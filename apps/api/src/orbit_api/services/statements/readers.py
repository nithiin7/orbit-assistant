"""Turning a statement file into rows of text cells: CSV or delimited text, Excel, or PDF.

The file's type comes from its contents, never its name. Files stay in memory and are never
stored, and a PDF's password is used only to open it here.

A PDF has no table, only characters placed on a page. Characters are grouped into lines by their
height on the page and into cells by the gaps between them; each cell then goes under the header
it sits beneath, judged by its real position rather than by counting characters.
"""

import csv
import io
import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Final, Literal, cast
from zipfile import BadZipFile

import openpyxl
import xlrd
from openpyxl.utils.exceptions import InvalidFileException
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTChar, LTContainer, LTItem, LTPage
from pdfminer.pdfdocument import PDFPasswordIncorrect
from pdfminer.psexceptions import PSException
from xlrd.biffh import XLRDError

from orbit_api.services.statements.columns import classify, match_columns

MAX_STATEMENT_BYTES: Final = 5 * 1024 * 1024
MAX_PDF_PAGES: Final = 100
MAX_TABLE_ROWS: Final = 20_000

StatementSource = Literal["text", "excel", "pdf"]

_DELIMITERS: Final = (",", "\t", ";", "|")
_NUMBER: Final = re.compile(
    r"^[-(]?(?:₹|rs\.?|inr)?\s*\d[\d,]*(?:\.\d+)?\)?(?:\s*(?:cr|dr))?$", re.IGNORECASE
)
# Lines that end a page's transactions and aren't part of any row.
_PAGE_FURNITURE: Final = re.compile(
    r"^\s*(page\s*\d+|page\s+no|total\b|grand total|legends?\b|this is (a )?(computer|system)"
    r"|\*+\s*end of|statement summary)",
    re.IGNORECASE,
)
# Gaps, as a share of the font size: wider than a word space splits words, and wider than
# about a character splits cells.
_WORD_GAP: Final = 0.2
_CELL_GAP: Final = 1.0


class StatementUnreadableError(Exception):
    """The file isn't a statement Orbit can read. `message` is safe to show."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class StatementPasswordRequiredError(Exception):
    """The PDF is locked and no password was given."""


class StatementPasswordWrongError(Exception):
    """The password given doesn't open the PDF."""


@dataclass(frozen=True, slots=True)
class StatementTable:
    source: StatementSource
    rows: list[list[str]]


def read_statement(data: bytes, password: str | None = None) -> StatementTable:
    if b"%PDF-" in data[:1024]:
        return StatementTable("pdf", _read_pdf(data, password))
    if data.startswith(b"PK\x03\x04"):
        return StatementTable("excel", _read_xlsx(data))
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        return StatementTable("excel", _read_xls(data))
    return StatementTable("text", _read_text(data))


def _limited(rows: list[list[str]]) -> list[list[str]]:
    if len(rows) > MAX_TABLE_ROWS:
        raise StatementUnreadableError("This statement is too long. Import a shorter period.")
    if not rows:
        raise StatementUnreadableError("This file has no transactions to read.")
    return rows


# Text


