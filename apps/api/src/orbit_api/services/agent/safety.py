"""Keeping secrets and bulk personal data out of execution history.

Step arguments and outputs are stored so people can see what the agent did, but anything that
looks like a credential is masked first, and long values are cut. Errors are stored as safe
messages, never as exception text from deep inside a library.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Final, cast

MAX_STRING: Final = 500
MAX_ITEMS: Final = 20
REDACTED: Final = "[redacted]"

_SECRET_KEYS: Final = re.compile(
    r"pass(word)?|secret|token|api[_-]?key|authorization|credential|cookie|private[_-]?key", re.I
)
_SECRET_VALUES: Final = (
    re.compile(r"\bsk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"\b(?:bearer|basic)\s+[A-Za-z0-9._~+/\-]{12,}=*", re.I),
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),
    re.compile(r"\b(?:ghp|gho|xox[abp]|AIza)[A-Za-z0-9_\-]{12,}"),
    re.compile(r"\b[A-Fa-f0-9]{40,}\b"),
)


def redact_text(text: str, limit: int = MAX_STRING) -> str:
    for pattern in _SECRET_VALUES:
        text = pattern.sub(REDACTED, text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def redact(value: object, *, limit: int = MAX_STRING) -> object:
    """A JSON-safe copy with credential-looking keys and values masked and sizes bounded."""
    if isinstance(value, str):
        return redact_text(value, limit)
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, Mapping):
        mapping = cast(Mapping[object, object], value)
        redacted: dict[str, object] = {}
        for index, (key, item) in enumerate(mapping.items()):
            if index >= MAX_ITEMS:
                break
            name = str(key)
            redacted[name] = REDACTED if _SECRET_KEYS.search(name) else redact(item, limit=limit)
        return redacted
    if isinstance(value, Sequence):
        items = cast(Sequence[object], value)
        return [redact(item, limit=limit) for item in items[:MAX_ITEMS]]
    return redact_text(str(value), limit)


def redact_arguments(arguments: Mapping[str, object]) -> dict[str, object]:
    return cast(dict[str, object], redact(arguments))
