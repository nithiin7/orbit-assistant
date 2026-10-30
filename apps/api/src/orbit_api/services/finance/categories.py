"""The categories every workspace starts with, chosen for personal finance in India.

Each has a stable `key`, so seeding is idempotent: a workspace gets the defaults it is missing,
never duplicates, and a renamed default keeps its key. There is deliberately no category for
investments, credit-card bills, or loan principal: those are transfers between accounts, not
spending.
"""

from dataclasses import dataclass
from typing import Final

from orbit_api.services.finance.models import CategoryType


@dataclass(frozen=True, slots=True)
class DefaultCategory:
    key: str
    name: str
    type: CategoryType


DEFAULT_CATEGORIES: Final[tuple[DefaultCategory, ...]] = (
    DefaultCategory("salary", "Salary", "income"),
    DefaultCategory("freelance", "Freelance", "income"),
    DefaultCategory("business", "Business income", "income"),
    DefaultCategory("interest", "Interest", "income"),
    DefaultCategory("dividends", "Dividends", "income"),
    DefaultCategory("rental_income", "Rental income", "income"),
    DefaultCategory("gifts_received", "Gifts received", "income"),
    DefaultCategory("other_income", "Other income", "income"),
    DefaultCategory("rent", "Rent", "expense"),
    DefaultCategory("groceries", "Groceries", "expense"),
    DefaultCategory("food_dining", "Food and dining", "expense"),
    DefaultCategory("utilities", "Utilities", "expense"),
    DefaultCategory("mobile_internet", "Mobile and internet", "expense"),
    DefaultCategory("transport", "Transport", "expense"),
    DefaultCategory("fuel", "Fuel", "expense"),
    DefaultCategory("shopping", "Shopping", "expense"),
    DefaultCategory("healthcare", "Healthcare", "expense"),
    DefaultCategory("entertainment", "Entertainment", "expense"),
    DefaultCategory("travel", "Travel", "expense"),
    DefaultCategory("education", "Education", "expense"),
    DefaultCategory("insurance", "Insurance", "expense"),
    DefaultCategory("personal_care", "Personal care", "expense"),
    DefaultCategory("household", "Household", "expense"),
    DefaultCategory("taxes", "Taxes", "expense"),
    DefaultCategory("fees_charges", "Fees and charges", "expense"),
    DefaultCategory("gifts_donations", "Gifts and donations", "expense"),
    DefaultCategory("other_expense", "Other expenses", "expense"),
)
