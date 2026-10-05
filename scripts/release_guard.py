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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("version")
    parser.add_argument("--releases", type=Path)
    args = parser.parse_args()
    parts = version_parts(args.version)
    version = ".".join(map(str, parts))
    if args.releases:
        pages = json.loads(args.releases.read_text())
        check_published(version, [release for page in pages for release in page])
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as out:
            out.write(f"version={version}\ntag=v{version}\n")
    print(f"Validated v{version} (versionCode {version_code(version)})")


if __name__ == "__main__":
    try: main()
    except ValueError as error: raise SystemExit(str(error)) from error
