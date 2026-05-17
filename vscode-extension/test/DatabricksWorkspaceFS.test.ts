import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import * as vscode from "vscode";
import {
  DatabricksWorkspaceFS,
  resolveWorkspaceClientConfig,
} from "../src/DatabricksWorkspaceFS";

// ---------------------------------------------------------------------------
// Helpers for building fake SDK objects
// ---------------------------------------------------------------------------

interface FakeObjectInfo {
  path?: string;
  object_type?: string;
  language?: string;
  size?: number;
  modified_at?: number;
  created_at?: number;
}

interface FakeExportResponse {
  content?: string;
}

type FakeApiMethod = (...args: any[]) => any;

function fakeClient(overrides?: {
  getStatus?: FakeApiMethod;
  list?: FakeApiMethod;
  export?: FakeApiMethod;
  import?: FakeApiMethod;
  mkdirs?: FakeApiMethod;
  delete?: FakeApiMethod;
}) {
  return {
    workspace: {
      getStatus: overrides?.getStatus ?? (async () => ({})),
      list:
        overrides?.list ??
        (async function* () {}),
      export: overrides?.export ?? (async () => ({})),
      import: overrides?.import ?? (async () => {}),
      mkdirs: overrides?.mkdirs ?? (async () => {}),
      delete: overrides?.delete ?? (async () => {}),
    },
  } as any;
}

function makeUri(path: string): vscode.Uri {
  return vscode.Uri.parse("dbws:" + path);
}

function base64Encode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function fileInfo(overrides?: FakeObjectInfo): FakeObjectInfo {
  return {
    path: "/Users/test/file.py",
    object_type: "FILE",
    size: 42,
    modified_at: 1715800000000,
    created_at: 1715700000000,
    ...overrides,
  };
}

function dirInfo(overrides?: FakeObjectInfo): FakeObjectInfo {
  return {
    path: "/Users/test",
    object_type: "DIRECTORY",
    ...overrides,
  };
}

