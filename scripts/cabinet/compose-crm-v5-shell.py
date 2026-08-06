#!/usr/bin/env python3
"""Compose the v5 CRM shell over selected v4 screen references."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
V4 = ROOT / "docs/design/crm-complete-interface-pack-v4/images"
V5 = ROOT / "docs/design/crm-complete-interface-pack-v5"
RAW = V5 / "images-raw"
FINAL = V5 / "images"
SHELL = V5 / "qa/assistant-shell-reference.png"

REGENERATED = {4, 14, 19, 20, 22, 23, 25, 33, 34, 35, 41}
SKIP_SEARCH_PATCH = {14}
SKIP_ASSISTANT_PATCH = {4, 19, 20, 22, 33, 34, 35, 41}
SETTINGS_SCREENS = {31, 32}


def screen_path(folder: Path, number: int) -> Path:
    matches = sorted(folder.glob(f"{number:02d}-*.png"))
    if len(matches) != 1:
        raise RuntimeError(f"Expected one screen {number:02d} in {folder}, got {matches}")
    return matches[0]


def main() -> None:
    FINAL.mkdir(parents=True, exist_ok=True)
    with Image.open(SHELL) as shell_source:
        shell = shell_source.convert("RGB")
        search_text = shell.crop((300, 20, 800, 90))
        ordinary_sidebar = shell.crop((0, 820, 260, 1024))
        assistant_only = shell.crop((0, 832, 260, 890))

    for number in range(1, 45):
        source_folder = RAW if number in REGENERATED else V4
        source = screen_path(source_folder, number)
        target = screen_path(FINAL, number)
        with Image.open(source) as source_image:
            image = source_image.convert("RGB")

        if image.size != (1536, 1024):
            raise RuntimeError(f"Unexpected size for {source}: {image.size}")

        if number not in SKIP_SEARCH_PATCH and number not in REGENERATED:
            image.paste(search_text, (300, 20))

        if number in SETTINGS_SCREENS:
            image.paste(assistant_only, (0, 785))
        elif number not in SKIP_ASSISTANT_PATCH:
            image.paste(ordinary_sidebar, (0, 820))

        image.save(target, format="PNG", compress_level=4)

    for number in range(45, 52):
        source = screen_path(RAW, number)
        target = screen_path(FINAL, number)
        with Image.open(source) as source_image:
            image = source_image.convert("RGB")
        if image.size != (1536, 1024):
            raise RuntimeError(f"Unexpected size for {source}: {image.size}")
        image.save(target, format="PNG", compress_level=4)

    print("Composed 51 CRM v5 screens")


if __name__ == "__main__":
    main()
