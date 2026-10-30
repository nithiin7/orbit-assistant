"""Validated field types shared by request models."""

import unicodedata
from typing import Annotated, Any

from pydantic import AfterValidator, BeforeValidator, StringConstraints

from orbit_api.services.reminders.recurrence import is_valid_timezone

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


SEARCH_MAX_LENGTH = 200

# Blank searches are treated as no search.
SearchText = Annotated[
    Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=SEARCH_MAX_LENGTH),
        AfterValidator(single_line),
    ]
    | None,
    BeforeValidator(blank_to_none),
]


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


def _known_timezone(value: str) -> str:
    if not is_valid_timezone(value):
        raise ValueError("must be an IANA time zone name, such as Europe/Paris")
    return value


# An IANA time zone name, such as `Europe/Paris` or `UTC`.
TimeZoneName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=64),
    AfterValidator(_known_timezone),
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
