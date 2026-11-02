"""The AI layer: per-person settings, providers, and usage under `/me/ai`, and the assistant,
contextual features, semantic search, insights, and index under each workspace.

Everything workspace-scoped is authorized by `WorkspaceDep`, and conversations, proposals, and
dismissals are also scoped to the signed-in person. Settings decide what AI may read before
anything is read; API keys are accepted and never returned.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator, Generator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import AiServicesDep, WorkspaceServiceDep, build_ai_for
from orbit_api.schemas.ai import (
    AiAssistRequest,
    AiAssistResponse,
    AiCitationResponse,
    AiConnectionTestResponse,
    AiConversationDetailResponse,
    AiConversationListResponse,
    AiConversationResponse,
    AiIndexActionResponse,
    AiIndexResponse,
    AiInsightListResponse,
    AiInsightResponse,
    AiMessageResponse,
    AiModelListResponse,
    AiProposalResponse,
    AiProviderListResponse,
    AiProviderResponse,
    AiSearchMatchResponse,
    AiSearchParams,
    AiSearchResponse,
    AiSettingsResponse,
    AiStreamDone,
    AiTimezoneParams,
    AiTurnStarted,
    AiUsageParams,
    AiUsageResponse,
    CreateAiProviderRequest,
    DismissAiInsightRequest,
    RenameAiConversationRequest,
    SendAiMessageRequest,
    TestAiProviderRequest,
    UpdateAiProviderRequest,
    UpdateAiSettingsRequest,
)
from orbit_api.services.ai.assist import AssistRequest
from orbit_api.services.ai.assistant import (
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    SourcesEvent,
    Turn,
    viewer_for,
)
from orbit_api.services.ai.configuration import ProviderChanges, ProviderDraft, SettingsChanges
from orbit_api.services.ai.indexing import permitted_types
from orbit_api.services.ai.models import (
    AiDisabledError,
    AiNotConfiguredError,
    CloudProcessingNotAllowedError,
    ConversationNotFoundError,
    CredentialsUnavailableError,
    EndpointNotAllowedError,
    ModuleNotPermittedError,
    ProposalNotFoundError,
    ProposalNotPendingError,
    ProviderNameTakenError,
    ProviderNotFoundError,
    SourceNotFoundError,
    UsageLimitReachedError,
)
from orbit_api.services.ai.providers import (
    ProviderError,
    ProviderRequestError,
    UnsupportedCapabilityError,
)
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

logger = logging.getLogger(__name__)

_RESPONSES: dict[int | str, dict[str, str]] = {401: {"description": "Not signed in."}}
me_router = APIRouter(prefix="/me/ai", tags=["ai"], responses=_RESPONSES)
router = APIRouter(
    prefix="/workspaces/{workspace_id}/ai",
    tags=["ai"],
    responses={
        **_RESPONSES,
        404: {"description": "The workspace (or record) does not exist or is not accessible."},
    },
)


@contextmanager
def _errors() -> Generator[None]:
    """Map the AI layer's errors to safe HTTP errors. Provider messages never contain keys."""
    try:
        yield
    except AiDisabledError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "AI is turned off. Turn it on in Settings → AI."
        ) from None
    except AiNotConfiguredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, exc.message) from None
    except CloudProcessingNotAllowedError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The selected provider runs in the cloud. Allow cloud processing in Settings → AI, "
            "or choose a local provider.",
        ) from None
    except ModuleNotPermittedError as exc:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"AI isn't allowed to read {exc.module}. Change it in Settings → AI.",
        ) from None
    except UsageLimitReachedError:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "This month's AI token limit has been reached."
        ) from None
    except ProviderNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found.") from None
    except ProviderNameTakenError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Another provider has that name.") from None
    except CredentialsUnavailableError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This server can't store or read API keys. Set ORBIT_AI_SECRET_KEY, then enter the "
            "key again.",
        ) from None
    except EndpointNotAllowedError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except ConversationNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.") from None
    except ProposalNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found.") from None
    except ProposalNotPendingError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This proposal was already handled."
        ) from None
    except SourceNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That record wasn't found.") from None
    except (UnsupportedCapabilityError, ProviderRequestError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.message) from None
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, exc.message) from None


def _zone(requested: str | None, profile: str | None) -> str:
    return requested or profile or "UTC"


# Settings


@me_router.get("/settings", summary="Get AI settings")
async def get_settings(user: CurrentUserDep, ai: AiServicesDep) -> AiSettingsResponse:
    settings = await ai.config.settings(user.id)
    return AiSettingsResponse.of(settings, ai.config.server_enabled)


