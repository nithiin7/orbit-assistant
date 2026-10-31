"""Investment accounts, holdings and prices, investment transactions, SIP plans, deposits, other
assets and their valuations, and net worth snapshots. Every query is filtered by workspace, so
callers cannot reach other workspaces' rows."""

import uuid
from collections.abc import Callable, Sequence
from datetime import date, datetime
from typing import Any, cast

from sqlalchemy import delete, func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    FinanceAccountModel,
    FinanceAssetModel,
    FinanceAssetValuationModel,
    FinanceDepositModel,
    FinanceHoldingModel,
    FinanceHoldingPriceModel,
    FinanceInvestmentAccountModel,
    FinanceInvestmentTransactionModel,
    FinanceNetWorthSnapshotModel,
    FinanceSipPlanModel,
)
from orbit_api.repositories.commitments import reminder_columns, reminder_of
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.commitments.schedule import Frequency
from orbit_api.services.finance.money import Currency
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.investments.assets import AssetService
from orbit_api.services.investments.deposits import Compounding
from orbit_api.services.investments.models import (
    Asset,
    AssetCategory,
    AssetValuation,
    AssetValuationSource,
    BuyPlan,
    Deposit,
    DepositKind,
    DepositStatus,
    Holding,
    HoldingKind,
    InvestmentAccountKind,
    InvestmentProfile,
    InvestmentTransaction,
    InvestmentTransactionPage,
    InvestmentTransactionQuery,
    InvestmentTransactionType,
    Price,
    PriceSource,
    Settlement,
    SipPlan,
    SipState,
)
from orbit_api.services.investments.service import InvestmentService
from orbit_api.services.networth.calculation import GROUPS, GroupTotal, NetWorthGroup
from orbit_api.services.networth.service import NetWorthService, Snapshot, SnapshotSource
from orbit_api.services.transactions import ConflictError

_Profile = FinanceInvestmentAccountModel
_Holding = FinanceHoldingModel
_Price = FinanceHoldingPriceModel
_Tx = FinanceInvestmentTransactionModel
_Sip = FinanceSipPlanModel
_Deposit = FinanceDepositModel
_Asset = FinanceAssetModel
_Valuation = FinanceAssetValuationModel
_Snapshot = FinanceNetWorthSnapshotModel

# The tables' CHECK constraints limit the enumerated columns to these values.


