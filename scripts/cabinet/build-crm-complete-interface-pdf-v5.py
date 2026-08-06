#!/usr/bin/env python3
"""Build the gated CRM-only v5 client interface PDF."""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path

from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "docs/design/crm-complete-interface-pack-v5"
MANIFEST = PACK / "MANIFEST.csv"
OUTPUT = ROOT / "output/pdf/kurs-na-sever-crm-complete-interfaces-v5.pdf"
TMP_FONTS = ROOT / "tmp/pdfs/crm-complete-interface-pack-v5/fonts"
PAGE = landscape((648, 864))
EXPECTED_SCREEN_COUNT = 51
REQUIRED_MANIFEST_COLUMNS = {
    "order",
    "slug",
    "title",
    "purpose",
    "file",
    "status",
}
ALLOWED_STATUSES = {"qa-pending", "qa-passed"}


@dataclass(frozen=True)
class Screen:
    order: int
    slug: str
    title: str
    purpose: str
    file: Path
    status: str


def _convert_font(source: Path, target: Path) -> Path:
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    from fontTools.ttLib import TTFont as FontToolsTTFont

    font = FontToolsTTFont(str(source))
    font.flavor = None
    font.save(str(target))
    return target


def register_fonts() -> tuple[str, str]:
    try:
        regular = _convert_font(
            ROOT / "assets/fonts/manrope-400.woff2",
            TMP_FONTS / "Manrope-Regular.ttf",
        )
        bold = _convert_font(
            ROOT / "assets/fonts/manrope-700.woff2",
            TMP_FONTS / "Manrope-Bold.ttf",
        )
        pdfmetrics.registerFont(TTFont("CRM-Regular", str(regular)))
        pdfmetrics.registerFont(TTFont("CRM-Bold", str(bold)))
    except Exception:
        pdfmetrics.registerFont(
            TTFont("CRM-Regular", "/System/Library/Fonts/Supplemental/Arial.ttf")
        )
        pdfmetrics.registerFont(
            TTFont("CRM-Bold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf")
        )
    return "CRM-Regular", "CRM-Bold"


