#!/usr/bin/env python3
"""Catch the one mistake class that costs a CI round trip on this machine.

There is no Dart SDK here, so the analyzer only ever runs in CI. The failures
that kept happening were never about logic: a file reached for a type that
lived in a sibling library it did not import. Dart has no transitive imports,
so that is a compile error the build will report and nothing before it will.

This walks every library under app/lib and app/test, collects the symbols each
one declares, then reports any project symbol used without a direct import of
its home. Third-party and SDK names are ignored on purpose: this is a check
for our own graph, not a replacement for the analyzer.
"""

import os
import re
import sys
from pathlib import Path

# Declarations that introduce a name visible to other libraries.
TOP_LEVEL_VAR = re.compile(r"^(const|final)\s+(?:[\w<>,?\s]+\s+)?([a-zA-Z_$][\w$]*)\s*=")
TOP_LEVEL_FN = re.compile(r"^(?:[\w<>,?\s]+?\s+)?([a-zA-Z_$][\w$]*)\s*\([^()]*\)\s*(?:async\s*)?[{;]")
CLASSISH = re.compile(r"^\s*(?:abstract\s+|final\s+|base\s+|interface\s+|sealed\s+|mixin\s+)*"
                      r"(?:class|enum|extension|typedef|mixin)\s+([A-Za-z_$][\w$]*)")
IMPORT = re.compile(r"^\s*import\s+'([^']+)'(?:\s+as\s+\w+)?(?:\s+show\s+[^;]+)?;", re.M)
EXPORT = re.compile(r"^\s*export\s+'([^']+)'", re.M)
# A word is a reference only when nothing before it makes it a member access and
# nothing after it turns it into a named argument. A name that starts lowercase
# counts only in call position, so fields and locals called amount or modal are
# not mistaken for somebody else's top-level helper.
TYPES = re.compile(r"(?<![.$\w])([A-Z][\w$]*|k[A-Z][\w$]*)(?!\s*:)")
CALLS = re.compile(r"(?<![.$\w])([a-z][\w$]*)\s*\(")
# Everything the analyzer resolves from .dart_tool rather than from these files.
THIRD_PARTY = (
    "dart:",
    "package:flutter",
    "package:sqflite",
    "package:crypto",
    "package:uuid",
    "package:fl_chart",
    "package:path",
)


def strip_noise(text: str) -> str:
    """Blank comments and string contents so identifiers inside them do not count."""
    out = []
    i, n = 0, len(text)
    while i < n:
        two = text[i:i + 2]
        if two == "//":
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if two == "/*":
            depth = 1
            i += 2
            while i < n and depth:
                if text[i:i + 2] == "/*":
                    depth += 1
                    i += 2
                elif text[i:i + 2] == "*/":
                    depth -= 1
                    i += 2
                else:
                    out.append(" " if text[i] != "\n" else "\n")
                    i += 1
            continue
        if text[i] in "\"'":
            quote = text[i]
            triple = text[i:i + 3] == quote * 3
            if not triple and "\\" in text[i + 1:i + 3]:
                pass
            step = 3 if triple else 1
            i += step
            while i < n:
                if text[i] == "\\":
                    out.append(" " * 2)
                    i += 2
                    continue
                if text[i:i + step] == quote * step:
                    i += step
                    break
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def declarations(body: str) -> set[str]:
    names: set[str] = set()
    for line in body.splitlines():
        match = CLASSISH.match(line)
        if match:
            names.add(match.group(1))
            continue
        if line[:1] in (" ", "\t", "(") or line.strip().startswith("@"):
            continue
        match = TOP_LEVEL_FN.match(line)
        if match:
            names.add(match.group(1))
            continue
        match = TOP_LEVEL_VAR.match(line)
        if match:
            names.add(match.group(2))
    return names


def main(roots: list[str]) -> int:
    # Everything is keyed by absolute path: an import resolved from a relative
    # file path would otherwise never match the relative key it came from.
    files = sorted(p.resolve() for root in roots for p in Path(root).rglob("*.dart"))
    if not files:
        print("no dart files found", file=sys.stderr)
        return 2

    declared: dict[Path, set[str]] = {}
    imports: dict[Path, list[Path]] = {}
    bodies: dict[Path, str] = {}
    sources: dict[Path, str] = {}

    for path in files:
        source = path.read_text()
        sources[path] = source
        clean = strip_noise(source)
        bodies[path] = clean
        declared[path] = declarations(clean)

    missing: list[tuple[Path, str]] = []
    for path in files:
        targets = []
        # Import specs live inside string literals, which strip_noise has blanked:
        # read them from the untouched source.
        for spec in IMPORT.findall(sources[path]) + EXPORT.findall(sources[path]):
            if spec.startswith(THIRD_PARTY):
                continue
            if spec.startswith("package:karsa_business/"):
                # package: maps to the lib/ beside the package's pubspec.yaml,
                # which is kb-build/ in CI and app/ at home. Walk up to find it.
                root = next((a for a in path.parents if (a / "pubspec.yaml").exists()), None)
                resolved = (
                    (root / "lib" / spec[len("package:karsa_business/"):]).resolve()
                    if root
                    else path.parent / spec
                )
            else:
                resolved = (path.parent / spec).resolve()
            if not resolved.exists():
                missing.append((path, spec))
            targets.append(resolved)
        imports[path] = [t for t in targets if t.exists()]

    homes: dict[str, set[Path]] = {}
    for path, names in declared.items():
        in_lib = "lib" in path.parts
        for name in names:
            if name[:1].islower() and not in_lib:
                # A test helper is not part of the API surface; nothing in lib
                # can or should import it.
                continue
            homes.setdefault(name, set()).add(path)

    def shown(path: Path) -> str:
        try:
            return os.path.relpath(path)
        except ValueError:
            return str(path)

    problems = 0
    for path in files:
        visible = set(declared[path])
        for target in imports[path]:
            visible |= declared.get(target, set())
        lines = bodies[path].splitlines()
        for number, line in enumerate(lines, start=1):
            for name in TYPES.findall(line) + CALLS.findall(line):
                owner = homes.get(name)
                if not owner or name in visible:
                    continue
                print(f"{shown(path)}:{number}: uses {name} "
                      f"(from {', '.join(sorted(shown(o) for o in owner))}) without importing it")
                problems += 1

    for path, spec in missing:
        print(f"{shown(path)}: import does not resolve: {spec}")
        problems += 1

    if problems:
        print(f"{problems} problem(s)")
        return 1
    print(f"imports resolve: {len(files)} file(s), "
          f"{sum(len(v) for v in declared.values())} symbol(s) reachable")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["app/lib", "app/test"]))
