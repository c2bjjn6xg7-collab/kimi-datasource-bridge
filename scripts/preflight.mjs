#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_OAUTH_HOST = 'https://auth.kimi.com';
const DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1';

function parseTomlString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function parseKimiConfig(text) {
  let section = '';
  let defaultModel;
  const models = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = parseTomlString(rawValue);

    if (section === '' && key === 'default_model') defaultModel = value;

    const modelSection = section.match(/^models\.(?:"([^"]+)"|'([^']+)'|(.+))$/);
    if (!modelSection) continue;
    const alias = modelSection[1] ?? modelSection[2] ?? modelSection[3];
    const existing = models.get(alias) ?? {};
    existing[key] = value;
    models.set(alias, existing);
  }

  return { defaultModel, models };
}

function normalizeEndpoint(value) {
  return value.trim().replace(/\/+$/, '');
}

function credentialName() {
  const oauthHost = normalizeEndpoint(
    process.env.KIMI_CODE_OAUTH_HOST ?? process.env.KIMI_OAUTH_HOST ?? DEFAULT_OAUTH_HOST,
  );
  const baseUrl = normalizeEndpoint(process.env.KIMI_CODE_BASE_URL ?? DEFAULT_BASE_URL);
  if (oauthHost === DEFAULT_OAUTH_HOST && baseUrl === DEFAULT_BASE_URL) return 'kimi-code';
  const digest = createHash('sha256')
    .update(JSON.stringify({ oauthHost, baseUrl }))
    .digest('hex')
    .slice(0, 16);
  return `kimi-code-env-${digest}`;
}

async function isExecutable(candidate) {
  if (!candidate.includes(path.sep)) return true;
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findKimi() {
  const candidates = [
    process.env.KIMI_CODE_CLI,
    path.join(homedir(), '.kimi-code', 'bin', process.platform === 'win32' ? 'kimi.exe' : 'kimi'),
    'kimi',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (!result.error && result.status === 0) {
      return { path: candidate, version: result.stdout.trim() || result.stderr.trim() };
    }
  }
  return undefined;
}

export async function inspectEnvironment() {
  const errors = [];
  const warnings = [];
  const kimiHome = process.env.KIMI_CODE_HOME?.trim() || path.join(homedir(), '.kimi-code');
  const configPath = path.join(kimiHome, 'config.toml');
  const pluginDir = path.join(kimiHome, 'plugins', 'managed', 'kimi-datasource');
  const pluginManifestPath = path.join(pluginDir, 'kimi.plugin.json');
  const credentialPath = path.join(kimiHome, 'credentials', `${credentialName()}.json`);

  const kimi = await findKimi();
  if (!kimi) errors.push('Kimi Code CLI was not found. Install Kimi Code or set KIMI_CODE_CLI.');

  let config;
  try {
    config = parseKimiConfig(await readFile(configPath, 'utf8'));
  } catch (error) {
    errors.push(`Unable to read Kimi config: ${error instanceof Error ? error.message : String(error)}`);
    config = { defaultModel: undefined, models: new Map() };
  }

  const managedModels = [...config.models.entries()]
    .filter(([, value]) => value.provider === 'managed:kimi-code')
    .map(([alias]) => alias);
  const defaultProvider = config.defaultModel
    ? config.models.get(config.defaultModel)?.provider
    : undefined;
  const selectedModel =
    (defaultProvider === 'managed:kimi-code' ? config.defaultModel : undefined) ??
    (managedModels.includes('kimi-code/k3-256k') ? 'kimi-code/k3-256k' : managedModels[0]);

  if (managedModels.length === 0) {
    errors.push('No model mapped to provider managed:kimi-code was found in config.toml.');
  } else if (defaultProvider !== 'managed:kimi-code') {
    warnings.push(`Default model is not managed OAuth; the query wrapper will force ${selectedModel}.`);
  }

  let plugin;
  try {
    plugin = JSON.parse(await readFile(pluginManifestPath, 'utf8'));
  } catch (error) {
    errors.push(`Unable to read kimi-datasource plugin manifest: ${error instanceof Error ? error.message : String(error)}`);
  }

  let credentialSummary;
  try {
    const credential = JSON.parse(await readFile(credentialPath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = Number.isFinite(Number(credential.expires_at))
      ? Number(credential.expires_at)
      : undefined;
    credentialSummary = {
      present: true,
      has_access_token: typeof credential.access_token === 'string' && credential.access_token.length > 0,
      has_refresh_token: typeof credential.refresh_token === 'string' && credential.refresh_token.length > 0,
      expires_at: expiresAt,
      seconds_remaining: expiresAt === undefined ? undefined : expiresAt - now,
      expired: expiresAt === undefined ? undefined : expiresAt <= now,
      scope: typeof credential.scope === 'string' ? credential.scope : undefined,
    };
    if (!credentialSummary.has_refresh_token) {
      errors.push('Kimi credentials do not contain a refresh token. Run kimi login.');
    } else if (!credentialSummary.has_access_token || credentialSummary.expired) {
      warnings.push('The current access token is missing or expired; the managed Kimi host must refresh it.');
    }
  } catch (error) {
    credentialSummary = { present: false };
    errors.push(`Unable to read Kimi OAuth credentials: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ok: errors.length === 0,
    kimi: kimi ?? null,
    kimi_home: kimiHome,
    config: {
      path: configPath,
      default_model: config.defaultModel,
      default_provider: defaultProvider,
      managed_models: managedModels,
      selected_model: selectedModel,
    },
    plugin: plugin
      ? {
          path: pluginManifestPath,
          name: plugin.name,
          version: plugin.version,
          mcp_servers: Object.keys(plugin.mcpServers ?? {}),
        }
      : null,
    credentials: credentialSummary,
    warnings,
    errors,
  };
}

async function main() {
  const result = await inspectEnvironment();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await main();
