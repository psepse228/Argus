"""Real style fingerprint pulled from the actual Excel samples (openpyxl,
full cell-by-cell dump) — column widths, row heights, borders, number
formats, zoom. Fonts are simplified to Times New Roman (headers/data) +
Arial (a few specific columns) rather than replicating every single
inconsistent per-cell quirk in the real files (e.g. one cell using Calibri
for no discernible reason) — those aren't visually meaningful, just artifacts
of a hand-edited spreadsheet.
"""
from openpyxl.styles import Font, Alignment, Border, Side

COL_WIDTHS = {
    "C": 12.0, "D": 18.0, "E": 12.0, "F": 19.66, "G": 18.44, "H": 17.55,
    "I": 18.33, "J": 12.66, "K": 14.11, "L": 18.0, "M": 15.11, "N": 16.44,
    "O": 17.44, "P": 14.89, "Q": 16.11, "R": 14.33, "S": 21.55, "T": 18.33,
    "U": 23.44, "V": 14.55, "W": 12.44, "X": 22.44,
}
COL_WIDTHS_BALLOON = {**COL_WIDTHS, "V": 21.89, "AB": 10.22}

ROW_HEIGHTS = {1: 15.0, 2: 19.5, 3: 36.75, 4: 44.25, 5: 28.5, 6: 15.6, 7: 15.6, 8: 16.5, 9: 15.0, 12: 1.5, 13: 27.75, 15: 51.75}
ROW_HEIGHTS_BALLOON = {**ROW_HEIGHTS, 3: 67.8}

ZOOM = 62
ZOOM_BALLOON = 66

TITLE_FONT = Font(name="Times New Roman", size=14, bold=True)
HEADER_FONT_TIMES = Font(name="Times New Roman", size=11, bold=True)
HEADER_FONT_ARIAL = Font(name="Arial", size=10, bold=True)
HEADER_FONT_LAST = Font(name="Calibri", size=11, bold=True)
DATA_FONT_ARIAL = Font(name="Arial", size=12, bold=True)
DATA_FONT_TIMES = Font(name="Times New Roman", size=11, bold=True)
DATA_FONT_LAST = Font(name="Calibri", size=11, bold=True)

CENTER_WRAP = Alignment(horizontal="center", vertical="center", wrap_text=True)

_thin = Side(style="thin")
_medium = Side(style="medium")

BORDER_TITLE = Border(top=_medium, bottom=_medium, left=_medium)
BORDER_TITLE_MID = Border(top=_medium, bottom=_medium)
BORDER_HEADER_FIRST = Border(top=_medium, bottom=_thin, left=_medium, right=_thin)
BORDER_HEADER_MID = Border(top=_medium, bottom=_thin, left=_thin, right=_thin)
BORDER_HEADER_LAST = Border(top=_medium, bottom=_thin, left=_thin, right=_medium)
BORDER_DATA_FIRST = Border(top=_thin, bottom=_thin, left=_medium, right=_thin)
BORDER_DATA_MID = Border(top=_thin, bottom=_thin, left=_thin, right=_thin)
BORDER_DATA_LAST = Border(top=_thin, bottom=_thin, left=_thin, right=_medium)

ACCOUNTING_FMT = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-'
