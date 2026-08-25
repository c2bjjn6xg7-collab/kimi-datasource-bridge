#!/usr/bin/env node

import { lstat, mkdir, readlink, realpath, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'kimi-datasource-bridge';
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_HOME = process.env.KIMI_DATASOURCE_INSTALL_HOME?.trim() || homedir();
const TARGETS = {
  codex: path.join(INSTALL_HOME, '.agents', 'skills', SKILL_NAME),
  claude: path.join(INSTALL_HOME, '.claude', 'skills', SKILL_NAME),
  opencode: path.join(INSTALL_HOME, '.config', 'opencode', 'skills', SKILL_NAME),
};

function usage() {
  return `Usage:
  node scripts/install.mjs [--agent all|codex|claude|opencode] [--dry-run]

Options:
  --agent <name>  Agent host to register. Repeat for multiple hosts. Default: all.
  --dry-run       Print the planned links without changing the filesystem.
  -h, --help      Show this help.
`;
}

function parseArgs(argv) {
  const agents = [];
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--agent') {
      const value = argv[index + 1];
      if (!value) throw new Error('--agent requires a value.');
      index += 1;
      if (!['all', ...Object.keys(TARGETS)].includes(value)) {
        throw new Error(`Unsupported agent: ${value}`);
      }
      agents.push(value);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const requested = agents.length === 0 || agents.includes('all')
    ? Object.keys(TARGETS)
    : [...new Set(agents)];
  return { agents: requested, dryRun };
}

async function inspectTarget(target) {
  try {
    const stat = await lstat(target);
    const resolved = stat.isSymbolicLink()
      ? path.resolve(path.dirname(target), await readlink(target))
      : target;
    try {
      return (await realpath(resolved)) === (await realpath(SOURCE_ROOT)) ? 'registered' : 'conflict';
    } catch {
      return 'conflict';
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return 'absent';
    throw error;
  }
}

async function register(agent, state, dryRun) {
  const target = TARGETS[agent];
  if (state === 'registered') return { agent, target, status: 'already-registered' };
  if (dryRun) return { agent, target, status: 'would-link' };

  await mkdir(path.dirname(target), { recursive: true });
  await symlink(SOURCE_ROOT, target, process.platform === 'win32' ? 'junction' : 'dir');
  return { agent, target, status: 'linked' };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const plans = [];
  try {
    for (const agent of options.agents) {
      plans.push({ agent, target: TARGETS[agent], state: await inspectTarget(TARGETS[agent]) });
    }
    const conflicts = plans.filter((plan) => plan.state === 'conflict');
    if (conflicts.length > 0) {
      const paths = conflicts.map((plan) => plan.target).join(', ');
      throw new Error(`Refusing to overwrite existing skill targets: ${paths}`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  try {
    for (const plan of plans) {
      results.push(await register(plan.agent, plan.state, options.dryRun));
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ source: SOURCE_ROOT, results }, null, 2)}\n`);
}

await main();
