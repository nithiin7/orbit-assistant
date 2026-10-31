"""Fixed-point unit quantities and per-unit prices, and the exact arithmetic that turns them into
money. No floats.

- **Quantities** (mutual fund units, shares) are integers in millionths of a unit: 12.345 units
  is `12_345_000`. Six decimals cover mutual fund units (3 or 4 decimals) and whole shares.
- **Prices** (a NAV or a share price) are integers in millionths of the currency's *major* unit
  per unit: a NAV of ₹45.6789 is `45_678_900`. Six decimals cover NAVs (4 decimals) and prices.
- **Money** stays in integer minor units, as everywhere in finance.

Market value is `quantity * price`, converted to minor units and **rounded half up once**, at
the end. A cost split across a partial sale is rounded half up the same way (see `lots.py`).
The API sends quantities and prices as decimal strings, never JSON numbers.
"""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Final

from orbit_api.services.finance.money import CURRENCY_EXPONENTS, Currency

QUANTITY_DECIMALS: Final = 6
QUANTITY_SCALE: Final = 10**QUANTITY_DECIMALS
PRICE_DECIMALS: Final = 6
PRICE_SCALE: Final = 10**PRICE_DECIMALS
# 100 billion units and a price of one billion per unit: far beyond personal use, and the scaled
# integers stay well inside a 64-bit column.
MAX_QUANTITY: Final = 10**11 * QUANTITY_SCALE
MAX_PRICE: Final = 10**9 * PRICE_SCALE


def divide_half_up(numerator: int, denominator: int) -> int:
    """`numerator / denominator` rounded half away from zero. `denominator` must be positive."""
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    sign = -1 if numerator < 0 else 1
    return sign * ((2 * abs(numerator) + denominator) // (2 * denominator))


def parse_scaled(text: str, decimals: int) -> int:
    """Decimal text such as `12.345` as an integer scaled by `10**decimals`. Rejects signs,
    exponents, and more decimals than allowed rather than rounding them away."""
    value = text.strip()
    if not value or value.startswith(("+", "-")) or any(c in value for c in "eE_ "):
        raise ValueError("must be a plain decimal number, such as 12.345")
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise ValueError("must be a plain decimal number, such as 12.345") from None
    if not number.is_finite():
        raise ValueError("must be a plain decimal number, such as 12.345")
    scaled = number * (10**decimals)
    if scaled != scaled.to_integral_value():
        raise ValueError(f"can have at most {decimals} decimal places")
    return int(scaled)


def format_scaled(value: int, decimals: int) -> str:
    """A scaled integer as decimal text without trailing zeros: `12_345_000` is `12.345`."""
    sign = "-" if value < 0 else ""
    whole, fraction = divmod(abs(value), 10**decimals)
    if fraction == 0:
        return f"{sign}{whole}"
    return f"{sign}{whole}.{fraction:0{decimals}d}".rstrip("0")


def parse_quantity(text: str) -> int:
    return parse_scaled(text, QUANTITY_DECIMALS)


def parse_price(text: str) -> int:
    return parse_scaled(text, PRICE_DECIMALS)


def format_quantity(value: int) -> str:
    return format_scaled(value, QUANTITY_DECIMALS)


def format_price(value: int) -> str:
    return format_scaled(value, PRICE_DECIMALS)


def market_value(quantity: int, price: int, currency: Currency) -> int:
    """What `quantity` units are worth at `price`, in minor units, rounded half up once."""
    minor = 10 ** CURRENCY_EXPONENTS[currency]
    return divide_half_up(quantity * price * minor, QUANTITY_SCALE * PRICE_SCALE)


def unit_price(amount: int, quantity: int, currency: Currency) -> int:
    """The per-unit price (scaled) that `amount` minor units paid for `quantity` units, rounded
    half up: the average cost, or the price implied by a trade."""
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    minor = 10 ** CURRENCY_EXPONENTS[currency]
    return divide_half_up(amount * QUANTITY_SCALE * PRICE_SCALE, quantity * minor)


def percent(numerator: int, denominator: int) -> str | None:
    """`numerator / denominator` as a percentage with two decimals (`12.34`), rounded half up;
    `None` when the denominator isn't positive. For display only: never used in further sums."""
    if denominator <= 0:
        return None
    hundredths = Decimal(numerator * 10_000) / Decimal(denominator)
    return str(hundredths.quantize(Decimal(1), rounding=ROUND_HALF_UP) / 100)
