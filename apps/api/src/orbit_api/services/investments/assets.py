"""Other assets: gold, property, vehicles, cash outside any account, and anything else valued by
hand, with a history of dated valuations.

**No double counting.** An asset linked to an asset account (a bank, cash, or investment
account) is what that account's balance already counts, so it is never added to net worth
again; one linked to a liability (the loan that financed a vehicle) is counted, since the loan
is the debt and the vehicle the asset. The user can also leave any asset out. Names are unique
per workspace, so the same asset isn't added twice by accident.
"""

import uuid
from collections.abc import Callable, Iterable
from dataclasses import replace
from datetime import date, datetime
from typing import Protocol

from orbit_api.services.finance.models import ACCOUNT_CLASSES, Account, AccountNotFoundError
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.investments.models import (
    VALUATION_STALE_DAYS,
    Asset,
    AssetChanges,
    AssetDraft,
    AssetNotFoundError,
    AssetValuation,
    AssetValuationSource,
    AssetView,
    Freshness,
    InvalidInvestmentError,
    InvestmentConflictError,
    ValuationNotFoundError,
)
from orbit_api.services.transactions import ConflictError
from orbit_api.services.transactions import Transaction as UnitOfWork
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now


class AssetRepository(Protocol):
    async def add(self, asset: Asset) -> None:
        """Raises `ConflictError` on a duplicate name."""
        ...

    async def get(self, workspace_id: uuid.UUID, asset_id: uuid.UUID) -> Asset | None: ...

    async def list(self, workspace_id: uuid.UUID) -> list[Asset]:
        """Current assets first, then archived ones, each by name."""
        ...

    async def save(self, asset: Asset) -> None:
        """Raises `ConflictError` on a duplicate name."""
        ...


class ValuationRepository(Protocol):
    async def put(self, valuation: AssetValuation) -> AssetValuation:
        """Store the asset's value for its date, replacing one already there."""
        ...

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[AssetValuation]: ...

    async def for_asset(self, workspace_id: uuid.UUID, asset_id: uuid.UUID) -> list[AssetValuation]:
        """Newest first."""
        ...

    async def delete(
        self, workspace_id: uuid.UUID, asset_id: uuid.UUID, valuation_id: uuid.UUID
    ) -> bool: ...


def asset_view(
    asset: Asset, valuations: Iterable[AssetValuation], as_of: date, linked: Account | None
) -> AssetView:
    """The asset on `as_of`: its latest valuation on or before then, else its purchase cost
    (marked `missing`), and whether net worth counts it."""
    latest = max(
        (entry for entry in valuations if entry.valued_on <= as_of),
        key=lambda entry: entry.valued_on,
        default=None,
    )
    freshness: Freshness
    if latest is not None:
        value, valued_on = latest.value, latest.valued_on
        stale = (as_of - latest.valued_on).days > VALUATION_STALE_DAYS
        freshness = "stale" if stale else "current"
    else:
        value, valued_on, freshness = asset.purchase_cost or 0, asset.purchase_date, "missing"

    reason: str | None = None
    if asset.archived_at is not None:
        reason = "Sold or disposed of."
    elif asset.purchase_date is not None and asset.purchase_date > as_of:
        reason = "Not owned yet on this date."
    elif linked is not None and ACCOUNT_CLASSES[linked.type] == "asset":
        reason = f"Already counted in the balance of “{linked.name}”."
    elif not asset.include_in_net_worth:
        reason = "Left out of net worth."
    return AssetView(
        asset=asset,
        latest=latest,
        value=value,
        valued_on=valued_on,
        freshness=freshness,
        counted=reason is None,
        excluded_reason=reason,
    )


