"""Per-unit PDF export -- Macro CRM parity (see
docs/superpowers/plans/2026-08-01-ulkan-full-replacement-week-plan.md Day 1).

Live macroserver.uz access never came through (blocked by the client's
privacy policy), but on 2026-08-02 the client sent two real Macro PDF exports
instead -- those replace the planned Cowork audit as the source of truth for
this layout. The real thing is 4 pages (unit card, full-floor plan with the
unit highlighted, marketing copy, building renders); this only builds page 1
(the unit info card) tonight. Pages 2-4 need assets we don't have yet:
- page 2 needs a real per-floor architectural plan per building (we only have
  2 example floors of Milano from the sample PDFs) -- an asset-sourcing gap,
  not a code gap.
- pages 3-4 need per-building marketing copy + photos, which don't exist in
  the schema at all yet.
Both are flagged in the vault/plan docs as follow-up, not silently skipped.

Field set on page 1 is copied field-for-field from the real samples. Some of
those fields (address, срок сдачи, материал дома, этажность) didn't exist in
our schema at all -- see migration 0021. Fields we still can't fill honestly
(Спецпредложение -- which plan_type's rate would even apply on a walk-in
handout with no client attached, приведенная площадь -- unknown balcony
weighting formula) are left out entirely rather than guessed.
"""
import io
import os
from datetime import date

