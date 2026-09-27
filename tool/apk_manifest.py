#!/usr/bin/env python3
"""Baca AndroidManifest.xml biner di dalam sebuah APK.

Mesin pengembang tidak punya aapt, apksigner, adb, maupun `strings`: yang bisa
diperiksa setelah build hanyalah artefaknya sendiri. Manifest sumber boleh
berkata "versi satu tidak meminta izin apa pun", tetapi yang dipasang ke hp
pengguna adalah manifest hasil merge Gradle. Janji itu baru terbukti kalau yang
dibaca manifest di dalam APK.

Format mengikuti ResourceTypes.h milik AOSP. Konstanta yang salah di sini tidak
akan berteriak — ia hanya membuat parser melewatkan semua elemen dan
melaporkan "tidak ada izin", persis kesimpulan yang ingin kita jaga supaya
tidak pernah hasil dari kebetulan.
"""

from __future__ import annotations

import argparse
import struct
import sys
import zipfile
from pathlib import Path

RES_STRING_POOL_TYPE = 0x0001
RES_XML_TYPE = 0x0003
RES_XML_START_NAMESPACE_TYPE = 0x0100
RES_XML_END_NAMESPACE_TYPE = 0x0101
RES_XML_START_ELEMENT_TYPE = 0x0102
RES_XML_END_ELEMENT_TYPE = 0x0103
RES_XML_CDATA_TYPE = 0x0104
RES_XML_RESOURCE_MAP_TYPE = 0x0180

# Ada, tetapi tidak membawa informasi yang laporan ini butuhkan.
_IGNORED_CHUNKS = {
    RES_XML_START_NAMESPACE_TYPE,
    RES_XML_END_NAMESPACE_TYPE,
    RES_XML_END_ELEMENT_TYPE,
    RES_XML_CDATA_TYPE,
    RES_XML_RESOURCE_MAP_TYPE,
}

POOL_UTF8_FLAG = 1 << 8
NO_NAMESPACE = 0xFFFFFFFF
TYPE_STRING = 0x03


class Malformed(Exception):
    pass


def _byte_len(data: bytes, at: int) -> tuple[int, int]:
    """Varint satu-byte AXML: bit tertinggi menandakan lanjutannya."""
    first = data[at]
    if first & 0x80:
        return 2, ((first & 0x7F) << 8) | data[at + 1]
    return 1, first


def _unit_len(data: bytes, at: int) -> tuple[int, int]:
    """Panjang dalam u16 little-endian; bit tertinggi menandakan lanjutannya."""
    first = struct.unpack_from("<H", data, at)[0]
    if first & 0x8000:
        return 4, ((first & 0x7FFF) << 16) | struct.unpack_from("<H", data, at + 2)[0]
    return 2, first


def read_string_pool(chunk: bytes) -> list[str]:
    if len(chunk) < 28:
        raise Malformed("tabel string lebih pendek dari header-nya")
    string_count, _style_count, flags, strings_start, _styles_start = struct.unpack_from(
        "<IIIII", chunk, 8
    )
    if len(chunk) < 28 + 4 * string_count:
        raise Malformed("tabel offset string terpotong")
    offsets = struct.unpack_from(f"<{string_count}I", chunk, 28)
    utf8 = bool(flags & POOL_UTF8_FLAG)

    strings: list[str] = []
    for offset in offsets:
        at = strings_start + offset
        if at >= len(chunk):
            raise Malformed("offset string menunjuk ke luar tabel")
        if utf8:
            used, _chars = _byte_len(chunk, at)
            at += used
            used, length = _byte_len(chunk, at)
            strings.append(chunk[at + used : at + used + length].decode("utf-8", "replace"))
        else:
            used, units = _unit_len(chunk, at)
            at += used
            raw = chunk[at : at + 2 * units]
            strings.append(raw.decode("utf-16-le", "replace"))
    return strings


def _node(chunk: bytes) -> tuple[int, int, list[tuple[int, int, int, int, int]]]:
    """Ambil (nama, namespace, [(namaAtribut, nsAtribut, rawValue, tipe, data)])."""
    if len(chunk) < 36:
        raise Malformed("simpul elemen terpotong")
    _line, _comment, ns, name, attr_start, _attr_size, attr_count = struct.unpack_from(
        "<IIIIHHH", chunk, 8
    )
    attributes = []
    at = 16 + attr_start
    for _ in range(attr_count):
        attr_ns, attr_name, raw_value = struct.unpack_from("<III", chunk, at)
        _size, _res0, data_type, data = struct.unpack_from("<HBBI", chunk, at + 12)
        attributes.append((attr_name, attr_ns, raw_value, data_type, data))
        at += 20
    return name, ns, attributes