class AssetService:
    def __init__(
        self,
        assets: AssetRepository,
        valuations: ValuationRepository,
        finance: FinanceService,
        unit_of_work: UnitOfWork,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._assets = assets
        self._valuations = valuations
        self._finance = finance
        self._unit_of_work = unit_of_work
        self._clock = clock

    async def views(self, workspace_id: uuid.UUID, as_of: date) -> list[AssetView]:
        accounts = {
            view.account.id: view.account for view in await self._finance.accounts(workspace_id)
        }
        by_asset: dict[uuid.UUID, list[AssetValuation]] = {}
        for entry in await self._valuations.for_workspace(workspace_id):
            by_asset.setdefault(entry.asset_id, []).append(entry)
        return [
            asset_view(
                asset,
                by_asset.get(asset.id, []),
                as_of,
                accounts.get(asset.linked_account_id) if asset.linked_account_id else None,
            )
            for asset in await self._assets.list(workspace_id)
        ]

    async def view(self, workspace_id: uuid.UUID, asset_id: uuid.UUID, today: date) -> AssetView:
        for view in await self.views(workspace_id, today):
            if view.asset.id == asset_id:
                return view
        raise AssetNotFoundError

    async def create(self, workspace_id: uuid.UUID, draft: AssetDraft, today: date) -> AssetView:
        if draft.linked_account_id is not None:
            await self._linked(workspace_id, draft.linked_account_id, draft.currency)
        await self._check_name(workspace_id, draft.name, None)
        now = self._clock()
        asset = Asset(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=draft.name,
            category=draft.category,
            currency=draft.currency,
            purchase_date=draft.purchase_date,
            purchase_cost=draft.purchase_cost,
            linked_account_id=draft.linked_account_id,
            include_in_net_worth=draft.include_in_net_worth,
            notes=draft.notes,
            archived_at=None,
            created_at=now,
            updated_at=now,
        )
        try:
            await self._assets.add(asset)
        except ConflictError:
            await self._unit_of_work.rollback()
            raise _duplicate() from None
        if draft.current_value is not None:
            await self._put(asset, draft.valued_on or today, draft.current_value, "manual", "")
        await self._commit()
        return await self.view(workspace_id, asset.id, today)

    async def update(
        self, workspace_id: uuid.UUID, asset_id: uuid.UUID, changes: AssetChanges, today: date
    ) -> AssetView:
        asset = await self._get(workspace_id, asset_id)
        if changes.linked_account_id is not UNSET and changes.linked_account_id is not None:
            await self._linked(workspace_id, changes.linked_account_id, asset.currency)
        if changes.name is not UNSET:
            await self._check_name(workspace_id, changes.name, asset.id)
        archived_at = asset.archived_at
        if changes.archived is True and archived_at is None:
            archived_at = self._clock()
        elif changes.archived is False:
            archived_at = None
        updated = replace(
            asset,
            name=asset.name if changes.name is UNSET else changes.name,
            category=asset.category if changes.category is UNSET else changes.category,
            purchase_date=asset.purchase_date
            if changes.purchase_date is UNSET
            else changes.purchase_date,
            purchase_cost=asset.purchase_cost
            if changes.purchase_cost is UNSET
            else changes.purchase_cost,
            linked_account_id=asset.linked_account_id
            if changes.linked_account_id is UNSET
            else changes.linked_account_id,
            include_in_net_worth=asset.include_in_net_worth
            if changes.include_in_net_worth is UNSET
            else changes.include_in_net_worth,
            notes=asset.notes if changes.notes is UNSET else changes.notes,
            archived_at=archived_at,
        )
        if updated != asset:
            try:
                await self._assets.save(replace(updated, updated_at=self._clock()))
            except ConflictError:
                await self._unit_of_work.rollback()
                raise _duplicate() from None
            await self._commit()
        return await self.view(workspace_id, asset_id, today)

    async def valuations(
        self, workspace_id: uuid.UUID, asset_id: uuid.UUID
    ) -> list[AssetValuation]:
        await self._get(workspace_id, asset_id)
        return await self._valuations.for_asset(workspace_id, asset_id)

    async def value(
        self,
        workspace_id: uuid.UUID,
        asset_id: uuid.UUID,
        valued_on: date,
        value: int,
        notes: str,
    ) -> AssetValuation:
        """Record what the asset was worth on a date, replacing any value already on it. Earlier
        values stay as history."""
        asset = await self._get(workspace_id, asset_id)
        stored = await self._put(asset, valued_on, value, "manual", notes)
        await self._commit()
        return stored

    async def delete_valuation(
        self, workspace_id: uuid.UUID, asset_id: uuid.UUID, valuation_id: uuid.UUID
    ) -> None:
        await self._get(workspace_id, asset_id)
        if not await self._valuations.delete(workspace_id, asset_id, valuation_id):
            raise ValuationNotFoundError
        await self._commit()

    async def _put(
        self,
        asset: Asset,
        valued_on: date,
        value: int,
        source: AssetValuationSource,
        notes: str,
    ) -> AssetValuation:
        return await self._valuations.put(
            AssetValuation(
                id=uuid.uuid4(),
                workspace_id=asset.workspace_id,
                asset_id=asset.id,
                valued_on=valued_on,
                value=value,
                source=source,
                notes=notes,
                created_at=self._clock(),
            )
        )

    async def _get(self, workspace_id: uuid.UUID, asset_id: uuid.UUID) -> Asset:
        asset = await self._assets.get(workspace_id, asset_id)
        if asset is None:
            raise AssetNotFoundError
        return asset

    async def _linked(self, workspace_id: uuid.UUID, account_id: uuid.UUID, currency: str) -> None:
        try:
            account = (await self._finance.account(workspace_id, account_id)).account
        except AccountNotFoundError:
            raise InvalidInvestmentError("That account doesn't exist in this workspace.") from None
        if account.currency != currency:
            raise InvalidInvestmentError(f"Link an account in {currency}.")

    async def _check_name(
        self, workspace_id: uuid.UUID, name: str, except_id: uuid.UUID | None
    ) -> None:
        for other in await self._assets.list(workspace_id):
            if other.id != except_id and other.name.casefold() == name.casefold():
                raise _duplicate()

    async def _commit(self) -> None:
        try:
            await self._unit_of_work.commit()
        except ConflictError:
            raise _duplicate() from None


def _duplicate() -> InvestmentConflictError:
    return InvestmentConflictError("You already track an asset with that name.")