def _to_profile(model: FinanceInvestmentAccountModel) -> InvestmentProfile:
    return InvestmentProfile(
        account_id=model.account_id,
        workspace_id=model.workspace_id,
        currency=cast(Currency, model.currency),
        kind=cast(InvestmentAccountKind, model.kind),
        provider=model.provider,
        linked_account_id=model.linked_account_id,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_holding(model: FinanceHoldingModel) -> Holding:
    return Holding(
        id=model.id,
        workspace_id=model.workspace_id,
        account_id=model.account_id,
        currency=cast(Currency, model.currency),
        kind=cast(HoldingKind, model.kind),
        name=model.name,
        symbol=model.symbol,
        exchange=model.exchange,
        isin=model.isin,
        issuer=model.issuer,
        category=model.category,
        folio=model.folio,
        notes=model.notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _holding_fields(holding: Holding) -> dict[str, Any]:
    return {
        "name": holding.name,
        "symbol": holding.symbol,
        "exchange": holding.exchange,
        "isin": holding.isin,
        "issuer": holding.issuer,
        "category": holding.category,
        "folio": holding.folio,
        "identity": holding.identity,
        "notes": holding.notes,
        "updated_at": holding.updated_at,
    }


def _to_price(model: FinanceHoldingPriceModel) -> Price:
    return Price(
        id=model.id,
        workspace_id=model.workspace_id,
        holding_id=model.holding_id,
        price_date=model.price_date,
        price=model.price,
        source=cast(PriceSource, model.source),
        created_at=model.created_at,
    )


def _to_transaction(model: FinanceInvestmentTransactionModel) -> InvestmentTransaction:
    return InvestmentTransaction(
        id=model.id,
        workspace_id=model.workspace_id,
        account_id=model.account_id,
        currency=cast(Currency, model.currency),
        type=cast(InvestmentTransactionType, model.type),
        trade_date=model.trade_date,
        amount=model.amount,
        fees=model.fees,
        holding_id=model.holding_id,
        deposit_id=model.deposit_id,
        sip_plan_id=model.sip_plan_id,
        sip_due_date=model.sip_due_date,
        quantity=model.quantity,
        plan=cast(BuyPlan | None, model.plan),
        settlement=cast(Settlement, model.settlement),
        cash_account_id=model.cash_account_id,
        cash_transaction_id=model.cash_transaction_id,
        fee_transaction_id=model.fee_transaction_id,
        notes=model.notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_sip(model: FinanceSipPlanModel) -> SipPlan:
    return SipPlan(
        id=model.id,
        workspace_id=model.workspace_id,
        holding_id=model.holding_id,
        currency=cast(Currency, model.currency),
        amount=model.amount,
        frequency=cast(Frequency, model.frequency),
        anchor_date=model.anchor_date,
        end_date=model.end_date,
        funding_account_id=model.funding_account_id,
        state=cast(SipState, model.state),
        notes=model.notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _sip_fields(plan: SipPlan) -> dict[str, Any]:
    return {
        "amount": plan.amount,
        "frequency": plan.frequency,
        "anchor_date": plan.anchor_date,
        "end_date": plan.end_date,
        "funding_account_id": plan.funding_account_id,
        "state": plan.state,
        "notes": plan.notes,
        "updated_at": plan.updated_at,
    }


def _to_deposit(model: FinanceDepositModel) -> Deposit:
    return Deposit(
        id=model.id,
        workspace_id=model.workspace_id,
        account_id=model.account_id,
        currency=cast(Currency, model.currency),
        kind=cast(DepositKind, model.kind),
        name=model.name,
        institution=model.institution,
        interest_rate_bps=model.interest_rate_bps,
        compounding=cast(Compounding, model.compounding),
        start_date=model.start_date,
        maturity_date=model.maturity_date,
        installment_amount=model.installment_amount,
        stated_maturity_amount=model.stated_maturity_amount,
        status=cast(DepositStatus, model.status),
        closed_on=model.closed_on,
        manual_value=model.manual_value,
        manual_valued_on=model.manual_valued_on,
        reminder=reminder_of(model),
        notes=model.notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _deposit_fields(deposit: Deposit) -> dict[str, Any]:
    return {
        "name": deposit.name,
        "institution": deposit.institution,
        "interest_rate_bps": deposit.interest_rate_bps,
        "compounding": deposit.compounding,
        "maturity_date": deposit.maturity_date,
        "installment_amount": deposit.installment_amount,
        "stated_maturity_amount": deposit.stated_maturity_amount,
        "status": deposit.status,
        "closed_on": deposit.closed_on,
        "manual_value": deposit.manual_value,
        "manual_valued_on": deposit.manual_valued_on,
        "notes": deposit.notes,
        "updated_at": deposit.updated_at,
        **reminder_columns(deposit.reminder),
    }


def _to_asset(model: FinanceAssetModel) -> Asset:
    return Asset(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        category=cast(AssetCategory, model.category),
        currency=cast(Currency, model.currency),
        purchase_date=model.purchase_date,
        purchase_cost=model.purchase_cost,
        linked_account_id=model.linked_account_id,
        include_in_net_worth=model.include_in_net_worth,
        notes=model.notes,
        archived_at=model.archived_at,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _asset_fields(asset: Asset) -> dict[str, Any]:
    return {
        "name": asset.name,
        "category": asset.category,
        "purchase_date": asset.purchase_date,
        "purchase_cost": asset.purchase_cost,
        "linked_account_id": asset.linked_account_id,
        "include_in_net_worth": asset.include_in_net_worth,
        "notes": asset.notes,
        "archived_at": asset.archived_at,
        "updated_at": asset.updated_at,
    }


def _to_valuation(model: FinanceAssetValuationModel) -> AssetValuation:
    return AssetValuation(
        id=model.id,
        workspace_id=model.workspace_id,
        asset_id=model.asset_id,
        valued_on=model.valued_on,
        value=model.value,
        source=cast(AssetValuationSource, model.source),
        notes=model.notes,
        created_at=model.created_at,
    )


def _to_snapshot(model: FinanceNetWorthSnapshotModel) -> Snapshot:
    return Snapshot(
        id=model.id,
        workspace_id=model.workspace_id,
        currency=cast(Currency, model.currency),
        period_start=model.period_start,
        as_of=model.as_of,
        assets=model.assets,
        liabilities=model.liabilities,
        groups=[_group_of(entry) for entry in model.groups if entry.get("key") in GROUPS],
        source=cast(SnapshotSource, model.source),
        estimated_items=model.estimated_items,
        manual_items=model.manual_items,
        stale_items=model.stale_items,
        missing_items=model.missing_items,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _group_of(entry: dict[str, Any]) -> GroupTotal:
    key = cast(NetWorthGroup, entry["key"])
    label, side = GROUPS[key]
    return GroupTotal(key=key, label=label, side=side, value=int(entry["value"]))


def _snapshot_fields(snapshot: Snapshot) -> dict[str, Any]:
    return {
        "as_of": snapshot.as_of,
        "assets": snapshot.assets,
        "liabilities": snapshot.liabilities,
        "net_worth": snapshot.net_worth,
        "groups": [{"key": group.key, "value": group.value} for group in snapshot.groups],
        "source": snapshot.source,
        "estimated_items": snapshot.estimated_items,
        "manual_items": snapshot.manual_items,
        "stale_items": snapshot.stale_items,
        "missing_items": snapshot.missing_items,
        "updated_at": snapshot.updated_at,
    }


class SqlProfileRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, profile: InvestmentProfile) -> None:
        self._session.add(
            _Profile(
                account_id=profile.account_id,
                workspace_id=profile.workspace_id,
                currency=profile.currency,
                kind=profile.kind,
                provider=profile.provider,
                linked_account_id=profile.linked_account_id,
                created_at=profile.created_at,
                updated_at=profile.updated_at,
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, account_id: uuid.UUID) -> InvestmentProfile | None:
        model = await self._model(workspace_id, account_id)
        return _to_profile(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[InvestmentProfile]:
        models = await self._session.scalars(
            select(_Profile)
            .join(FinanceAccountModel, FinanceAccountModel.id == _Profile.account_id)
            .where(_Profile.workspace_id == workspace_id)
            .order_by(
                FinanceAccountModel.archived_at.is_not(None),
                FinanceAccountModel.name,
                _Profile.account_id,
            )
        )
        return [_to_profile(model) for model in models]

    async def save(self, profile: InvestmentProfile) -> None:
        model = await self._model(profile.workspace_id, profile.account_id)
        if model is None:
            return
        model.kind = profile.kind
        model.provider = profile.provider
        model.linked_account_id = profile.linked_account_id
        model.updated_at = profile.updated_at
        await flush(self._session)

    async def _model(
        self, workspace_id: uuid.UUID, account_id: uuid.UUID
    ) -> FinanceInvestmentAccountModel | None:
        return await self._session.scalar(
            select(_Profile).where(
                _Profile.account_id == account_id, _Profile.workspace_id == workspace_id
            )
        )


class SqlHoldingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, holding: Holding) -> None:
        self._session.add(
            _Holding(
                id=holding.id,
                workspace_id=holding.workspace_id,
                account_id=holding.account_id,
                currency=holding.currency,
                kind=holding.kind,
                created_at=holding.created_at,
                **_holding_fields(holding),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> Holding | None:
        model = await self._model(workspace_id, holding_id)
        return _to_holding(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[Holding]:
        models = await self._session.scalars(
            select(_Holding)
            .where(_Holding.workspace_id == workspace_id)
            .order_by(_Holding.name, _Holding.id)
        )
        return [_to_holding(model) for model in models]

    async def save(self, holding: Holding) -> None:
        model = await self._model(holding.workspace_id, holding.id)
        if model is None:
            return
        for name, value in _holding_fields(holding).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(_Holding).where(_Holding.id == holding_id, _Holding.workspace_id == workspace_id)
        )
        await flush(self._session)

    async def _model(
        self, workspace_id: uuid.UUID, holding_id: uuid.UUID
    ) -> FinanceHoldingModel | None:
        return await self._session.scalar(
            select(_Holding).where(_Holding.id == holding_id, _Holding.workspace_id == workspace_id)
        )


class SqlPriceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def put(self, price: Price) -> Price:
        model = await self._session.scalar(
            select(_Price).where(
                _Price.workspace_id == price.workspace_id,
                _Price.holding_id == price.holding_id,
                _Price.price_date == price.price_date,
            )
        )
        if model is None:
            holding = await self._session.scalar(
                select(_Holding.currency).where(
                    _Holding.id == price.holding_id, _Holding.workspace_id == price.workspace_id
                )
            )
            model = _Price(
                id=price.id,
                workspace_id=price.workspace_id,
                holding_id=price.holding_id,
                currency=holding,
                price_date=price.price_date,
                price=price.price,
                source=price.source,
                created_at=price.created_at,
            )
            self._session.add(model)
        else:
            model.price = price.price
            model.source = price.source
            model.created_at = price.created_at
        await flush(self._session)
        return _to_price(model)

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[Price]:
        models = await self._session.scalars(
            select(_Price).where(_Price.workspace_id == workspace_id)
        )
        return [_to_price(model) for model in models]

    async def for_holding(self, workspace_id: uuid.UUID, holding_id: uuid.UUID) -> list[Price]:
        models = await self._session.scalars(
            select(_Price)
            .where(_Price.workspace_id == workspace_id, _Price.holding_id == holding_id)
            .order_by(_Price.price_date.desc())
        )
        return [_to_price(model) for model in models]

    async def delete(
        self, workspace_id: uuid.UUID, holding_id: uuid.UUID, price_id: uuid.UUID
    ) -> bool:
        result = await self._session.execute(
            delete(_Price).where(
                _Price.id == price_id,
                _Price.holding_id == holding_id,
                _Price.workspace_id == workspace_id,
            )
        )
        await flush(self._session)
        return bool(getattr(result, "rowcount", 0))


class SqlInvestmentTransactionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, transaction: InvestmentTransaction) -> None:
        self._session.add(
            _Tx(
                id=transaction.id,
                workspace_id=transaction.workspace_id,
                account_id=transaction.account_id,
                currency=transaction.currency,
                type=transaction.type,
                trade_date=transaction.trade_date,
                amount=transaction.amount,
                fees=transaction.fees,
                holding_id=transaction.holding_id,
                deposit_id=transaction.deposit_id,
                sip_plan_id=transaction.sip_plan_id,
                sip_due_date=transaction.sip_due_date,
                quantity=transaction.quantity,
                plan=transaction.plan,
                settlement=transaction.settlement,
                cash_account_id=transaction.cash_account_id,
                cash_transaction_id=transaction.cash_transaction_id,
                fee_transaction_id=transaction.fee_transaction_id,
                notes=transaction.notes,
                created_at=transaction.created_at,
                updated_at=transaction.updated_at,
            )
        )
        await flush(self._session)

    async def get(
        self, workspace_id: uuid.UUID, transaction_id: uuid.UUID
    ) -> InvestmentTransaction | None:
        model = await self._session.scalar(
            select(_Tx).where(_Tx.id == transaction_id, _Tx.workspace_id == workspace_id)
        )
        return _to_transaction(model) if model else None

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[InvestmentTransaction]:
        models = await self._session.scalars(
            select(_Tx)
            .where(_Tx.workspace_id == workspace_id)
            .order_by(_Tx.trade_date, _Tx.created_at, _Tx.id)
        )
        return [_to_transaction(model) for model in models]

    async def find(
        self, workspace_id: uuid.UUID, query: InvestmentTransactionQuery
    ) -> InvestmentTransactionPage:
        conditions = [_Tx.workspace_id == workspace_id]
        if query.account_id is not None:
            conditions.append(_Tx.account_id == query.account_id)
        if query.holding_id is not None:
            conditions.append(_Tx.holding_id == query.holding_id)
        if query.deposit_id is not None:
            conditions.append(_Tx.deposit_id == query.deposit_id)
        if query.types:
            conditions.append(_Tx.type.in_(sorted(query.types)))
        if query.date_from is not None:
            conditions.append(_Tx.trade_date >= query.date_from)
        if query.date_to is not None:
            conditions.append(_Tx.trade_date <= query.date_to)
        total = await self._session.scalar(select(func.count()).select_from(_Tx).where(*conditions))
        models = await self._session.scalars(
            select(_Tx)
            .where(*conditions)
            .order_by(_Tx.trade_date.desc(), _Tx.created_at.desc(), _Tx.id)
            .limit(query.limit)
            .offset(query.offset)
        )
        return InvestmentTransactionPage(
            transactions=[_to_transaction(model) for model in models], total=int(total or 0)
        )

    async def delete(self, workspace_id: uuid.UUID, transaction_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(_Tx).where(_Tx.id == transaction_id, _Tx.workspace_id == workspace_id)
        )
        await flush(self._session)


class SqlSipPlanRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, plan: SipPlan) -> None:
        self._session.add(
            _Sip(
                id=plan.id,
                workspace_id=plan.workspace_id,
                holding_id=plan.holding_id,
                currency=plan.currency,
                created_at=plan.created_at,
                **_sip_fields(plan),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, plan_id: uuid.UUID) -> SipPlan | None:
        model = await self._model(workspace_id, plan_id)
        return _to_sip(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[SipPlan]:
        models = await self._session.scalars(
            select(_Sip)
            .where(_Sip.workspace_id == workspace_id)
            .order_by(_Sip.state != "active", _Sip.anchor_date, _Sip.id)
        )
        return [_to_sip(model) for model in models]

    async def save(self, plan: SipPlan) -> None:
        model = await self._model(plan.workspace_id, plan.id)
        if model is None:
            return
        for name, value in _sip_fields(plan).items():
            setattr(model, name, value)
        await flush(self._session)

    async def _model(
        self, workspace_id: uuid.UUID, plan_id: uuid.UUID
    ) -> FinanceSipPlanModel | None:
        return await self._session.scalar(
            select(_Sip).where(_Sip.id == plan_id, _Sip.workspace_id == workspace_id)
        )


class SqlDepositRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, deposit: Deposit) -> None:
        self._session.add(
            _Deposit(
                id=deposit.id,
                workspace_id=deposit.workspace_id,
                account_id=deposit.account_id,
                currency=deposit.currency,
                kind=deposit.kind,
                start_date=deposit.start_date,
                created_at=deposit.created_at,
                **_deposit_fields(deposit),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, deposit_id: uuid.UUID) -> Deposit | None:
        model = await self._model(workspace_id, deposit_id)
        return _to_deposit(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[Deposit]:
        models = await self._session.scalars(
            select(_Deposit)
            .where(_Deposit.workspace_id == workspace_id)
            .order_by(_Deposit.status != "active", _Deposit.maturity_date, _Deposit.id)
        )
        return [_to_deposit(model) for model in models]

    async def save(self, deposit: Deposit) -> None:
        model = await self._model(deposit.workspace_id, deposit.id)
        if model is None:
            return
        for name, value in _deposit_fields(deposit).items():
            setattr(model, name, value)
        await flush(self._session)

    async def _model(
        self, workspace_id: uuid.UUID, deposit_id: uuid.UUID
    ) -> FinanceDepositModel | None:
        return await self._session.scalar(
            select(_Deposit).where(_Deposit.id == deposit_id, _Deposit.workspace_id == workspace_id)
        )


class SqlAssetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, asset: Asset) -> None:
        self._session.add(
            _Asset(
                id=asset.id,
                workspace_id=asset.workspace_id,
                currency=asset.currency,
                created_at=asset.created_at,
                **_asset_fields(asset),
            )
        )
        await flush(self._session)

    async def get(self, workspace_id: uuid.UUID, asset_id: uuid.UUID) -> Asset | None:
        model = await self._model(workspace_id, asset_id)
        return _to_asset(model) if model else None

    async def list(self, workspace_id: uuid.UUID) -> list[Asset]:
        models = await self._session.scalars(
            select(_Asset)
            .where(_Asset.workspace_id == workspace_id)
            .order_by(_Asset.archived_at.is_not(None), _Asset.name, _Asset.id)
        )
        return [_to_asset(model) for model in models]

    async def save(self, asset: Asset) -> None:
        model = await self._model(asset.workspace_id, asset.id)
        if model is None:
            return
        for name, value in _asset_fields(asset).items():
            setattr(model, name, value)
        await flush(self._session)

    async def _model(
        self, workspace_id: uuid.UUID, asset_id: uuid.UUID
    ) -> FinanceAssetModel | None:
        return await self._session.scalar(
            select(_Asset).where(_Asset.id == asset_id, _Asset.workspace_id == workspace_id)
        )


class SqlValuationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def put(self, valuation: AssetValuation) -> AssetValuation:
        model = await self._session.scalar(
            select(_Valuation).where(
                _Valuation.workspace_id == valuation.workspace_id,
                _Valuation.asset_id == valuation.asset_id,
                _Valuation.valued_on == valuation.valued_on,
            )
        )
        if model is None:
            model = _Valuation(
                id=valuation.id,
                workspace_id=valuation.workspace_id,
                asset_id=valuation.asset_id,
                valued_on=valuation.valued_on,
                value=valuation.value,
                source=valuation.source,
                notes=valuation.notes,
                created_at=valuation.created_at,
            )
            self._session.add(model)
        else:
            model.value = valuation.value
            model.source = valuation.source
            model.notes = valuation.notes
            model.created_at = valuation.created_at
        await flush(self._session)
        return _to_valuation(model)

    async def for_workspace(self, workspace_id: uuid.UUID) -> list[AssetValuation]:
        models = await self._session.scalars(
            select(_Valuation).where(_Valuation.workspace_id == workspace_id)
        )
        return [_to_valuation(model) for model in models]

    async def for_asset(self, workspace_id: uuid.UUID, asset_id: uuid.UUID) -> list[AssetValuation]:
        models = await self._session.scalars(
            select(_Valuation)
            .where(_Valuation.workspace_id == workspace_id, _Valuation.asset_id == asset_id)
            .order_by(_Valuation.valued_on.desc())
        )
        return [_to_valuation(model) for model in models]

    async def delete(
        self, workspace_id: uuid.UUID, asset_id: uuid.UUID, valuation_id: uuid.UUID
    ) -> bool:
        result = await self._session.execute(
            delete(_Valuation).where(
                _Valuation.id == valuation_id,
                _Valuation.asset_id == asset_id,
                _Valuation.workspace_id == workspace_id,
            )
        )
        await flush(self._session)
        return bool(getattr(result, "rowcount", 0))


class SqlSnapshotRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, snapshot: Snapshot) -> None:
        self._session.add(
            _Snapshot(
                id=snapshot.id,
                workspace_id=snapshot.workspace_id,
                currency=snapshot.currency,
                period_start=snapshot.period_start,
                created_at=snapshot.created_at,
                **_snapshot_fields(snapshot),
            )
        )
        await flush(self._session)

    async def get(
        self, workspace_id: uuid.UUID, currency: Currency, period_start: date
    ) -> Snapshot | None:
        model = await self._model(workspace_id, currency, period_start)
        return _to_snapshot(model) if model else None

    async def list(self, workspace_id: uuid.UUID, currency: Currency) -> list[Snapshot]:
        models = await self._session.scalars(
            select(_Snapshot)
            .where(_Snapshot.workspace_id == workspace_id, _Snapshot.currency == currency)
            .order_by(_Snapshot.period_start)
        )
        return [_to_snapshot(model) for model in models]

    async def save(self, snapshot: Snapshot) -> None:
        model = await self._model(snapshot.workspace_id, snapshot.currency, snapshot.period_start)
        if model is None:
            raise ConflictError
        for name, value in _snapshot_fields(snapshot).items():
            setattr(model, name, value)
        await flush(self._session)

    async def workspaces_with_finance(self) -> Sequence[uuid.UUID]:
        rows = await self._session.scalars(
            union(
                select(FinanceAccountModel.workspace_id),
                select(_Asset.workspace_id),
            )
        )
        return sorted(rows)

    async def _model(
        self, workspace_id: uuid.UUID, currency: Currency, period_start: date
    ) -> FinanceNetWorthSnapshotModel | None:
        return await self._session.scalar(
            select(_Snapshot).where(
                _Snapshot.workspace_id == workspace_id,
                _Snapshot.currency == currency,
                _Snapshot.period_start == period_start,
            )
        )


def _finance(session: AsyncSession, timing: dict[str, Any]) -> FinanceService:
    return FinanceService(
        SqlFinanceAccountRepository(session),
        SqlFinanceCategoryRepository(session),
        SqlFinanceTransactionRepository(session),
        SqlTransaction(session),
        **timing,
    )


def build_investment_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> InvestmentService:
    """An investment service whose ledger rows, reminders, and records share `session`'s
    transaction, so each operation commits once."""
    timing: dict[str, Any] = {"clock": clock} if clock else {}
    return InvestmentService(
        SqlProfileRepository(session),
        SqlHoldingRepository(session),
        SqlPriceRepository(session),
        SqlInvestmentTransactionRepository(session),
        SqlSipPlanRepository(session),
        SqlDepositRepository(session),
        _finance(session, timing),
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        SqlTransaction(session),
        **timing,
    )


def build_asset_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> AssetService:
    timing: dict[str, Any] = {"clock": clock} if clock else {}
    return AssetService(
        SqlAssetRepository(session),
        SqlValuationRepository(session),
        _finance(session, timing),
        SqlTransaction(session),
        **timing,
    )


def build_net_worth_service(
    session: AsyncSession, clock: Callable[[], datetime] | None = None
) -> NetWorthService:
    timing: dict[str, Any] = {"clock": clock} if clock else {}
    return NetWorthService(
        build_investment_service(session, clock),
        build_asset_service(session, clock),
        _finance(session, timing),
        SqlSnapshotRepository(session),
        SqlTransaction(session),
        **timing,
    )
