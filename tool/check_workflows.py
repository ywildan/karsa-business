#!/usr/bin/env python3
"""Catch the YAML mistake that makes Actions fail with no log at all.

A workflow file that does not parse is the most expensive kind of typo here:
the run dies in zero seconds, produces no jobs, no annotations and no log, so
`gh run view --log-failed` answers "log not found" and the only clue is that
the run exists at all. The `Parse workflow files` step inside kb-validate.yml
cannot help, because the thing that has to parse the file to run the step is
the same parser that refused the file.

So this checks the one rule that bit us, with a scanner small enough to trust:
a plain (unquoted) scalar may not contain ": ", because that is the mapping-key
indicator. `name: Worker: typecheck, test` looks like prose and is a parse
error. Block scalars are skipped, since their body is text, not structure.
Nothing else about YAML is checked here; Actions remains the real judge.
"""

import re
import sys
from pathlib import Path

# `key:`, optionally as a list item, with the value split off behind it.
ENTRY = re.compile(r"^(?P<indent> *)(?:- +)?(?P<key>[A-Za-z_][\w .-]*|[\"'][^\"']+[\"']):[ \t]*(?P<value>.*)$")
BLOCK = re.compile(r"^[|>](?:[+-]?[0-9]*)?[+-]?[ \t]*(?:#.*)?$")
INDICATORS = ("|", ">", "&", "*", "!", "%", "@", "`", "[", "{", "#", '"', "'")


def comment_free(value: str) -> str:
    """Drop a trailing ` # comment`, but not a `#` that sits inside quotes."""
    quote = None
    for index, char in enumerate(value):
        if quote:
            if char == quote:
                quote = None
        elif char in "\"'":
            quote = char
        elif char == "#" and value[index - 1 : index].isspace():
            return value[:index]
    return value


def plain(value: str) -> bool:
    """Is this value a plain scalar, i.e. one where ": " ends the key?"""
    return not value.startswith(INDICATORS)


def check(path: Path) -> list[str]:
    problems = []
    block_indent = None
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if block_indent is not None:
            # Inside a block scalar: content until something dedents to us.
            if line.strip() and len(line) - len(line.lstrip()) > block_indent:
                continue
            block_indent = None
        stripped = line.strip()
        if stripped.startswith("#") or not stripped:
            continue
        match = ENTRY.match(line)
        if not match:
            # A plain scalar continuing over lines (`>-` bodies, folded text).
            continue
        value = comment_free(match.group("value")).rstrip()
        if BLOCK.match(value):
            block_indent = len(match.group("indent"))
            continue
        if not value or not plain(value):
            continue
        if ": " in value or value.endswith(":"):
            problems.append(
                f"{path}:{number}: unquoted value holds ': ' and Actions will not parse it: "
                f"{stripped}\n    quote it: {match.group('key')}: \"{value}\""
            )
    return problems


def targets(paths: list[str]) -> list[Path]:
    found: list[Path] = []
    for entry in paths:
        path = Path(entry)
        if path.is_dir():
            found.extend(sorted(path.rglob("*.yml")))
            found.extend(sorted(path.rglob("*.yaml")))
        else:
            found.append(path)
    return found


def main(argv: list[str]) -> int:
    # A directory is the usual call and the default is the only place workflows
    # live in this repo; a file argument keeps it usable as a scratch check.
    found = targets(argv or [".github/workflows"])
    if not found:
        print("no workflow files found", file=sys.stderr)
        return 2
    problems = [problem for path in found for problem in check(path)]
    for problem in problems:
        print(problem)
    if problems:
        print(f"{len(problems)} problem(s)")
        return 1
    print(f"no ambiguous plain scalars: {len(found)} workflow file(s) checked")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
