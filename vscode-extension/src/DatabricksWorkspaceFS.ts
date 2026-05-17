import * as vscode from "vscode";
import { WorkspaceClient, workspace as sdkWorkspace } from "@databricks/sdk-experimental";
import {
  decodeBase64Content,
  displayNameForObject,
  exportFormatForPath,
  importFormatForPath,
  toFileType,
  toWorkspacePathFromUriPath,
  type WorkspaceObjectType,
} from "./workspaceUtils";

export type WorkspaceClientFactory = () => WorkspaceClient | Promise<WorkspaceClient>;

export interface WorkspaceClientConfigSource {
  get<T>(section: string): T | undefined;
}

export interface ResolvedWorkspaceClientConfig {
  host?: string;
  profile?: string;
  databricksCliPath?: string;
}

export function resolveWorkspaceClientConfig(
  config: WorkspaceClientConfigSource
): ResolvedWorkspaceClientConfig {
  const host = config.get<string>("host") || undefined;
  const configuredProfile = (config.get<string>("profile") || "").trim();
  const profile = configuredProfile.length > 0 ? configuredProfile : undefined;
  const databricksCliPath =
    config.get<string>("databricksCliPath") || undefined;

  return {
    host,
    profile,
    databricksCliPath,
  };
}

export class DatabricksWorkspaceFS implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  private _client?: WorkspaceClient;
  private readonly _clientFactory?: WorkspaceClientFactory;

  /**
   * @param clientFactory Optional factory for creating a WorkspaceClient.
   * If omitted, the client is created from VS Code configuration and env vars.
   */
  constructor(clientFactory?: WorkspaceClientFactory) {
    this._clientFactory = clientFactory;
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const dbPath = toWorkspacePathFromUriPath(uri.path);
    if (dbPath === "/") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const status = await this.getStatus(dbPath);
    return this.toFileStat(status);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const dbPath = toWorkspacePathFromUriPath(uri.path);
    const client = await this.getClient();

    const objects: sdkWorkspace.ObjectInfo[] = [];
    for await (const obj of client.workspace.list({ path: dbPath })) {
      objects.push(obj);
    }

    return objects.map((o) => {
      const name = displayNameForObject(
        o.path ?? "",
        (o.object_type ?? "FILE") as WorkspaceObjectType
      );
      return [name, this.toVsFileType(o.object_type ?? "FILE")] as [string, vscode.FileType];
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const dbPath = toWorkspacePathFromUriPath(uri.path);
    const status = await this.getStatus(dbPath);

    if (status.object_type === "DIRECTORY") {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }

    const format = exportFormatForPath(
      uri.path,
      status.object_type as WorkspaceObjectType
    ) as sdkWorkspace.ExportFormat;

    let exported;
    try {
      const client = await this.getClient();
      exported = await client.workspace.export({ path: dbPath, format });
    } catch (e: any) {
      throw vscode.FileSystemError.Unavailable(
        `Failed to read ${dbPath}: ${e?.message ?? e}`
      );
    }

    return decodeBase64Content(exported.content);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const path = toWorkspacePathFromUriPath(uri.path);
    try {
      const client = await this.getClient();
      await client.workspace.mkdirs({ path });
    } catch (e: any) {
      throw vscode.FileSystemError.Unavailable(
        `Failed to create directory ${path}: ${e?.message ?? e}`
      );
    }
    this.emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const path = toWorkspacePathFromUriPath(uri.path);

    if (!options.create && !(await this.exists(path))) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (!options.overwrite && (await this.exists(path))) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    const format = importFormatForPath(uri.path) as sdkWorkspace.ImportFormat;

    try {
      const client = await this.getClient();
      await client.workspace.import({
        path,
        format,
        overwrite: true,
        content: Buffer.from(content).toString("base64"),
      });
    } catch (e: any) {
      throw vscode.FileSystemError.Unavailable(
        `Failed to write ${path}: ${e?.message ?? e}`
      );
    }

    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const path = toWorkspacePathFromUriPath(uri.path);
    try {
      const client = await this.getClient();
      await client.workspace.delete({ path, recursive: options.recursive });
    } catch (e: any) {
      throw vscode.FileSystemError.Unavailable(
        `Failed to delete ${path}: ${e?.message ?? e}`
      );
    }
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    const oldPath = toWorkspacePathFromUriPath(oldUri.path);
    const newPath = toWorkspacePathFromUriPath(newUri.path);

    const status = await this.getStatus(oldPath);
    if (status.object_type === "DIRECTORY") {
      throw vscode.FileSystemError.NoPermissions(
        "Directory rename is not yet supported"
      );
    }

    if (!options.overwrite && (await this.exists(newPath))) {
      throw vscode.FileSystemError.FileExists(newUri);
    }

    const content = await this.readFile(oldUri);
    await this.writeFile(newUri, content, { create: true, overwrite: true });

    try {
      const client = await this.getClient();
      await client.workspace.delete({ path: oldPath, recursive: false });
    } catch (e: any) {
      throw vscode.FileSystemError.Unavailable(
        `Failed to delete ${oldPath} after rename: ${e?.message ?? e}`
      );
    }

    this.emitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private toFileStat(o: sdkWorkspace.ObjectInfo): vscode.FileStat {
    return {
      type: this.toVsFileType(o.object_type ?? "FILE"),
      ctime: o.created_at ?? 0,
      mtime: o.modified_at ?? 0,
      size: o.size ?? 0,
    };
  }

  private toVsFileType(objectType: string): vscode.FileType {
    return toFileType(objectType) === "directory"
      ? vscode.FileType.Directory
      : vscode.FileType.File;
  }

  private async getStatus(path: string): Promise<sdkWorkspace.ObjectInfo> {
    try {
      const client = await this.getClient();
      return await client.workspace.getStatus({ path });
    } catch (e: any) {
      throw vscode.FileSystemError.Unavailable(
        `Failed to get status for ${path}: ${e?.message ?? e}`
      );
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.getStatus(path);
      return true;
    } catch {
      return false;
    }
  }

  private async getClient(): Promise<WorkspaceClient> {
    if (this._clientFactory) {
      return this._clientFactory();
    }

    if (!this._client) {
      const config = vscode.workspace.getConfiguration("databricksWorkspace");
      this._client = new WorkspaceClient(resolveWorkspaceClientConfig(config));
    }
    return this._client;
  }
}
