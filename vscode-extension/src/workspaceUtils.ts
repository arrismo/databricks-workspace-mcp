export type WorkspaceObjectType = "DIRECTORY" | "NOTEBOOK" | "FILE" | string;
export type NormalizedFileType = "directory" | "file";

export function toDbPath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

export function toFileType(objectType: WorkspaceObjectType): NormalizedFileType {
  return objectType === "DIRECTORY" ? "directory" : "file";
}

export function decodeBase64Content(content?: string): Uint8Array {
  if (!content) return new Uint8Array();
  return new Uint8Array(Buffer.from(content, "base64"));
}
