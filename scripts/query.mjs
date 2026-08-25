#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { inspectEnvironment } from './preflight.mjs';

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 2 * 1024 * 1024;

function usage() {
  return `Usage:
  node query.mjs --query "request" [--source name] [--describe-only]

Options:
  -q, --query <text>       Natural-language data request.
  --source <name>          Preserve a user-selected Kimi data source.
  --describe-only          Require get_data_source_desc but no data call.
  --model <alias>          Managed Kimi model alias; must map to managed:kimi-code.
  --timeout-seconds <n>    Process timeout, default 300.
  --include-events         Include parsed Kimi stream events in the JSON result.
  -h, --help               Show this help.
`;
}

function parseArgs(argv) {
  const result = {
    query: undefined,
    source: undefined,
    describeOnly: false,
    model: undefined,
    timeoutSeconds: 300,
    includeEvents: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--describe-only') {
      result.describeOnly = true;
      continue;
    }
    if (arg === '--include-events') {
      result.includeEvents = true;
      continue;
    }
    if (['--query', '-q', '--source', '--model', '--timeout-seconds'].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === '--query' || arg === '-q') result.query = value;
      if (arg === '--source') result.source = value;
      if (arg === '--model') result.model = value;
      if (arg === '--timeout-seconds') result.timeoutSeconds = Number(value);
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    positional.push(arg);
  }

  if (!result.query && positional.length > 0) result.query = positional.join(' ');
  if (!result.query?.trim()) throw new Error('A non-empty query is required.');
  if (!Number.isFinite(result.timeoutSeconds) || result.timeoutSeconds < 10 || result.timeoutSeconds > 1800) {
    throw new Error('--timeout-seconds must be between 10 and 1800.');
  }
  return result;
}

function buildPrompt(options) {
  const sourceInstruction = options.source
    ? `用户已经指定数据源为 ${JSON.stringify(options.source)}；必须使用这个数据源，不要改用其他源。`
    : '用户未必指定数据源。根据 Kimi Code 中的 kimi-datasource skill 只选择一个最匹配的数据源。';
  const callInstruction = options.describeOnly
    ? '这是能力描述请求：调用 get_data_source_desc 后即可回答，不要调用实际取数 API。'
    : '这是实际数据请求：必须先调用 get_data_source_desc，再根据返回文档调用 call_data_source_tool。仅返回描述不算完成。';

  return `你正在 Kimi Code 宿主中执行一次受控、只读的结构化数据查询。

必须使用已安装的 kimi-datasource 插件。不要依靠模型记忆伪造数据，也不要用普通网页搜索代替数据库取数。只有核对股票代码或企业全称确有必要时，才可使用 Kimi Code 的搜索能力辅助确认实体。

${sourceInstruction}
${callInstruction}

遵守插件自己的工作流和参数文档：一次简单查询只使用一个数据源；先读取该源的当前 desc；多数完整结果写到 /tmp 下的 CSV；成功覆盖用户问题后立即停止。不要读取、显示或修改任何 Kimi 凭据，不要修改自选股，不要执行发布、评论、交易等写操作。不得提供投资建议。

最终用用户提问时的语言回答。明确数据源、时间范围、单位和必要的口径；如生成 CSV，列出路径。若工具失败，直接说明工具返回的真实原因，不要编造答案。

<user_request>
${options.query.trim()}
</user_request>`;
}

function runKimi(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: tmpdir(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        overflow = `Kimi output exceeded ${MAX_STDOUT_BYTES} bytes.`;
        child.kill('SIGTERM');
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, overflow, timedOut });
    });
  });
}

function parseEvents(stdout) {
  const events = [];
  const invalidLines = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      invalidLines.push(line);
    }
  }
  return { events, invalidLines };
}

function toolCallsFrom(events) {
  const calls = [];
  for (const event of events) {
    if (!Array.isArray(event?.tool_calls)) continue;
    for (const call of event.tool_calls) {
      const name = call?.function?.name;
      if (typeof name !== 'string') continue;
      let argumentsValue = call.function.arguments;
      if (typeof argumentsValue === 'string') {
        try {
          argumentsValue = JSON.parse(argumentsValue);
        } catch {
          // Preserve the original string for diagnostics.
        }
      }
      calls.push({ id: call.id, name, arguments: argumentsValue });
    }
  }
  return calls;
}

function extractFiles(text) {
  const matches = text.match(/\/tmp\/[A-Za-z0-9._/-]+\.(?:csv|json|xlsx|parquet)/gi) ?? [];
  return [...new Set(matches.map((value) => value.replace(/[),.;:]+$/, '')))];
}

