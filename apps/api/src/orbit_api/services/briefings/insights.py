"""Deterministic insights over a finished briefing: counts, and what needs attention first.

Nothing here reads data or guesses: every number is counted from the sections, and the
attention list only reorders items whose severity the aggregator already set from the modules'
own statuses. A narrative (a later phase) starts from this summary rather than from raw records.
"""

from typing import Final

from orbit_api.services.briefings.models import (
    ITEM_LIMIT,
    SEVERITY_RANK,
    AttentionItem,
    BriefingContent,
    BriefingSummary,
    Severity,
    Source,
)

EMPTY_SUMMARY: Final = BriefingSummary(
    events=0,
    conflicts=0,
    tasks_overdue=0,
    tasks_due_today=0,
    reminders_due=0,
    payments_overdue=0,
    payments_due=0,
    budgets_exceeded=0,
    budgets_approaching=0,
    habits_remaining=0,
    habits_done=0,
    workouts=0,
    attention=(),
)


def attention(content: BriefingContent) -> tuple[AttentionItem, ...]:
    """Items marked `critical` or `warning`, most severe first; within a severity, in section
    order (money, then tasks, schedule, reminders, goals) and each section's own order."""
    found: list[AttentionItem] = []
    if content.payments is not None:
        found += [_item(p.ref.key, "payments", p.name, p.severity) for p in content.payments.items]
    if content.budgets is not None:
        found += [_item(b.ref.key, "budgets", b.name, b.severity) for b in content.budgets.items]
    if content.tasks is not None:
        for bucket in (content.tasks.overdue, content.tasks.due_today):
            found += [_item(t.ref.key, "tasks", t.title, t.severity) for t in bucket.items]
    if content.schedule is not None:
        found += [
            _item(e.ref.key, "calendar", e.title, e.severity) for e in content.schedule.events
        ]
    if content.reminders is not None:
        found += [
            _item(r.ref.key, "reminders", r.title, r.severity) for r in content.reminders.items
        ]
    if content.investments is not None:
        found += [
            _item(d.ref.key, "investments", d.name, d.severity)
            for d in content.investments.deposits
        ]
        found += [
            _item(i.ref.key, "investments", i.holding_name, i.severity)
            for i in content.investments.sips
        ]
    if content.documents is not None:
        found += [
            _item(d.ref.key, "documents", d.title, d.severity) for d in content.documents.items
        ]
    if content.deadlines is not None:
        found += [
            _item(g.ref.key, "goals", g.name, g.severity) for g in content.deadlines.savings_goals
        ]
    # `sorted` is stable, so ties keep section order.
    pressing = sorted(
        (item for item in found if item.severity != "info"),
        key=lambda item: SEVERITY_RANK[item.severity],
    )
    return tuple(pressing[:ITEM_LIMIT])


def _item(key: str, module: Source, title: str, severity: Severity) -> AttentionItem:
    return AttentionItem(key=key, module=module, title=title, severity=severity)


def summarize(content: BriefingContent) -> BriefingSummary:
    """The summary of `content`, ignoring the summary it already holds."""
    schedule, tasks, reminders = content.schedule, content.tasks, content.reminders
    payments, budgets, habits, health = (
        content.payments,
        content.budgets,
        content.habits,
        content.health,
    )
    return BriefingSummary(
        events=len(schedule.events) if schedule else 0,
        conflicts=len(schedule.conflicts) if schedule else 0,
        tasks_overdue=tasks.overdue.total if tasks else 0,
        tasks_due_today=tasks.due_today.total if tasks else 0,
        reminders_due=sum(1 for r in reminders.items if r.bucket != "upcoming") if reminders else 0,
        payments_overdue=payments.overdue if payments else 0,
        payments_due=payments.due_today if payments else 0,
        budgets_exceeded=budgets.exceeded if budgets else 0,
        budgets_approaching=budgets.approaching if budgets else 0,
        habits_remaining=habits.remaining if habits else 0,
        habits_done=habits.done if habits else 0,
        workouts=sum(1 for w in health.workouts if w.state != "completed") if health else 0,
        attention=attention(content),
    )
