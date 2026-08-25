# Kimi Datasource Bridge

简体中文 | [English](README.en.md)

让 Codex、Claude Code、OpenCode 通过本机已经登录的 Kimi Code，调用其托管的 `kimi-datasource` 数据源插件。不需要分别在三个 Agent 里注册 Kimi 的原始 MCP 服务。

## 使用前须知

1. **这个仓库不包含数据库本身。** 它通过 `kimi -p` 调用你本机 Kimi Code 中已经安装的托管数据源插件。
2. **Agent 和 Kimi Code 必须运行在同一个本地环境。** 如果 Agent 在云端、Docker、远程服务器或另一台电脑上，它无法使用只存在于本机的 Kimi 登录状态。
3. **只需要登录 Kimi Code。** Codex、Claude Code、OpenCode 不需要分别登录 Kimi；它们共用当前系统用户目录下的 Kimi OAuth 凭据。
4. **不要直接注册 Kimi 数据源的原始 STDIO MCP。** 原始进程虽然可以读取当前 access token，但不能独立完成 OAuth 刷新。本 Skill 始终让 Kimi Code 作为认证宿主。
5. **每次正式查询会消耗一次 Kimi Code 模型调用。** Skill 会优先选择配置中映射到 `managed:kimi-code` 的模型，即使你的 Kimi 默认模型是其他 provider。
6. **仅用于只读的公开或已授权数据查询。** 不执行交易、发布、评论等写操作，也不提供投资建议。

## 最短上手

### 第一步：确认运行条件

需要准备：

- Node.js 18 或更高版本
- 本机已经安装 Kimi Code CLI
- Kimi Code 已经安装托管的 `kimi-datasource` 插件
- Kimi 配置中至少有一个模型使用 `managed:kimi-code` provider
- Kimi Code 已完成登录

先检查命令是否存在：

```bash
node --version
kimi --version
```

如果 Kimi 尚未登录或登录已经失效：

```bash
kimi login --region mainland-cn
```

### 第二步：克隆并安装 Skill

只需要克隆一份仓库：

```bash
git clone https://github.com/c2bjjn6xg7-collab/kimi-datasource-bridge.git
cd kimi-datasource-bridge
node scripts/install.mjs --agent all
```

`--agent all` 会把同一份仓库注册给三个 Agent：

| Agent | 创建的入口 |
| --- | --- |
| Codex | `~/.agents/skills/kimi-datasource-bridge` |
| Claude Code | `~/.claude/skills/kimi-datasource-bridge` |
| OpenCode | `~/.config/opencode/skills/kimi-datasource-bridge` |

安装器只创建指向当前仓库的链接，不会复制三份代码。因此安装后请保留这个仓库目录，不要移动或删除它。

如果只使用其中一个 Agent：

```bash
# 只安装到 Codex
node scripts/install.mjs --agent codex

# 只安装到 Claude Code
node scripts/install.mjs --agent claude

# 只安装到 OpenCode
node scripts/install.mjs --agent opencode
```

只想预览安装器会做什么：

```bash
node scripts/install.mjs --agent all --dry-run
```

安装器不会覆盖已经存在的其他 Skill 文件或目录。macOS/Linux 使用软链接，Windows 使用目录 junction。

### 第三步：重新打开 Agent

安装完成后重新启动 Codex、Claude Code 或 OpenCode。如果当前会话支持自动发现，也可以先在新对话中尝试；找不到 Skill 时再重启。

### 第四步：开始查询

Codex：

```text
$kimi-datasource-bridge 查询科创50指数最新可用的估值数据
```

Claude Code：

```text
/kimi-datasource-bridge 查询中国 2015-2024 年 GDP
```

OpenCode：

```text
请使用 kimi-datasource-bridge 查询宁德时代 2024 年财务数据
```

也可以直接用自然语言提问，由 Agent 根据 Skill 的描述自动决定是否调用；第一次使用时建议显式点名 `kimi-datasource-bridge`。

## 可以查询什么

常见数据包括：

- A股、港股、美股行情、财务、股东和机构持仓
- 基金、债券、指数和宏观数据
- SEC EDGAR、World Bank、IMF、FRED、中国国家统计局
- 中国企业工商、股东和司法风险
- arXiv、Scholar 等学术论文
- 中国法律法规、判例和国家/行业标准
- 新华财经、财新及其他已授权数据

实际可用范围取决于当前 Kimi 账户、插件版本和数据源授权。

## 验证环境

在仓库目录执行：

```bash
node scripts/preflight.mjs
```

正常情况下会返回 JSON，并包含：

```json
{
  "ok": true
}
```

直接测试一次查询：

```bash
node scripts/query.mjs --source china_nbs --query "中国 2015-2024 年 GDP"
```

正式查询会消耗一次 Kimi Code 模型调用。

## 常见问题

### `AUTH_REQUIRED`

Kimi 登录失效，重新登录：

```bash
kimi login --region mainland-cn
```

不要把 access token 或 refresh token 发给 Agent。

### `NO_MANAGED_MODEL`

Kimi 的 `config.toml` 中没有模型映射到 `managed:kimi-code`。需要恢复一个 Kimi 托管模型后再运行查询。

### `PREFLIGHT_FAILED`

先运行：

```bash
node scripts/preflight.mjs
```

根据返回的 `errors` 检查 Node.js、Kimi CLI、插件、模型配置或登录状态。

### Agent 提示找不到 Skill

1. 确认安装命令执行成功。
2. 确认对应入口存在。
3. 确认原始仓库目录没有被移动或删除。
4. 重新启动 Agent 后再试。

### 安装器提示目标已存在

安装器为了保护现有配置不会自动覆盖。先检查提示路径中的现有文件、目录或链接，确认其用途后再移动到其他位置，随后重新执行安装命令。

### 本机可以用，远程 Agent 不可以用

这是预期行为。远程环境必须单独安装 Node.js、Kimi Code、数据源插件并完成 Kimi 登录，才能使用这个 Skill。

## 更新

进入原始仓库目录更新即可。三个 Agent 的入口都指向同一目录，不需要重新安装：

```bash
git pull --ff-only
```

## 安全说明

- Bridge 不会打印或复制 Kimi token 的值。
- 不直接启动托管数据源的原始 STDIO MCP 服务。
- 数据文件默认写入临时目录。
- Skill 只负责查询和整理数据，不能替代专业的法律、财务或投资判断。

## 开源许可

MIT License
