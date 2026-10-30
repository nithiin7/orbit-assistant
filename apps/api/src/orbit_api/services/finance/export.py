"""CSV export of transactions, for spreadsheets and other tools.

One row per transaction, oldest first. Amounts are positive decimal text in the major unit
(`1234.50`), with the currency beside them and the transaction type saying which way the money
moved. Accounts and categories appear by name.
"""

import csv
import io
import uuid
from collections.abc import Iterable

from orbit_api.services.finance.models import Account, Category, Transaction
from orbit_api.services.finance.money import to_decimal_string

CSV_HEADER = (
    "Date",
    "Type",
    "Description",
    "Category",
    "Account",
    "To account",
    "Amount",
    "Currency",
    "Notes",
    "ID",
)

# A spreadsheet treats a cell starting with one of these as a formula, which can run commands or
# send data elsewhere when the file is opened. Such text is prefixed with an apostrophe, which
# spreadsheets show as text (OWASP's guidance for CSV injection).
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _text(value: str) -> str:
    return f"'{value}" if value.startswith(_FORMULA_PREFIXES) else value


def transactions_csv(
    transactions: Iterable[Transaction],
    accounts: Iterable[Account],
    categories: Iterable[Category],
) -> str:
    account_names: dict[uuid.UUID, str] = {account.id: account.name for account in accounts}
    category_names: dict[uuid.UUID, str] = {category.id: category.name for category in categories}

    def account_name(account_id: uuid.UUID | None) -> str:
        return _text(account_names.get(account_id, "")) if account_id else ""

    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    for transaction in transactions:
        category = transaction.category_id
        writer.writerow(
            (
                transaction.occurred_on.isoformat(),
                transaction.type,
                _text(transaction.description),
                _text(category_names.get(category, "")) if category else "",
                account_name(transaction.account_id),
                account_name(transaction.to_account_id),
                to_decimal_string(transaction.amount, transaction.currency),
                transaction.currency,
                _text(transaction.notes),
                str(transaction.id),
            )
        )
    return output.getvalue()