@me_router.patch("/settings", summary="Update AI settings")
async def update_settings(
    body: UpdateAiSettingsRequest,
    user: CurrentUserDep,
    ai: AiServicesDep,
    workspaces: WorkspaceServiceDep,
) -> AiSettingsResponse:
    """Switching a module off removes its records from the index of every workspace at once."""
    provided = body.model_fields_set
    changes = SettingsChanges(
        enabled=body.enabled if body.enabled is not None else UNSET,
        chat_provider_id=body.chat_provider_id if "chat_provider_id" in provided else UNSET,
        chat_model=body.chat_model if "chat_model" in provided else UNSET,
        embedding_provider_id=body.embedding_provider_id
        if "embedding_provider_id" in provided
        else UNSET,
        embedding_model=body.embedding_model if "embedding_model" in provided else UNSET,
        fallback_provider_id=body.fallback_provider_id
        if "fallback_provider_id" in provided
        else UNSET,
        fallback_model=body.fallback_model if "fallback_model" in provided else UNSET,
        allow_cloud=body.allow_cloud if body.allow_cloud is not None else UNSET,
        modules=frozenset(body.modules) if body.modules is not None else UNSET,
        response_style=body.response_style if body.response_style is not None else UNSET,
        monthly_token_limit=body.monthly_token_limit
        if "monthly_token_limit" in provided
        else UNSET,
        indexing_enabled=body.indexing_enabled if body.indexing_enabled is not None else UNSET,
    )
    with _errors():
        settings = await ai.config.update_settings(user.id, changes)
    if body.modules is not None:
        for workspace in await workspaces.list_for(user.id):
            await ai.index.forget_modules(workspace.id, settings.modules)
    return AiSettingsResponse.of(settings, ai.config.server_enabled)


# Providers


@me_router.get("/providers", summary="List AI providers")
async def list_providers(user: CurrentUserDep, ai: AiServicesDep) -> AiProviderListResponse:
    providers = await ai.config.providers(user.id)
    return AiProviderListResponse(providers=[AiProviderResponse.of(p) for p in providers])


@me_router.post("/providers", status_code=status.HTTP_201_CREATED, summary="Add an AI provider")
async def create_provider(
    body: CreateAiProviderRequest, user: CurrentUserDep, ai: AiServicesDep
) -> AiProviderResponse:
    with _errors():
        connection = await ai.config.create_provider(
            user.id,
            ProviderDraft(
                name=body.name,
                kind=body.kind,
                base_url=body.base_url,
                api_key=body.api_key,
                input_price=body.input_price,
                output_price=body.output_price,
            ),
        )
    return AiProviderResponse.of(connection)


@me_router.patch("/providers/{provider_id}", summary="Update an AI provider")
async def update_provider(
    provider_id: uuid.UUID, body: UpdateAiProviderRequest, user: CurrentUserDep, ai: AiServicesDep
) -> AiProviderResponse:
    provided = body.model_fields_set
    changes = ProviderChanges(
        name=body.name if body.name is not None else UNSET,
        base_url=body.base_url if "base_url" in provided else UNSET,
        api_key=body.api_key if "api_key" in provided else UNSET,
        input_price=body.input_price if "input_price" in provided else UNSET,
        output_price=body.output_price if "output_price" in provided else UNSET,
    )
    with _errors():
        return AiProviderResponse.of(await ai.config.update_provider(user.id, provider_id, changes))


