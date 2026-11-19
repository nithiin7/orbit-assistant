"""Reading statements: header keywords, amounts, dates, PDFs with passwords, and balance checks."""

from datetime import date

import pytest

from orbit_api.services.statements.columns import ColumnMap, classify, find_header, match_columns
from orbit_api.services.statements.parsing import (
    AmountError,
    infer_date_order,
    merchant_key,
    parse_amount,
    parse_date,
    parse_rows,
    with_fingerprints,
)
from orbit_api.services.statements.readers import (
    StatementPasswordRequiredError,
    StatementPasswordWrongError,
    StatementUnreadableError,
    read_statement,
)
from tests.statement_files import (
    HDFC_ROWS,
    ICICI_HEADER,
    icici_line,
    icici_pdf,
    statement_pdf,
    statement_xlsx,
)


@pytest.mark.parametrize(
    ("header", "field", "exact"),
    [
        ("DATE", "date", True),
        ("Txn Date", "date", True),
        ("Value Dt", "value_date", True),
        ("Transaction Remarks", "description", True),
        ("Narration", "description", True),
        ("Withdrawal Amt.", "withdrawal", True),
        ("Withdrawal Amount (INR)", "withdrawal", False),
        ("Deposit Amt.", "deposit", True),
        ("DR", "withdrawal", True),
        ("Cr", "deposit", True),
        ("Dr/Cr", "direction", True),
        ("Closing Balance", "balance", True),
        ("Balance Amount", "balance", False),
        ("Amount (INR)", "amount", False),
    ],
)
def test_headers_are_classified_by_keyword(header: str, field: str, exact: bool) -> None:
    assert classify(header) == (field, exact)


def test_short_keywords_match_whole_words_only() -> None:
    assert classify("Description") == ("description", True)
    assert classify("Mode") is None


def test_a_header_row_needs_a_date_a_description_and_amounts() -> None:
    assert match_columns(["Date", "Particulars", "Balance"]) is None
    assert match_columns(["Date", "Particulars", "Debit", "Credit"]) == ColumnMap(
        date=0, description=1, withdrawal=2, deposit=3
    )


def test_an_exact_header_wins_and_a_tie_needs_the_person() -> None:
    columns = match_columns(["Transaction Date", "Cheque Date", "Remarks", "Amount"])
    assert columns is not None and columns.date == 0
    assert match_columns(["Date", "Date", "Remarks", "Amount"]) is None


def test_the_header_is_found_below_the_bank_details() -> None:
    rows = [
        ["Account XXXX0000"],
        ["Period: October"],
        ["Tran Date", "PARTICULARS", "DR", "CR", "BAL"],
    ]
    found = find_header(rows)
    assert found is not None and found.row == 2
    assert found.columns.balance == 4


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1,250.50", 125050),
        ("₹ 1,250.50", 125050),
        ("Rs. 99", 9900),
        ("1,000.00 Cr", 100000),
        ("1,000.00 Dr", -100000),
        ("(45.00)", -4500),
        ("-45", -4500),
        ("", None),
        ("-", None),
    ],
)
def test_amounts_become_signed_paise(text: str, expected: int | None) -> None:
    assert parse_amount(text, "INR") == expected


@pytest.mark.parametrize("text", ["12.345", "abc", "1e99"])
def test_bad_amounts_are_refused(text: str) -> None:
    with pytest.raises(AmountError):
        parse_amount(text, "INR")


@pytest.mark.parametrize(
    "text",
    ["03-10-2026", "03/10/26", "03 Oct 2026", "03-Oct-26", "Oct 03, 2026", "2026-10-03"],
)
def test_dates_in_bank_formats(text: str) -> None:
    assert parse_date(text, "dmy") == date(2026, 10, 3)


def test_the_date_order_is_inferred_or_asked_for() -> None:
    assert infer_date_order(["03/10/2026", "25/10/2026"]) == "dmy"
    assert infer_date_order(["10/25/2026"]) == "mdy"
    assert infer_date_order(["03/10/2026", "05/11/2026"]) is None
    assert infer_date_order(["2026-10-03"]) == "dmy"


