"""Turning a statement's rows into dated, signed entries, and checking them against its balances.

Money is parsed with `Decimal` into the currency's minor unit; floats never touch it. The printed
running balance is the safety net: each row must explain the change from the balance before it,
and a row that doesn't is flagged so it can't be imported by accident.
"""

import hashlib
import re
from collections import Counter
from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Final, Literal

from orbit_api.services.finance.money import CURRENCY_EXPONENTS, MAX_AMOUNT, Currency
from orbit_api.services.statements.columns import ColumnMap
from orbit_api.services.statements.readers import StatementSource

Direction = Literal["in", "out"]
DateOrder = Literal["dmy", "mdy"]
RowIssue = Literal["balance_mismatch", "unreadable_amount"]

MAX_DESCRIPTION: Final = 200

_MONTHS: Final = {
    name: number
    for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1
    )
}
_ISO: Final = re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b")
_NUMERIC: Final = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b")
_DAY_NAME: Final = re.compile(r"\b(\d{1,2})[-/. ]+([a-z]{3})[a-z]*[-/., ]+(\d{4}|\d{2})\b", re.I)
_NAME_DAY: Final = re.compile(r"\b([a-z]{3})[a-z]*[ .]+(\d{1,2})[, ]+(\d{4}|\d{2})\b", re.I)
_OPENING: Final = re.compile(r"\b(b/?f|brought forward|opening balance)\b", re.IGNORECASE)
# Words in a bank narration that say how money moved rather than who it went to.
_RAIL_WORDS: Final = frozenset(
    {
        "ACH",
        "ATM",
        "BIL",
        "BILLPAY",
        "CMS",
        "CR",
        "DR",
        "ECOM",
        "IMPS",
        "INB",
        "INF",
        "INFT",
        "MMT",
        "MOB",
        "NACH",
        "NEFT",
        "NFS",
        "OK",
        "PAYMENT",
        "PCA",
        "POS",
        "RTGS",
        "TO",
        "FROM",
        "TRANSFER",
        "UPI",
        "VIN",
        "VPS",
    }
)


# The bank part of a UPI address (`name@okaxis`), which says nothing about the merchant.
_UPI_HANDLES: Final = frozenset(
    {"OKAXIS", "OKHDFCBANK", "OKICICI", "OKSBI", "YBL", "IBL", "AXL", "APL", "PAYTM", "UPI"}
)


class AmountError(ValueError):
    """The text isn't an amount in this currency."""


@dataclass(frozen=True, slots=True)
class StatementRow:
    line: int
    occurred_on: date
    description: str
    amount: int
    direction: Direction
    balance: int | None
    issue: RowIssue | None
    fingerprint: str = ""


@dataclass(frozen=True, slots=True)
class ParsedStatement:
    rows: list[StatementRow]
    # True when every date could be day-first or month-first, so the person has to say which.
    needs_date_order: bool


def parse_amount(text: str, currency: Currency) -> int | None:
    """The signed amount in minor units, or `None` for an empty cell. A `Dr` suffix or
    parentheses make it negative."""
    cleaned = text.strip().lower()
    if cleaned in ("", "-", "--", "nil", "n/a", "na"):
        return None
    negative = cleaned.startswith("-") or (cleaned.startswith("(") and cleaned.endswith(")"))
    if cleaned.endswith("dr"):
        negative = True
    cleaned = re.sub(r"(cr|dr)$", "", cleaned)
    cleaned = re.sub(r"[₹,\s()+-]|rs\.?|inr", "", cleaned)
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        raise AmountError from None
    minor = value.scaleb(CURRENCY_EXPONENTS[currency])
    if minor != minor.to_integral_value() or abs(minor) > MAX_AMOUNT:
        raise AmountError
    return -int(minor) if negative else int(minor)


