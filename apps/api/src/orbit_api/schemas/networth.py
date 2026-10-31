"""Other assets and net worth: assets with dated valuations, net worth on a date with every item
behind it, and monthly snapshots. Money is integer minor units, as in the rest of finance."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import Name, single_line
from orbit_api.schemas.finance import Month, Notes, TransactionDate
from orbit_api.schemas.investments import Value
from orbit_api.services.finance.money import DEFAULT_CURRENCY, Currency
from orbit_api.services.investments.models import (
    AssetCategory,
    AssetChanges,
    AssetDraft,
    AssetValuation,
    AssetValuationSource,
    AssetView,
    Freshness,
    ValueSource,
)
from orbit_api.services.networth.calculation import (
    GroupTotal,
    ItemKind,
    NetWorth,
    NetWorthGroup,
    NetWorthItem,
    Side,
)
from orbit_api.services.networth.service import PeriodChange, Snapshot, SnapshotSource
from orbit_api.utils.changes import UNSET

ValuationNotes = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=500), AfterValidator(single_line)
]


def _change(model: BaseModel, name: str) -> Any:
    return getattr(model, name) if name in model.model_fields_set else UNSET


# Assets


class AssetValuationResponse(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    valued_on: date
    value: int
    source: AssetValuationSource
    notes: str
    created_at: datetime

    @classmethod
    def of(cls, valuation: AssetValuation) -> "AssetValuationResponse":
        return cls(
            id=valuation.id,
            asset_id=valuation.asset_id,
            valued_on=valuation.valued_on,
            value=valuation.value,
            source=valuation.source,
            notes=valuation.notes,
            created_at=valuation.created_at,
        )


class AssetResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    category: AssetCategory
    currency: Currency
    purchase_date: date | None
    purchase_cost: int | None
    linked_account_id: uuid.UUID | None
    include_in_net_worth: bool
    notes: str
    archived: bool
    value: int = Field(description="The latest valuation, else the purchase cost, else 0.")
    valued_on: date | None
    latest_valuation: AssetValuationResponse | None
    freshness: Freshness = Field(
        description="`current`; `stale` when the latest valuation is over a year old; "
        "`missing` without one."
    )
    counted: bool = Field(description="Whether net worth counts it.")
    excluded_reason: str | None = Field(
        description="Why net worth leaves it out, such as being already counted in a linked "
        "account's balance."
    )
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, view: AssetView) -> "AssetResponse":
        asset = view.asset
        return cls(
            id=asset.id,
            workspace_id=asset.workspace_id,
            name=asset.name,
            category=asset.category,
            currency=asset.currency,
            purchase_date=asset.purchase_date,
            purchase_cost=asset.purchase_cost,
            linked_account_id=asset.linked_account_id,
            include_in_net_worth=asset.include_in_net_worth,
            notes=asset.notes,
            archived=asset.archived_at is not None,
            value=view.value,
            valued_on=view.valued_on,
            latest_valuation=AssetValuationResponse.of(view.latest) if view.latest else None,
            freshness=view.freshness,
            counted=view.counted,
            excluded_reason=view.excluded_reason,
            created_at=asset.created_at,
            updated_at=asset.updated_at,
        )


class AssetListResponse(BaseModel):
    assets: list[AssetResponse] = Field(description="Current first, then archived, by name.")


class CreateAssetRequest(BaseModel):
    """Track an asset valued by hand. `current_value` records its first valuation (on
    `valued_on`, default today). Names are unique per workspace."""

    model_config = ConfigDict(extra="forbid")

    name: Name
    category: AssetCategory
    currency: Currency = DEFAULT_CURRENCY
    purchase_date: TransactionDate | None = None
    purchase_cost: Value | None = None
    current_value: Value | None = None
    valued_on: TransactionDate | None = None
    linked_account_id: uuid.UUID | None = Field(
        default=None,
        description="A related account. An asset account (bank, cash, investment) means the "
        "asset is already counted in its balance, so net worth leaves the asset out.",
    )
    include_in_net_worth: bool = True
    notes: Notes = ""

    def to_draft(self) -> AssetDraft:
        return AssetDraft(
            name=self.name,
            category=self.category,
            currency=self.currency,
            purchase_date=self.purchase_date,
            purchase_cost=self.purchase_cost,
            current_value=self.current_value,
            valued_on=self.valued_on,
            linked_account_id=self.linked_account_id,
            include_in_net_worth=self.include_in_net_worth,
            notes=self.notes,
        )


class UpdateAssetRequest(BaseModel):
    """`null` clears the purchase details or the linked account. `archived: true` records it as
    sold or disposed of; it stays as history but isn't counted."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    category: AssetCategory | None = None
    purchase_date: TransactionDate | None = None
    purchase_cost: Value | None = None
    linked_account_id: uuid.UUID | None = None
    include_in_net_worth: bool | None = None
    notes: Notes | None = None
    archived: bool | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        for name in ("name", "category", "include_in_net_worth", "notes", "archived"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self

    def to_changes(self) -> AssetChanges:
        return AssetChanges(**{name: _change(self, name) for name in type(self).model_fields})


class RecordValuationRequest(BaseModel):
    """What the asset was worth on a date. A value already on that date is replaced."""

    model_config = ConfigDict(extra="forbid")

    valued_on: TransactionDate
    value: Value
    notes: ValuationNotes = ""


class AssetValuationListResponse(BaseModel):
    valuations: list[AssetValuationResponse] = Field(description="Newest first.")


# Net worth


class NetWorthItemResponse(BaseModel):
    kind: ItemKind
    id: uuid.UUID
    name: str
    group: NetWorthGroup
    side: Side
    value: int = Field(description="What it adds to its side: a value, or what is owed.")
    valued_on: date | None
    source: ValueSource = Field(
        description="`ledger` (account balance), `market` (latest price), `manual` (entered "
        "by hand), `estimate` (computed from assumptions), or `cost` (no valuation)."
    )
    freshness: Freshness
    counted: bool
    note: str | None

    @classmethod
    def of(cls, item: NetWorthItem) -> "NetWorthItemResponse":
        return cls(
            kind=item.kind,
            id=item.id,
            name=item.name,
            group=item.group,
            side=item.side,
            value=item.value,
            valued_on=item.valued_on,
            source=item.source,
            freshness=item.freshness,
            counted=item.counted,
            note=item.note,
        )


class GroupTotalResponse(BaseModel):
    key: NetWorthGroup
    label: str
    side: Side
    value: int

    @classmethod
    def of(cls, group: GroupTotal) -> "GroupTotalResponse":
        return cls(key=group.key, label=group.label, side=group.side, value=group.value)


class QualityResponse(BaseModel):
    estimated: int
    manual: int
    stale: int
    missing: int


class SnapshotResponse(BaseModel):
    id: uuid.UUID
    currency: Currency
    month: str = Field(description="`YYYY-MM`.")
    as_of: date
    assets: int
    liabilities: int
    net_worth: int
    groups: list[GroupTotalResponse]
    source: SnapshotSource = Field(
        description="`scheduled` (taken at month end), `manual` (the current month, saved by "
        "you), or `backfill` (a past month reconstructed later from history)."
    )
    quality: QualityResponse = Field(
        description="How many counted values were estimates, manual, stale, or missing."
    )
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, snapshot: Snapshot) -> "SnapshotResponse":
        return cls(
            id=snapshot.id,
            currency=snapshot.currency,
            month=f"{snapshot.period_start.year:04d}-{snapshot.period_start.month:02d}",
            as_of=snapshot.as_of,
            assets=snapshot.assets,
            liabilities=snapshot.liabilities,
            net_worth=snapshot.net_worth,
            groups=[GroupTotalResponse.of(group) for group in snapshot.groups],
            source=snapshot.source,
            quality=QualityResponse(
                estimated=snapshot.estimated_items,
                manual=snapshot.manual_items,
                stale=snapshot.stale_items,
                missing=snapshot.missing_items,
            ),
            created_at=snapshot.created_at,
            updated_at=snapshot.updated_at,
        )


