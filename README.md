# databricks-workspace-explorer

> Disclaimer: This project is not affiliated with, endorsed by, or maintained by Databricks.

A VS Code extension that mounts your Databricks Workspace as `dbws:/` so you can browse and edit workspace files from the Explorer.

## What it does

Registers a filesystem provider at:

- `dbws:/`

So you can open Databricks workspace paths directly in VS Code Explorer.

## Authentication

This extension uses the [Databricks JS SDK](https://www.npmjs.com/package/@databricks/sdk-experimental) for authentication, which supports multiple methods:

1. **Databricks CLI profile** (recommended) — set up once with `databricks configure`, then set the VS Code setting `databricksWorkspace.profile` (leave it empty to use the Databricks CLI default profile).
2. **Environment variables** — `DATABRICKS_HOST` + `DATABRICKS_TOKEN`.
3. **OAuth (databricks-cli)** — run `databricks auth login` first.
4. **Azure CLI** — for Azure Databricks workspaces.

No token is ever stored in VS Code settings. Credentials are managed by the standard `~/.databrickscfg` file or the Databricks CLI's OAuth token cache.

### Quick start

```bash
# Install Databricks CLI and authenticate
databricks auth login --host https://<your-workspace>.cloud.databricks.com
```

Then set the workspace host in VS Code settings (optional — the SDK reads it from your `.databrickscfg`):

```json
{
  "databricksWorkspace.host": "https://<your-workspace>.cloud.databricks.com"
}
```

## Run the extension locally

```bash
npm install
npm run compile
npm run test:all
```

Then press `F5` in VS Code (Extension Development Host).

## Open Databricks in Explorer

In the Extension Development Host:

1. Command Palette → `Databricks: Open Workspace Explorer`
2. VS Code opens `dbws:/` as a folder
3. Browse files/folders in the Explorer panel

## Commands

Available from the Command Palette:

- `Databricks: Open Workspace Explorer` — opens the `dbws:/` workspace root in Explorer.
- `Databricks: Open Workspace Path` — opens a specific Databricks workspace file or folder by path.
- `Databricks: Refresh Workspace` — refreshes the Databricks workspace view.
- `Databricks: Show Active Auth/Profile` — shows the active host, profile, and optional Databricks CLI path.

## Notes

- Supports create/write/delete for workspace files and notebooks.
- Notebook files are shown as `.ipynb` in Explorer and use JUPYTER import/export.
- Script/text files use SOURCE import and AUTO export.
- Directory rename is not supported yet.
