#!/usr/bin/env python3
"""Verify that the release JAR, not a separate ZIP, contains a complete Diorama UI."""
import json
import pathlib
import sys
import zipfile


def main():
    jars = list(pathlib.Path("public-assets-neoforge/build/libs").glob("player-history-public-assets-*.jar"))
    if len(jars) != 1:
        raise SystemExit(f"Expected one public-assets JAR, found: {jars}")
    with zipfile.ZipFile(jars[0]) as jar:
        names = set(jar.namelist())
        required = {"diorama-history.js", "player-history.css", "player-history-assets.json"}
        missing = required - names
        if missing:
            raise SystemExit(f"Missing web entrypoints in {jars[0]}: {sorted(missing)}")
        modules = json.loads(jar.read("player-history-assets.json"))
        if not modules or not all(
            isinstance(name, str) and name.startswith("modules/") and name.endswith(".js")
            for name in modules
        ):
            raise SystemExit("Invalid or empty bundled versioned-module index")
        missing_modules = sorted(set(modules) - names)
        if missing_modules:
            raise SystemExit(f"Frontend module index refers to absent JAR entries: {missing_modules}")
        boot = jar.read("diorama-history.js").decode()
        if not any(f"./{name}" in boot for name in modules if name.endswith("/diorama.js")):
            raise SystemExit("Diorama bootstrap does not import a bundled module")
        if not jar.read("player-history.css"):
            raise SystemExit("Diorama stylesheet is empty")
        print(f"Verified {jars[0]}: JAR-backed Diorama bootstrap/CSS and {len(modules)} modules")


if __name__ == "__main__":
    main()
