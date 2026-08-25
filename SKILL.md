---
name: kimi-datasource-bridge
description: Bridge a local coding agent to Kimi Code's managed kimi-datasource plugin through the authenticated `kimi -p` host. Use for structured public or authorized financial, macroeconomic, company, academic, Chinese legal, standards, official-statistics, international-organization, Xinhua Finance, or Caixin data. Not for generic web search, investment advice, or write actions.
license: MIT
---

# Kimi Datasource Bridge

This skill uses Kimi Code as the authenticated host for Kimi's managed `kimi-datasource` plugin. Do not register or invoke the plugin's raw STDIO server directly: that process can read the current access token but cannot refresh it by itself.

## Bundled script paths

Resolve every bundled script relative to the directory containing this loaded `SKILL.md`. Call that absolute directory `<skill-root>` in the commands below. Replace the placeholder before execution; never run a literal `<skill-root>` path or assume the current project directory is the skill directory.

## Workflow

1. Run the environment check before the first query in a turn:

   ```bash
   node "<skill-root>/scripts/preflight.mjs"
   ```

2. For an actual data request, pass the user's request intact to the wrapper:

   ```bash
   node "<skill-root>/scripts/query.mjs" --query "中国 2015-2024 年 GDP"
   ```

   When the user names a source, preserve that choice:

   ```bash
   node "<skill-root>/scripts/query.mjs" --source china_nbs --query "中国 2015-2024 年 GDP"
   ```

3. Read the returned JSON. Treat the run as successful only when `ok` is `true`. Use `answer` as the factual response and read any paths in `files` only when further analysis or visualization is requested.

4. For a capability check that should call only `get_data_source_desc`, add `--describe-only`. Do not use this flag for a normal data request.

The wrapper selects a model configured with provider `managed:kimi-code` and explicitly passes it to `kimi -m ... -p ...`. This keeps OAuth refresh inside the Kimi Code host even if the user's general default model later changes to a static API-key provider.

## Data routing

Let the managed Kimi plugin choose one suitable source unless the user names one. Its structured sources include stock and company financials, Yahoo Finance, Wind, SEC EDGAR, S&P Capital IQ, World Bank, IMF, FRED, China NBS, Tianyancha, arXiv, Scholar, Chinese laws and cases, Chinese standards, WHO, FAO, UNSD, ECB, Eurostat, UNICEF, OECD, Xinhua Finance, and Caixin.

Preserve these constraints:

- Query one specialized source at a time unless the user explicitly requests a comparison.
- The Kimi agent must call `get_data_source_desc` before `call_data_source_tool`; the wrapper verifies this observable tool sequence.
- Stock codes and company legal names must be verified rather than guessed.
- Data files should be written under `/tmp`; never expose or copy Kimi credential files.
- Do not provide investment advice. Distinguish retrieved data from interpretation.

## Failures

- `AUTH_REQUIRED`: tell the user to run `kimi login --region mainland-cn`; do not print, inspect, or request tokens.
- `NO_MANAGED_MODEL`: the Kimi config has no model mapped to `managed:kimi-code`. Ask the user to restore a managed Kimi model.
- `DATASOURCE_NOT_USED` or `INCOMPLETE_TOOL_SEQUENCE`: report that Kimi did not execute the required plugin workflow; retry once with `--source` only when the correct source is clear.
- Backend schema or data-source errors: report the returned human-readable error. Do not invent parameters or silently switch sources.

The wrapper consumes a Kimi Code model turn and may take tens of seconds. Stop after the first sufficient successful result.
