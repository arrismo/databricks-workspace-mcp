import * as vscode from "vscode";
import { DatabricksWorkspaceFS } from "./DatabricksWorkspaceFS";

let outputChannel: vscode.OutputChannel;

function log(msg: string): void {
  outputChannel?.appendLine(`[${new Date().toISOString()}] ${msg}`);
  console.log(`[databricks-workspace] ${msg}`);
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Databricks Workspace", { log: true });
  log("Databricks Workspace Explorer activating...");

  const host = vscode.workspace.getConfiguration("databricksWorkspace").get<string>("host")
    || process.env.DATABRICKS_HOST
    || "<not set>";
  log(`Host: ${host}`);

  const profile = vscode.workspace.getConfiguration("databricksWorkspace").get<string>("profile")
    || process.env.DATABRICKS_CONFIG_PROFILE
    || "DEFAULT (default)";
  log(`Profile: ${profile}`);

  const provider = new DatabricksWorkspaceFS();

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("dbws", provider, {
      isCaseSensitive: true,
      isReadonly: false,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("databricksWorkspace.openRoot", async () => {
      log("Opening Databricks workspace root...");
      const uri = vscode.Uri.parse("dbws:/");
      await vscode.commands.executeCommand("vscode.openFolder", uri, false);
    }),
    outputChannel
  );

  log("Databricks Workspace Explorer activated.");
}

export function deactivate(): void {}
