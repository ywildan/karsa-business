#!/usr/bin/env python3
"""Cheap Dart sanity check for a machine with no Dart SDK.

Blanks out comments and string literals, then walks the delimiters so an
unbalanced brace is reported where the depth stops making sense. Not a
parser: a tripwire for the mistakes that cost a whole CI round trip to
find. Validated against the files the analyzer already accepted.
"""

import sys
from pathlib import Path

IDENT = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$")
PAIRS = {"(": ")", ")": "(", "{": "}", "}": "{", "[": "]", "]": "["}
CLOSES = {")", "}", "]"}
OPENS = {"(", "{", "["}


def strip_code(text: str) -> str:
    out: list[str] = []
    i, n = 0, len(text)
    previous = ""
    while i < n:
        char = text[i]

        if char == "/" and text[i + 1 : i + 2] == "/":
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
            continue

        if char == "/" and text[i + 1 : i + 2] == "*":
            depth = 1
            while i < n and depth:
                if text[i : i + 2] == "/*":
                    depth, i = depth + 1, i + 2
                    out.append("  ")
                elif text[i : i + 2] == "*/":
                    depth, i = depth - 1, i + 2
                    out.append("  ")
                else:
                    out.append("\n" if text[i] == "\n" else " ")
                    i += 1
            continue

        raw = char == "r" and previous not in IDENT and text[i + 1 : i + 2] in (
            "'",
            '"',
        )
        quote = char if char in "'\"" else ""
        if raw or quote:
            start = i + 1 if raw else i
            mark = text[start : start + 1]
            triple = text[start : start + 3] == mark * 3
            token = mark * 3 if triple else mark
            out.extend(" " for _ in range(start - i + len(token)))
            i = start + len(token)
            while i < n:
                if text[i] == "\\":
                    out.append("  ")
                    i += 2
                    continue
                if text[i : i + len(token)] == token:
                    out.append(" " * len(token))
                    i += len(token)
                    break
                if text[i] == "$" and text[i + 1 : i + 2] == "{":
                    # Interpolation holds any expression, braces included.
                    depth, i = 1, i + 2
                    out.append("   ")
                    while i < n and depth:
                        depth += text[i] == "{"
                        depth -= text[i] == "}"
                        out.append("\n" if text[i] == "\n" else " ")
                        i += 1
                    continue
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            previous = token[-1]
            continue

        out.append(char)
        previous = char
        i += 1
    return "".join(out)


def check(path: Path) -> list[str]:
    source = path.read_text()
    lines = strip_code(source).splitlines()
    problems: list[str] = []
    stack: list[tuple[int, str]] = []
    for number, text in enumerate(lines, start=1):
        for column, char in enumerate(text, start=1):
            if char in OPENS:
                stack.append((number, char))
            elif char in CLOSES:
                if not stack:
                    problems.append(f"{path}:{number}: stray '{char}'")
                    return problems
                opened, opener = stack.pop()
                if PAIRS[opener] != char:
                    problems.append(
                        f"{path}:{number}:{column}: '{char}' closes '{opener}' "
                        f"from line {opened}"
                    )
                    return problems
    for opened, opener in stack:
        problems.append(
            f"{path}:{opened}: '{opener}' never closed"
        )
    return problems


if __name__ == "__main__":
    targets: list[Path] = []
    for argument in sys.argv[1:]:
        candidate = Path(argument)
        if candidate.is_dir():
            targets.extend(sorted(candidate.rglob("*.dart")))
        elif candidate.suffix == ".dart":
            targets.append(candidate)
    found: list[str] = []
    for target in targets:
        found.extend(check(target))
        if len(found) > 5:
            break
    for problem in found:
        print(problem)
    if not found:
        print(f"balanced: {len(targets)} file(s) checked")
    sys.exit(1 if found else 0)
