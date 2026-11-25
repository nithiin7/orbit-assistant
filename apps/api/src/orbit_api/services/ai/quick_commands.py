"""Plain commands Orbit can read itself, so adding something never depends on a model's format.

These are the sentences the composer's Quick add menu starts, when they carry nothing that needs
interpreting. A date, a priority, or a schedule goes to the model instead. Pure Python.
"""

import re
from typing import Final

_SEPARATOR: Final = r"\s*[:\u2013\u2014-]\s+|\s*:\s*"
_TASK = re.compile(rf"^(?:add|create)\s+(?:a\s+|new\s+)*task(?:{_SEPARATOR})(.+)$", re.IGNORECASE)
_SHOPPING = re.compile(
    rf"^add\s+to\s+(?:my\s+|the\s+)?shopping\s+list(?:{_SEPARATOR})(.+)$", re.IGNORECASE
)
_NOTE = re.compile(rf"^note\s+down(?:{_SEPARATOR})(.+)$", re.IGNORECASE | re.DOTALL)
_LINK = re.compile(rf"^save\s+this\s+link(?:{_SEPARATOR})(\S+)$", re.IGNORECASE)
_HABIT = re.compile(rf"^(?:add|start)\s+a\s+habit(?:{_SEPARATOR})(.+)$", re.IGNORECASE)
_WATER = re.compile(r"^i\s+drank\s+(\d{1,5})\s*ml\b[\s\w]*\.?$", re.IGNORECASE)
_WEIGHT = re.compile(r"^i\s+weigh\s+(\d{1,3}(?:\.\d+)?)\s*kgs?\.?$", re.IGNORECASE)
# Details only the model can place in the right field.
_NEEDS_MODEL = re.compile(
    r"\b(today|tonight|tomorrow|yesterday|next|this|every|daily|weekly|monthly|by|before|after|"
    r"due|until|at\s+\d|on\s+\d|\d{1,2}(?:am|pm)|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|"
    r"thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|urgent|priority)\b",
    re.IGNORECASE,
)
_MAX_ITEMS: Final = 8

type Command = tuple[str, dict[str, object]]


def read_commands(message: str) -> list[Command]:
    """The actions a plain command asks for, or nothing when the model should read it."""
    text = message.strip()
    if match := _NOTE.match(text):
        return [("create_note", {"text": match.group(1).strip()})]
    if "\n" in text:
        return []
    if match := _LINK.match(text):
        return [("save_link", {"url": match.group(1)})]
    if match := _WATER.match(text):
        return [("log_water", {"amount_ml": int(match.group(1))})]
    if match := _WEIGHT.match(text):
        return [("log_weight", {"weight_kg": float(match.group(1))})]
    if match := _SHOPPING.match(text):
        names = [name.strip(" .") for name in match.group(1).split(",")]
        items: list[Command] = [("add_shopping_item", {"name": n}) for n in names if n]
        return items[:_MAX_ITEMS]
    if _NEEDS_MODEL.search(text):
        return []
    if match := _TASK.match(text):
        return [("create_task", {"title": match.group(1).strip(" .")})]
    if match := _HABIT.match(text):
        return [("create_habit", {"name": match.group(1).strip(" .")})]
    return []