import httpx
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# reportlab's built-in Helvetica/Helvetica-Bold are Type1 fonts with no
# Cyrillic glyphs at all -- every Russian label rendered as a solid black box
# before this. DejaVu Sans is a Bitstream Vera derivative with full Cyrillic
# coverage; see assets/fonts/LICENSE.txt for why it's bundled here.
_FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "fonts")
_FONT = "DejaVuSans"
_FONT_BOLD = "DejaVuSans-Bold"
pdfmetrics.registerFont(TTFont(_FONT, os.path.join(_FONTS_DIR, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont(_FONT_BOLD, os.path.join(_FONTS_DIR, "DejaVuSans-Bold.ttf")))


def generate_unit_pdf(client, tenant_id: str, unit_id: str) -> tuple[bytes, str] | None:
    """Returns (pdf_bytes, filename), or None if the unit doesn't exist for this tenant."""
    unit_res = (
        client.table("units")
        .select("*, buildings(name, project_name, address, landmark, completion_label, material, total_floors)")
        .eq("id", unit_id).eq("tenant_id", tenant_id).execute()
    )
    if not unit_res.data:
        return None
    unit = unit_res.data[0]
    building = unit.get("buildings") or {}

    manager_name = unit.get("assigned_manager")
    manager_phone = None
    if manager_name:
        tu_res = (
            client.table("tenant_users")
            .select("phone")
            .eq("tenant_id", tenant_id).eq("name", manager_name)
            .execute()
        )
        if tu_res.data:
            manager_phone = tu_res.data[0].get("phone")

    floor_plan_bytes = _fetch_floor_plan(unit.get("floor_plan_url"))
    pdf_bytes = _render_pdf(unit, building, manager_name, manager_phone, floor_plan_bytes)

    building_name = building.get("name") or "unit"
    filename = f"{building_name}-{unit['unit_number']}.pdf".replace(" ", "-")
    return pdf_bytes, filename


def _fetch_floor_plan(floor_plan_url: str | None) -> bytes | None:
    if not floor_plan_url or not floor_plan_url.startswith("http"):
        return None
    try:
        resp = httpx.get(floor_plan_url, timeout=10)
        return resp.content if resp.status_code == 200 else None
    except Exception:
        return None


def _wrap(c: canvas.Canvas, text: str, font: str, size: int, max_width: float) -> list[str]:
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if stringWidth(trial, font, size) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def _price_fmt(amount: float) -> str:
    return f"${round(amount):,}".replace(",", " ")


def _render_pdf(unit: dict, building: dict, manager_name: str | None, manager_phone: str | None, floor_plan_bytes: bytes | None) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    margin = 20 * mm
    col_gap = 10 * mm
    col_w = (width - 2 * margin - col_gap) / 2
    left_x, right_x = margin, margin + col_w + col_gap

    # Header: manager contact top-right, project wordmark top-left.
    y = height - margin
    c.setFont(_FONT, 9)
    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.drawRightString(width - margin, y, "Менеджер:")
    c.setFillColorRGB(0, 0, 0)
    y -= 5 * mm
    c.setFont(_FONT_BOLD, 12)
    c.drawRightString(width - margin, y, manager_name or "—")
    if manager_phone:
        y -= 5.5 * mm
        c.setFont(_FONT, 11)
        c.drawRightString(width - margin, y, manager_phone)
    y -= 8 * mm
    c.setFont(_FONT, 9)
    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.drawRightString(width - margin, y, date.today().strftime("%d.%m.%Y"))
    c.setFillColorRGB(0, 0, 0)

    project_name = building.get("project_name")
    if project_name:
        c.setFont(_FONT_BOLD, 13)
        c.drawString(margin, height - margin - 5 * mm, project_name.upper())

    # Title.
    y = height - margin - 22 * mm
    title_bits = [b for b in (unit.get("room_type"), f"квартира №{unit['unit_number']}") if b]
    c.setFont(_FONT_BOLD, 20)
    c.drawString(margin, y, " ".join(title_bits))
    y -= 4 * mm
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.line(margin, y, width - margin, y)
    y -= 10 * mm

    # Two-column field grid -- only fields we actually have data for. Never
    # fabricate address/material/completion/floor-count when null.
    left_top = y
    ly = left_top
    if building.get("address") or building.get("name"):
        c.setFont(_FONT, 10)
        c.setFillColorRGB(0.45, 0.45, 0.45)
        c.drawString(left_x, ly, "Адрес")
        c.setFillColorRGB(0, 0, 0)
        ly -= 5 * mm
        c.setFont(_FONT, 11)
        value_w = col_w - 25 * mm
        if building.get("address"):
            for line in _wrap(c, building["address"], _FONT, 11, value_w):
                c.drawString(left_x, ly, line)
                ly -= 5 * mm
        if building.get("name"):
            c.setFont(_FONT_BOLD, 11)
            c.drawString(left_x, ly, f"ЖК {building['name']}")
            ly -= 5 * mm
        if building.get("landmark"):
            c.setFont(_FONT, 10)
            for line in _wrap(c, f"(ориентир: {building['landmark']})", _FONT, 10, value_w):
                c.drawString(left_x, ly, line)
                ly -= 4.5 * mm
        ly -= 3 * mm

    left_rows = [
        ("Срок сдачи", building.get("completion_label")),
        ("Материал дома", building.get("material")),
        ("Подъезд", str(unit["entrance"]) if unit.get("entrance") is not None else None),
        ("Этаж", str(unit["floor"])),
        ("Этажность", str(building["total_floors"]) if building.get("total_floors") is not None else None),
    ]
    for label, value in left_rows:
        if value is None:
            continue
        c.setFont(_FONT, 10)
        c.setFillColorRGB(0.45, 0.45, 0.45)
        c.drawString(left_x, ly, label)
        c.setFillColorRGB(0, 0, 0)
        c.setFont(_FONT, 11)
        c.drawRightString(left_x + col_w, ly, value)
        ly -= 6.5 * mm

    ry = left_top
    c.setFont(_FONT, 10)
    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.drawString(right_x, ry, "Цена")
    c.setFillColorRGB(0, 0, 0)
    ry -= 5 * mm
    total_price = unit["area_m2"] * unit["price_per_m2_usd"]
    c.setFont(_FONT_BOLD, 13)
    c.drawString(right_x, ry, _price_fmt(total_price))
    ry -= 4.5 * mm
    c.setFont(_FONT, 9)
    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.drawString(right_x, ry, f"({unit['price_per_m2_usd']:.0f} $/м²)")
    c.setFillColorRGB(0, 0, 0)
    ry -= 8 * mm

    right_rows = [
        ("Площадь", f"{unit['area_m2']} м²"),
        ("Высота потолка", f"{unit['ceiling_height_m']} м" if unit.get("ceiling_height_m") is not None else None),
    ]
    for label, value in right_rows:
        if value is None:
            continue
        c.setFont(_FONT, 10)
        c.setFillColorRGB(0.45, 0.45, 0.45)
        c.drawString(right_x, ry, label)
        c.setFillColorRGB(0, 0, 0)
        c.setFont(_FONT, 11)
        c.drawRightString(right_x + col_w, ry, value)
        ry -= 6.5 * mm

    y = min(ly, ry) - 8 * mm

    # Floor plan (this unit's own layout) or a placeholder box.
    img_w, img_h = width - 2 * margin, 85 * mm
    if floor_plan_bytes:
        try:
            c.drawImage(
                ImageReader(io.BytesIO(floor_plan_bytes)), margin, y - img_h,
                width=img_w, height=img_h, preserveAspectRatio=True, anchor="c",
            )
        except Exception:
            floor_plan_bytes = None
    if not floor_plan_bytes:
        c.setStrokeColorRGB(0.75, 0.75, 0.75)
        c.rect(margin, y - img_h, img_w, img_h)
        c.setFillColorRGB(0.55, 0.55, 0.55)
        c.setFont(_FONT, 11)
        c.drawCentredString(width / 2, y - img_h / 2, "План появится после загрузки в систему")
        c.setFillColorRGB(0, 0, 0)

    c.showPage()
    c.save()
    return buf.getvalue()
