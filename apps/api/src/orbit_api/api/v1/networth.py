"""Other assets and net worth in a workspace: assets with dated valuations, net worth on a date,
and monthly snapshots. Every route authorizes the workspace through `WorkspaceDep` first.

Values are personal data, so routes log nothing about them.
"""

import uuid
from collections.abc import Awaitable
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import AssetServiceDep, NetWorthServiceDep
from orbit_api.api.v1.commitments import local_today
from orbit_api.schemas.commitments import TodayParams
from orbit_api.schemas.finance import parse_month
from orbit_api.schemas.networth import (
    AssetListResponse,
    AssetResponse,
    AssetValuationListResponse,
    AssetValuationResponse,
    CreateAssetRequest,
    NetWorthParams,
    NetWorthResponse,
    RecordValuationRequest,
    SnapshotListParams,
    SnapshotListResponse,
    SnapshotResponse,
    TakeSnapshotRequest,
    UpdateAssetRequest,
)
from orbit_api.services.finance.money import DEFAULT_CURRENCY
from orbit_api.services.investments.models import (
    AssetNotFoundError,
    InvalidInvestmentError,
    InvestmentConflictError,
    ValuationNotFoundError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance",
    tags=["finance net worth"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace, asset, or valuation does not exist."},
    },
)

AssetId = Annotated[uuid.UUID, Path(description="The asset's ID.")]

_RULES: dict[int | str, dict[str, Any]] = {
    409: {"description": "An asset with that name exists, or a past snapshot can't change."},
    422: {"description": "Invalid input, or a linked account outside this workspace."},
}


async def _call[T](call: Awaitable[T]) -> T:
    try:
        return await call
    except InvalidInvestmentError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message) from None
    except InvestmentConflictError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, error.message) from None
    except AssetNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found.") from None
    except ValuationNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Valuation not found.") from None


# Assets


@router.get("/assets", summary="List other assets")
async def list_assets(
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    assets: AssetServiceDep,
) -> AssetListResponse:
    views = await assets.views(workspace.id, local_today(user, params.today))
    return AssetListResponse(assets=[AssetResponse.of(view) for view in views])


@router.post(
    "/assets", status_code=status.HTTP_201_CREATED, summary="Track an asset", responses=_RULES
)
async def create_asset(
    body: CreateAssetRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    assets: AssetServiceDep,
) -> AssetResponse:
    view = await _call(assets.create(workspace.id, body.to_draft(), local_today(user, None)))
    return AssetResponse.of(view)


@router.get("/assets/{asset_id}", summary="Get an asset")
async def get_asset(
    asset_id: AssetId,
    params: Annotated[TodayParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    assets: AssetServiceDep,
) -> AssetResponse:
    view = await _call(assets.view(workspace.id, asset_id, local_today(user, params.today)))
    return AssetResponse.of(view)


@router.patch("/assets/{asset_id}", summary="Update or archive an asset", responses=_RULES)
async def update_asset(
    asset_id: AssetId,
    body: UpdateAssetRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    assets: AssetServiceDep,
) -> AssetResponse:
    view = await _call(
        assets.update(workspace.id, asset_id, body.to_changes(), local_today(user, None))
    )
    return AssetResponse.of(view)


@router.get("/assets/{asset_id}/valuations", summary="An asset's valuation history")
async def list_valuations(
    asset_id: AssetId, workspace: WorkspaceDep, assets: AssetServiceDep
) -> AssetValuationListResponse:
    valuations = await _call(assets.valuations(workspace.id, asset_id))
    return AssetValuationListResponse(
        valuations=[AssetValuationResponse.of(entry) for entry in valuations]
    )


@router.post("/assets/{asset_id}/valuations", summary="Record a valuation", responses=_RULES)
async def record_valuation(
    asset_id: AssetId,
    body: RecordValuationRequest,
    workspace: WorkspaceDep,
    assets: AssetServiceDep,
) -> AssetValuationResponse:
    """Replaces any valuation already on that date; earlier ones stay as history."""
    valuation = await _call(
        assets.value(workspace.id, asset_id, body.valued_on, body.value, body.notes)
    )
    return AssetValuationResponse.of(valuation)


@router.delete(
    "/assets/{asset_id}/valuations/{valuation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a valuation",
)
async def delete_valuation(
    asset_id: AssetId,
    valuation_id: Annotated[uuid.UUID, Path()],
    workspace: WorkspaceDep,
    assets: AssetServiceDep,
) -> Response:
    await _call(assets.delete_valuation(workspace.id, asset_id, valuation_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Net worth


@router.get("/net-worth", summary="Net worth")
async def net_worth(
    params: Annotated[NetWorthParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    service: NetWorthServiceDep,
) -> NetWorthResponse:
    """Total assets minus total liabilities in one currency, with every item behind them, its
    valuation date and source, and changes since earlier snapshots."""
    today = local_today(user, params.today)
    currencies = await service.currencies(workspace.id)
    currency = params.currency or (currencies[0] if currencies else DEFAULT_CURRENCY)
    worth = await service.net_worth(workspace.id, currency, params.as_of or today)
    changes = await service.changes(workspace.id, worth, today)
    return NetWorthResponse.of(worth, currencies, changes)


@router.get("/net-worth/snapshots", summary="Net worth history")
async def list_snapshots(
    params: Annotated[SnapshotListParams, Query()],
    workspace: WorkspaceDep,
    service: NetWorthServiceDep,
) -> SnapshotListResponse:
    snapshots = await service.snapshots(workspace.id, params.currency)
    return SnapshotListResponse(snapshots=[SnapshotResponse.of(entry) for entry in snapshots])


@router.post(
    "/net-worth/snapshots",
    summary="Save a month's net worth snapshot",
    responses={201: {"description": "Created or refreshed."}, **_RULES},
)
async def take_snapshot(
    body: TakeSnapshotRequest,
    response: Response,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    service: NetWorthServiceDep,
) -> SnapshotResponse:
    """Idempotent: a month with a snapshot returns it with 200 instead of adding another."""
    today = local_today(user, body.today)
    month = parse_month(body.month) if body.month else today.replace(day=1)
    snapshot, created = await _call(
        service.take_snapshot(workspace.id, body.currency, month, today, refresh=body.refresh)
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return SnapshotResponse.of(snapshot)