function resultError(code, message, extra = {}) {
  return { ok: false, code, error: message, ...extra };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify(resultError('INVALID_ARGUMENT', error.message), null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const environment = await inspectEnvironment();
  if (!environment.ok) {
    process.stdout.write(`${JSON.stringify(resultError('PREFLIGHT_FAILED', 'Kimi datasource preflight failed.', {
      details: environment.errors,
      warnings: environment.warnings,
    }), null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const model = options.model ?? environment.config.selected_model;
  if (!environment.config.managed_models.includes(model)) {
    process.stdout.write(`${JSON.stringify(resultError('NO_MANAGED_MODEL', `${model} is not mapped to managed:kimi-code.`, {
      managed_models: environment.config.managed_models,
    }), null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  const prompt = buildPrompt(options);
  let execution;
  try {
    execution = await runKimi(
      environment.kimi.path,
      ['-m', model, '-p', prompt, '--output-format', 'stream-json'],
      options.timeoutSeconds * 1000,
    );
  } catch (error) {
    process.stdout.write(`${JSON.stringify(resultError('KIMI_START_FAILED', error.message), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  if (execution.overflow) {
    process.stdout.write(`${JSON.stringify(resultError('OUTPUT_TOO_LARGE', execution.overflow), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const parsed = parseEvents(execution.stdout);
  const toolCalls = toolCallsFrom(parsed.events);
  const datasourceCalls = toolCalls.filter((call) => call.name.includes('plugin-kimi-datasource_data'));
  const assistantMessages = parsed.events
    .filter((event) => event?.role === 'assistant' && typeof event.content === 'string')
    .map((event) => event.content.trim())
    .filter(Boolean);
  const toolMessages = parsed.events
    .filter((event) => event?.role === 'tool' && typeof event.content === 'string')
    .map((event) => event.content);
  const dataToolCallIds = new Set(
    datasourceCalls
      .filter((call) => call.name.endsWith('__call_data_source_tool'))
      .map((call) => call.id)
      .filter(Boolean),
  );
  const dataToolMessages = parsed.events
    .filter(
      (event) =>
        event?.role === 'tool' &&
        typeof event.content === 'string' &&
        dataToolCallIds.has(event.tool_call_id),
    )
    .map((event) => event.content);
  const sessionId = parsed.events.find((event) => event?.type === 'session.resume_hint')?.session_id;
  const answer = assistantMessages.at(-1);
  const diagnosticText = [...assistantMessages, ...toolMessages, execution.stderr].join('\n');
  const common = {
    model,
    session_id: sessionId,
    datasource_tools: datasourceCalls.map((call) => call.name),
    files: extractFiles([answer ?? '', ...dataToolMessages].join('\n')),
    warnings: environment.warnings,
    ...(options.includeEvents ? { events: parsed.events, invalid_output_lines: parsed.invalidLines } : {}),
  };

  if (/access_token was rejected|credentials file not found|run \/login|run kimi login/i.test(diagnosticText)) {
    process.stdout.write(`${JSON.stringify(resultError(
      'AUTH_REQUIRED',
      'Kimi OAuth authentication must be renewed. Run: kimi login --region mainland-cn',
      common,
    ), null, 2)}\n`);
    process.exitCode = 3;
    return;
  }

  if (execution.timedOut) {
    process.stdout.write(`${JSON.stringify(resultError('TIMEOUT', 'Kimi query timed out.', common), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  if (execution.code !== 0) {
    process.stdout.write(`${JSON.stringify(resultError(
      'KIMI_FAILED',
      execution.stderr.trim() || `Kimi exited with code ${execution.code}.`,
      common,
    ), null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const descUsed = datasourceCalls.some((call) => call.name.endsWith('__get_data_source_desc'));
  const dataUsed = datasourceCalls.some((call) => call.name.endsWith('__call_data_source_tool'));
  if (!descUsed) {
    process.stdout.write(`${JSON.stringify(resultError(
      'DATASOURCE_NOT_USED',
      'Kimi did not call kimi-datasource get_data_source_desc.',
      { ...common, answer },
    ), null, 2)}\n`);
    process.exitCode = 4;
    return;
  }
  if (!options.describeOnly && !dataUsed) {
    process.stdout.write(`${JSON.stringify(resultError(
      'INCOMPLETE_TOOL_SEQUENCE',
      'Kimi read the datasource description but did not call the data tool.',
      { ...common, answer },
    ), null, 2)}\n`);
    process.exitCode = 4;
    return;
  }
  if (!answer) {
    process.stdout.write(`${JSON.stringify(resultError('NO_FINAL_ANSWER', 'Kimi returned no final answer.', common), null, 2)}\n`);
    process.exitCode = 4;
    return;
  }

  process.stdout.write(`${JSON.stringify({ ok: true, code: 'OK', answer, ...common }, null, 2)}\n`);
}

await main();
