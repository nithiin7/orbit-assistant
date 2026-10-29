"""Validated field types shared by request models."""

from typing import Annotated

from pydantic import AfterValidator, StringConstraints


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