@me_router.delete(
    "/providers/{provider_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an AI provider",
)
async def delete_provider(
    provider_id: uuid.UUID, user: CurrentUserDep, ai: AiServicesDep
) -> Response:
    with _errors():
        await ai.config.delete_provider(user.id, provider_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@me_router.post("/providers/test", summary="Test a provider connection without saving it")
async def test_provider(
    body: TestAiProviderRequest, user: CurrentUserDep, ai: AiServicesDep
) -> AiConnectionTestResponse:
    """Lists the provider's models, which spends no tokens."""
    draft = (
        ProviderDraft(name="Test", kind=body.kind, base_url=body.base_url, api_key=body.api_key)
        if body.kind is not None
        else None
    )
    with _errors():
        result = await ai.config.test_connection(user.id, draft=draft, provider_id=body.provider_id)
    return AiConnectionTestResponse.of(result)


@me_router.get("/providers/{provider_id}/models", summary="List a provider's models")
async def list_models(
    provider_id: uuid.UUID, user: CurrentUserDep, ai: AiServicesDep
) -> AiModelListResponse:
    with _errors():
        return AiModelListResponse.of(await ai.config.models(user.id, provider_id))


@me_router.get("/usage", summary="AI usage")
async def usage(
    params: Annotated[AiUsageParams, Query()], user: CurrentUserDep, ai: AiServicesDep
) -> AiUsageResponse:
    """Requests, tokens, and estimated cost per provider, model, and kind of request. No prompts
    or answers are stored."""
    settings = await ai.config.settings(user.id)
    return AiUsageResponse.of(
        await ai.usage.summary(user.id, params.days, settings.monthly_token_limit)
    )


# Conversations


@router.get("/conversations", summary="List assistant conversations")
async def list_conversations(
    workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> AiConversationListResponse:
    conversations = await ai.assistant.conversations(workspace.id, user.id)
    return AiConversationListResponse(
        conversations=[AiConversationResponse.of(c) for c in conversations]
    )


@router.get("/conversations/{conversation_id}", summary="Get a conversation with its messages")
async def get_conversation(
    conversation_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> AiConversationDetailResponse:
    with _errors():
        conversation, messages, proposals = await ai.assistant.conversation(
            workspace.id, user.id, conversation_id
        )
    return AiConversationDetailResponse(
        **AiConversationResponse.of(conversation).model_dump(),
        messages=[AiMessageResponse.of(m) for m in messages],
        proposals=[AiProposalResponse.of(p) for p in proposals],
    )


@router.patch("/conversations/{conversation_id}", summary="Rename a conversation")
async def rename_conversation(
    conversation_id: uuid.UUID,
    body: RenameAiConversationRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    ai: AiServicesDep,
) -> AiConversationResponse:
    with _errors():
        return AiConversationResponse.of(
            await ai.assistant.rename(workspace.id, user.id, conversation_id, body.title)
        )


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a conversation",
)
async def delete_conversation(
    conversation_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> Response:
    with _errors():
        await ai.assistant.delete(workspace.id, user.id, conversation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/messages",
    summary="Ask the assistant (streamed)",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "Server-sent events: `start` (AiTurnStarted), `sources` "
            "({citations}), `delta` ({text}), `error` ({message}), then `done` (AiStreamDone).",
            "content": {"text/event-stream": {}},
        },
        409: {"description": "AI is off, not configured, or cloud processing isn't allowed."},
        429: {"description": "The monthly token limit has been reached."},
    },
)
async def send_message(
    body: SendAiMessageRequest,
    request: Request,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    ai: AiServicesDep,
) -> StreamingResponse:
    """Checks settings and saves the question first (failures are ordinary errors), then
    streams the answer. Closing the connection stops generation; what was written is kept."""
    with _errors():
        turn = await ai.assistant.prepare(
            workspace.id,
            user.id,
            body.conversation_id,
            body.content,
            _zone(body.timezone, user.timezone),
        )
    return StreamingResponse(
        _stream(request, turn),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream(request: Request, turn: Turn) -> AsyncIterator[str]:
    # A session of its own: the request's session may close before streaming finishes.
    database = request.app.state.database
    async with database.session() as session:
        ai = build_ai_for(session, request.app.state)
        try:
            provider = await ai.config.chat_provider(
                turn.settings, turn.viewer.workspace_id, "chat"
            )
        except (CloudProcessingNotAllowedError, AiNotConfiguredError, ProviderNotFoundError):
            yield _event("error", {"message": "The AI provider is no longer available."})
            return
        turn = Turn(
            conversation=turn.conversation,
            settings=turn.settings,
            provider=provider,
            viewer=turn.viewer,
            question=turn.question,
            history=turn.history,
        )
        yield _event("start", AiTurnStarted.of(turn.conversation, provider))
        async for event in ai.assistant.run(turn):
            match event:
                case SourcesEvent(citations=citations):
                    yield _event(
                        "sources",
                        {
                            "citations": [
                                AiCitationResponse.of(c).model_dump(mode="json") for c in citations
                            ]
                        },
                    )
                case DeltaEvent(text=text):
                    yield _event("delta", {"text": text})
                case ErrorEvent(message=message):
                    yield _event("error", {"message": message})
                case DoneEvent(message=message, proposals=proposals):
                    yield _event(
                        "done",
                        AiStreamDone(
                            message=AiMessageResponse.of(message),
                            proposals=[AiProposalResponse.of(p) for p in proposals],
                        ),
                    )


def _event(name: str, data: BaseModel | dict[str, object]) -> str:
    payload = data.model_dump_json() if isinstance(data, BaseModel) else json.dumps(data)
    return f"event: {name}\ndata: {payload}\n\n"


# Proposals


@router.post("/proposals/{proposal_id}/approve", summary="Approve and run a proposed action")
async def approve_proposal(
    proposal_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> AiProposalResponse:
    """Runs once: a second approval is 409. A refusal by the module is recorded as `failed`
    with a safe message."""
    with _errors():
        await ai.config.require_enabled(user.id)
        proposal = await ai.proposals.approve(workspace.id, user.id, proposal_id, user.timezone)
    return AiProposalResponse.of(proposal)


@router.post("/proposals/{proposal_id}/reject", summary="Reject a proposed action")
async def reject_proposal(
    proposal_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> AiProposalResponse:
    with _errors():
        return AiProposalResponse.of(await ai.proposals.reject(workspace.id, user.id, proposal_id))


# Contextual features


@router.post("/assist", summary="Run a contextual AI feature")
async def assist(
    body: AiAssistRequest, workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> AiAssistResponse:
    """Summaries, extraction, and drafts for one record or range. Changes come back as pending
    proposals; nothing is changed until approved."""
    with _errors():
        result = await ai.assist.run(
            workspace.id,
            user.id,
            AssistRequest(
                kind=body.kind,
                target_id=body.target_id,
                text=body.text,
                instruction=body.instruction,
                start=body.start,
                end=body.end,
            ),
            _zone(body.timezone, user.timezone),
        )
    return AiAssistResponse.of(result)


# Semantic search


@router.get("/search", summary="Search by meaning and keywords")
async def semantic_search(
    params: Annotated[AiSearchParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    ai: AiServicesDep,
) -> AiSearchResponse:
    """Hybrid search over modules AI may read. Without an embedding model it is keyword only
    (`semantic: false`). The existing `/search` endpoint is unchanged."""
    with _errors():
        settings = await ai.config.require_enabled(user.id)
    modules = settings.modules & frozenset(params.module) if params.module else settings.modules
    embedder = await ai.config.embedding_provider(settings, workspace.id)
    retrieval = await ai.retriever.search(
        workspace.id,
        params.q,
        modules=modules,
        embedder=embedder,
        limit=params.limit,
        start=params.date_from,
        end=params.date_to,
    )
    return AiSearchResponse(
        query=params.q,
        matches=[AiSearchMatchResponse.of(m) for m in retrieval.matches],
        semantic=retrieval.semantic,
        semantic_error=retrieval.semantic_error,
    )


# Insights


@router.get("/insights", summary="Personal insights")
async def insights(
    params: Annotated[AiTimezoneParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    ai: AiServicesDep,
) -> AiInsightListResponse:
    """Deterministic observations from modules AI may read; no model is called."""
    with _errors():
        settings = await ai.config.require_enabled(user.id)
    viewer = viewer_for(workspace.id, user.id, _zone(params.timezone, user.timezone), utc_now())
    found = await ai.insights.insights(viewer, settings)
    return AiInsightListResponse(insights=[AiInsightResponse.of(i) for i in found])


@router.post(
    "/insights/dismiss", status_code=status.HTTP_204_NO_CONTENT, summary="Dismiss an insight"
)
async def dismiss_insight(
    body: DismissAiInsightRequest, workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> Response:
    await ai.insights.dismiss(workspace.id, user.id, body.key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Index


@router.get("/index", summary="Retrieval index status")
async def index_status(
    workspace: WorkspaceDep, user: CurrentUserDep, ai: AiServicesDep
) -> AiIndexResponse:
    settings = await ai.config.settings(user.id)
    embedder = await ai.config.embedding_provider(settings, workspace.id)
    active = embedder if settings.indexing_enabled and permitted_types(settings.modules) else None
    return AiIndexResponse.of(await ai.index.summary(workspace.id, active))


@router.post("/index/rebuild", summary="Re-index everything")
async def rebuild_index(workspace: WorkspaceDep, ai: AiServicesDep) -> AiIndexActionResponse:
    """Marks every indexed record pending; the worker re-embeds them."""
    return AiIndexActionResponse(affected=await ai.index.rebuild(workspace.id))


@router.post("/index/retry", summary="Retry records that failed to index")
async def retry_index(workspace: WorkspaceDep, ai: AiServicesDep) -> AiIndexActionResponse:
    return AiIndexActionResponse(affected=await ai.index.retry_failed(workspace.id))


@router.delete("/index", status_code=status.HTTP_204_NO_CONTENT, summary="Delete the index")
async def clear_index(workspace: WorkspaceDep, ai: AiServicesDep) -> Response:
    """Deletes indexed text and embeddings for the workspace; records are untouched. With
    indexing on, the worker builds it again."""
    await ai.index.clear(workspace.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
