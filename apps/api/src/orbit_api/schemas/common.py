"""Validated field types shared by request models."""

import unicodedata
from typing import Annotated, Any

from pydantic import AfterValidator, StringConstraints

# Line breaks and tabs are fine in multi-line text; other control characters are not.
_ALLOWED_CONTROL_CHARACTERS = frozenset("\n\r\t")


def _is_control(character: str) -> bool:
    # Only C0/C1 controls (category Cc). Unlike `str.isprintable()`, this accepts the zero-width
    # joiners in emoji sequences and non-breaking spaces, which people paste into titles.
    return unicodedata.category(character) == "Cc"


def single_line(value: str) -> str:
    if any(_is_control(c) for c in value):
        raise ValueError("must not contain control characters")
    return value


def multi_line(value: str) -> str:
    if any(_is_control(c) and c not in _ALLOWED_CONTROL_CHARACTERS for c in value):
        raise ValueError("must not contain control characters other than line breaks and tabs")
    return value


def blank_to_none(value: Any) -> Any:
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _printable(value: str) -> str:
    if not value.isprintable():
        raise ValueError("must not contain control characters")
    return value


# A user-visible name, such as a display name or workspace name.
Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(_printable),
]

# Normalized for comparison: trimmed and lowercase. Deliberately permissive; it is a sign-in
# identifier, and Orbit does not send email in local mode.
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=3,
        max_length=320,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    ),
]
