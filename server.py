import base64
import os
from datetime import datetime, timezone
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import DatabricksError
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("databricks-workspace")


def _workspace_client() -> WorkspaceClient:
    host = os.getenv("DATABRICKS_HOST")
    token = os.getenv("DATABRICKS_TOKEN")
    if not host or not token:
        raise ValueError(
            "Missing Databricks credentials. Set DATABRICKS_HOST and DATABRICKS_TOKEN."
        )
    return WorkspaceClient(host=host, token=token)


def _iso_ts(ms_or_s: Any) -> str | None:
    if ms_or_s is None:
        return None
    try:
        value = float(ms_or_s)
        if value > 10_000_000_000:
            value /= 1000.0
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    except Exception:
        return str(ms_or_s)


def _object_to_dict(obj: Any) -> dict[str, Any]:
    return {
        "path": getattr(obj, "path", None),
        "type": str(getattr(obj, "object_type", None)),
        "language": str(getattr(obj, "language", None))
        if getattr(obj, "language", None) is not None
        else None,
        "size": getattr(obj, "size", None),
        "modified_time": _iso_ts(getattr(obj, "modified_at", None)),
        "created_time": _iso_ts(getattr(obj, "created_at", None)),
        "object_id": getattr(obj, "object_id", None),
    }


def _iter_recursive(w: WorkspaceClient, path: str):
    stack = [path]
    while stack:
        current = stack.pop()
        for child in w.workspace.list(current):
            yield child
            if str(getattr(child, "object_type", "")).endswith("DIRECTORY"):
                stack.append(getattr(child, "path"))


@mcp.tool()
def list_files(path: str) -> dict[str, Any]:
    """List files and folders at a Databricks workspace path."""
    w = _workspace_client()
    try:
        objects = [_object_to_dict(obj) for obj in w.workspace.list(path)]
        return {"path": path, "items": objects}
    except DatabricksError as e:
        return {"error": str(e), "path": path}


@mcp.tool()
def read_file(path: str) -> dict[str, Any]:
    """Read a Databricks workspace file or notebook and return its source content."""
    w = _workspace_client()
    try:
        status = w.workspace.get_status(path)
        object_type = str(getattr(status, "object_type", ""))

        if object_type.endswith("NOTEBOOK"):
            export = w.workspace.export(path=path, format="SOURCE")
        else:
            export = w.workspace.export(path=path, format="AUTO")

        raw = getattr(export, "content", None)
        if raw is None:
            return {"path": path, "type": object_type, "content": ""}

        decoded = base64.b64decode(raw).decode("utf-8", errors="replace")
        return {
            "path": path,
            "type": object_type,
            "language": str(getattr(status, "language", None))
            if getattr(status, "language", None) is not None
            else None,
            "content": decoded,
        }
    except DatabricksError as e:
        return {"error": str(e), "path": path}


@mcp.tool()
def search_files(query: str, path: str = "/") -> dict[str, Any]:
    """Search files and folders by name under a workspace path."""
    w = _workspace_client()
    q = query.lower()

    try:
        matches = []
        for obj in _iter_recursive(w, path):
            obj_path = getattr(obj, "path", "") or ""
            name = obj_path.rstrip("/").split("/")[-1].lower()
            if q in name:
                matches.append(_object_to_dict(obj))
        return {"query": query, "path": path, "matches": matches}
    except DatabricksError as e:
        return {"error": str(e), "query": query, "path": path}


@mcp.tool()
def get_file_info(path: str) -> dict[str, Any]:
    """Get metadata for a workspace file/folder."""
    w = _workspace_client()
    try:
        status = w.workspace.get_status(path)

        size = getattr(status, "size", None)
        modified = getattr(status, "modified_at", None)

        if size is None or modified is None:
            parent = "/".join(path.rstrip("/").split("/")[:-1]) or "/"
            name = path.rstrip("/").split("/")[-1]
            try:
                for child in w.workspace.list(parent):
                    child_path = getattr(child, "path", "") or ""
                    child_name = child_path.rstrip("/").split("/")[-1]
                    if child_name == name:
                        size = size if size is not None else getattr(child, "size", None)
                        modified = (
                            modified
                            if modified is not None
                            else getattr(child, "modified_at", None)
                        )
                        break
            except DatabricksError:
                pass

        return {
            "path": path,
            "type": str(getattr(status, "object_type", None)),
            "language": str(getattr(status, "language", None))
            if getattr(status, "language", None) is not None
            else None,
            "size": size,
            "modified_time": _iso_ts(modified),
            "object_id": getattr(status, "object_id", None),
        }
    except DatabricksError as e:
        return {"error": str(e), "path": path}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
