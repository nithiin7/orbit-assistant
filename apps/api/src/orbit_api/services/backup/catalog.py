"""What a backup contains: every table, either in a module or deliberately left out.

Every table Orbit has appears exactly once, in `MODULE_TABLES` or in `EXCLUDED_TABLES` (with
the reason), and a test fails when a new table appears in neither, so a future module can't be
silently missing from backups.

The table structures themselves (columns, keys, references) are read from the ORM metadata by
the repository and handed to the service as `TableSpec`s, so the service stays free of
SQLAlchemy.
"""

from dataclasses import dataclass
from typing import Final, Literal

Module = Literal[
    "tasks",
    "shopping",
    "reminders",
    "finance",
    "notes",
    "calendar",
    "habits",
    "documents",
    "fitness",
    "assistant",
    "search",
]

MODULES: Final[tuple[Module, ...]] = (
    "tasks",
    "shopping",
    "reminders",
    "finance",
    "notes",
    "calendar",
    "habits",
    "documents",
    "fitness",
    "assistant",
    "search",
)

MODULE_LABELS: Final[dict[Module, str]] = {
    "tasks": "Tasks",
    "shopping": "Shopping lists",
    "reminders": "Reminders and notifications",
    "finance": "Finance",
    "notes": "Notes",
    "calendar": "Calendar",
    "habits": "Habits and routines",
    "documents": "Documents",
    "fitness": "Health and fitness",
    "assistant": "Assistant conversations",
    "search": "Saved searches",
}

_PREFIXES: Final[tuple[tuple[str, Module], ...]] = (
    ("finance_", "finance"),
    ("note_", "notes"),
    ("calendar_", "calendar"),
    ("habit_", "habits"),
    ("routine_", "habits"),
    ("document_", "documents"),
    ("fitness_", "fitness"),
    ("shopping_", "shopping"),
)

_EXACT: Final[dict[str, Module]] = {
    "tasks": "tasks",
    "reminders": "reminders",
    "reminder_occurrences": "reminders",
    "notifications": "reminders",
    "notes": "notes",
    "habits": "habits",
    "routines": "habits",
    "documents": "documents",
    "ai_conversations": "assistant",
    "ai_messages": "assistant",
    "ai_insight_dismissals": "assistant",
    "saved_searches": "search",
}

# Tables a backup leaves out, and why. Credentials and tokens never leave the server; derived
# data is rebuilt; per-user settings aren't workspace data; integrations must be reconnected.
EXCLUDED_TABLES: Final[dict[str, str]] = {
    "users": "the profile belongs to the account, not the workspace",
    "workspaces": "recreated from the manifest",
    "local_credentials": "password hashes never leave the server",
    "local_sessions": "sign-in tokens never leave the server",
    "user_avatars": "the profile photo belongs to the account",
    "dashboard_layouts": "a per-person preference, not workspace data",
    "calendar_preferences": "a per-person preference, not workspace data",
    "ai_providers": "encrypted provider API keys never leave the server",
    "ai_settings": "per-person AI settings refer to providers, which aren't backed up",
    "ai_index_sources": "the retrieval index is rebuilt from the records",
    "ai_chunks": "the retrieval index is rebuilt from the records",
    "ai_action_proposals": "pending AI actions must not be replayed",
    "ai_usage": "operational usage records, not workspace content",
    "recent_searches": "short-lived search history",
    "integration_connections": "encrypted account tokens never leave the server",
    "integration_oauth_states": "short-lived sign-in state",
    "integration_resources": "synchronization state; accounts are reconnected after a restore",
    "integration_links": "synchronization state; accounts are reconnected after a restore",
    "integration_sync_runs": "synchronization history",
    "backups": "backups don't contain other backups",
    "backup_settings": "set again in the restored workspace",
    "backup_uploads": "staging state",
}

# Columns that name a file in the attachment store: `(table, column)`. The file is stored as
# `<workspace id>/<value>`.
FILE_COLUMNS: Final[dict[str, str]] = {
    "note_attachments": "id",
    "document_versions": "blob_id",
    "fitness_photos": "blob_id",
}

# Records an import matches to existing ones by their natural key rather than duplicating, in
# order of preference: the same category, tag, built-in exercise, or default shopping list is
# by definition the same record in one workspace. Keys with a missing value (or `False`) don't
# match.
MATCH_KEYS: Final[dict[str, tuple[tuple[str, ...], ...]]] = {
    "finance_categories": (("key",), ("type", "name")),
    "calendar_categories": (("normalized_name",),),
    "document_categories": (("normalized_name",),),
    "habit_categories": (("normalized_name",),),
    "note_tags": (("normalized_name",),),
    "fitness_exercises": (("builtin_key",),),
    "shopping_lists": (("is_default",),),
}


def module_of(table: str) -> Module | None:
    """The module `table` belongs to, or `None` if it's excluded or unknown."""
    if table in EXCLUDED_TABLES:
        return None
    if table in _EXACT:
        return _EXACT[table]
    for prefix, module in _PREFIXES:
        if table.startswith(prefix):
            return module
    return None


ColumnKind = Literal[
    "uuid",
    "text",
    "integer",
    "float",
    "boolean",
    "datetime",
    "local_datetime",
    "date",
    "time",
    "json",
]


@dataclass(frozen=True, slots=True)
class ColumnSpec:
    name: str
    kind: ColumnKind
    nullable: bool
    # Filled in by the database or the ORM when absent, so an older backup may lack it.
    has_default: bool


@dataclass(frozen=True, slots=True)
class Reference:
    """A column holding another backed-up record's identity (`table.id`)."""

    column: str
    table: str


@dataclass(frozen=True, slots=True)
class TableSpec:
    name: str
    module: Module
    columns: tuple[ColumnSpec, ...]
    primary_key: tuple[str, ...]
    # The table's own generated ID column, when its primary key is one (not a link table).
    identity: str | None
    references: tuple[Reference, ...]
    # Columns holding the owning user's ID; set to the restoring user.
    user_columns: tuple[str, ...]
    # Whether the table has a `workspace_id` column (all but `reminder_occurrences`, which
    # belongs to its reminder).
    scoped: bool
    # A column referencing this same table (folders in folders), so parents go first.
    parent_column: str | None = None

    def column(self, name: str) -> ColumnSpec | None:
        return next((column for column in self.columns if column.name == name), None)