def read_manifest() -> list[Screen]:
    with MANIFEST.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_MANIFEST_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Manifest columns missing: {sorted(missing)}")
        rows = list(reader)

    screens: list[Screen] = []
    pack_root = PACK.resolve()
    for row_number, row in enumerate(rows, start=2):
        try:
            file_path = (PACK / row["file"]).resolve()
            file_path.relative_to(pack_root)
            screens.append(
                Screen(
                    order=int(row["order"]),
                    slug=row["slug"].strip(),
                    title=row["title"].strip(),
                    purpose=row["purpose"].strip(),
                    file=file_path,
                    status=row["status"].strip(),
                )
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Invalid manifest row {row_number}: {error}") from error
    return screens


def validate(screens: list[Screen], allow_pending: bool) -> None:
    if len(screens) != EXPECTED_SCREEN_COUNT:
        raise ValueError(
            f"Manifest must contain exactly {EXPECTED_SCREEN_COUNT} screens; "
            f"found {len(screens)}"
        )
    if [screen.order for screen in screens] != list(
        range(1, EXPECTED_SCREEN_COUNT + 1)
    ):
        raise ValueError(
            f"Manifest order must be contiguous from 1 to {EXPECTED_SCREEN_COUNT}"
        )

    slugs = [screen.slug for screen in screens]
    if len(slugs) != len(set(slugs)):
        raise ValueError("Manifest slugs must be unique")
    files = [screen.file for screen in screens]
    if len(files) != len(set(files)):
        raise ValueError("Manifest image paths must be unique")

    for screen in screens:
        if not screen.slug or not screen.title or not screen.purpose:
            raise ValueError(f"Manifest fields cannot be empty: screen {screen.order:02d}")
        if screen.status not in ALLOWED_STATUSES:
            raise ValueError(
                f"Unsupported QA status: {screen.order:02d} {screen.status!r}"
            )
        if not allow_pending and screen.status != "qa-passed":
            raise ValueError(f"Screen not QA-passed: {screen.order:02d} {screen.slug}")
        if not screen.file.exists():
            raise FileNotFoundError(screen.file)
        with Image.open(screen.file) as image:
            if image.size != (1536, 1024):
                raise ValueError(f"Unexpected image size: {screen.file} = {image.size}")


def text(
    document: canvas.Canvas,
    value: str,
    x: float,
    y: float,
    font: str,
    size: float,
    color: str,
) -> None:
    document.setFont(font, size)
    document.setFillColor(HexColor(color))
    document.drawString(x, y, value)


def draw_cover(
    document: canvas.Canvas,
    regular: str,
    bold: str,
    total_pages: int,
    screen_count: int,
) -> None:
    width, height = PAGE
    document.setFillColor(HexColor("#F6F9FD"))
    document.rect(0, 0, width, height, fill=1, stroke=0)
    document.setFillColor(HexColor("#061A3D"))
    document.rect(0, 0, 176, height, fill=1, stroke=0)
    document.setFillColor(HexColor("#2764D8"))
    document.circle(88, height - 92, 30, fill=1, stroke=0)
    document.setFillColor(HexColor("#59DCE6"))
    document.roundRect(46, 58, 84, 5, 2.5, fill=1, stroke=0)

    text(document, "Курс на Север", 224, height - 74, bold, 13, "#071942")
    text(document, "CRM · интерфейсы v5", 224, height - 96, regular, 9, "#66738C")
    text(document, "Полный комплект интерфейсов", 224, height - 154, bold, 27, "#071942")
    text(
        document,
        f"Экранов в комплекте: {screen_count} · Основано на базе данных и ТЗ",
        224,
        height - 184,
        regular,
        11,
        "#66738C",
    )

    principles = [
        "Один экран - одно решение и одно главное действие.",
        "Переезд и трудоустройство остаются разными жизненными циклами.",
        "Почта РФ подключается через готовые профили и IMAP/SMTP.",
        "MAX закрывает вход до подтверждения второго фактора.",
        "ИИ готовит черновик; запись проходит preview, подтверждение и receipt.",
        "Миграционные исключения видимы и не склеиваются автоматически.",
    ]
    y = height - 246
    for index, principle in enumerate(principles, start=1):
        document.setFillColor(HexColor("#FFFFFF"))
        document.roundRect(224, y - 18, 584, 48, 10, fill=1, stroke=0)
        document.setFillColor(HexColor("#2764D8"))
        document.circle(246, y + 6, 10, fill=1, stroke=0)
        text(document, str(index), 243, y + 2.5, bold, 7.5, "#FFFFFF")
        text(document, principle, 266, y + 1, regular, 10.6, "#071942")
        y -= 58

    text(document, "Маршрут", 224, 68, bold, 9, "#66738C")
    text(
        document,
        "Моя работа  ->  Воронки  ->  Карточка  ->  Действие  ->  Отчёт",
        224,
        47,
        regular,
        10.5,
        "#071942",
    )
    text(document, "КИБЕРНЕТИЧЕСКИЕ СИСТЕМЫ", 36, 28, bold, 6.8, "#FFFFFF")
    text(document, f"01 / {total_pages:02d}", width - 57, 18, regular, 7.5, "#66738C")
    document.showPage()


def draw_screen(
    document: canvas.Canvas,
    screen: Screen,
    regular: str,
    bold: str,
    page_number: int,
    total_pages: int,
) -> None:
    width, height = PAGE
    document.setFillColor(HexColor("#F6F9FD"))
    document.rect(0, 0, width, height, fill=1, stroke=0)
    text(document, screen.title, 28, height - 39, bold, 20, "#071942")
    text(document, screen.purpose, 28, height - 59, regular, 9.2, "#66738C")

    image_x = 28
    image_y = 33
    image_w = width - 56
    image_h = image_w * 2 / 3
    document.setStrokeColor(HexColor("#DDE5F0"))
    document.setLineWidth(0.7)
    document.roundRect(
        image_x - 1,
        image_y - 1,
        image_w + 2,
        image_h + 2,
        6,
        fill=0,
        stroke=1,
    )
    document.drawImage(
        str(screen.file),
        image_x,
        image_y,
        width=image_w,
        height=image_h,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    text(
        document,
        f"{page_number:02d} / {total_pages:02d}",
        width - 57,
        16,
        regular,
        7.5,
        "#66738C",
    )
    document.showPage()


def build(screens: list[Screen]) -> Path:
    regular, bold = register_fonts()
    total_pages = len(screens) + 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = canvas.Canvas(str(OUTPUT), pagesize=PAGE, pageCompression=1)
    document.setTitle("Курс на Север - полный комплект интерфейсов CRM v5")
    document.setAuthor("Кибернетические Системы")
    document.setSubject("CRM-only interface references: 51 screens")
    draw_cover(document, regular, bold, total_pages, len(screens))
    for page_number, screen in enumerate(screens, start=2):
        draw_screen(document, screen, regular, bold, page_number, total_pages)
    document.save()
    return OUTPUT


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--allow-pending",
        "--allow-planned",
        dest="allow_pending",
        action="store_true",
        help="Allow qa-pending rows for draft builds; final builds require qa-passed.",
    )
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    screens = sorted(read_manifest(), key=lambda item: item.order)
    validate(screens, allow_pending=args.allow_pending)
    if args.check_only:
        print(f"OK: {len(screens)} CRM screens")
        return
    print(f"Wrote {build(screens)}")


if __name__ == "__main__":
    main()