def _year(text: str) -> int:
    return int(text) if len(text) == 4 else 2000 + int(text)


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date(text: str, order: DateOrder) -> date | None:
    if match := _ISO.search(text):
        return _safe_date(int(match[1]), int(match[2]), int(match[3]))
    if match := _NUMERIC.search(text):
        first, second = int(match[1]), int(match[2])
        day, month = (first, second) if order == "dmy" else (second, first)
        return _safe_date(_year(match[3]), month, day)
    if (match := _DAY_NAME.search(text)) and (month := _MONTHS.get(match[2].lower())):
        return _safe_date(_year(match[3]), month, int(match[1]))
    if (match := _NAME_DAY.search(text)) and (month := _MONTHS.get(match[1].lower())):
        return _safe_date(_year(match[3]), month, int(match[2]))
    return None


def infer_date_order(cells: list[str]) -> DateOrder | None:
    """The order the dates must be in, or `None` if they read correctly either way. Dates that
    can't be misread (ISO, or with a month name) settle nothing but need no answer."""
    ambiguous = False
    for text in cells:
        if _ISO.search(text) or (match := _NUMERIC.search(text)) is None:
            continue
        first, second = int(match[1]), int(match[2])
        if first > 12 >= second:
            return "dmy"
        if second > 12 >= first:
            return "mdy"
        ambiguous = ambiguous or first != second
    if not ambiguous:
        return "dmy"
    # A statement covers a short period, so the reading that keeps the dates far closer
    # together is the right one: 01-10 to 05-10 is five days in October, not five months.
    spans = {order: _span(cells, order) for order in ("dmy", "mdy")}
    dmy, mdy = spans["dmy"], spans["mdy"]
    if dmy is not None and (mdy is None or dmy * 2 < mdy):
        return "dmy"
    if mdy is not None and (dmy is None or mdy * 2 < dmy):
        return "mdy"
    return None


def _span(cells: list[str], order: DateOrder) -> int | None:
    """Days between the earliest and latest dates read this way, or `None` if one is invalid."""
    dates: list[date] = []
    for text in cells:
        if _NUMERIC.search(text) is None:
            continue
        parsed = parse_date(text, order)
        if parsed is None:
            return None
        dates.append(parsed)
    return (max(dates) - min(dates)).days if dates else None


def _cell(cells: list[str], position: int | None) -> str:
    return cells[position] if position is not None and position < len(cells) else ""


def _signed_amount(cells: list[str], columns: ColumnMap, currency: Currency) -> int | None:
    """Money in as positive and money out as negative, or `None` when the row moved none."""
    if columns.amount is not None:
        value = parse_amount(_cell(cells, columns.amount), currency)
        if value is None:
            return None
        marker = _cell(cells, columns.direction).strip().lower()
        if marker.startswith(("d", "w")):
            return -abs(value)
        if marker.startswith("c"):
            return abs(value)
        return value
    withdrawal = parse_amount(_cell(cells, columns.withdrawal), currency)
    deposit = parse_amount(_cell(cells, columns.deposit), currency)
    out = abs(withdrawal) if withdrawal else 0
    into = abs(deposit) if deposit else 0
    if out and into:
        raise AmountError
    return into or -out or None


