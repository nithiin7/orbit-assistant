"""Let the assistant propose quick-capture actions in more modules.

`ai_action_proposals.kind` also allows adding shopping items, habits, health logs, transactions,
places, saved links, and watchlist titles. On SQLite this rebuilds `ai_action_proposals` (batch
mode copies every row); no table references it.

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_KINDS = (
    "'create_task', 'create_reminder', 'create_event', 'create_note', 'append_to_note', "
    "'add_note_tags', 'update_document_details'"
)
_ADDED_KINDS = (
    "'add_shopping_item', 'create_habit', 'log_water', 'log_weight', 'log_activity', "
    "'add_transaction', 'add_place', 'save_link', 'add_watch_item'"
)


def upgrade() -> None:
    with op.batch_alter_table("ai_action_proposals", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_action_proposals_kind"), type_="check")
        batch_op.create_check_constraint(
            op.f("ck_ai_action_proposals_kind"), f"kind IN ({_OLD_KINDS}, {_ADDED_KINDS})"
        )


def downgrade() -> None:
    op.execute(f"DELETE FROM ai_action_proposals WHERE kind IN ({_ADDED_KINDS})")
    with op.batch_alter_table("ai_action_proposals", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_ai_action_proposals_kind"), type_="check")
        batch_op.create_check_constraint(
            op.f("ck_ai_action_proposals_kind"), f"kind IN ({_OLD_KINDS})"
        )
