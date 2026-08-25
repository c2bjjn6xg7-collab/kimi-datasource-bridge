# Kimi Datasource Bridge

Use Kimi Code's authenticated, managed `kimi-datasource` plugin from Codex, Claude Code, or OpenCode without registering the plugin's raw MCP process in each agent.

The skill delegates each read-only data request to `kimi -p`. Kimi Code remains the authenticated host, selects a `managed:kimi-code` model, refreshes OAuth when possible, and runs the original managed datasource workflow.

## Requirements

- Node.js 18 or newer
- Kimi Code CLI installed locally
- Kimi Code logged in with `kimi login --region mainland-cn`
- The managed `kimi-datasource` plugin installed by Kimi Code
- At least one Kimi model mapped to the `managed:kimi-code` provider

The coding agent and Kimi Code must run in the same local environment. A remote container or cloud agent cannot use credentials stored only on another machine.

## Install one repository for multiple agents

Clone the repository once, keep that clone, and register it with any supported hosts:

```bash
git clone https://github.com/c2bjjn6xg7-collab/kimi-datasource-bridge.git
cd kimi-datasource-bridge
node scripts/install.mjs --agent all
```

The installer creates links to the same checkout; it does not copy the skill:

| Host | Link created |
| --- | --- |
| Codex | `~/.agents/skills/kimi-datasource-bridge` |
| Claude Code | `~/.claude/skills/kimi-datasource-bridge` |
| OpenCode | `~/.config/opencode/skills/kimi-datasource-bridge` |

Install only selected hosts by repeating `--agent`:

```bash
node scripts/install.mjs --agent codex --agent opencode
```

Preview changes without writing anything:

```bash
node scripts/install.mjs --agent all --dry-run
```

The installer refuses to overwrite an existing file, directory, or link that points elsewhere. On Windows it creates directory junctions; on macOS and Linux it creates symbolic links. Restart the host if a newly installed skill is not discovered immediately.

## Invoke

- Codex: mention `$kimi-datasource-bridge` or ask for a supported structured-data query.
- Claude Code: run `/kimi-datasource-bridge` or ask Claude to use it.
- OpenCode: ask the agent to use `kimi-datasource-bridge`; OpenCode loads it through its skill tool.

Examples:

```text
Use kimi-datasource-bridge to query China's annual GDP from 2015 to 2024.
Use kimi-datasource-bridge to find the latest available valuation data for the STAR 50 index.
Use kimi-datasource-bridge with china_nbs to query China's historical CPI.
```

## Verify the local environment

Run the preflight directly from the checkout:

```bash
node scripts/preflight.mjs
```

For a direct query test:

```bash
node scripts/query.mjs --source china_nbs --query "中国 2015-2024 年 GDP"
```

Successful commands return JSON with `"ok": true`. Querying consumes a Kimi Code model turn.

## Update

Pull the existing checkout. Because every host link points to the same directory, no reinstall is required:

```bash
git pull --ff-only
```

## Security

- The bridge never prints or copies Kimi token values.
- It does not invoke the managed datasource's raw STDIO MCP server directly.
- It is designed for read-only public or authorized data queries and does not perform trades or other write actions.

## License

MIT
