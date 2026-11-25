"""Which assistant proposals may run without a tap, once the person has turned that on.

A proposal runs straight away only if it creates a new low-risk record and everything it says
came from what the person typed. The model may have read records that carry injected
instructions, so its word isn't enough: every word of the record's text, and every number it
logs, must appear in the person's own message. Anything else stays a card to approve, and so do
events, changes to existing records, and money. Pure Python.
"""

import re
from typing import Final

from orbit_api.services.ai.models import ActionKind

# The field that says what the record is; it has to be there, and stated by the person.
_MAIN_TEXT: Final[dict[ActionKind, str]] = {
    "create_task": "title",
    "create_reminder": "title",
    "create_note": "text",
    "add_shopping_item": "name",
    "create_habit": "name",
    "add_place": "name",
    "save_link": "url",
    "add_watch_item": "title",
}
# The amounts a health log records; at least one has to be there, and stated by the person.
_AMOUNTS: Final[dict[ActionKind, tuple[str, ...]]] = {
    "log_water": ("amount_ml",),
    "log_weight": ("weight_kg",),
    "log_activity": ("duration_minutes", "distance_km", "steps"),
}
# Free text the model could add beside the main field.
_OTHER_TEXT: Final = (
    "title",
    "name",
    "text",
    "description",
    "notes",
    "note",
    "quantity",
    "list_name",
    "locality",
    "platform",
    "recommended_by",
)

_WORD = re.compile(r"[^\W_]+")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}\b)")


def may_add_directly(kind: ActionKind, payload: dict[str, object], message: str) -> bool:
    """Whether this proposal is low risk and fully stated in the person's `message`."""
    words = frozenset(_WORD.findall(message.casefold()))
    main = _MAIN_TEXT.get(kind)
    amounts = _AMOUNTS.get(kind)
    if main is not None:
        value = payload.get(main)
        if not isinstance(value, str) or not _WORD.search(value):
            return False
    elif amounts is not None:
        stated = {float(n) for n in _NUMBER.findall(_THOUSANDS.sub("", message))}
        given = [v for key in amounts if isinstance(v := payload.get(key), int | float)]
        if not given or any(float(v) not in stated for v in given):
            return False
    else:
        return False
    fields = (*_OTHER_TEXT, main) if main else _OTHER_TEXT
    return all(_stated(payload.get(field), words) for field in fields)


def _stated(value: object, words: frozenset[str]) -> bool:
    if not isinstance(value, str):
        return True
    return all(word in words for word in _WORD.findall(value.casefold()))
