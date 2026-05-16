import * as vscode from "vscode";
import { decodeBase64Content, toDbPath, toFileType, type WorkspaceObjectType } from "./workspaceUtils";

type WorkspaceObject = {
  path: string;
  object_type: WorkspaceObjectType;
  language?: string;
  size?: number;
  modified_at?: number;
  created_at?: number;
};

type WorkspaceExportResponse = {
  content?: string;
};

class DatabricksWorkspaceFS implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const dbPath = toDbPath(uri.path);
    if (dbPath === "/") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const status = await this.getStatus(dbPath);
    return this.toFileStat(status);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const dbPath = toDbPath(uri.path);
    const data = await this.api<{ objects?: WorkspaceObject[] }>(
      `/api/2.0/workspace/list?path=${encodeURIComponent(dbPath)}`
    );
    const objects = data.objects ?? [];

    return objects.map((o) => {
      const name = o.path.split("/").filter(Boolean).pop() ?? o.path;
      return [name, this.toVsFileType(o.object_type)] as [string, vscode.FileType];
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const dbPath = toDbPath(uri.path);
    const status = await this.getStatus(dbPath);

    if (status.object_type === "DIRECTORY") {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    const format = status.object_type === "NOTEBOOK" ? "SOURCE" : "AUTO";
    const exported = await this.api<WorkspaceExportResponse>(
      `/api/2.0/workspace/export?path=${encodeURIComponent(dbPath)}&format=${format}`
    );

    return decodeBase64Content(exported.content);
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only provider");
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only provider");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only provider");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("Read-only provider");
  }

  private toFileStat(o: WorkspaceObject): vscode.FileStat {
    return {
      type: this.toVsFileType(o.object_type),
      ctime: o.created_at ?? 0,
      mtime: o.modified_at ?? 0,
      size: o.size ?? 0,
    };
  }

  private toVsFileType(objectType: WorkspaceObjectType): vscode.FileType {
    return toFileType(objectType) === "directory" ? vscode.FileType.Directory : vscode.FileType.File;
  }

  private async getStatus(path: string): Promise<WorkspaceObject> {
    return this.api<WorkspaceObject>(
      `/api/2.0/workspace/get-status?path=${encodeURIComponent(path)}`
    );
  }

  private async api<T>(endpoint: string): Promise<T> {
    const config = vscode.workspace.getConfiguration("databricksWorkspace");
    const host = (config.get<string>("host") || process.env.DATABRICKS_HOST || "").replace(/\/$/, "");
    const token = config.get<string>("token") || process.env.DATABRICKS_TOKEN || "";

    if (!host || !token) {
      throw vscode.FileSystemError.Unavailable(
        "Set databricksWorkspace.host and databricksWorkspace.token (or DATABRICKS_HOST/DATABRICKS_TOKEN)."
      );
    }

    const res = await fetch(`${host}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw vscode.FileSystemError.Unavailable(`Databricks API ${res.status}: ${body}`);
    }

    return (await res.json()) as T;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DatabricksWorkspaceFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("dbws", provider, {
      isCaseSensitive: true,
      isReadonly: true,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("databricksWorkspace.openRoot", async () => {
      const uri = vscode.Uri.parse("dbws:/");
      await vscode.commands.executeCommand("vscode.openFolder", uri, false);
    })
  );
}

export function deactivate(): void {}
