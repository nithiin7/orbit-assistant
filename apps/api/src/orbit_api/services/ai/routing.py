"""Reading a question deterministically: which modules it is about, which dates, and whether
the person asked for something to be created.

The assistant uses this to choose structured queries (the modules' own services) before asking
the model anything, so numbers, dates, and lists come from Orbit rather than from the model. It
is keyword based on purpose: predictable, testable, and the same with any provider, including
small local models that can't plan tool calls. Pure Python.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from orbit_api.services.ai.models import AiModule

_MODULE_TERMS: Final[dict[AiModule, tuple[str, ...]]] = {
    "tasks": (
        "task",
        "todo",
        "to-do",
        "to do",
        "overdue",
        "deadline",
        "productiv",
        "working on",
        "work on",
        "worked on",
        "finish",
        "complete",
    ),
    "calendar": (
        "schedul",
        "calendar",
        "event",
        "meeting",
        "appointment",
        "busy",
        "free time",
        "agenda",
        "conflict",
        "commitment",
        "plans",
    ),
    "reminders": ("remind",),
    "finance": (
        "spend",
        "spent",
        "expense",
        "income",
        "budget",
        "money",
        "bill",
        "subscription",
        "payment",
        "emi",
        "loan",
        "saving",
        "transaction",
        "salary",
        "financ",
        "commitment",
        "afford",
        "bank",
    ),
    "habits": ("habit", "routine", "streak", "consisten"),
    "health": (
        "workout",
        "exercise",
        "gym",
        "fitness",
        "health",
        "weight",
        "running",
        "nutrition",
        "calorie",
        "protein",
        "water",
        "steps",
        "sleep",
    ),
    "notes": ("note", "journal", "wrote", "idea", "discuss"),
    "documents": (
        "document",
        "insurance",
        "passport",
        "policy",
        "certificate",
        "contract",
        "licen",
        "warranty",
        "expir",
        "renew",
        "paperwork",
    ),
}

# Broad questions that span the day-to-day modules.
_OVERVIEW_TERMS: Final = (
    "overview",
    "what's up",
    "what is up",
    "going on",
    "my day",
    "my week",
    "coming up",
    "upcoming",
    "important",
    "recently",
    "lately",
)

_ACTION = re.compile(
    r"\b(create|add|make|schedule|draft|book|plan|set up|set a|remind me|new task|new note|"
    r"new event|put .{1,40} (on|in) my calendar|save (this|that|it) as|log|note down|jot)\b",
    re.IGNORECASE,
)

_WEEKDAYS: Final = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_MONTHS: Final = (
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
)
_RELATIVE_DAYS = re.compile(r"\b(next|past|last|coming)\s+(\d{1,3})\s+days?\b")
_STOPWORD_TEXT: Final = (
    "a about above after again all am an and any are as at be been before being below between "
    "both but by can could did do does doing down during each few for from had has have "
    "having he her here hers him his how i if in into is it its just me more most my myself "
    "no nor not now of off on once only or other our out over own same she should so some "
    "such than that the their them then there these they this those through to too under "
    "until up very was we were what when where which while who whom why will with would you "
    "your yours show find tell give list please related regarding much many get got last next "
    "week month year today tomorrow yesterday days day summarize summary recent recently "
    "upcoming orbit "
)
_STOPWORDS: Final = frozenset(_STOPWORD_TEXT.split())


@dataclass(frozen=True, slots=True)
class Route:
    modules: frozenset[AiModule]
    # An inclusive date range the question named, or `None`.
    start: date | None
    end: date | None
    # A phrase for the range, such as "this month".
    period: str | None
    wants_action: bool
    keywords: tuple[str, ...]
    overview: bool


def route_question(text: str, today: date) -> Route:
    lowered = f" {text.lower()} "
    modules: set[AiModule] = {
        module for module, terms in _MODULE_TERMS.items() if any(term in lowered for term in terms)
    }
    overview = any(term in lowered for term in _OVERVIEW_TERMS)
    if overview and not modules:
        modules = {"tasks", "calendar", "reminders"}
    start, end, period = _date_range(lowered, today)
    if period is not None and not modules:
        # "What's on tomorrow?" names a time but no module: the schedule and tasks.
        modules = {"calendar", "tasks"}
    return Route(
        modules=frozenset(modules),
        start=start,
        end=end,
        period=period,
        wants_action=wants_action(text),
        keywords=keywords(text),
        overview=overview,
    )


def wants_action(text: str) -> bool:
    """Whether the person asked for something to be created or scheduled. Proposals from the
    model are dropped otherwise, so instructions inside retrieved records can't make it
    propose anything on its own."""
    return _ACTION.search(text) is not None


def keywords(text: str, limit: int = 4) -> tuple[str, ...]:
    """The question's most distinctive words, longest first, for keyword search."""
    words = re.findall(r"[a-z0-9][a-z0-9'&-]{2,}", text.lower())
    unique = dict.fromkeys(w.strip("'-") for w in words if w not in _STOPWORDS)
    ranked = sorted((w for w in unique if len(w) >= 3), key=len, reverse=True)
    return tuple(ranked[:limit])


def _date_range(text: str, today: date) -> tuple[date | None, date | None, str | None]:
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    if "today" in text or "tonight" in text:
        return today, today, "today"
    if "tomorrow" in text:
        day = today + timedelta(days=1)
        return day, day, "tomorrow"
    if "yesterday" in text:
        day = today - timedelta(days=1)
        return day, day, "yesterday"
    match = _RELATIVE_DAYS.search(text)
    if match:
        count = int(match.group(2))
        if match.group(1) in {"next", "coming"}:
            return today, today + timedelta(days=count), f"the next {count} days"
        return today - timedelta(days=count), today, f"the last {count} days"
    if "next week" in text:
        start = week_start + timedelta(days=7)
        return start, start + timedelta(days=6), "next week"
    if "last week" in text or "past week" in text:
        start = week_start - timedelta(days=7)
        return start, start + timedelta(days=6), "last week"
    if "this week" in text:
        return week_start, week_start + timedelta(days=6), "this week"
    if "last month" in text or "previous month" in text:
        end = month_start - timedelta(days=1)
        return end.replace(day=1), end, "last month"
    if "next month" in text:
        start = (month_start + timedelta(days=32)).replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        return start, end, "next month"
    if "this month" in text or "so far" in text:
        return month_start, today, "this month"
    if "this year" in text:
        return today.replace(month=1, day=1), today, "this year"
    for index, name in enumerate(_MONTHS, start=1):
        if f" in {name}" in text or f" for {name}" in text or f" during {name}" in text:
            year = today.year if index <= today.month else today.year - 1
            start = date(year, index, 1)
            end = (start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
            return start, end, name.capitalize()
    for index, name in enumerate(_WEEKDAYS):
        if f" on {name}" in text or f" this {name}" in text or f" next {name}" in text:
            ahead = (index - today.weekday()) % 7 or 7
            day = today + timedelta(days=ahead)
            return day, day, name.capitalize()
    if "recent" in text or "lately" in text:
        return today - timedelta(days=14), today, "the last two weeks"
    if "upcoming" in text or "soon" in text or "coming up" in text:
        return today, today + timedelta(days=14), "the next two weeks"
    return None, None, None