def parse_rows(
    rows: list[list[str]],
    columns: ColumnMap,
    currency: Currency,
    source: StatementSource,
    date_order: DateOrder | None,
) -> ParsedStatement:
    """Entries from the rows below the header. Rows without a date continue the description of
    the entry above them, as long PDF narrations do."""
    order = date_order or infer_date_order([_cell(cells, columns.date) for cells in rows])
    if order is None:
        return ParsedStatement([], needs_date_order=True)

    entries: list[StatementRow] = []
    opening: int | None = None
    for line, cells in enumerate(rows, 1):
        description = " ".join(_cell(cells, columns.description).split())
        occurred_on = parse_date(_cell(cells, columns.date), order)
        readable = True
        try:
            balance = parse_amount(_cell(cells, columns.balance), currency)
        except AmountError:
            balance, readable = None, False

        if occurred_on is None:
            if _OPENING.search(description) and balance is not None and not entries:
                opening = balance
            elif description and entries and _only_description(cells, columns):
                last = entries[-1]
                joined = f"{last.description} {description}"[:MAX_DESCRIPTION]
                entries[-1] = replace(last, description=joined)
            continue

        try:
            signed = _signed_amount(cells, columns, currency)
        except AmountError:
            signed, readable = None, False
        if signed is None and readable and balance is not None and not entries:
            # A dated row with only a balance, before any transaction, is the opening balance.
            opening = balance
            continue
        text = description[:MAX_DESCRIPTION] or "Statement entry"
        if signed is None or not readable:
            # Never drop a dated row silently: show it, flagged, so the person can see it.
            entries.append(
                StatementRow(line, occurred_on, text, 0, "out", balance, "unreadable_amount")
            )
            continue
        direction: Direction = "in" if signed > 0 else "out"
        entries.append(StatementRow(line, occurred_on, text, abs(signed), direction, balance, None))
    return ParsedStatement(_checked(entries, opening, source), needs_date_order=False)


def _only_description(cells: list[str], columns: ColumnMap) -> bool:
    return all(not cell for index, cell in enumerate(cells) if index != columns.description)


def _delta(row: StatementRow) -> int:
    return row.amount if row.direction == "in" else -row.amount


def _agreements(rows: list[StatementRow], opening: int | None) -> int:
    previous = opening
    agreed = 0
    for row in rows:
        if previous is not None and row.balance is not None:
            agreed += previous + _delta(row) == row.balance
        previous = row.balance
    return agreed


def _checked(
    entries: list[StatementRow], opening: int | None, source: StatementSource
) -> list[StatementRow]:
    """The entries oldest first, each flagged if the printed balances contradict it. In a PDF a
    number can land under the wrong column, so the balance decides which way the money moved."""
    newest_first = list(reversed(entries))
    ordered = (
        newest_first if _agreements(newest_first, None) > _agreements(entries, opening) else entries
    )
    start = opening if ordered is entries else None

    checked: list[StatementRow] = []
    previous = start
    for row in ordered:
        checked.append(_verified(row, previous, source))
        previous = row.balance
    return checked


def _verified(row: StatementRow, previous: int | None, source: StatementSource) -> StatementRow:
    if row.issue is not None or previous is None or row.balance is None:
        return row
    if previous + _delta(row) == row.balance:
        return row
    flipped = replace(row, direction="in" if row.direction == "out" else "out")
    if source == "pdf" and previous + _delta(flipped) == row.balance:
        return flipped
    return replace(row, issue="balance_mismatch")


def normalized_description(description: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", description.upper())


def with_fingerprints(rows: list[StatementRow], account_key: str) -> list[StatementRow]:
    """Give each row a stable identity within its account. Identical rows on one day, like two
    equal coffees, are told apart by their order, so both import once and only once."""
    seen: Counter[tuple[date, Direction, int, str]] = Counter()
    stamped: list[StatementRow] = []
    for row in rows:
        key = (row.occurred_on, row.direction, row.amount, normalized_description(row.description))
        ordinal = seen[key]
        seen[key] += 1
        text = "|".join(
            (account_key, key[0].isoformat(), key[1], str(key[2]), key[3], str(ordinal))
        )
        stamped.append(replace(row, fingerprint=hashlib.sha256(text.encode()).hexdigest()))
    return stamped


def merchant_key(description: str) -> str:
    """The word that identifies who a narration is about: `UPI/6274/SWIGGY/okaxis` is `SWIGGY`.
    Only the first such word counts, because what follows (a note, a wrapped second line) varies
    from one payment to the next. Category rules are stored against this key."""
    words = re.split(r"[^A-Z0-9]+", description.upper())
    useful = [
        word
        for word in words
        if len(word) > 1 and word.isalpha() and word not in _RAIL_WORDS and word not in _UPI_HANDLES
    ]
    return useful[0][:100] if useful else ""
