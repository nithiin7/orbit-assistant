"""Made-up bank statements for tests: PDFs (optionally password-protected), Excel, and CSV.

The PDFs place each cell with its own text operator at a fixed position, the way bank statement
generators do, with amounts right-aligned under their headers.
"""

import io
from collections.abc import Sequence
from datetime import datetime

import openpyxl
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

Cell = tuple[float, str]
# Left edges of the left-aligned columns and right edges of the right-aligned ones, in points.
ICICI_LAYOUT = {
    "DATE": 40.0,
    "MODE": 100.0,
    "PARTICULARS": 190.0,
    "DEPOSITS": -420.0,
    "WITHDRAWALS": -490.0,
    "BALANCE": -560.0,
}
_FONT_SIZE = 9


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _x(edge: float, text: str) -> float:
    """A negative edge is a right edge: estimate the text's width to right-align it."""
    return edge if edge >= 0 else -edge - len(text) * _FONT_SIZE * 0.5


def statement_pdf(pages: Sequence[Sequence[Sequence[Cell]]], password: str | None = None) -> bytes:
    """Each page is a list of lines; each line a list of (edge, text) cells."""
    writer = PdfWriter()
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    for lines in pages:
        page = writer.add_blank_page(595, 842)
        operations = [f"BT /F1 {_FONT_SIZE} Tf"]
        for index, line in enumerate(lines):
            y = 800 - index * 14
            for edge, text in line:
                operations.append(f"1 0 0 1 {_x(edge, text):.1f} {y} Tm ({_escape(text)}) Tj")
        operations.append("ET")
        stream = DecodedStreamObject()
        stream.set_data("\n".join(operations).encode("latin-1"))
        page[NameObject("/Contents")] = writer._add_object(stream)  # pyright: ignore[reportPrivateUsage]
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
    if password is not None:
        writer.encrypt(password, algorithm="AES-256")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def icici_line(
    day: str = "",
    mode: str = "",
    particulars: str = "",
    deposit: str = "",
    withdrawal: str = "",
    balance: str = "",
) -> list[Cell]:
    values = {
        "DATE": day,
        "MODE": mode,
        "PARTICULARS": particulars,
        "DEPOSITS": deposit,
        "WITHDRAWALS": withdrawal,
        "BALANCE": balance,
    }
    return [(ICICI_LAYOUT[name], text) for name, text in values.items() if text]


ICICI_HEADER: list[Cell] = [(edge, name) for name, edge in ICICI_LAYOUT.items()]
ICICI_TITLE: list[Cell] = [
    (40.0, "Statement of Transactions in Savings Account XXXXXXXX0000 in INR for the period"),
]


def icici_pdf(password: str | None = None) -> bytes:
    """October in ICICI's layout: an opening balance, a wrapped narration, salary, and a bill."""
    return statement_pdf(
        [
            [
                ICICI_TITLE,
                ICICI_HEADER,
                icici_line(particulars="B/F", balance="10,000.00"),
                icici_line(
                    "01-10-2026", "UPI", "UPI/627412345678/SWIGGY/okaxis/", "", "450.00", "9,550.00"
                ),
                icici_line(particulars="Payment from Phone"),
                icici_line(
                    "03-10-2026", "NEFT", "NEFT-SALARY ACME LTD", "50,000.00", "", "59,550.00"
                ),
                [(40.0, "Page 1 of 2")],
            ],
            [
                ICICI_HEADER,
                icici_line(
                    "05-10-2026", "ACH", "ACH/BESCOM ELECTRICITY", "", "1,200.00", "58,350.00"
                ),
                [(40.0, "Page 2 of 2")],
            ],
        ],
        password,
    )


def statement_xlsx(rows: Sequence[Sequence[object]]) -> bytes:
    book = openpyxl.Workbook()
    sheet = book.active
    assert sheet is not None
    for row in rows:
        sheet.append(list(row))
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


HDFC_ROWS: list[list[object]] = [
    ["HDFC BANK Ltd.", None, None, None, None, None, None],
    ["Statement of account", None, None, None, None, None, None],
    [
        "Date",
        "Narration",
        "Chq./Ref.No.",
        "Value Dt",
        "Withdrawal Amt.",
        "Deposit Amt.",
        "Closing Balance",
    ],
    [
        datetime(2026, 10, 2),
        "UPI-ZOMATO-ZOMATO@HDFCBANK",
        "0000123",
        datetime(2026, 10, 2),
        320.5,
        None,
        9679.5,
    ],
    [
        datetime(2026, 10, 4),
        "NEFT CR-ACME LTD-SALARY",
        "0000456",
        datetime(2026, 10, 4),
        None,
        50000,
        59679.5,
    ],
]
