import test from "node:test";
import assert from "node:assert/strict";
import { decodeBase64Content, toDbPath, toFileType } from "../src/workspaceUtils";

test("toDbPath normalizes missing leading slash", () => {
  assert.equal(toDbPath("Users/me"), "/Users/me");
});

test("toDbPath keeps root slash", () => {
  assert.equal(toDbPath("/"), "/");
});

test("toFileType maps DIRECTORY to directory", () => {
  assert.equal(toFileType("DIRECTORY"), "directory");
});

test("toFileType maps NOTEBOOK/FILE to file", () => {
  assert.equal(toFileType("NOTEBOOK"), "file");
  assert.equal(toFileType("FILE"), "file");
});

test("decodeBase64Content decodes utf-8 content", () => {
  const bytes = decodeBase64Content(Buffer.from("hello", "utf8").toString("base64"));
  assert.equal(Buffer.from(bytes).toString("utf8"), "hello");
});
