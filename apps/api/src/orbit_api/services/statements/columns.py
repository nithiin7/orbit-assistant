"""Finding a statement's columns from the words in its header row.

Banks name the same column differently, so each field has a list of keywords. A header that is
exactly a keyword beats one that only contains it, and a keyword must match whole words, so `cr`
never matches inside `description`. When a required column is missing, or two columns claim one
field equally, nothing is guessed: the person maps the columns themselves.
"""

import re
from dataclasses import dataclass
from typing import Final, Literal

Field = Literal[
    "balance",
    "direction",
    "value_date",
    "date",
    "withdrawal",
    "deposit",
    "amount",
    "description",
]

# Checked in this order, so `balance amount` is a balance and `value date` isn't a plain date.
KEYWORDS: Final[dict[Field, tuple[str, ...]]] = {
    "balance": ("balance", "closing balance", "running balance", "available balance", "bal"),
    "direction": ("dr cr", "cr dr", "debit credit", "credit debit", "dr or cr"),
    "value_date": ("value date", "value dt"),
    "date": (
        "date",
        "dt",
        "transaction date",
        "txn date",
        "tran date",
        "trans date",
        "posting date",
        "post date",
    ),
    "withdrawal": ("withdrawal", "withdrawals", "withdrawal amt", "debit", "debits", "dr"),
    "deposit": ("deposit", "deposits", "deposit amt", "credit", "credits", "cr"),
    "amount": ("amount", "amt", "transaction amount", "txn amount"),
    "description": (
        "description",
        "particulars",
        "narration",
        "remarks",
        "transaction remarks",
        "details",
        "transaction details",
    ),
}

# How many rows from the top of a file can hold the header; banks put account details above it.
HEADER_SEARCH_ROWS: Final = 40


@dataclass(frozen=True, slots=True)
class ColumnMap:
    """Zero-based column positions. A statement has either separate withdrawal and deposit
    columns, or one amount column."""

    date: int
    description: int
    withdrawal: int | None = None
    deposit: int | None = None
    amount: int | None = None
    direction: int | None = None
    balance: int | None = None

    @property
    def is_complete(self) -> bool:
        return (self.withdrawal is not None and self.deposit is not None) or (
            self.amount is not None
        )


@dataclass(frozen=True, slots=True)
class HeaderMatch:
    row: int
    columns: ColumnMap


def normalize_header(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def _contains(header: str, keyword: str) -> bool:
    return re.search(rf"\b{re.escape(keyword)}\b", header) is not None


def classify(text: str) -> tuple[Field, bool] | None:
    """The field a header names and whether it names it exactly, or `None`."""
    header = normalize_header(text)
    if not header:
        return None
    for field, keywords in KEYWORDS.items():
        if header in keywords:
            return field, True
    for field, keywords in KEYWORDS.items():
        if any(_contains(header, keyword) for keyword in keywords):
            return field, False
    return None


def match_columns(cells: list[str]) -> ColumnMap | None:
    """The columns this row names, or `None` if it isn't a usable header row."""
    found: dict[Field, list[tuple[int, bool]]] = {}
    for position, cell in enumerate(cells):
        kind = classify(cell)
        if kind is not None:
            found.setdefault(kind[0], []).append((position, kind[1]))

    chosen: dict[Field, int] = {}
    for field, candidates in found.items():
        exact = [position for position, is_exact in candidates if is_exact]
        pool = exact or [position for position, _ in candidates]
        if len(pool) > 1:
            return None
        chosen[field] = pool[0]

    date = chosen.get("date", chosen.get("value_date"))
    description = chosen.get("description")
    if date is None or description is None:
        return None
    columns = ColumnMap(
        date=date,
        description=description,
        withdrawal=chosen.get("withdrawal"),
        deposit=chosen.get("deposit"),
        amount=chosen.get("amount"),
        direction=chosen.get("direction"),
        balance=chosen.get("balance"),
    )
    return columns if columns.is_complete else None


def find_header(rows: list[list[str]]) -> HeaderMatch | None:
    for index, cells in enumerate(rows[:HEADER_SEARCH_ROWS]):
        columns = match_columns(cells)
        if columns is not None:
            return HeaderMatch(index, columns)
    return None