class PeriodChangeResponse(BaseModel):
    months: int
    snapshot: SnapshotResponse | None = Field(
        description="That month's snapshot; `null` when none was taken."
    )
    change: int | None = Field(description="Net worth now minus then.")

    @classmethod
    def of(cls, change: PeriodChange) -> "PeriodChangeResponse":
        return cls(
            months=change.months,
            snapshot=SnapshotResponse.of(change.snapshot) if change.snapshot else None,
            change=change.change,
        )


class NetWorthResponse(BaseModel):
    currency: Currency
    currencies: list[Currency] = Field(
        description="Every currency with accounts or assets. Never added together."
    )
    as_of: date
    assets: int
    liabilities: int
    net_worth: int = Field(description="`assets - liabilities`.")
    groups: list[GroupTotalResponse]
    items: list[NetWorthItemResponse] = Field(
        description="Every account, holding, deposit, and asset behind the totals, including "
        "assets left out (`counted: false`)."
    )
    quality: QualityResponse
    changes: list[PeriodChangeResponse] = Field(
        description="Against the snapshots 1, 3, 6, and 12 months back."
    )

    @classmethod
    def of(
        cls, worth: NetWorth, currencies: list[Currency], changes: list[PeriodChange]
    ) -> "NetWorthResponse":
        return cls(
            currency=worth.currency,
            currencies=currencies,
            as_of=worth.as_of,
            assets=worth.assets,
            liabilities=worth.liabilities,
            net_worth=worth.net_worth,
            groups=[GroupTotalResponse.of(group) for group in worth.groups],
            items=[NetWorthItemResponse.of(item) for item in worth.items],
            quality=QualityResponse(
                estimated=worth.quality.estimated,
                manual=worth.quality.manual,
                stale=worth.quality.stale,
                missing=worth.quality.missing,
            ),
            changes=[PeriodChangeResponse.of(change) for change in changes],
        )


class NetWorthParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: Currency | None = Field(
        default=None, description="Defaults to the first currency with accounts or assets."
    )
    today: TransactionDate | None = None
    as_of: TransactionDate | None = Field(
        default=None, description="Value as of this date instead of today."
    )


class SnapshotListParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: Currency = DEFAULT_CURRENCY


class SnapshotListResponse(BaseModel):
    snapshots: list[SnapshotResponse] = Field(description="Oldest month first.")


class TakeSnapshotRequest(BaseModel):
    """Save a month's snapshot. Idempotent: a month that has one returns it (200) rather than
    adding another. `refresh` recomputes the current month's; past months can't be refreshed."""

    model_config = ConfigDict(extra="forbid")

    currency: Currency = DEFAULT_CURRENCY
    month: Month | None = Field(default=None, description="`YYYY-MM`; defaults to this month.")
    refresh: bool = False
    today: TransactionDate | None = None
