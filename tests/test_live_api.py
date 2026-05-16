import os

import pytest

from server import get_file_info, list_files, read_file, search_files


@pytest.fixture(scope="session", autouse=True)
def _require_env():
    missing = [k for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN") if not os.getenv(k)]
    if missing:
        pytest.skip(f"Missing env vars for live tests: {', '.join(missing)}")


def _assert_ok(resp: dict):
    assert isinstance(resp, dict)
    assert "error" not in resp, resp.get("error")


def test_list_files_root():
    resp = list_files("/")
    _assert_ok(resp)
    assert "items" in resp
    assert isinstance(resp["items"], list)


def test_search_files_under_root():
    root = list_files("/")
    _assert_ok(root)

    if not root["items"]:
        pytest.skip("Workspace root has no items to search")

    sample_name = (root["items"][0].get("path") or "").rstrip("/").split("/")[-1]
    if not sample_name:
        pytest.skip("Could not derive sample name from root item")

    resp = search_files(sample_name[:3] or sample_name, "/")
    _assert_ok(resp)
    assert isinstance(resp.get("matches"), list)


def test_get_file_info_for_first_root_item():
    root = list_files("/")
    _assert_ok(root)

    if not root["items"]:
        pytest.skip("Workspace root has no items")

    path = root["items"][0].get("path")
    if not path:
        pytest.skip("First root item has no path")

    resp = get_file_info(path)
    _assert_ok(resp)
    assert resp.get("path") == path
    assert "type" in resp


def test_read_file_for_first_non_directory_root_item():
    root = list_files("/")
    _assert_ok(root)

    candidate = None
    for item in root.get("items", []):
        item_type = str(item.get("type") or "")
        if not item_type.endswith("DIRECTORY"):
            candidate = item.get("path")
            break

    if not candidate:
        pytest.skip("No non-directory item found at root for read_file test")

    resp = read_file(candidate)
    _assert_ok(resp)
    assert resp.get("path") == candidate
    assert "content" in resp
