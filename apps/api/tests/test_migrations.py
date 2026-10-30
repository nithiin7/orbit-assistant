import sqlite3
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from orbit_api.config import Settings
from orbit_api.db.migrate import alembic_config, downgrade, head_revision, upgrade
from tests.support import query


def recorded_revisions(settings: Settings) -> list[str]:
    with sqlite3.connect(settings.sqlite_path) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        if "alembic_version" not in tables:
            return []
        return [row[0] for row in connection.execute("SELECT version_num FROM alembic_version")]


def test_migration_history_is_linear() -> None:
    script = ScriptDirectory.from_config(alembic_config())

    assert len(script.get_heads()) == 1
    assert head_revision() is not None


def test_upgrade_records_the_head_revision(settings: Settings) -> None:
    upgrade(settings)

    assert recorded_revisions(settings) == [head_revision()]


def test_upgrade_is_idempotent(migrated_settings: Settings) -> None:
    upgrade(migrated_settings)

    assert recorded_revisions(migrated_settings) == [head_revision()]


def test_downgrade_to_base_and_upgrade_again(migrated_settings: Settings) -> None:
    downgrade(migrated_settings, "base")
    assert recorded_revisions(migrated_settings) == []

    upgrade(migrated_settings)
    assert recorded_revisions(migrated_settings) == [head_revision()]


def test_models_match_migrations(migrated_settings: Settings) -> None:
    """Fails when an ORM model changes without a migration. Fix with an Alembic revision."""
    command.check(alembic_config(migrated_settings))


IDENTITY_TABLES = {"users", "local_credentials", "local_sessions", "workspaces"}
NOW = "2026-10-29 12:00:00.000000"


def tables(settings: Settings) -> set[str]:
    rows = query(settings.sqlite_path, "SELECT name FROM sqlite_master WHERE type = 'table'")
    return {row[0] for row in rows}


def test_identity_migration_creates_and_drops_its_tables(migrated_settings: Settings) -> None:
    assert tables(migrated_settings) >= IDENTITY_TABLES

    downgrade(migrated_settings, "0001")

    assert not IDENTITY_TABLES & tables(migrated_settings)
    assert recorded_revisions(migrated_settings) == ["0001"]


def insert_user(database: Path, provider: str = "local", subject: str | None = None) -> str:
    user_id = uuid.uuid4().hex
    query(
        database,
        "INSERT INTO users (id, auth_provider, auth_subject, email, display_name, created_at,"
        " updated_at) VALUES (?, ?, ?, 'a@example.com', 'A', ?, ?)",
        user_id,
        provider,
        subject or user_id,
        NOW,
        NOW,
    )
    return user_id


def insert_workspace(database: Path, owner_id: str, *, is_personal: bool, name: str = "W") -> str:
    workspace_id = uuid.uuid4().hex
    query(
        database,
        "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        workspace_id,
        owner_id,
        name,
        is_personal,
        NOW,
        NOW,
    )
    return workspace_id