def parse(data: bytes) -> tuple[list[str], list[tuple[int, int, list]]]:
    doc_type, doc_header, doc_size = struct.unpack_from("<HHI", data, 0)
    if doc_type != RES_XML_TYPE:
        raise Malformed(f"bukan dokumen XML biner (0x{doc_type:#06x})")

    pool: list[str] = []
    elements: list[tuple[int, int, list]] = []
    at = doc_header
    end = min(doc_size, len(data))
    while at + 8 <= end:
        chunk_type, _header, size = struct.unpack_from("<HHI", data, at)
        if size < 8 or at + size > end:
            raise Malformed(f"chunk {chunk_type:#06x} mengklaim panjang {size}")
        body = data[at : at + size]
        if chunk_type == RES_STRING_POOL_TYPE:
            pool = read_string_pool(body)
        elif chunk_type == RES_XML_START_ELEMENT_TYPE:
            elements.append(_node(body))
        elif chunk_type not in _IGNORED_CHUNKS:
            raise Malformed(f"chunk {chunk_type:#06x} belum dikenali — jangan menebak isinya")
        at += size

    if not pool:
        raise Malformed("tidak ada tabel string yang terbaca")
    if not elements:
        raise Malformed("tidak ada satu pun elemen yang terbaca")
    return pool, elements


def _attr(pool: list[str], attributes, wanted: str, namespace: str | None = None):
    for name, ns, raw_value, data_type, data in attributes:
        if name >= len(pool) or pool[name] != wanted:
            continue
        if namespace is not None:
            prefix = pool[ns] if ns != NO_NAMESPACE and ns < len(pool) else ""
            if prefix != namespace:
                continue
        if data_type == TYPE_STRING:
            return pool[raw_value] if raw_value < len(pool) else None
        return data
    return None


def _android(pool, attributes, wanted):
    return _attr(pool, attributes, wanted, "http://schemas.android.com/apk/res/android")


def _element(pool, elements, name: str, after: int = 0):
    for index in range(after, len(elements)):
        node_name, _ns, attributes = elements[index]
        if node_name < len(pool) and pool[node_name] == name:
            return index, attributes
    return None, []


def summarize(pool: list[str], elements) -> dict[str, object]:
    root_index, root_attributes = _element(pool, elements, "manifest")
    if root_index is None:
        raise Malformed("tidak ada elemen <manifest>")

    sdk_index, sdk_attributes = _element(pool, elements, "uses-sdk", root_index + 1)
    app_index, app_attributes = _element(pool, elements, "application", root_index + 1)

    permissions = []
    for index, (name, _ns, attributes) in enumerate(elements):
        if name < len(pool) and pool[name] == "uses-permission":
            declared = _android(pool, attributes, "name")
            permissions.append(str(declared))

    launcher = None
    if app_index is not None:
        activity_index, activity_attributes = _element(pool, elements, "activity", app_index + 1)
        if activity_index is not None:
            launcher = _android(pool, activity_attributes, "name")

    return {
        "package": _attr(pool, root_attributes, "package", ""),
        "version_name": _android(pool, root_attributes, "versionName"),
        "version_code": _android(pool, root_attributes, "versionCode"),
        "min_sdk": _android(pool, sdk_attributes, "minSdkVersion") if sdk_index else None,
        "target_sdk": _android(pool, sdk_attributes, "targetSdkVersion") if sdk_index else None,
        "label": _android(pool, app_attributes, "label") if app_index else None,
        "permissions": sorted(set(permissions)),
        "launcher": launcher,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Lapor isi manifest sebuah APK apa adanya.")
    parser.add_argument("apk", type=Path)
    parser.add_argument(
        "--forbid-permission",
        action="append",
        default=[],
        metavar="NAMA",
        help="berhenti dengan galat kalau izin ini ternyata ada",
    )
    parser.add_argument(
        "--expect-min-sdk", type=int, metavar="API", help="berhenti kalau lantai SDK bukan ini"
    )
    args = parser.parse_args(argv)

    try:
        with zipfile.ZipFile(args.apk) as archive:
            pool, elements = parse(archive.read("AndroidManifest.xml"))
        report = summarize(pool, elements)
    except (Malformed, KeyError, OSError, ValueError, zipfile.BadZipFile) as problem:
        print(f"::error::{args.apk}: manifest tidak terbaca: {problem}")
        return 1

    print(f"package      {report['package']}")
    print(f"version      {report['version_name']} (code {report['version_code']})")
    print(f"minSdk       {report['min_sdk']}")
    print(f"targetSdk    {report['target_sdk']}")
    print(f"label        {report['label']}")
    print(f"launcher     {report['launcher']}")
    print(f"permissions  {', '.join(report['permissions']) or '(tidak ada)'}")

    failures = [
        f"izin {denied} ada di APK, padahal tidak boleh"
        for denied in args.forbid_permission
        if denied in report["permissions"]
    ]
    if args.expect_min_sdk is not None and report["min_sdk"] != args.expect_min_sdk:
        failures.append(f"minSdk {report['min_sdk']}, diharapkan {args.expect_min_sdk}")
    for reason in failures:
        print(f"::error::{reason}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
