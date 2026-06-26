#!/usr/bin/env python3
"""Inspect Pencil's bundled .pen templates from app.asar."""

from __future__ import annotations

import json
import struct
from pathlib import Path


ASAR_PATH = Path("/Applications/Pencil.app/Contents/Resources/app.asar")


def load_asar_header(path: Path) -> tuple[dict, int]:
    with path.open("rb") as fh:
        size_blob = fh.read(16)
        header_json_size = struct.unpack("<I", size_blob[12:16])[0]
        header = json.loads(fh.read(header_json_size))
    return header, 16 + header_json_size


def find_node(root: dict, parts: list[str]) -> dict:
    node = root
    for part in parts:
        node = node["files"][part]
    return node


def read_file(path: str) -> bytes:
    header, data_offset = load_asar_header(ASAR_PATH)
    node = find_node(header, path.split("/"))
    offset = int(node["offset"])
    size = int(node["size"])
    with ASAR_PATH.open("rb") as fh:
        fh.seek(data_offset + offset)
        return fh.read(size)


def main() -> None:
    for name in [
        "out/data/pencil-new.pen",
        "out/data/pencil-demo.pen",
        "out/data/shadcn.lib.pen",
    ]:
        data = read_file(name)
        print(f"{name}: {len(data)} bytes")
        print(data[:400])
        print()


if __name__ == "__main__":
    main()