def test_merchant_keys_drop_payment_rails_and_references() -> None:
    assert merchant_key("UPI/627412345678/SWIGGY/okaxis/") == "SWIGGY"
    assert merchant_key("NEFT-SALARY ACME LTD") == "SALARY"
    assert merchant_key("UPI/62741/SWIGGY/okaxis/ Payment from Phone") == "SWIGGY"


def test_an_icici_pdf_is_read_with_its_password() -> None:
    table = read_statement(icici_pdf(password="AB12"), "AB12")
    assert table.source == "pdf"
    found = find_header(table.rows)
    assert found is not None
    parsed = parse_rows(table.rows[found.row + 1 :], found.columns, "INR", "pdf", None)

    assert [(row.occurred_on.day, row.direction, row.amount) for row in parsed.rows] == [
        (1, "out", 45000),
        (3, "in", 5000000),
        (5, "out", 120000),
    ]
    assert parsed.rows[0].description == "UPI/627412345678/SWIGGY/okaxis/ Payment from Phone"
    assert all(row.issue is None for row in parsed.rows)


def test_a_locked_pdf_asks_for_its_password() -> None:
    locked = icici_pdf(password="AB12")
    with pytest.raises(StatementPasswordRequiredError):
        read_statement(locked)
    with pytest.raises(StatementPasswordWrongError):
        read_statement(locked, "wrong")


def test_a_pdf_without_a_transaction_table_is_refused() -> None:
    with pytest.raises(StatementUnreadableError):
        read_statement(statement_pdf([[[(40.0, "Hello")]]]))


def test_a_row_the_balance_contradicts_is_flagged() -> None:
    pdf = statement_pdf(
        [
            [
                ICICI_HEADER,
                icici_line(particulars="B/F", balance="1,000.00"),
                icici_line("01-10-2026", "UPI", "COFFEE", "", "100.00", "900.00"),
                icici_line("02-10-2026", "UPI", "BOOKS", "", "250.00", "600.00"),
            ]
        ]
    )
    table = read_statement(pdf)
    found = find_header(table.rows)
    assert found is not None
    rows = parse_rows(table.rows[found.row + 1 :], found.columns, "INR", "pdf", None).rows
    assert [row.issue for row in rows] == [None, "balance_mismatch"]


def test_newest_first_statements_are_put_in_date_order() -> None:
    rows = [
        ["Date", "Description", "Debit", "Credit", "Balance"],
        ["02/10/2026", "BOOKS", "250.00", "", "650.00"],
        ["01/10/2026", "COFFEE", "100.00", "", "900.00"],
        ["30/09/2026", "SALARY", "", "1,000.00", "1,000.00"],
    ]
    csv_bytes = "\n".join(",".join(f'"{cell}"' for cell in row) for row in rows).encode()
    table = read_statement(csv_bytes)
    found = find_header(table.rows)
    assert found is not None
    parsed = parse_rows(table.rows[found.row + 1 :], found.columns, "INR", "text", None)
    assert [row.description for row in parsed.rows] == ["SALARY", "COFFEE", "BOOKS"]
    assert [row.issue for row in parsed.rows] == [None, None, None]


def test_an_hdfc_excel_statement_is_read() -> None:
    table = read_statement(statement_xlsx(HDFC_ROWS))
    assert table.source == "excel"
    found = find_header(table.rows)
    assert found is not None and found.row == 2
    parsed = parse_rows(table.rows[found.row + 1 :], found.columns, "INR", "excel", None)
    assert [(row.occurred_on, row.amount, row.direction) for row in parsed.rows] == [
        (date(2026, 10, 2), 32050, "out"),
        (date(2026, 10, 4), 5000000, "in"),
    ]


def test_identical_rows_on_one_day_get_different_fingerprints() -> None:
    rows = [
        ["Date", "Description", "Amount"],
        ["2026-10-01", "COFFEE", "-100"],
        ["2026-10-01", "COFFEE", "-100"],
    ]
    table = read_statement("\n".join(",".join(row) for row in rows).encode())
    found = find_header(table.rows)
    assert found is not None
    parsed = parse_rows(table.rows[1:], found.columns, "INR", "text", None)
    first, second = with_fingerprints(parsed.rows, "account")
    assert first.fingerprint != second.fingerprint
    again = with_fingerprints(parsed.rows, "account")
    assert [row.fingerprint for row in again] == [first.fingerprint, second.fingerprint]
