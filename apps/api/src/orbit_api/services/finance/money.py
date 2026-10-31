"""Money as whole numbers of a currency's minor unit (paise for INR, cents for USD).

Amounts are Python `int`s throughout: stored as integers, summed by the database as integers, and
turned into decimal text only for display or export. Floats never touch money.
"""

import calendar
from datetime import date
from typing import Final, Literal, get_args

# ISO 4217 codes Orbit accepts. Each needs an entry in `CURRENCY_EXPONENTS`.
Currency = Literal["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "CHF", "JPY"]
CURRENCIES: Final[tuple[Currency, ...]] = get_args(Currency)
DEFAULT_CURRENCY: Final[Currency] = "INR"

# Digits after the decimal point in the currency's major unit (ISO 4217's "minor unit"):
# ₹12.50 is 1250 paise; ¥1250 is 1250 yen.
CURRENCY_EXPONENTS: Final[dict[Currency, int]] = {
    "INR": 2,
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
    "AED": 2,
    "SGD": 2,
    "AUD": 2,
    "CAD": 2,
    "CHF": 2,
    "JPY": 0,
}

# The largest amount one transaction or opening balance may hold, in minor units: 10^13 paise is
# ₹10,000 crore. Far beyond personal use, and far enough below the 64-bit integer limit
# (about 9.2 * 10^18) that the database can sum over 900,000 maximal amounts without overflowing.
MAX_AMOUNT: Final = 10**13


def to_decimal_string(amount: int, currency: Currency) -> str:
    """The amount in major units as plain decimal text, such as `-1234.50`. No grouping or
    symbol, so spreadsheets and other programs read it exactly."""
    exponent = CURRENCY_EXPONENTS[currency]
    sign = "-" if amount < 0 else ""
    whole, fraction = divmod(abs(amount), 10**exponent)
    if exponent == 0:
        return f"{sign}{whole}"
    return f"{sign}{whole}.{fraction:0{exponent}d}"


def month_bounds(first_day: date) -> tuple[date, date]:
    """The first and last calendar days of the month that `first_day` falls in."""
    start = first_day.replace(day=1)
    last = calendar.monthrange(start.year, start.month)[1]
    return start, start.replace(day=last)


def add_months(month: date, months: int) -> date:
    """The first day of the month `months` after (or before, if negative) `month`'s."""
    index = month.year * 12 + month.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)
