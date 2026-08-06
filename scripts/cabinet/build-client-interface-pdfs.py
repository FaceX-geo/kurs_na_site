#!/usr/bin/env python3
"""Build two client-facing interface PDFs from the v3 ImageGen manifest."""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "docs/design/client-interface-pack-v3"
MANIFEST = PACK / "MANIFEST.csv"
OUTPUT = ROOT / "output/pdf"
TMP_FONTS = ROOT / "tmp/pdfs/client-interface-pack-v3/fonts"
PAGE = landscape((648, 864))  # 12 x 9 in, client-document ratio.


@dataclass(frozen=True)
class Screen:
    app: str
    order: int
    slug: str
    title: str
    purpose: str
    file: Path
    status: str


APP_CONFIG = {
    "crm": {
        "output": OUTPUT / "kurs-na-sever-crm-interfaces.pdf",
        "brand": "Курс на Север",
        "subtitle": "CRM",
        "title": "Интерфейсы программы",
        "canvas": HexColor("#F6F8FC"),
        "ink": HexColor("#0F1B36"),
        "muted": HexColor("#66738C"),
        "line": HexColor("#DDE5F0"),
        "primary": HexColor("#225FE3"),
        "sidebar": HexColor("#061A3D"),
        "principles": [
            "Один экран - одно решение.",
            "Система сама поднимает то, что требует внимания.",
            "Специалист видит только нужные данные и следующий шаг.",
            "Подробности раскрываются по запросу без потери контекста.",
            "Каждый переход понятен и подтверждается пользователем.",
            "Отчёты объясняют результат и ведут к исходным записям.",
        ],
        "route": "Моя работа  →  Воронка  →  Карточка  →  Следующий этап  →  Отчёт",
    },
    "tracker": {
        "output": OUTPUT / "ks-projects-tracker-interfaces.pdf",
        "brand": "КС Проекты",
        "subtitle": "Трекер проектов",
        "title": "Интерфейсы программы",
        "canvas": HexColor("#F4F3F0"),
        "ink": HexColor("#171B24"),
        "muted": HexColor("#7A8291"),
        "line": HexColor("#DEDFDC"),
        "primary": HexColor("#4768EF"),
        "sidebar": HexColor("#20242D"),
        "principles": [
            "Проект, команда и задачи находятся в одном контексте.",
            "В фокусе только работа, которая требует решения сейчас.",
            "Система заранее показывает отклонения и зависимости.",
            "Повторяемую работу выполняет система, исключения решает человек.",
            "Агент готовит отчёты, планы и задачи по обычной фразе.",
            "Любые изменения сначала показываются и только потом подтверждаются.",
        ],
        "route": "Сегодня  →  Проект  →  Задача  →  Команда и сроки  →  Отчёт",
    },
}


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
    regular_woff = ROOT / "assets/fonts/manrope-400.woff2"
    bold_woff = ROOT / "assets/fonts/manrope-700.woff2"
    try:
        regular = _convert_font(regular_woff, TMP_FONTS / "Manrope-Regular.ttf")
        bold = _convert_font(bold_woff, TMP_FONTS / "Manrope-Bold.ttf")
        pdfmetrics.registerFont(TTFont("Client-Regular", str(regular)))
        pdfmetrics.registerFont(TTFont("Client-Bold", str(bold)))
        return "Client-Regular", "Client-Bold"
    except Exception:
        regular = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
        bold = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
        pdfmetrics.registerFont(TTFont("Client-Regular", str(regular)))
        pdfmetrics.registerFont(TTFont("Client-Bold", str(bold)))
        return "Client-Regular", "Client-Bold"


def read_manifest() -> list[Screen]:
    with MANIFEST.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    screens: list[Screen] = []
    for row in rows:
        screens.append(
            Screen(
                app=row["app"],
                order=int(row["order"]),
                slug=row["slug"],
                title=row["title"],
                purpose=row["purpose"],
                file=(PACK / row["file"]).resolve(),
                status=row["status"],
            )
        )
    return screens


def validate(screens: Iterable[Screen], require_final: bool) -> None:
    seen: set[tuple[str, int]] = set()
    for screen in screens:
        key = (screen.app, screen.order)
        if key in seen:
            raise ValueError(f"Duplicate manifest order: {key}")
        seen.add(key)
        if screen.app not in APP_CONFIG:
            raise ValueError(f"Unknown app: {screen.app}")
        if require_final and screen.status != "qa-passed":
            raise ValueError(f"Screen not QA-passed: {screen.app}/{screen.slug}")
        if not screen.file.exists():
            raise FileNotFoundError(screen.file)
        with Image.open(screen.file) as image:
            if image.width < 1200 or image.height < 800:
                raise ValueError(f"Image too small: {screen.file} = {image.size}")