function notebookInfo(overrides?: FakeObjectInfo): FakeObjectInfo {
  return {
    path: "/Users/test/notebook",
    object_type: "NOTEBOOK",
    language: "PYTHON",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: stat
// ---------------------------------------------------------------------------

test("stat returns directory for root path", async () => {
  const fs = new DatabricksWorkspaceFS(() => fakeClient());
  const stat = await fs.stat(makeUri("/"));
  assert.equal(stat.type, vscode.FileType.Directory);
  assert.equal(stat.size, 0);
});

test("stat returns file stat from getStatus", async () => {
  const client = fakeClient({
    getStatus: async () => fileInfo({ size: 100, modified_at: 99, created_at: 50 }),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const stat = await fs.stat(makeUri("/Users/test/file.py"));
  assert.equal(stat.type, vscode.FileType.File);
  assert.equal(stat.size, 100);
  assert.equal(stat.mtime, 99);
  assert.equal(stat.ctime, 50);
});

test("stat returns directory type for DIRECTORY object", async () => {
  const client = fakeClient({
    getStatus: async () => dirInfo(),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const stat = await fs.stat(makeUri("/Users/test"));
  assert.equal(stat.type, vscode.FileType.Directory);
});

test("stat throws Unavailable when getStatus fails", async () => {
  const client = fakeClient({
    getStatus: async () => {
      throw new Error("Boom");
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.stat(makeUri("/Users/test/missing")),
    (err: any) => err.code === "Unavailable" && err.message.includes("Failed to get status")
  );
});

// ---------------------------------------------------------------------------
// Tests: readDirectory
// ---------------------------------------------------------------------------

test("readDirectory lists files and directories", async () => {
  const client = fakeClient({
    list: async function* () {
      yield fileInfo({ path: "/Users/test/script.py" });
      yield dirInfo({ path: "/Users/test/subdir" });
      yield notebookInfo({ path: "/Users/test/notebook" });
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const entries = await fs.readDirectory(makeUri("/Users/test"));
  assert.equal(entries.length, 3);
  // file
  assert.equal(entries[0][0], "script.py");
  assert.equal(entries[0][1], vscode.FileType.File);
  // directory
  assert.equal(entries[1][0], "subdir");
  assert.equal(entries[1][1], vscode.FileType.Directory);
  // notebook (should get .ipynb suffix from displayNameForObject)
  assert.equal(entries[2][0], "notebook.ipynb");
  assert.equal(entries[2][1], vscode.FileType.File);
});

test("readDirectory returns empty array for empty directory", async () => {
  const client = fakeClient({
    list: async function* () {},
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const entries = await fs.readDirectory(makeUri("/Users/test/empty"));
  assert.equal(entries.length, 0);
});

test("readDirectory handles missing object_type gracefully", async () => {
  const client = fakeClient({
    list: async function* () {
      yield { path: "/Users/test/unknown" };
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const entries = await fs.readDirectory(makeUri("/Users/test"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], vscode.FileType.File); // defaults to file
});

// ---------------------------------------------------------------------------
// Tests: readFile
// ---------------------------------------------------------------------------

test("readFile reads file content", async () => {
  const client = fakeClient({
    getStatus: async () => fileInfo(),
    export: async () => ({ content: base64Encode("hello world") }),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const content = await fs.readFile(makeUri("/Users/test/file.py"));
  assert.equal(Buffer.from(content).toString("utf8"), "hello world");
});

test("readFile reads notebook source", async () => {
  const client = fakeClient({
    getStatus: async () => notebookInfo(),
    export: async () => ({ content: base64Encode("print(1)") }),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const content = await fs.readFile(makeUri("/Users/test/notebook"));
  assert.equal(Buffer.from(content).toString("utf8"), "print(1)");
});

test("readFile exports .ipynb notebooks with JUPYTER format", async () => {
  let exportReq: any;
  const client = fakeClient({
    getStatus: async () => notebookInfo(),
    export: async (req: any) => {
      exportReq = req;
      return { content: base64Encode('{"cells":[]}') };
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const content = await fs.readFile(makeUri("/Users/test/notebook.ipynb"));

  assert.equal(exportReq.path, "/Users/test/notebook");
  assert.equal(exportReq.format, "JUPYTER");
  assert.equal(Buffer.from(content).toString("utf8"), '{"cells":[]}');
});

test("readFile throws FileIsADirectory for directories", async () => {
  const client = fakeClient({
    getStatus: async () => dirInfo(),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.readFile(makeUri("/Users/test")),
    (err: any) => err.code === "FileIsADirectory"
  );
});

test("readFile wraps export errors in Unavailable", async () => {
  const client = fakeClient({
    getStatus: async () => fileInfo(),
    export: async () => {
      throw new Error("Network error");
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.readFile(makeUri("/Users/test/file.py")),
    (err: any) => err.code === "Unavailable" && err.message.includes("Failed to read")
  );
});

// ---------------------------------------------------------------------------
// Tests: createDirectory
// ---------------------------------------------------------------------------

test("createDirectory calls mkdirs", async () => {
  let mkdirsPath: string | undefined;
  const client = fakeClient({
    mkdirs: async (req: any) => {
      mkdirsPath = req.path;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await fs.createDirectory(makeUri("/Users/test/newdir"));
  assert.equal(mkdirsPath, "/Users/test/newdir");
});

test("createDirectory wraps errors in Unavailable", async () => {
  const client = fakeClient({
    mkdirs: async () => {
      throw new Error("Permission denied");
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.createDirectory(makeUri("/Users/test/newdir")),
    (err: any) => err.code === "Unavailable" && err.message.includes("Failed to create directory")
  );
});

// ---------------------------------------------------------------------------
// Tests: writeFile
// ---------------------------------------------------------------------------

test("writeFile imports content with create + overwrite", async () => {
  let importReq: any;
  const client = fakeClient({
    getStatus: async () => fileInfo(), // for exists()
    import: async (req: any) => {
      importReq = req;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  const content = Buffer.from("print('hello')", "utf8");
  await fs.writeFile(makeUri("/Users/test/script.py"), content, { create: true, overwrite: true });

  assert.equal(importReq.path, "/Users/test/script.py");
  assert.equal(importReq.format, "SOURCE");
  assert.equal(importReq.overwrite, true);
  assert.equal(Buffer.from(importReq.content, "base64").toString("utf8"), "print('hello')");
});

test("writeFile uses JUPYTER format for .ipynb files", async () => {
  let importReq: any;
  const client = fakeClient({
    getStatus: async () => notebookInfo(),
    import: async (req: any) => {
      importReq = req;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await fs.writeFile(makeUri("/Users/test/notebook.ipynb"), Buffer.from("{}"), {
    create: true,
    overwrite: true,
  });

  assert.equal(importReq.path, "/Users/test/notebook");
  assert.equal(importReq.format, "JUPYTER");
});

test("writeFile creates a new file when create=true", async () => {
  let importReq: any;
  const client = fakeClient({
    getStatus: async (req: any) => {
      if (req.path === "/Users/test/new.py") {
        throw new Error("Not found");
      }
      return fileInfo({ path: req.path });
    },
    import: async (req: any) => {
      importReq = req;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await fs.writeFile(makeUri("/Users/test/new.py"), Buffer.from("print('new')"), {
    create: true,
    overwrite: false,
  });

  assert.equal(importReq.path, "/Users/test/new.py");
  assert.equal(importReq.format, "SOURCE");
  assert.equal(Buffer.from(importReq.content, "base64").toString("utf8"), "print('new')");
});

test("writeFile throws FileNotFound when create=false and file doesn't exist", async () => {
  const client = fakeClient({
    getStatus: async () => {
      throw new Error("Not found");
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.writeFile(makeUri("/Users/test/missing.py"), Buffer.from("x"), { create: false, overwrite: false }),
    (err: any) => err.code === "FileNotFound"
  );
});

test("writeFile throws FileExists when overwrite=false and file exists", async () => {
  const client = fakeClient({
    getStatus: async () => fileInfo(),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.writeFile(makeUri("/Users/test/file.py"), Buffer.from("x"), { create: false, overwrite: false }),
    (err: any) => err.code === "FileExists"
  );
});

test("writeFile wraps import errors in Unavailable", async () => {
  const client = fakeClient({
    getStatus: async () => fileInfo(),
    import: async () => {
      throw new Error("Disk full");
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.writeFile(makeUri("/Users/test/file.py"), Buffer.from("x"), { create: true, overwrite: true }),
    (err: any) => err.code === "Unavailable" && err.message.includes("Failed to write")
  );
});

// ---------------------------------------------------------------------------
// Tests: delete
// ---------------------------------------------------------------------------

test("delete calls workspace delete", async () => {
  let deleteReq: any;
  const client = fakeClient({
    delete: async (req: any) => {
      deleteReq = req;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await fs.delete(makeUri("/Users/test/file.py"), { recursive: false });
  assert.equal(deleteReq.path, "/Users/test/file.py");
  assert.equal(deleteReq.recursive, false);
});

test("delete passes recursive flag", async () => {
  let deleteReq: any;
  const client = fakeClient({
    delete: async (req: any) => {
      deleteReq = req;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await fs.delete(makeUri("/Users/test/dir"), { recursive: true });
  assert.equal(deleteReq.recursive, true);
});

test("delete wraps errors in Unavailable", async () => {
  const client = fakeClient({
    delete: async () => {
      throw new Error("Forbidden");
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.delete(makeUri("/Users/test/file.py"), { recursive: false }),
    (err: any) => err.code === "Unavailable" && err.message.includes("Failed to delete")
  );
});

// ---------------------------------------------------------------------------
// Tests: rename
// ---------------------------------------------------------------------------

test("rename copies content and deletes old path", async () => {
  const oldContent = base64Encode("old content");
  let importReq: any;
  let deleteReq: any;

  const client = fakeClient({
    getStatus: async (req: any) => {
      if (req.path === "/Users/test/old.py") return fileInfo({ path: "/Users/test/old.py" });
      throw new Error("Not found"); // new path doesn't exist yet
    },
    export: async () => ({ content: oldContent }),
    import: async (req: any) => {
      importReq = req;
    },
    delete: async (req: any) => {
      deleteReq = req;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await fs.rename(makeUri("/Users/test/old.py"), makeUri("/Users/test/new.py"), { overwrite: false });

  assert.equal(importReq.path, "/Users/test/new.py");
  assert.equal(Buffer.from(importReq.content, "base64").toString("utf8"), "old content");
  assert.equal(importReq.overwrite, true);
  assert.equal(deleteReq.path, "/Users/test/old.py");
  assert.equal(deleteReq.recursive, false);
});

test("rename throws NoPermissions for directories", async () => {
  const client = fakeClient({
    getStatus: async () => dirInfo(),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.rename(makeUri("/Users/test/olddir"), makeUri("/Users/test/newdir"), { overwrite: false }),
    (err: any) => err.code === "NoPermissions"
  );
});

test("rename throws FileExists when overwrite=false and target exists", async () => {
  const client = fakeClient({
    getStatus: async () => fileInfo(),
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.rename(makeUri("/Users/test/old.py"), makeUri("/Users/test/existing.py"), { overwrite: false }),
    (err: any) => err.code === "FileExists"
  );
});

test("rename allows overwrite when target exists", async () => {
  let importReq: any;
  let deleteReq: any;
  const client = fakeClient({
    getStatus: async (req: any) => {
      if (req.path === "/Users/test/old.py") return fileInfo({ path: req.path });
      if (req.path === "/Users/test/existing.py") return fileInfo({ path: req.path });
      throw new Error("Not found");
    },
    export: async () => ({ content: base64Encode("replacement") }),
    import: async (req: any) => {
      importReq = req;
    },
    delete: async (req: any) => {
      deleteReq = req;
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await fs.rename(makeUri("/Users/test/old.py"), makeUri("/Users/test/existing.py"), { overwrite: true });

  assert.equal(importReq.path, "/Users/test/existing.py");
  assert.equal(Buffer.from(importReq.content, "base64").toString("utf8"), "replacement");
  assert.equal(deleteReq.path, "/Users/test/old.py");
});

test("rename wraps delete-after-copy errors in Unavailable", async () => {
  const client = fakeClient({
    getStatus: async (req: any) => {
      if (req.path === "/Users/test/old.py") return fileInfo({ path: req.path });
      throw new Error("Not found");
    },
    export: async () => ({ content: base64Encode("old content") }),
    import: async () => {},
    delete: async () => {
      throw new Error("Delete failed");
    },
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  await assert.rejects(
    () => fs.rename(makeUri("/Users/test/old.py"), makeUri("/Users/test/new.py"), { overwrite: false }),
    (err: any) => err.code === "Unavailable" && err.message.includes("after rename")
  );
});

// ---------------------------------------------------------------------------
// Tests: auth/config fallback behavior
// ---------------------------------------------------------------------------

test("resolveWorkspaceClientConfig trims profile and omits empty values", () => {
  const config = {
    get<T>(section: string): T | undefined {
      const values: Record<string, any> = {
        host: "",
        profile: "   ",
        databricksCliPath: "",
      };
      return values[section];
    },
  };

  assert.deepEqual(resolveWorkspaceClientConfig(config), {
    host: undefined,
    profile: undefined,
    databricksCliPath: undefined,
  });
});

test("resolveWorkspaceClientConfig preserves host, cli path, and trimmed profile", () => {
  const config = {
    get<T>(section: string): T | undefined {
      const values: Record<string, any> = {
        host: "https://dbc.example.com",
        profile: "  DEFAULT  ",
        databricksCliPath: "/usr/local/bin/databricks",
      };
      return values[section];
    },
  };

  assert.deepEqual(resolveWorkspaceClientConfig(config), {
    host: "https://dbc.example.com",
    profile: "DEFAULT",
    databricksCliPath: "/usr/local/bin/databricks",
  });
});

// ---------------------------------------------------------------------------
// Tests: watch
// ---------------------------------------------------------------------------

test("watch returns a Disposable", () => {
  const fs = new DatabricksWorkspaceFS(() => fakeClient());
  const d = fs.watch(makeUri("/"), { recursive: false, excludes: [] });
  assert.ok(typeof d.dispose === "function");
});

// ---------------------------------------------------------------------------
// Tests: onDidChangeFile event
// ---------------------------------------------------------------------------

test("onDidChangeFile fires on writeFile", async () => {
  const client = fakeClient({
    getStatus: async () => fileInfo(),
    import: async () => {},
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  let fired = false;
  fs.onDidChangeFile((_events) => {
    fired = true;
  });

  await fs.writeFile(makeUri("/Users/test/file.py"), Buffer.from("x"), { create: true, overwrite: true });
  assert.equal(fired, true);
});

test("onDidChangeFile fires Created event on createDirectory", async () => {
  const client = fakeClient({
    mkdirs: async () => {},
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  let events: any[] | undefined;
  fs.onDidChangeFile((firedEvents) => {
    events = firedEvents;
  });

  const uri = makeUri("/Users/test/newdir");
  await fs.createDirectory(uri);

  assert.deepEqual(events, [{ type: vscode.FileChangeType.Created, uri }]);
});

test("onDidChangeFile fires Deleted event on delete", async () => {
  const client = fakeClient({
    delete: async () => {},
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  let events: any[] | undefined;
  fs.onDidChangeFile((firedEvents) => {
    events = firedEvents;
  });

  const uri = makeUri("/Users/test/file.py");
  await fs.delete(uri, { recursive: false });

  assert.deepEqual(events, [{ type: vscode.FileChangeType.Deleted, uri }]);
});

test("onDidChangeFile fires Deleted and Created events on rename", async () => {
  const client = fakeClient({
    getStatus: async (req: any) => {
      if (req.path === "/Users/test/old.py") return fileInfo({ path: req.path });
      throw new Error("Not found");
    },
    export: async () => ({ content: base64Encode("renamed") }),
    import: async () => {},
    delete: async () => {},
  });
  const fs = new DatabricksWorkspaceFS(() => client);

  let events: any[] | undefined;
  fs.onDidChangeFile((firedEvents) => {
    events = firedEvents;
  });

  const oldUri = makeUri("/Users/test/old.py");
  const newUri = makeUri("/Users/test/new.py");
  await fs.rename(oldUri, newUri, { overwrite: false });

  assert.deepEqual(events, [
    { type: vscode.FileChangeType.Deleted, uri: oldUri },
    { type: vscode.FileChangeType.Created, uri: newUri },
  ]);
});
