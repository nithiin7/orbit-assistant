"""Text safe to put in a CSV cell."""

# A spreadsheet treats a cell starting with one of these as a formula, which can run commands or
# send data elsewhere when the file is opened. Such text is prefixed with an apostrophe, which
# spreadsheets show as text (OWASP's guidance for CSV injection).
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value: str) -> str:
    return f"'{value}" if value.startswith(_FORMULA_PREFIXES) else value