def draw_text(c: canvas.Canvas, value: str, x: float, y: float, font: str, size: float, color: Color) -> None:
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, y, value)


def draw_cover(c: canvas.Canvas, cfg: dict, regular: str, bold: str, total_pages: int) -> None:
    width, height = PAGE
    c.setFillColor(cfg["canvas"])
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(cfg["sidebar"])
    c.rect(0, 0, 176, height, fill=1, stroke=0)
    c.setFillColor(cfg["primary"])
    c.circle(88, height - 92, 30, fill=1, stroke=0)
    c.roundRect(46, 58, 84, 5, 2.5, fill=1, stroke=0)

    draw_text(c, cfg["brand"], 224, height - 74, bold, 13, cfg["ink"])
    draw_text(c, cfg["subtitle"], 224, height - 96, regular, 9, cfg["muted"])
    draw_text(c, cfg["title"], 224, height - 154, bold, 31, cfg["ink"])
    draw_text(c, "Принципы интерфейса", 224, height - 192, regular, 13, cfg["muted"])

    y = height - 245
    for index, principle in enumerate(cfg["principles"], start=1):
        c.setFillColor(HexColor("#FFFFFF"))
        c.roundRect(224, y - 18, 584, 48, 10, fill=1, stroke=0)
        c.setFillColor(cfg["primary"])
        c.circle(246, y + 6, 10, fill=1, stroke=0)
        draw_text(c, str(index), 243, y + 2.5, bold, 7.5, HexColor("#FFFFFF"))
        draw_text(c, principle, 266, y + 1, regular, 11.2, cfg["ink"])
        y -= 58

    draw_text(c, "Маршрут", 224, 68, bold, 9, cfg["muted"])
    draw_text(c, cfg["route"], 224, 47, regular, 10.5, cfg["ink"])
    draw_text(c, "КИБЕРНЕТИЧЕСКИЕ СИСТЕМЫ", 36, 28, bold, 6.8, HexColor("#FFFFFF"))
    draw_text(c, f"01 / {total_pages:02d}", width - 57, 18, regular, 7.5, cfg["muted"])
    c.showPage()


def draw_screen_page(
    c: canvas.Canvas,
    cfg: dict,
    screen: Screen,
    regular: str,
    bold: str,
    page_number: int,
    total_pages: int,
) -> None:
    width, height = PAGE
    c.setFillColor(cfg["canvas"])
    c.rect(0, 0, width, height, fill=1, stroke=0)

    draw_text(c, screen.title, 28, height - 39, bold, 20, cfg["ink"])
    draw_text(c, screen.purpose, 28, height - 59, regular, 9.5, cfg["muted"])

    image_x = 28
    image_y = 33
    image_w = width - 56
    image_h = image_w * 2 / 3
    c.setStrokeColor(cfg["line"])
    c.setLineWidth(0.7)
    c.roundRect(image_x - 1, image_y - 1, image_w + 2, image_h + 2, 6, fill=0, stroke=1)
    c.drawImage(
        str(screen.file),
        image_x,
        image_y,
        width=image_w,
        height=image_h,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )

    draw_text(c, f"{page_number:02d} / {total_pages:02d}", width - 57, 16, regular, 7.5, cfg["muted"])
    c.showPage()


def build_app(app: str, screens: list[Screen], regular: str, bold: str) -> Path:
    cfg = APP_CONFIG[app]
    app_screens = sorted((screen for screen in screens if screen.app == app), key=lambda item: item.order)
    output = cfg["output"]
    output.parent.mkdir(parents=True, exist_ok=True)
    total_pages = len(app_screens) + 1
    document = canvas.Canvas(str(output), pagesize=PAGE, pageCompression=1)
    document.setTitle(f"{cfg['brand']} — {cfg['title']}")
    document.setAuthor("Кибернетические Системы")
    document.setSubject("Согласованные интерфейсы программы")
    draw_cover(document, cfg, regular, bold, total_pages)
    for page_number, screen in enumerate(app_screens, start=2):
        draw_screen_page(document, cfg, screen, regular, bold, page_number, total_pages)
    document.save()
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--allow-planned", action="store_true")
    args = parser.parse_args()

    screens = read_manifest()
    validate(screens, require_final=not args.allow_planned)
    counts = {app: sum(1 for screen in screens if screen.app == app) for app in APP_CONFIG}
    if args.check_only:
        print(f"OK: CRM {counts['crm']} screens, Tracker {counts['tracker']} screens")
        return

    regular, bold = register_fonts()
    for app in APP_CONFIG:
        output = build_app(app, screens, regular, bold)
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
