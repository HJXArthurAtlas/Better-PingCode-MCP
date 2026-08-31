# better-pingcode

PingCode MCP server and CLI (`pingcode`). Provides both a command-line interface for humans and an MCP server for AI agents.

Also available in [中文](README.zh.md).

## Install / Run

No installation required. Use with `npx -y`:

```bash
# Run the CLI
npx -y @arthuratlas/better-pingcode --help

# Start the MCP server
npx -y @arthuratlas/better-pingcode --mcp
```

You can also install it globally:

```bash
npm install -g @arthuratlas/better-pingcode
pingcode --help
pingcode --mcp
pingcode init
```

## CLI Usage

### Authentication

Use `pingcode init` to authenticate and configure MCP clients in one step:

```bash
pingcode init --client-id ID --client-secret SECRET
```

Check status:

```bash
pingcode auth status
```

### Workspace Context

Interactive setup:

```bash
pingcode context init
```

Non-interactive setup:

```bash
pingcode context set-current-project PROJECT_ID_OR_NAME
pingcode context set-current-sprint SPRINT_ID_OR_NAME
pingcode context set-current-user USER_ID_OR_NAME
pingcode context list
```

### Work Items

```bash
# List my open tasks
pingcode workitem list --assignee @me --state "In Progress" --compact

# Get by identifier
pingcode workitem get SCR-123 --compact

# Create a task
pingcode workitem create --title "Fix login" --type task --project "Core" --sprint "Sprint 1" --dry-run

# Update state
pingcode workitem update SCR-123 --state "Done" --dry-run
```

### Init

Authenticate and configure supported AI clients in one command:

```bash
# 1. Enter client id/secret, 2. pick clients, 3. confirm
pingcode init

# Non-interactive: authenticate + configure all clients
pingcode init --all --yes --client-id ID --client-secret SECRET

# Configure specific clients
pingcode init --tool codex --tool opencode

# Preview the changes without writing files
pingcode init --all --dry-run
```

Interactive selection keybindings:

- `↑` / `↓` to move the cursor
- `Space` to toggle selection
- `Backspace` to delete a search filter character
- `Enter` to confirm
- Files are only written after the final confirmation

The command updates each tool's global (user-level) MCP config:

- Codex: `~/.codex/config.toml`
- OpenCode: `~/.config/opencode/opencode.json`
- Oh My Pi: `~/.omp/agent/mcp.json`

Existing entries for other MCP servers are preserved; the `pingcode` entry is added or replaced incrementally.

## MCP Usage

Add to your MCP client config (e.g., Claude Desktop, Cursor, Cline):

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

The MCP server reads `PINGCODE_CLIENT_ID` and `PINGCODE_CLIENT_SECRET` from the environment provided by the MCP host. You can also pass `base_url`, `client_id`, `client_secret` in tool arguments.

### Available Tools

- `pingcode_auth_status` — Check authentication status.
- `pingcode_auth_get_authorization_url` — Get OAuth2 URL for user-token login.
- `pingcode_auth_exchange_code` — Exchange authorization code for token.
- `pingcode_list_projects` — List projects.
- `pingcode_list_sprints` — List sprints for a project.
- `pingcode_list_users` — List users for a project.
- `pingcode_context_set` — Set current project/sprint/user.
- `pingcode_context_get` — Show current workspace context.
- `pingcode_workitem_list` — List work items.
- `pingcode_workitem_get` — Get a single work item.
- `pingcode_workitem_create` — Create a work item.
- `pingcode_workitem_update` — Update a work item.

### MCP Authentication Flow

1. Ask the agent to call `pingcode_auth_get_authorization_url`.
2. Open the returned URL in a browser and authorize.
3. Call `pingcode_auth_exchange_code` with the authorization code.
4. Subsequent tool calls will use the cached user token.

Alternatively, if you only need enterprise-token access, just ensure `PINGCODE_CLIENT_ID` and `PINGCODE_CLIENT_SECRET` are set; the server will use `client_credentials` automatically.

## Notes

- Node.js >=18 is required.
- No skill/markdown installation is provided; agents connect via MCP directly.
- Token cache: `~/.cache/bpingcode/token.json`
- Workspace cache: `.bpingcode/cache.json`
- Stubs are present for `comment`, `attachment`, `idea`, and `product` CLI modules; they are not yet implemented.
