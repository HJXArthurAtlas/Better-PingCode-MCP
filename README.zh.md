# better-pingcode

PingCode MCP server 与 CLI (`pingcode`)。同时提供面向人类的命令行界面和面向 AI agent 的 MCP server。

English version: [README.md](README.md)

## 安装 / 运行

无需安装，直接用 `npx -y`：

```bash
# 运行 CLI
npx -y @arthuratlas/better-pingcode --help

# 启动 MCP server
npx -y @arthuratlas/better-pingcode --mcp
```

也可以全局安装：

```bash
npm install -g @arthuratlas/better-pingcode
pingcode --help
pingcode --mcp
pingcode init
```

## CLI 用法

### 认证

使用 `pingcode init` 一步完成认证并配置 MCP 客户端：

```bash
pingcode init --client-id ID --client-secret SECRET
```

查看状态：

```bash
pingcode auth status
```

### 工作空间上下文

交互式设置：

```bash
pingcode context init
```

非交互式设置：

```bash
pingcode context set-current-project PROJECT_ID_OR_NAME
pingcode context set-current-sprint SPRINT_ID_OR_NAME
pingcode context set-current-user USER_ID_OR_NAME
pingcode context list
```

### 工作项

```bash
# 列出我的待办任务
pingcode workitem list --assignee @me --state 进行中 --compact

# 按标识符查询
pingcode workitem get SCR-123 --compact

# 创建任务
pingcode workitem create --title "Fix login" --type task --project "Core" --sprint "Sprint 1" --dry-run

# 更新状态
pingcode workitem update SCR-123 --state 已完成 --dry-run
```

### 初始化

一条命令完成认证并配置支持的 AI 客户端：

```bash
# 1. 输入 client id/secret，2. 选择客户端，3. 确认
pingcode init

# 非交互式：认证并配置所有客户端
pingcode init --all --yes --client-id ID --client-secret SECRET

# 配置指定客户端
pingcode init --tool codex --tool opencode

# 仅预览，不写入文件
pingcode init --all --dry-run
```

交互式选择快捷键：

- `↑` / `↓` 移动光标
- `Space` 勾选 / 取消勾选
- `Backspace` 删除搜索过滤字符
- `Enter` 确认选择
- 二次确认后才会真正写入文件

该命令会更新每个工具的全局（用户级）MCP 配置：

- Codex: `~/.codex/config.toml`
- OpenCode: `~/.config/opencode/opencode.json`
- Oh My Pi: `~/.omp/agent/mcp.json`

其他 MCP server 的现有配置会被保留；`pingcode` 条目会增量地添加或替换。

## MCP 用法

添加到你的 MCP 客户端配置（例如 Claude Desktop、Cursor、Cline）：

```json
{
  "mcpServers": {
    "pingcode": {
      "command": "npx",
      "args": ["-y", "@arthuratlas/better-pingcode@latest", "--mcp"],
      "env": {
        "PINGCODE_CLIENT_ID": "your-client-id",
        "PINGCODE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

MCP server 从 MCP host 提供的环境中读取 `PINGCODE_CLIENT_ID` 和 `PINGCODE_CLIENT_SECRET`。你也可以在 tool 参数中传入 `base_url`、`client_id`、`client_secret`。

### 可用 Tools

- `pingcode_auth_status` — 检查认证状态。
- `pingcode_auth_get_authorization_url` — 获取用户 token 登录的 OAuth2 URL。
- `pingcode_auth_exchange_code` — 用授权码换取 token。
- `pingcode_list_projects` — 列出项目。
- `pingcode_list_sprints` — 列出项目下的迭代。
- `pingcode_list_users` — 列出项目成员。
- `pingcode_context_set` — 设置当前项目/迭代/用户。
- `pingcode_context_get` — 显示当前工作空间上下文。
- `pingcode_workitem_list` — 列出工作项。
- `pingcode_workitem_get` — 获取单个工作项。
- `pingcode_workitem_create` — 创建工作项。
- `pingcode_workitem_update` — 更新工作项。

### MCP 认证流程

1. 让 agent 调用 `pingcode_auth_get_authorization_url`。
2. 在浏览器中打开返回的 URL 并授权。
3. 用授权码调用 `pingcode_auth_exchange_code`。
4. 后续 tool 调用会使用缓存的用户 token。

如果你只需要企业级 token 访问，只需确保设置了 `PINGCODE_CLIENT_ID` 和 `PINGCODE_CLIENT_SECRET`；server 会自动使用 `client_credentials`。

## 说明

- 需要 Node.js >=18。
- 不需要安装 skill/markdown；agent 直接通过 MCP 连接。
- Token 缓存：`~/.cache/bpingcode/token.json`
- 工作空间缓存：`.bpingcode/cache.json`
- `comment`、`attachment`、`idea`、`product` 这几个 CLI 模块目前是占位实现，尚未完整实现。
