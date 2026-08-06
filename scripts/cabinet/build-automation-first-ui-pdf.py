#!/usr/bin/env python3
"""Build the FaceX automation-first interface reference PDF.

The builder is deliberately strict: it validates every manifest row and every
image before it creates or replaces the final PDF. This prevents a partially
generated album from being mistaken for the approved interface set.

Default output:
    output/pdf/kurs-na-sever-automation-first-interfaces.pdf
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence
from xml.sax.saxutils import escape

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import KeepInFrame, Paragraph, Spacer
from reportlab.lib.utils import ImageReader


DEFAULT_MANIFEST = Path(
    "docs/design/kurs-na-sever-system-reference/v2-automation-first/MANIFEST.csv"
)
DEFAULT_LAWS = Path("docs/facex-manifesto/AUTOMATION_LAWS.md")
DEFAULT_OUTPUT = Path("output/pdf/kurs-na-sever-automation-first-interfaces.pdf")
ALLOWED_IMAGE_ROOT = Path("docs/design/kurs-na-sever-system-reference")

PAGE_SIZE = (12 * inch, 8 * inch)
PAGE_WIDTH, PAGE_HEIGHT = PAGE_SIZE
EXPECTED_LAW_COUNT = 20
FINAL_STATUSES = {"approved", "qa-passed", "retained-v1"}
SUPPORTED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg"}
MIN_IMAGE_WIDTH = 1000
MIN_IMAGE_HEIGHT = 650

BACKGROUND = HexColor("#F7FAFF")
WHITE = HexColor("#FFFFFF")
NAVY = HexColor("#06143B")
BLUE = HexColor("#2B5DA8")
CORAL = HexColor("#EC194C")
CYAN = HexColor("#59DCE6")
TEXT = HexColor("#12213F")
MUTED = HexColor("#60708F")
LINE = HexColor("#DCE6F3")
PALE_CYAN = HexColor("#EAFBFD")

FONT_REGULAR = "FaceXArial"
FONT_BOLD = "FaceXArialBold"

REQUIRED_MANIFEST_COLUMNS = {
    "id",
    "family",
    "file",
    "scenarios",
    "primary_question",
    "human_focus",
    "automation",
    "status",
}

FAMILY_LABELS = {
    "access": "Доступ",
    "foundations": "Системные состояния",
    "today": "Сегодня",
    "crm": "CRM",
    "projects": "Проекты",
    "command": "Найти или поручить",
    "control": "Контроль",
    "migration": "Миграция",
    "responsive": "Адаптивный фокус",
}

LAW_HEADING_RE = re.compile(r"^##\s+(\d+)\.\s+(.+?)\s*$", re.MULTILINE)
DATE_RE = re.compile(r"^Дата:\s*(.+?)\s*$", re.MULTILINE)
HIGH_CONFIDENCE_SECRET_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("API secret", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
)


class BuildInputError(RuntimeError):
    """A user-actionable input validation error."""


@dataclass(frozen=True)
class AutomationLaw:
    number: int
    title: str
    body: str


@dataclass(frozen=True)
class InterfaceReference:
    reference_id: str
    family: str
    file_ref: str
    path: Path
    scenarios: str
    primary_question: str
    human_focus: str
    automation: str
    status: str
    pixel_width: int
    pixel_height: int


@dataclass(frozen=True)
class BuildInputs:
    laws: tuple[AutomationLaw, ...]
    law_date: str | None
    references: tuple[InterfaceReference, ...]


def _plain_text(value: str) -> str:
    """Normalize Markdown-ish source text for safe PDF rendering."""

    value = value.replace("`", "")
    value = value.replace("**", "").replace("__", "")
    value = value.replace("\u00a0", " ")
    value = value.translate(str.maketrans({"–": "-", "—": "-", "‑": "-", "−": "-"}))
    return re.sub(r"\s+", " ", value).strip()


def _paragraph_text(value: str) -> str:
    return escape(_plain_text(value))


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve_repo_path(repo_root: Path, value: Path, allowed_root: Path) -> Path:
    candidate = value if value.is_absolute() else repo_root / value
    candidate = candidate.resolve()
    if not _is_within(candidate, allowed_root.resolve()):
        raise BuildInputError(
            f"Path must stay inside {allowed_root.relative_to(repo_root)}: {value}"
        )
    return candidate


def _find_font(candidates: Sequence[Path], label: str) -> Path:
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    attempted = ", ".join(str(path) for path in candidates)
    raise BuildInputError(f"Cyrillic-safe {label} font not found. Checked: {attempted}")


def register_fonts() -> None:
    registered = set(pdfmetrics.getRegisteredFontNames())
    if FONT_REGULAR in registered and FONT_BOLD in registered:
        return

    regular = _find_font(
        (
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Path("/Library/Fonts/Arial.ttf"),
            Path("/Library/Fonts/Arial Unicode.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        ),
        "Arial/Arial Unicode regular",
    )
    bold = _find_font(
        (
            Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
            Path("/Library/Fonts/Arial Bold.ttf"),
            regular,
        ),
        "Arial bold",
    )

    pdfmetrics.registerFont(TTFont(FONT_REGULAR, str(regular)))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold)))
    pdfmetrics.registerFontFamily(
        "FaceXArialFamily",
        normal=FONT_REGULAR,
        bold=FONT_BOLD,
        italic=FONT_REGULAR,
        boldItalic=FONT_BOLD,
    )


def _detect_secret_like_text(label: str, text: str) -> list[str]:
    errors: list[str] = []
    for secret_kind, pattern in HIGH_CONFIDENCE_SECRET_PATTERNS:
        if pattern.search(text):
            errors.append(f"{label} contains a value that looks like a {secret_kind}")
    return errors


def parse_laws(path: Path) -> tuple[tuple[AutomationLaw, ...], str | None, str]:
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise BuildInputError(f"Cannot read laws file {path}: {exc}") from exc

    matches = list(LAW_HEADING_RE.finditer(source))
    laws: list[AutomationLaw] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        section = source[start:end].strip()
        paragraphs = [
            _plain_text(paragraph)
            for paragraph in re.split(r"\n\s*\n", section)
            if paragraph.strip() and not paragraph.lstrip().startswith("#")
        ]
        if not paragraphs:
            raise BuildInputError(f"Automation law {match.group(1)} has no body text")
        laws.append(
            AutomationLaw(
                number=int(match.group(1)),
                title=_plain_text(match.group(2)),
                body=paragraphs[0],
            )
        )

    expected_numbers = list(range(1, EXPECTED_LAW_COUNT + 1))
    actual_numbers = [law.number for law in laws]
    if actual_numbers != expected_numbers:
        raise BuildInputError(
            "Automation laws must contain exactly numbered sections 1-20; "
            f"found {actual_numbers or 'none'}"
        )

    date_match = DATE_RE.search(source)
    law_date = _plain_text(date_match.group(1)) if date_match else None
    return tuple(laws), law_date, source


def parse_manifest(
    manifest_path: Path,
    allowed_image_root: Path,
    allow_planned: bool,
) -> tuple[tuple[InterfaceReference, ...], str]:
    try:
        raw_manifest = manifest_path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise BuildInputError(f"Cannot read manifest {manifest_path}: {exc}") from exc

    reader = csv.DictReader(raw_manifest.splitlines())
    columns = set(reader.fieldnames or ())
    missing_columns = sorted(REQUIRED_MANIFEST_COLUMNS - columns)
    if missing_columns:
        raise BuildInputError(
            "Manifest is missing required columns: " + ", ".join(missing_columns)
        )

    errors: list[str] = []
    references: list[InterfaceReference] = []
    seen_ids: set[str] = set()

    for line_number, raw_row in enumerate(reader, start=2):
        row = {key: (value or "").strip() for key, value in raw_row.items()}
        reference_id = row["id"]
        file_ref = row["file"]
        status = row["status"]

        if not reference_id:
            errors.append(f"line {line_number}: empty id")
            continue
        if reference_id in seen_ids:
            errors.append(f"line {line_number}: duplicate id {reference_id}")
            continue
        seen_ids.add(reference_id)

        empty_fields = [name for name in REQUIRED_MANIFEST_COLUMNS if not row[name]]
        if empty_fields:
            errors.append(
                f"{reference_id}: empty fields: {', '.join(sorted(empty_fields))}"
            )
            continue

        if status not in FINAL_STATUSES and not allow_planned:
            errors.append(
                f"{reference_id}: status '{status}' is not final; expected one of "
                + ", ".join(sorted(FINAL_STATUSES))
            )

        unresolved_path = manifest_path.parent / file_ref
        image_path = unresolved_path.resolve()
        if not _is_within(image_path, allowed_image_root.resolve()):
            errors.append(f"{reference_id}: image path escapes the allowed reference root")
            continue
        if image_path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
            errors.append(
                f"{reference_id}: unsupported image format {image_path.suffix or '(none)'}"
            )
            continue
        if not image_path.is_file():
            errors.append(f"{reference_id}: missing image {file_ref}")
            continue

        try:
            image_reader = ImageReader(str(image_path))
            pixel_width, pixel_height = map(int, image_reader.getSize())
        except Exception as exc:  # ReportLab normalizes several image backend errors.
            errors.append(f"{reference_id}: unreadable image {file_ref}: {exc}")
            continue

        if pixel_width < MIN_IMAGE_WIDTH or pixel_height < MIN_IMAGE_HEIGHT:
            errors.append(
                f"{reference_id}: image is only {pixel_width}x{pixel_height}; "
                f"minimum is {MIN_IMAGE_WIDTH}x{MIN_IMAGE_HEIGHT}"
            )

        references.append(
            InterfaceReference(
                reference_id=reference_id,
                family=row["family"],
                file_ref=file_ref,
                path=image_path,
                scenarios=row["scenarios"],
                primary_question=_plain_text(row["primary_question"]),
                human_focus=_plain_text(row["human_focus"]),
                automation=_plain_text(row["automation"]),
                status=status,
                pixel_width=pixel_width,
                pixel_height=pixel_height,
            )
        )

    if not references:
        errors.append("manifest contains no usable interface references")

    if errors:
        raise BuildInputError("PDF input validation failed:\n- " + "\n- ".join(errors))
    return tuple(references), raw_manifest


def load_inputs(
    laws_path: Path,
    manifest_path: Path,
    allowed_image_root: Path,
    allow_planned: bool,
) -> BuildInputs:
    laws, law_date, raw_laws = parse_laws(laws_path)
    references, raw_manifest = parse_manifest(
        manifest_path=manifest_path,
        allowed_image_root=allowed_image_root,
        allow_planned=allow_planned,
    )

    secret_errors = _detect_secret_like_text("laws source", raw_laws)
    secret_errors.extend(_detect_secret_like_text("manifest", raw_manifest))
    if secret_errors:
        raise BuildInputError("Secret-like content blocked:\n- " + "\n- ".join(secret_errors))

    return BuildInputs(laws=laws, law_date=law_date, references=references)


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "cover_title": ParagraphStyle(
            "cover_title",
            fontName=FONT_BOLD,
            fontSize=31,
            leading=35,
            textColor=NAVY,
            alignment=TA_LEFT,
            spaceAfter=0,
        ),
        "cover_subtitle": ParagraphStyle(
            "cover_subtitle",
            fontName=FONT_REGULAR,
            fontSize=14,
            leading=19,
            textColor=TEXT,
            alignment=TA_LEFT,
        ),
        "law_title": ParagraphStyle(
            "law_title",
            fontName=FONT_BOLD,
            fontSize=10.2,
            leading=12.2,
            textColor=NAVY,
            alignment=TA_LEFT,
        ),
        "law_body": ParagraphStyle(
            "law_body",
            fontName=FONT_REGULAR,
            fontSize=8.1,
            leading=10.1,
            textColor=TEXT,
            alignment=TA_LEFT,
        ),
        "question": ParagraphStyle(
            "question",
            fontName=FONT_BOLD,
            fontSize=16.5,
            leading=19.2,
            textColor=NAVY,
            alignment=TA_LEFT,
        ),
        "caption": ParagraphStyle(
            "caption",
            fontName=FONT_REGULAR,
            fontSize=7.8,
            leading=9.2,
            textColor=TEXT,
            alignment=TA_LEFT,
        ),
    }


def _draw_paragraph(
    pdf: canvas.Canvas,
    text: str,
    style: ParagraphStyle,
    x: float,
    top: float,
    width: float,
    max_height: float,
) -> float:
    paragraph = Paragraph(_paragraph_text(text), style)
    _, height = paragraph.wrap(width, max_height)
    if height > max_height:
        frame = KeepInFrame(width, max_height, [paragraph], mode="shrink")
        _, frame_height = frame.wrapOn(pdf, width, max_height)
        frame.drawOn(pdf, x, top - frame_height)
        return frame_height
    paragraph.drawOn(pdf, x, top - height)
    return height


def _draw_page_number(pdf: canvas.Canvas, page_number: int, total_pages: int) -> None:
    pdf.setFillColor(MUTED)
    pdf.setFont(FONT_REGULAR, 7.5)
    pdf.drawRightString(PAGE_WIDTH - 30, 15, f"{page_number:02d} / {total_pages:02d}")


def _draw_cover(
    pdf: canvas.Canvas,
    styles: dict[str, ParagraphStyle],
    inputs: BuildInputs,
    total_pages: int,
) -> None:
    pdf.bookmarkPage("cover")
    pdf.addOutlineEntry("Обложка", "cover", level=0, closed=False)
    pdf.setFillColor(BACKGROUND)
    pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)

    pdf.setFillColor(NAVY)
    pdf.rect(0, 0, 176, PAGE_HEIGHT, stroke=0, fill=1)
    pdf.setFillColor(CYAN)
    pdf.circle(88, PAGE_HEIGHT - 92, 26, stroke=0, fill=1)
    pdf.setFillColor(Color(1, 1, 1, alpha=0.12))
    pdf.circle(30, 88, 116, stroke=0, fill=1)
    pdf.setFillColor(CORAL)
    pdf.roundRect(64, 45, 48, 5, 2.5, stroke=0, fill=1)

    pdf.setFillColor(NAVY)
    pdf.setFont(FONT_BOLD, 9)
    pdf.drawString(224, PAGE_HEIGHT - 62, "FACEX · КУРС НА СЕВЕР")

    _draw_paragraph(
        pdf,
        "Интерфейсы automation-first",
        styles["cover_title"],
        224,
        PAGE_HEIGHT - 116,
        420,
        96,
    )
    pdf.setFillColor(CORAL)
    pdf.roundRect(224, PAGE_HEIGHT - 231, 56, 5, 2.5, stroke=0, fill=1)
    _draw_paragraph(
        pdf,
        "Минимум интерфейса. Максимум продуманности. Человек видит смысл, "
        "исключение и одно следующее действие; повторяемое берёт на себя система.",
        styles["cover_subtitle"],
        224,
        PAGE_HEIGHT - 266,
        518,
        70,
    )

    pdf.setFillColor(NAVY)
    pdf.setFont(FONT_BOLD, 11)
    pdf.drawString(224, 190, f"{len(inputs.laws)} законов автоматизации")
    pdf.drawString(224, 166, f"{len(inputs.references)} интерфейсных референсов")
    pdf.setFillColor(MUTED)
    pdf.setFont(FONT_REGULAR, 9)
    pdf.drawString(224, 136, "CRM · трекер · команда · контроль · миграция")
    if inputs.law_date:
        pdf.drawString(224, 104, f"Редакция: {inputs.law_date}")

    _draw_page_number(pdf, 1, total_pages)
    pdf.showPage()


def _draw_law_card(
    pdf: canvas.Canvas,
    styles: dict[str, ParagraphStyle],
    law: AutomationLaw,
    x: float,
    top: float,
    width: float,
    height: float,
) -> None:
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.7)
    pdf.line(x, top - height, x + width, top - height)

    badge_size = 23
    pdf.setFillColor(PALE_CYAN)
    pdf.roundRect(x, top - badge_size, badge_size, badge_size, 7, stroke=0, fill=1)
    pdf.setFillColor(BLUE)
    pdf.setFont(FONT_BOLD, 8)
    pdf.drawCentredString(x + badge_size / 2, top - 15.5, str(law.number))

    content_x = x + badge_size + 10
    content_width = width - badge_size - 10
    available_height = height - 8
    flowables = [
        Paragraph(_paragraph_text(law.title), styles["law_title"]),
        Spacer(1, 3),
        Paragraph(_paragraph_text(law.body), styles["law_body"]),
    ]
    frame = KeepInFrame(
        content_width,
        available_height,
        flowables,
        mode="shrink",
        hAlign="LEFT",
        vAlign="TOP",
    )
    _, frame_height = frame.wrapOn(pdf, content_width, available_height)
    frame.drawOn(pdf, content_x, top - frame_height)


def _draw_law_page(
    pdf: canvas.Canvas,
    styles: dict[str, ParagraphStyle],
    laws: Sequence[AutomationLaw],
    page_number: int,
    total_pages: int,
) -> None:
    start_number = laws[0].number
    end_number = laws[-1].number
    bookmark = f"laws-{start_number}-{end_number}"
    pdf.bookmarkPage(bookmark)
    pdf.addOutlineEntry(
        f"Законы автоматизации {start_number}-{end_number}",
        bookmark,
        level=0,
        closed=False,
    )

    pdf.setFillColor(BACKGROUND)
    pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
    pdf.setFillColor(NAVY)
    pdf.setFont(FONT_BOLD, 19)
    pdf.drawString(38, PAGE_HEIGHT - 48, "Законы автоматизации FaceX")
    pdf.setFillColor(MUTED)
    pdf.setFont(FONT_REGULAR, 8.5)
    pdf.drawRightString(
        PAGE_WIDTH - 38,
        PAGE_HEIGHT - 45,
        f"{start_number}-{end_number} из {EXPECTED_LAW_COUNT}",
    )

    margin_x = 38
    column_gap = 24
    column_width = (PAGE_WIDTH - 2 * margin_x - column_gap) / 2
    cards_top = PAGE_HEIGHT - 77
    cards_bottom = 36
    card_height = (cards_top - cards_bottom) / 5

    for index, law in enumerate(laws):
        column = index // 5
        row = index % 5
        x = margin_x + column * (column_width + column_gap)
        top = cards_top - row * card_height
        _draw_law_card(pdf, styles, law, x, top, column_width, card_height)

    pdf.setFillColor(MUTED)
    pdf.setFont(FONT_REGULAR, 7.5)
    pdf.drawString(38, 15, "Основание: манифест FaceX + ТЗ внутреннего кабинета")
    _draw_page_number(pdf, page_number, total_pages)
    pdf.showPage()


def _fit_inside(
    source_width: float,
    source_height: float,
    box_x: float,
    box_y: float,
    box_width: float,
    box_height: float,
) -> tuple[float, float, float, float]:
    scale = min(box_width / source_width, box_height / source_height)
    width = source_width * scale
    height = source_height * scale
    x = box_x + (box_width - width) / 2
    y = box_y + (box_height - height) / 2
    return x, y, width, height


def _draw_caption(
    pdf: canvas.Canvas,
    styles: dict[str, ParagraphStyle],
    label: str,
    body: str,
    x: float,
    width: float,
) -> None:
    pdf.setFillColor(BLUE)
    pdf.setFont(FONT_BOLD, 7.2)
    pdf.drawString(x, 56, label.upper())
    _draw_paragraph(pdf, body, styles["caption"], x, 49, width, 27)


def _draw_interface_page(
    pdf: canvas.Canvas,
    styles: dict[str, ParagraphStyle],
    reference: InterfaceReference,
    page_number: int,
    total_pages: int,
    family_bookmarked: set[str],
) -> None:
    page_key = f"interface-{reference.reference_id}"
    pdf.bookmarkPage(page_key)
    if reference.family not in family_bookmarked:
        pdf.addOutlineEntry(
            FAMILY_LABELS.get(reference.family, reference.family),
            page_key,
            level=0,
            closed=False,
        )
        family_bookmarked.add(reference.family)
    pdf.addOutlineEntry(reference.reference_id, page_key, level=1, closed=False)

    pdf.setFillColor(BACKGROUND)
    pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)

    pdf.setFillColor(NAVY)
    pdf.roundRect(38, PAGE_HEIGHT - 43, 65, 20, 7, stroke=0, fill=1)
    pdf.setFillColor(WHITE)
    pdf.setFont(FONT_BOLD, 8)
    pdf.drawCentredString(70.5, PAGE_HEIGHT - 36, reference.reference_id)
    pdf.setFillColor(MUTED)
    pdf.setFont(FONT_REGULAR, 8.5)
    family_label = FAMILY_LABELS.get(reference.family, reference.family)
    pdf.drawString(114, PAGE_HEIGHT - 36, family_label)

    _draw_paragraph(
        pdf,
        reference.primary_question,
        styles["question"],
        38,
        PAGE_HEIGHT - 54,
        PAGE_WIDTH - 76,
        38,
    )

    box_x = 38
    box_y = 76
    box_width = PAGE_WIDTH - 76
    box_height = 423
    image_x, image_y, image_width, image_height = _fit_inside(
        reference.pixel_width,
        reference.pixel_height,
        box_x,
        box_y,
        box_width,
        box_height,
    )
    pdf.setFillColor(WHITE)
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.8)
    pdf.roundRect(
        image_x - 3,
        image_y - 3,
        image_width + 6,
        image_height + 6,
        5,
        stroke=1,
        fill=1,
    )
    pdf.drawImage(
        str(reference.path),
        image_x,
        image_y,
        width=image_width,
        height=image_height,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )

    caption_gap = 24
    caption_width = (PAGE_WIDTH - 76 - caption_gap) / 2
    _draw_caption(
        pdf,
        styles,
        "Фокус человека",
        reference.human_focus,
        38,
        caption_width,
    )
    _draw_caption(
        pdf,
        styles,
        "Система берёт на себя",
        reference.automation,
        38 + caption_width + caption_gap,
        caption_width,
    )

    _draw_page_number(pdf, page_number, total_pages)
    pdf.showPage()


def build_pdf(output_path: Path, inputs: BuildInputs) -> None:
    register_fonts()
    styles = _styles()
    total_pages = 3 + len(inputs.references)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output_path.stem}-",
        suffix=".tmp",
        dir=output_path.parent,
    )
    os.close(file_descriptor)
    temporary_path = Path(temporary_name)

    try:
        pdf = canvas.Canvas(
            str(temporary_path),
            pagesize=PAGE_SIZE,
            pageCompression=1,
            invariant=1,
        )
        pdf.setTitle("Курс на Север - automation-first интерфейсы")
        pdf.setAuthor("FaceX")
        pdf.setSubject("CRM, трекер, управление, контроль и миграция")
        pdf.setCreator("FaceX automation-first PDF builder")

        _draw_cover(pdf, styles, inputs, total_pages)
        _draw_law_page(pdf, styles, inputs.laws[:10], 2, total_pages)
        _draw_law_page(pdf, styles, inputs.laws[10:], 3, total_pages)

        family_bookmarked: set[str] = set()
        for page_number, reference in enumerate(inputs.references, start=4):
            _draw_interface_page(
                pdf,
                styles,
                reference,
                page_number,
                total_pages,
                family_bookmarked,
            )

        pdf.save()
        os.replace(temporary_path, output_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build the validated FaceX automation-first interface PDF."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Repository root (default: inferred from this script).",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"Manifest path relative to the repository (default: {DEFAULT_MANIFEST}).",
    )
    parser.add_argument(
        "--laws",
        type=Path,
        default=DEFAULT_LAWS,
        help=f"Automation laws path relative to the repository (default: {DEFAULT_LAWS}).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output path under output/pdf (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Validate all inputs without creating or replacing the PDF.",
    )
    parser.add_argument(
        "--allow-planned",
        action="store_true",
        help="Allow non-final manifest statuses for draft/check runs only.",
    )
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    try:
        repo_root = args.repo_root.resolve()
        manifest_path = _resolve_repo_path(repo_root, args.manifest, repo_root)
        laws_path = _resolve_repo_path(repo_root, args.laws, repo_root)
        allowed_image_root = (repo_root / ALLOWED_IMAGE_ROOT).resolve()
        output_root = (repo_root / "output/pdf").resolve()
        output_path = _resolve_repo_path(repo_root, args.output, output_root)

        inputs = load_inputs(
            laws_path=laws_path,
            manifest_path=manifest_path,
            allowed_image_root=allowed_image_root,
            allow_planned=args.allow_planned,
        )
        register_fonts()
        total_pages = 3 + len(inputs.references)

        if args.check_only:
            print(
                f"OK: {len(inputs.laws)} laws, {len(inputs.references)} interfaces, "
                f"{total_pages} planned pages"
            )
            return 0

        build_pdf(output_path=output_path, inputs=inputs)
        print(f"Wrote {output_path} ({total_pages} pages)")
        return 0
    except BuildInputError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except ImportError as exc:
        print(
            "Missing PDF dependency. Run this script with the bundled workspace "
            f"Python that includes reportlab: {exc}",
            file=sys.stderr,
        )
        return 3
    except Exception as exc:
        print(f"PDF build failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
