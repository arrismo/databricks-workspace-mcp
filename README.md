# databricks-workspace-mcp

This repo now includes a VS Code extension to browse Databricks Workspace files in the Explorer side panel.

## VS Code extension location

- `vscode-extension/`

## What it does

Registers a read-only filesystem provider at:

- `dbws:/`

So you can open Databricks workspace paths directly in VS Code Explorer.

## Required auth

Set either extension settings or env vars:

- `databricksWorkspace.host` or `DATABRICKS_HOST`
- `databricksWorkspace.token` or `DATABRICKS_TOKEN`

Example host:

```bash
export DATABRICKS_HOST="https://dbc-2e2849bb-fd64.cloud.databricks.com"
```

## Run the extension locally

```bash
cd vscode-extension
npm install
npm run compile
npm test
```

Then press `F5` in VS Code (Extension Development Host).

A debug config is included at `vscode-extension/.vscode/launch.json` (configuration name: `Run Extension`).

## Open Databricks in Explorer

In the Extension Development Host:

1. Command Palette → `Databricks: Open Workspace Explorer`
2. VS Code opens `dbws:/` as a folder
3. Browse files/folders in the Explorer panel

## Notes

- Provider is currently read-only.
- Notebooks are exported in `SOURCE` format when opened.
- Regular files use `AUTO` export format.