def _read_text(data: bytes) -> list[list[str]]:
    if b"\x00" in data[:4096]:
        raise StatementUnreadableError("Orbit can read PDF, Excel, and CSV statements.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    lines = [line for line in text.splitlines() if line.strip()]
    delimiter = max(_DELIMITERS, key=lambda mark: sum(line.count(mark) for line in lines[:50]))
    try:
        rows = [[cell.strip() for cell in row] for row in csv.reader(lines, delimiter=delimiter)]
    except csv.Error:
        raise StatementUnreadableError("Orbit couldn't read this file.") from None
    return _limited([row for row in rows if any(row)])


# Excel


def _excel_cell(value: object) -> str:
    match value:
        case None | bool():
            return ""
        case datetime():
            return value.date().isoformat()
        case date():
            return value.isoformat()
        case float() | int() | Decimal():
            return format(Decimal(str(value)), "f")
        case _:
            return str(value).strip()


def _read_xlsx(data: bytes) -> list[list[str]]:
    try:
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (InvalidFileException, BadZipFile, KeyError, OSError, ValueError):
        raise StatementUnreadableError("Orbit couldn't read this Excel file.") from None
    try:
        rows: list[list[str]] = []
        for values in cast(Any, book.worksheets[0]).iter_rows(values_only=True):
            cells = [_excel_cell(value) for value in cast(tuple[object, ...], values)]
            if any(cells):
                rows.append(cells)
            if len(rows) > MAX_TABLE_ROWS:
                break
    finally:
        book.close()
    return _limited(rows)


def _read_xls(data: bytes) -> list[list[str]]:
    try:
        book: Any = xlrd.open_workbook(file_contents=data)  # pyright: ignore[reportUnknownMemberType]
    except XLRDError as error:
        if "encrypted" in str(error).lower():
            raise StatementUnreadableError(
                "This Excel file is password-protected. Remove the password in Excel, or import "
                "the PDF statement instead."
            ) from None
        raise StatementUnreadableError("Orbit couldn't read this Excel file.") from None
    sheet: Any = book.sheet_by_index(0)
    rows: list[list[str]] = []
    for index in range(min(sheet.nrows, MAX_TABLE_ROWS + 1)):
        cells = [_xls_cell(book, cell) for cell in sheet.row(index)]
        if any(cells):
            rows.append(cells)
    return _limited(rows)


def _xls_cell(book: Any, cell: Any) -> str:
    if cell.ctype == xlrd.XL_CELL_DATE:
        when: datetime = xlrd.xldate_as_datetime(cell.value, book.datemode)  # pyright: ignore[reportUnknownMemberType]
        return when.date().isoformat()
    return "" if cell.ctype == xlrd.XL_CELL_ERROR else _excel_cell(cell.value)


# PDF


@dataclass(frozen=True, slots=True)
class _Cell:
    """Text and its horizontal extent on the page, in points."""

    start: float
    end: float
    text: str

    @property
    def is_number(self) -> bool:
        return _NUMBER.match(self.text) is not None


def _pages(data: bytes, password: str | None) -> list[LTPage]:
    def load(secret: str) -> list[LTPage]:
        return list(extract_pages(io.BytesIO(data), password=secret, maxpages=MAX_PDF_PAGES + 1))

    try:
        try:
            # A PDF locked only against editing opens without a password.
            return load("")
        except PDFPasswordIncorrect:
            if not password:
                raise StatementPasswordRequiredError from None
        try:
            return load(password)
        except PDFPasswordIncorrect:
            raise StatementPasswordWrongError from None
    except (PSException, ValueError, KeyError, TypeError, IndexError, AttributeError, OSError):
        raise StatementUnreadableError("Orbit couldn't read this PDF.") from None


def _read_pdf(data: bytes, password: str | None) -> list[list[str]]:
    pages = _pages(data, password)
    if len(pages) > MAX_PDF_PAGES:
        raise StatementUnreadableError("This statement is too long. Import a shorter period.")
    lines_by_page = [_lines(page) for page in pages]
    if not any(lines_by_page):
        raise StatementUnreadableError(
            "This PDF is a scanned image, so Orbit can't read its text. Download the statement "
            "from your bank's website instead."
        )
    return _limited(_pdf_rows(lines_by_page))


def _chars(item: LTItem) -> Iterator[LTChar]:
    if isinstance(item, LTChar):
        yield item
    elif isinstance(item, LTContainer):
        for child in cast(LTContainer[LTItem], item):
            yield from _chars(child)


def _lines(page: LTPage) -> list[list[_Cell]]:
    """The page's lines from top to bottom, each split into cells."""
    chars = sorted(
        (char for char in _chars(page) if char.get_text().strip()),
        key=lambda char: (-round(char.y0), char.x0),
    )
    rows: list[list[LTChar]] = []
    for char in chars:
        if rows and abs(rows[-1][0].y0 - char.y0) <= max(char.size, 1) * 0.3:
            rows[-1].append(char)
        else:
            rows.append([char])
    return [_split(sorted(row, key=lambda char: char.x0)) for row in rows]


def _split(row: list[LTChar]) -> list[_Cell]:
    cells: list[_Cell] = []
    text = row[0].get_text()
    start, end = row[0].x0, row[0].x1
    for char in row[1:]:
        gap = char.x0 - end
        size = max(char.size, 1)
        if gap > size * _CELL_GAP:
            cells.append(_Cell(start, end, text))
            text, start = char.get_text(), char.x0
        else:
            text += (" " if gap > size * _WORD_GAP else "") + char.get_text()
        end = max(end, char.x1)
    cells.append(_Cell(start, end, text))
    return cells


def _is_header(cells: list[_Cell]) -> bool:
    return match_columns([cell.text for cell in cells]) is not None


def _column_of(cell: _Cell, header: list[_Cell]) -> int:
    """The header cell this cell sits under. Amounts are usually right-aligned, so a number goes
    under the amount column whose right edge is nearest."""
    if cell.is_number:
        numeric = [
            index
            for index, column in enumerate(header)
            if (kind := classify(column.text)) is not None
            and kind[0] in ("withdrawal", "deposit", "amount", "balance")
        ]
        if numeric:
            return min(numeric, key=lambda index: abs(header[index].end - cell.end))

    def overlap(index: int) -> float:
        column = header[index]
        return min(column.end, cell.end) - max(column.start, cell.start)

    def distance(index: int) -> float:
        column = header[index]
        return abs((column.start + column.end) - (cell.start + cell.end))

    best = max(range(len(header)), key=overlap)
    return best if overlap(best) > 0 else min(range(len(header)), key=distance)


def _pdf_rows(pages: list[list[list[_Cell]]]) -> list[list[str]]:
    """One grid under the first header found. Lines above the header (bank and account
    details) and page footers are left out; each page uses its own header when it repeats it."""
    rows: list[list[str]] = []
    header: list[_Cell] | None = None
    for lines in pages:
        in_table = header is not None
        for cells in lines:
            if _is_header(cells):
                if header is None:
                    rows.append([cell.text for cell in cells])
                header = cells
                in_table = True
                continue
            if header is None or not in_table:
                continue
            if _PAGE_FURNITURE.match(" ".join(cell.text for cell in cells)):
                in_table = False
                continue
            grid = [""] * len(header)
            for cell in cells:
                position = _column_of(cell, header)
                grid[position] = f"{grid[position]} {cell.text}".strip()
            rows.append(grid)
    if header is None:
        raise StatementUnreadableError(
            "Orbit couldn't find the transaction table in this PDF. Try the bank's Excel or CSV "
            "download if it has one."
        )
    return rows
