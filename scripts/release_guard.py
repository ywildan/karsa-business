"""Resolve strict versions and prevent replacing or downgrading published APKs."""
import argparse
import json
import os
import re
from pathlib import Path


def version_parts(raw):
    if not re.fullmatch(r"v?(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})", raw):
        raise ValueError("Version must be vMAJOR.MINOR.PATCH, each component 0..999")
    return tuple(map(int, raw.removeprefix("v").split(".")))


def version_code(raw):
    major, minor, patch = version_parts(raw)
    return major * 1_000_000 + minor * 1_000 + patch


def check_published(version, releases):
    code = version_code(version)
    for release in releases:
        try:
            previous = version_code(release["tag_name"])
        except ValueError:
            continue
        if previous >= code:
            raise ValueError(f"Version must exceed every existing release, including drafts/prereleases: {release['tag_name']}")


def next_version(releases, tags, baseline="0.1.0"):
    """Choose a fresh version above all releases and tags, including unpublished tags."""
    codes = []
    for raw in [release["tag_name"] for release in releases] + tags:
        try:
            codes.append(version_code(raw))
        except ValueError:
            continue
    floor = version_code(baseline)
    if not codes or max(codes) < floor:
        return baseline.removeprefix("v")
    code = max(codes) + 1
    if code > version_code("999.999.999"):
        raise ValueError("No higher Android version is available; version components are exhausted")
    return f"{code // 1_000_000}.{code // 1_000 % 1_000}.{code % 1_000}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("version", nargs="?")
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--tags", type=Path)
    parser.add_argument("--releases", type=Path)
    args = parser.parse_args()
    releases = []
    if args.releases:
        pages = json.loads(args.releases.read_text())
        releases = [release for page in pages for release in page]
    if args.auto:
        if args.version or not args.releases or not args.tags:
            raise ValueError("Automatic version selection requires --releases and --tags, without a version argument")
        version = next_version(releases, args.tags.read_text().splitlines())
    else:
        if not args.version:
            raise ValueError("Provide a version or use --auto")
        version = ".".join(map(str, version_parts(args.version)))
    check_published(version, releases)
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as out:
            out.write(f"version={version}\ntag=v{version}\n")
    print(f"Validated v{version} (versionCode {version_code(version)})")


if __name__ == "__main__":
    try: main()
    except ValueError as error: raise SystemExit(str(error)) from error