def test_database_allows_one_personal_workspace_per_user(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    insert_workspace(database, owner, is_personal=True)
    insert_workspace(database, owner, is_personal=False)

    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_workspace(database, owner, is_personal=True)


def test_database_requires_unique_identities(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    insert_user(database, "supabase", "subject-1")

    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_user(database, "supabase", "subject-1")


@pytest.mark.parametrize(
    ("statement", "params"),
    [
        ("UPDATE users SET auth_provider = 'github'", ()),
        ("UPDATE users SET display_name = ''", ()),
        ("UPDATE workspaces SET name = ''", ()),
        (
            "INSERT INTO local_credentials (user_id, email, password_hash, created_at,"
            " updated_at) SELECT id, 'Upper@Example.com', 'x', ?, ? FROM users",
            (NOW, NOW),
        ),
    ],
)
def test_database_enforces_check_constraints(
    migrated_settings: Settings, statement: str, params: tuple[str, ...]
) -> None:
    database = migrated_settings.sqlite_path
    insert_workspace(database, insert_user(database), is_personal=True)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        query(database, statement, *params)


def test_workspaces_require_an_existing_owner(migrated_settings: Settings) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_workspace(migrated_settings.sqlite_path, uuid.uuid4().hex, is_personal=True)


def test_deleting_a_user_deletes_their_workspaces(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    other = insert_user(database)
    insert_workspace(database, owner, is_personal=True)
    kept = insert_workspace(database, other, is_personal=True)

    query(database, "DELETE FROM users WHERE id = ?", owner)

    assert query(database, "SELECT id FROM workspaces") == [(kept,)]


def insert_task(database: Path, workspace_id: str, **overrides: object) -> str:
    task_id = uuid.uuid4().hex
    values: dict[str, object] = {
        "title": "T",
        "description": "",
        "status": "open",
        "priority": 0,
        "completed_at": None,
        **overrides,
    }
    query(
        database,
        "INSERT INTO tasks (id, workspace_id, title, description, status, priority,"
        " completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        task_id,
        workspace_id,
        values["title"],
        values["description"],
        values["status"],
        values["priority"],
        values["completed_at"],
        NOW,
        NOW,
    )
    return task_id


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""},
        {"title": "x" * 201},
        {"description": "x" * 5001},
        {"status": "archived"},
        {"priority": 4},
        {"priority": -1},
        # `completed_at` is set exactly when the task is completed.
        {"status": "completed"},
        {"status": "open", "completed_at": NOW},
    ],
)
def test_database_enforces_task_constraints(
    migrated_settings: Settings, overrides: dict[str, object]
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    insert_task(database, workspace, status="completed", completed_at=NOW)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_task(database, workspace, **overrides)


def test_tasks_require_an_existing_workspace(migrated_settings: Settings) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_task(migrated_settings.sqlite_path, uuid.uuid4().hex)


def test_deleting_a_workspace_deletes_its_tasks(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    doomed = insert_workspace(database, owner, is_personal=False)
    kept_workspace = insert_workspace(database, owner, is_personal=True)
    insert_task(database, doomed)
    kept = insert_task(database, kept_workspace)

    query(database, "DELETE FROM workspaces WHERE id = ?", doomed)

    assert query(database, "SELECT id FROM tasks") == [(kept,)]


def test_task_migration_creates_and_drops_its_table(migrated_settings: Settings) -> None:
    assert "tasks" in tables(migrated_settings)

    downgrade(migrated_settings, "0003")

    assert "tasks" not in tables(migrated_settings)
    assert tables(migrated_settings) >= IDENTITY_TABLES


def insert_shopping_list(
    database: Path, workspace_id: str, *, is_default: bool = False, name: str = "L"
) -> str:
    list_id = uuid.uuid4().hex
    query(
        database,
        "INSERT INTO shopping_lists (id, workspace_id, name, is_default, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        list_id,
        workspace_id,
        name,
        is_default,
        NOW,
        NOW,
    )
    return list_id


def insert_shopping_item(
    database: Path, workspace_id: str, list_id: str, **overrides: object
) -> str:
    item_id = uuid.uuid4().hex
    values: dict[str, object] = {
        "name": "I",
        "quantity": None,
        "url": None,
        "notes": "",
        "status": "needed",
        "purchased_at": None,
        **overrides,
    }
    query(
        database,
        "INSERT INTO shopping_items (id, workspace_id, list_id, name, quantity, url, notes,"
        " status, purchased_at, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        item_id,
        workspace_id,
        list_id,
        values["name"],
        values["quantity"],
        values["url"],
        values["notes"],
        values["status"],
        values["purchased_at"],
        NOW,
        NOW,
    )
    return item_id


def test_database_allows_one_default_shopping_list_per_workspace(
    migrated_settings: Settings,
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    insert_shopping_list(database, workspace, is_default=True)
    insert_shopping_list(database, workspace)
    insert_shopping_list(database, workspace)

    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_shopping_list(database, workspace, is_default=True)


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"name": "x" * 201},
        {"quantity": "x" * 51},
        {"url": "x" * 2049},
        {"notes": "x" * 2001},
        {"status": "wanted"},
        # `purchased_at` is set exactly when the item is purchased.
        {"status": "purchased"},
        {"status": "needed", "purchased_at": NOW},
    ],
)
def test_database_enforces_shopping_item_constraints(
    migrated_settings: Settings, overrides: dict[str, object]
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    list_id = insert_shopping_list(database, workspace)
    insert_shopping_item(database, workspace, list_id, status="purchased", purchased_at=NOW)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_shopping_item(database, workspace, list_id, **overrides)


def test_shopping_items_stay_in_their_lists_workspace(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    workspace = insert_workspace(database, owner, is_personal=True)
    other = insert_workspace(database, owner, is_personal=False)
    list_id = insert_shopping_list(database, workspace)

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_shopping_item(database, other, list_id)


def test_deleting_a_workspace_deletes_its_shopping_lists_and_items(
    migrated_settings: Settings,
) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    doomed = insert_workspace(database, owner, is_personal=False)
    kept_workspace = insert_workspace(database, owner, is_personal=True)
    insert_shopping_item(database, doomed, insert_shopping_list(database, doomed))
    kept_list = insert_shopping_list(database, kept_workspace)
    kept = insert_shopping_item(database, kept_workspace, kept_list)

    query(database, "DELETE FROM workspaces WHERE id = ?", doomed)

    assert query(database, "SELECT id FROM shopping_lists") == [(kept_list,)]
    assert query(database, "SELECT id FROM shopping_items") == [(kept,)]


def test_shopping_migration_creates_and_drops_its_tables(migrated_settings: Settings) -> None:
    assert {"shopping_lists", "shopping_items"} <= tables(migrated_settings)

    downgrade(migrated_settings, "0004")

    assert not {"shopping_lists", "shopping_items"} & tables(migrated_settings)
    assert "tasks" in tables(migrated_settings)


def test_dashboard_migration_creates_and_drops_its_table(migrated_settings: Settings) -> None:
    assert "dashboard_layouts" in tables(migrated_settings)

    downgrade(migrated_settings, "0005")

    assert "dashboard_layouts" not in tables(migrated_settings)
    assert {"shopping_lists", "shopping_items"} <= tables(migrated_settings)


def insert_reminder(database: Path, workspace_id: str, **overrides: object) -> str:
    reminder_id = uuid.uuid4().hex
    values: dict[str, object] = {
        "task_id": None,
        "title": "R",
        "timezone": "UTC",
        "last_outcome": None,
        **overrides,
    }
    query(
        database,
        "INSERT INTO reminders (id, workspace_id, task_id, title, description, enabled,"
        " start_date, time_of_day, timezone, recurrence, last_outcome, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, '', 1, '2030-01-15', '09:00:00.000000', ?, NULL, ?, ?, ?)",
        reminder_id,
        workspace_id,
        values["task_id"],
        values["title"],
        values["timezone"],
        values["last_outcome"],
        NOW,
        NOW,
    )
    return reminder_id


def insert_occurrence(database: Path, reminder_id: str, **overrides: object) -> str:
    occurrence_id = uuid.uuid4().hex
    values: dict[str, object] = {
        "scheduled_for": NOW,
        "status": "pending",
        "attempts": 0,
        "claim_token": None,
        "claimed_until": None,
        "finished_at": None,
        **overrides,
    }
    query(
        database,
        "INSERT INTO reminder_occurrences (id, reminder_id, scheduled_for, status, attempts,"
        " available_at, claim_token, claimed_until, finished_at, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        occurrence_id,
        reminder_id,
        values["scheduled_for"],
        values["status"],
        values["attempts"],
        NOW,
        values["claim_token"],
        values["claimed_until"],
        values["finished_at"],
        NOW,
    )
    return occurrence_id


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""},
        {"title": "x" * 201},
        {"timezone": ""},
        {"last_outcome": "lost"},
    ],
)
def test_database_enforces_reminder_constraints(
    migrated_settings: Settings, overrides: dict[str, object]
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    insert_reminder(database, workspace)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_reminder(database, workspace, **overrides)


def test_reminders_stay_in_their_tasks_workspace(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    workspace = insert_workspace(database, owner, is_personal=True)
    other = insert_workspace(database, owner, is_personal=False)
    task = insert_task(database, workspace)
    insert_reminder(database, workspace, task_id=task)

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_reminder(database, other, task_id=task)


def test_deleting_a_task_deletes_its_reminders_and_occurrences(
    migrated_settings: Settings,
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    task = insert_task(database, workspace)
    insert_occurrence(database, insert_reminder(database, workspace, task_id=task))
    kept = insert_reminder(database, workspace)

    query(database, "DELETE FROM tasks WHERE id = ?", task)

    assert query(database, "SELECT id FROM reminders") == [(kept,)]
    assert query(database, "SELECT id FROM reminder_occurrences") == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"status": "sent"},
        {"attempts": -1},
        # A claim exists exactly while processing.
        {"status": "processing"},
        {"claim_token": uuid.uuid4().hex, "claimed_until": NOW},
        # Final outcomes record when they finished; active ones don't.
        {"status": "delivered"},
        {"finished_at": NOW},
    ],
)
def test_database_enforces_occurrence_constraints(
    migrated_settings: Settings, overrides: dict[str, object]
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    reminder = insert_reminder(database, workspace)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_occurrence(database, reminder, **overrides)


def test_database_allows_one_occurrence_per_reminder_and_time(
    migrated_settings: Settings,
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    reminder = insert_reminder(database, workspace)
    insert_occurrence(database, reminder)
    insert_occurrence(database, insert_reminder(database, workspace))

    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_occurrence(database, reminder, status="delivered", finished_at=NOW)


def test_reminder_migration_creates_and_drops_its_tables(migrated_settings: Settings) -> None:
    reminder_tables = {"reminders", "reminder_occurrences", "notifications"}
    assert reminder_tables <= tables(migrated_settings)

    downgrade(migrated_settings, "0006")

    assert not reminder_tables & tables(migrated_settings)
    assert "tasks" in tables(migrated_settings)
    columns = {row[1] for row in query(migrated_settings.sqlite_path, "PRAGMA table_info(users)")}
    assert "timezone" not in columns


def insert_finance_account(database: Path, workspace_id: str, **overrides: object) -> str:
    account_id = uuid.uuid4().hex
    values: dict[str, object] = {
        "type": "bank",
        "currency": "INR",
        "opening_balance": 0,
        **overrides,
    }
    query(
        database,
        "INSERT INTO finance_accounts (id, workspace_id, name, type, currency, opening_balance,"
        " notes, archived_at, created_at, updated_at) VALUES (?, ?, 'A', ?, ?, ?, '', NULL, ?, ?)",
        account_id,
        workspace_id,
        values["type"],
        values["currency"],
        values["opening_balance"],
        NOW,
        NOW,
    )
    return account_id


def insert_finance_category(database: Path, workspace_id: str, name: str = "C") -> str:
    category_id = uuid.uuid4().hex
    query(
        database,
        "INSERT INTO finance_categories (id, workspace_id, name, type, key, created_at,"
        " updated_at) VALUES (?, ?, ?, 'expense', NULL, ?, ?)",
        category_id,
        workspace_id,
        name,
        NOW,
        NOW,
    )
    return category_id


def insert_finance_transaction(
    database: Path, workspace_id: str, account_id: str, **overrides: object
) -> str:
    transaction_id = uuid.uuid4().hex
    values: dict[str, object] = {
        "type": "expense",
        "amount": 100,
        "currency": "INR",
        "description": "T",
        "category_id": None,
        "to_account_id": None,
        **overrides,
    }
    query(
        database,
        "INSERT INTO finance_transactions (id, workspace_id, type, amount, currency, occurred_on,"
        " description, category_id, account_id, to_account_id, notes, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, '2026-02-10', ?, ?, ?, ?, '', ?, ?)",
        transaction_id,
        workspace_id,
        values["type"],
        values["amount"],
        values["currency"],
        values["description"],
        values["category_id"],
        account_id,
        values["to_account_id"],
        NOW,
        NOW,
    )
    return transaction_id


@pytest.mark.parametrize(
    "overrides",
    [
        {"amount": 0},
        {"amount": -1},
        {"amount": 10**13 + 1},
        {"type": "withdrawal"},
        {"currency": "inr"},
        {"description": ""},
        # A transfer needs a different destination and no category; nothing else has one.
        {"type": "transfer"},
        {"type": "transfer", "to_account_id": "SELF"},
        {"type": "transfer", "to_account_id": "OTHER", "category_id": "CATEGORY"},
        {"to_account_id": "OTHER"},
    ],
)
def test_database_enforces_finance_transaction_constraints(
    migrated_settings: Settings, overrides: dict[str, object]
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    account = insert_finance_account(database, workspace)
    ids = {
        "SELF": account,
        "OTHER": insert_finance_account(database, workspace),
        "CATEGORY": insert_finance_category(database, workspace),
    }
    insert_finance_transaction(
        database, workspace, account, type="transfer", to_account_id=ids["OTHER"]
    )

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_finance_transaction(
            database,
            workspace,
            account,
            **{key: ids.get(str(value), value) for key, value in overrides.items()},
        )


@pytest.mark.parametrize(
    "overrides",
    [{"type": "mortgage"}, {"opening_balance": 10**13 + 1}, {"currency": "US"}],
)
def test_database_enforces_finance_account_constraints(
    migrated_settings: Settings, overrides: dict[str, object]
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_finance_account(database, workspace, **overrides)


def test_finance_transactions_stay_in_their_accounts_workspace_and_currency(
    migrated_settings: Settings,
) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    workspace = insert_workspace(database, owner, is_personal=True)
    other = insert_workspace(database, owner, is_personal=False)
    rupees = insert_finance_account(database, workspace)
    dollars = insert_finance_account(database, workspace, currency="USD")
    elsewhere = insert_finance_account(database, other)
    foreign_category = insert_finance_category(database, other)

    for account, overrides in (
        # The transaction's currency must be its account's.
        (rupees, {"currency": "USD"}),
        # Both sides of a transfer share one currency.
        (rupees, {"type": "transfer", "to_account_id": dollars}),
        # Accounts and categories must be in the transaction's workspace.
        (elsewhere, {}),
        (rupees, {"type": "transfer", "to_account_id": elsewhere}),
        (rupees, {"category_id": foreign_category}),
    ):
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            insert_finance_transaction(database, workspace, account, **overrides)


def test_categories_in_use_cannot_be_deleted(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    used = insert_finance_category(database, workspace, "Used")
    insert_finance_transaction(
        database, workspace, insert_finance_account(database, workspace), category_id=used
    )

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        query(database, "DELETE FROM finance_categories WHERE id = ?", used)


def test_deleting_a_workspace_deletes_its_finance_data(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    doomed = insert_workspace(database, owner, is_personal=False)
    kept_workspace = insert_workspace(database, owner, is_personal=True)
    source = insert_finance_account(database, doomed)
    insert_finance_transaction(
        database,
        doomed,
        source,
        type="transfer",
        to_account_id=insert_finance_account(database, doomed),
    )
    insert_finance_transaction(
        database, doomed, source, category_id=insert_finance_category(database, doomed)
    )
    kept_account = insert_finance_account(database, kept_workspace)
    kept = insert_finance_transaction(database, kept_workspace, kept_account)

    query(database, "DELETE FROM workspaces WHERE id = ?", doomed)

    assert query(database, "SELECT id FROM finance_accounts") == [(kept_account,)]
    assert query(database, "SELECT id FROM finance_categories") == []
    assert query(database, "SELECT id FROM finance_transactions") == [(kept,)]


def test_finance_migration_creates_and_drops_its_tables(migrated_settings: Settings) -> None:
    finance_tables = {"finance_accounts", "finance_categories", "finance_transactions"}
    assert finance_tables <= tables(migrated_settings)

    downgrade(migrated_settings, "0007")

    assert not finance_tables & tables(migrated_settings)
    assert {"reminders", "tasks"} <= tables(migrated_settings)


# Investments, assets, and net worth (0010)

INVESTMENT_TABLES = {
    "finance_investment_accounts",
    "finance_holdings",
    "finance_holding_prices",
    "finance_sip_plans",
    "finance_deposits",
    "finance_investment_transactions",
    "finance_assets",
    "finance_asset_valuations",
    "finance_net_worth_snapshots",
}


def insert_investment_account(database: Path, workspace_id: str, currency: str = "INR") -> str:
    account_id = insert_finance_account(
        database, workspace_id, type="investment", currency=currency
    )
    query(
        database,
        "INSERT INTO finance_investment_accounts (account_id, workspace_id, currency, kind,"
        " provider, linked_account_id, created_at, updated_at)"
        " VALUES (?, ?, ?, 'brokerage', '', NULL, ?, ?)",
        account_id,
        workspace_id,
        currency,
        NOW,
        NOW,
    )
    return account_id


def insert_holding(
    database: Path, workspace_id: str, account_id: str, currency: str = "INR"
) -> str:
    holding_id = uuid.uuid4().hex
    query(
        database,
        "INSERT INTO finance_holdings (id, workspace_id, account_id, currency, kind, name, symbol,"
        " exchange, isin, issuer, category, folio, identity, notes, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, 'stock', 'H', '', '', '', '', '', '', ?, '', ?, ?)",
        holding_id,
        workspace_id,
        account_id,
        currency,
        f"stock|name:{holding_id}|",
        NOW,
        NOW,
    )
    return holding_id


def insert_investment_transaction(
    database: Path, workspace_id: str, account_id: str, **overrides: object
) -> str:
    transaction_id = uuid.uuid4().hex
    values: dict[str, object] = {
        "type": "buy",
        "amount": 100,
        "fees": 0,
        "holding_id": None,
        "deposit_id": None,
        "quantity": 1_000_000,
        "plan": "lump_sum",
        "settlement": "investment_account",
        "cash_transaction_id": None,
        "currency": "INR",
        **overrides,
    }
    query(
        database,
        "INSERT INTO finance_investment_transactions (id, workspace_id, account_id, currency, type,"
        " trade_date, amount, fees, holding_id, deposit_id, sip_plan_id, sip_due_date, quantity,"
        " plan, settlement, cash_account_id, cash_transaction_id, fee_transaction_id, notes,"
        " created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, '2026-02-10', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, NULL, '',"
        " ?, ?)",
        transaction_id,
        workspace_id,
        account_id,
        values["currency"],
        values["type"],
        values["amount"],
        values["fees"],
        values["holding_id"],
        values["deposit_id"],
        values["quantity"],
        values["plan"],
        values["settlement"],
        values["cash_transaction_id"],
        NOW,
        NOW,
    )
    return transaction_id


@pytest.mark.parametrize(
    "overrides",
    [
        {"amount": 0},
        {"type": "swap"},
        {"quantity": None},
        {"quantity": 0},
        # Only buys are lump sums or SIP installments; only trades have units.
        {"type": "sell"},
        {"type": "dividend", "quantity": None, "plan": None},
        # Income and fees always have a ledger row; fees on a trade too.
        {"fees": 5},
        # Money settled through another account names it; sales can't come from outside.
        {"settlement": "account"},
        {"type": "sell", "plan": None, "settlement": "none"},
    ],
)
def test_database_enforces_investment_transaction_constraints(
    migrated_settings: Settings, overrides: dict[str, object]
) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    account = insert_investment_account(database, workspace)
    holding = insert_holding(database, workspace, account)
    insert_investment_transaction(database, workspace, account, holding_id=holding)

    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_investment_transaction(database, workspace, account, holding_id=holding, **overrides)


def test_investments_stay_in_their_accounts_workspace_and_currency(
    migrated_settings: Settings,
) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    workspace = insert_workspace(database, owner, is_personal=True)
    other = insert_workspace(database, owner, is_personal=False)
    account = insert_investment_account(database, workspace)
    foreign = insert_holding(database, other, insert_investment_account(database, other))
    dollars = insert_holding(
        database, workspace, insert_investment_account(database, workspace, "USD"), "USD"
    )

    # A holding's account is an investment account in its workspace and currency.
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_holding(database, workspace, insert_finance_account(database, workspace))
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_holding(database, other, account)
    for holding in (foreign, dollars):
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            insert_investment_transaction(database, workspace, account, holding_id=holding)


def test_ledger_rows_recording_investments_cannot_be_deleted(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)
    account = insert_investment_account(database, workspace)
    holding = insert_holding(database, workspace, account)
    income = insert_finance_transaction(database, workspace, account, type="income")
    insert_investment_transaction(
        database,
        workspace,
        account,
        type="dividend",
        holding_id=holding,
        quantity=None,
        plan=None,
        cash_transaction_id=income,
    )
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        query(database, "DELETE FROM finance_transactions WHERE id = ?", income)
    # Nor can one ledger row back two investment transactions.
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_investment_transaction(
            database,
            workspace,
            account,
            type="dividend",
            holding_id=holding,
            quantity=None,
            plan=None,
            cash_transaction_id=income,
        )


def test_one_net_worth_snapshot_per_month_and_currency(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    workspace = insert_workspace(database, insert_user(database), is_personal=True)

    def snapshot(currency: str = "INR") -> None:
        query(
            database,
            "INSERT INTO finance_net_worth_snapshots (id, workspace_id, currency, period_start,"
            " as_of, assets, liabilities, net_worth, groups, source, estimated_items,"
            " manual_items, stale_items, missing_items, created_at, updated_at)"
            " VALUES (?, ?, ?, '2026-01-01', '2026-01-31', 0, 0, 0, '[]', 'manual', 0, 0, 0, 0,"
            " ?, ?)",
            uuid.uuid4().hex,
            workspace,
            currency,
            NOW,
            NOW,
        )

    snapshot()
    snapshot("USD")
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        snapshot()


def test_deleting_a_workspace_deletes_its_investments(migrated_settings: Settings) -> None:
    database = migrated_settings.sqlite_path
    owner = insert_user(database)
    doomed = insert_workspace(database, owner, is_personal=False)
    account = insert_investment_account(database, doomed)
    holding = insert_holding(database, doomed, account)
    insert_investment_transaction(database, doomed, account, holding_id=holding)

    query(database, "DELETE FROM workspaces WHERE id = ?", doomed)

    for table in INVESTMENT_TABLES:
        assert query(database, f"SELECT count(*) FROM {table}") == [(0,)]


def test_investment_migration_creates_and_drops_its_tables(migrated_settings: Settings) -> None:
    assert tables(migrated_settings) >= INVESTMENT_TABLES

    downgrade(migrated_settings, "0009")

    assert not INVESTMENT_TABLES & tables(migrated_settings)
    assert {"finance_loans", "finance_accounts", "reminders"} <= tables(migrated_settings)
