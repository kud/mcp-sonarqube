<div align="center">

🔍

# SonarQube MCP

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![npm](https://img.shields.io/npm/v/@kud/mcp-sonarqube?style=flat-square&color=CB3837)
![MIT](https://img.shields.io/badge/licence-MIT-22C55E?style=flat-square)

**MCP server for SonarQube — explain a red quality gate, search issues, read measures and source snippets.**

<a href="https://kud.io/projects/mcp-sonarqube">Website</a> · <a href="https://kud.io/projects/mcp-sonarqube/docs">Documentation</a>

</div>

## Features

- **Red gate, explained** — status, new-code period and every condition, with the failing ones listed first and ratings shown as A–E
- **Issue search** — filter a project's unresolved issues by severity, type, status, branch, pull request or new code, each with file, line, rule, message, author and date
- **Measures on demand** — read any metric (`coverage`, `bugs`, `new_coverage`, `sqale_rating`) for a project, branch or pull request
- **Source in context** — fetch the lines around an issue without leaving your MCP client
- **Strictly read-only** — all six tools are annotated read-only and idempotent; nothing in SonarQube is ever changed
- **Token stays private** — it is never returned, and is redacted from any error message
- **Zero-install usage** — run directly via `npx -y @kud/mcp-sonarqube@latest`

## Install

```sh
npm install -g @kud/mcp-sonarqube
```

Or use without installing via `npx` (see Configuration below). Requires Node.js 22 or later.

## Usage

Set the host and a token, then start the server over stdio:

```sh
SONAR_HOST_URL=https://sonarqube.example.com \
SONAR_TOKEN=your-token \
npx -y @kud/mcp-sonarqube@latest
```

Your MCP client then exposes six tools:

| Tool                     | What it does                                                   | Inputs                                                                                           |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `sonarqube_quality_gate` | Explains why a quality gate is red, failing conditions first   | `project`, `branch?`, `pullRequest?`                                                             |
| `sonarqube_issues`       | Searches unresolved issues                                     | `project`, `newCode?`, `severities?`, `types?`, `statuses?`, `branch?`, `pullRequest?`, `limit?` |
| `sonarqube_measures`     | Reads measures such as `coverage`, `bugs` or `new_coverage`    | `project`, `metricKeys`, `branch?`, `pullRequest?`                                               |
| `sonarqube_issue_source` | Shows the source lines around an issue                         | `component`, `line`, `contextLines?`                                                             |
| `sonarqube_branches`     | Lists branches with quality gate status and last analysis date | `project`                                                                                        |
| `sonarqube_projects`     | Lists or searches the projects the token can see               | `query?`, `limit?`                                                                               |

A few details worth knowing:

- `severities` accepts `INFO`, `MINOR`, `MAJOR`, `CRITICAL`, `BLOCKER`; `types` accepts `CODE_SMELL`, `BUG`, `VULNERABILITY`.
- `statuses` defaults to unresolved issues. `limit` defaults to 10 for issues and 50 for projects, with a maximum of 500.
- `sonarqube_issue_source` takes the `component` and `line` exactly as `sonarqube_issues` returns them, for example `my-project:src/index.ts`. `contextLines` defaults to 5, maximum 50.

Typical questions to put to your client: "why is the gate red on my-project?", "list the blocker bugs in new code on pull request 42", "what is the new coverage on the main branch?".

## Configuration

SonarQube MCP works with any MCP-compatible client — Claude Desktop, Cursor, Cline, Zed, Continue, and others. Register it in your client's MCP server configuration:

```json
{
  "mcpServers": {
    "sonarqube": {
      "command": "npx",
      "args": ["-y", "@kud/mcp-sonarqube@latest"],
      "env": {
        "SONAR_HOST_URL": "https://sonarqube.example.com",
        "SONAR_TOKEN": "<your-token>"
      }
    }
  }
}
```

The config file and its exact location depend on your client. Claude Desktop, for example, uses `claude_desktop_config.json` (Settings → Developer → Edit Config).

For a self-hosted instance on your own machine, point the host at it directly, for example `http://127.0.0.1:9000`.

### Claude Code plugin

If you use Claude Code, the server is also available as the `sonarqube` plugin from the [kud/claude-plugins](https://github.com/kud/claude-plugins) marketplace:

```sh
/plugin marketplace add kud/claude-plugins
/plugin install sonarqube@kud
```

### Environment variables

Configuration is resolved by the `@kud/sonarqube` core. The first variable set wins; there is no default host, and the server exits at start-up without one.

| Setting | Environment variables, in order                                    | Required                  |
| ------- | ------------------------------------------------------------------ | ------------------------- |
| Host    | `SONARQUBE_DASH_HOST`, then `SONAR_HOST_URL`                       | Yes                       |
| Token   | `SONARQUBE_DASH_TOKEN`, then `SONARQUBE_TOKEN`, then `SONAR_TOKEN` | Yes, for private projects |

Both can also come from the config file shared with the `sonarqube-dash` CLI, at `$XDG_CONFIG_HOME/sonarqube-dash-cli/config.json` (default `~/.config/sonarqube-dash-cli/config.json`), using the keys `host` and `token`. Environment variables take precedence over the file.

## Development

```sh
git clone https://github.com/kud/mcp-sonarqube.git
cd mcp-sonarqube
npm install
npm run dev
```

To test interactively with the MCP Inspector:

```sh
npm run inspect:dev
```

All HTTP, authentication and config resolution live in the `@kud/sonarqube` core; this package only validates tool input, calls the client and shapes the output.

📚 **Full documentation → [mcp-sonarqube/docs](https://kud.io/projects/mcp-sonarqube/docs)**
