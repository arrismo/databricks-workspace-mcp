# databricks-workspace-mcp

A local MCP server in Python that connects to a Databricks workspace and exposes workspace file tools.

## Tools exposed

- `list_files(path)` — list files/folders at a workspace path
- `read_file(path)` — export and return file content (notebook/script)
- `search_files(query, path)` — search by filename under a path
- `get_file_info(path)` — return metadata (type, size, modified time)

## Requirements

- Python 3.10+
- Databricks workspace URL + token
- Environment variables:
  - `DATABRICKS_HOST`
  - `DATABRICKS_TOKEN`

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install .
```

Set auth env vars:

```bash
export DATABRICKS_HOST="https://<your-workspace-host>"
export DATABRICKS_TOKEN="<your-personal-access-token>"
```

Run the MCP server:

```bash
databricks-workspace-mcp
```

## MCP client config (Claude Code, Codex, Zed)

You can use one canonical server setup across MCP clients:

```json
{
  "servers": {
    "databricks-workspace": {
      "command": "databricks-workspace-mcp",
      "args": [],
      "env": {
        "DATABRICKS_HOST": "https://<your-workspace-host>",
        "DATABRICKS_TOKEN": "<your-personal-access-token>"
      }
    }
  }
}
```

Use this same configuration in Claude Code, Codex, or Zed (only the config file location/format wrapper may differ by client).

For VS Code Claude Code, a ready-to-edit version is included at `.vscode/mcp.json`.

