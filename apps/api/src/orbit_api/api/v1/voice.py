"""Voice: per-person settings under `/me/voice`, and speech and spoken confirmation under each
workspace (for usage attribution and, for confirmation, the workspace's proposals and approvals).

The assistant itself is unchanged: the web sends a transcript to `…/ai/messages` with
`input_mode: "voice"`. Audio passes through these routes and is never stored or logged.
"""

import uuid
from collections.abc import AsyncIterator, Generator
from contextlib import AsyncExitStack, contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import AgentServicesDep, AiServicesDep, VoiceServicesDep
from orbit_api.api.files import read_body
from orbit_api.api.v1.agent import agent_errors
from orbit_api.api.v1.ai import ai_errors
from orbit_api.schemas.voice import (
    SpeakVoiceRequest,
    UpdateVoiceSettingsRequest,
    VoiceConfirmationRequest,
    VoiceConfirmationResponse,
    VoiceHistoryClearResponse,
    VoiceOptionListResponse,
    VoiceOptionResponse,
    VoiceSettingsResponse,
    VoiceTestResponse,
    VoiceTranscriptParams,
    VoiceTranscriptResponse,
)
from orbit_api.services.voice.approvals import (
    ProposalNotInConversationError,
    answer_approval,
    answer_proposal,
)
from orbit_api.services.voice.models import (
    MAX_AUDIO_BYTES,
    SPEECH_CONTENT_TYPE,
    AudioRejectedError,
    VoiceNotConfiguredError,
    VoiceProviderUnsupportedError,
)
from orbit_api.services.voice.service import VoiceService

_RESPONSES: dict[int | str, dict[str, str]] = {401: {"description": "Not signed in."}}

me_router = APIRouter(prefix="/me/voice", tags=["voice"], responses=_RESPONSES)
router = APIRouter(
    prefix="/workspaces/{workspace_id}/voice",
    tags=["voice"],
    responses={
        **_RESPONSES,
        404: {"description": "The workspace (or record) does not exist or is not accessible."},
    },
)

_AUDIO_BODY = {
    "requestBody": {
        "required": True,
        "description": "One utterance, typed by `Content-Type` (`audio/webm`, `audio/ogg`, "
        "`audio/wav`, `audio/mpeg`, `audio/mp4`).",
        "content": {"application/octet-stream": {"schema": {"type": "string"}}},
    }
}


@contextmanager
def _errors() -> Generator[None]:
    try:
        yield
    except VoiceNotConfiguredError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    except (VoiceProviderUnsupportedError, AudioRejectedError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except ProposalNotInConversationError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proposal not found.") from None


async def _settings_response(voice: VoiceService, user_id: uuid.UUID) -> VoiceSettingsResponse:
    return VoiceSettingsResponse.of(await voice.settings(user_id), await voice.status(user_id))


# Settings


@me_router.get("/settings", summary="Voice settings and where speech is processed")
async def get_voice_settings(
    user: CurrentUserDep, voice: VoiceServicesDep
) -> VoiceSettingsResponse:
    return await _settings_response(voice.service, user.id)


@me_router.put("/settings", summary="Replace voice settings")
async def update_voice_settings(
    body: UpdateVoiceSettingsRequest, user: CurrentUserDep, voice: VoiceServicesDep
) -> VoiceSettingsResponse:
    with ai_errors(), _errors():
        await voice.service.update(user.id, body.to_settings(user.id))
    return await _settings_response(voice.service, user.id)


@me_router.get("/providers/{provider_id}/voices", summary="A provider's voices, if it lists them")
async def list_provider_voices(
    provider_id: uuid.UUID, user: CurrentUserDep, voice: VoiceServicesDep
) -> VoiceOptionListResponse:
    with ai_errors(), _errors():
        options = await voice.service.voices(user.id, provider_id)
    return VoiceOptionListResponse(voices=[VoiceOptionResponse.of(o) for o in options])


# Speech


@router.post(
    "/transcriptions",
    summary="Transcribe one utterance",
    openapi_extra=_AUDIO_BODY,
    responses={
        409: {"description": "AI is off, transcription isn't set up, or cloud isn't allowed."},
        413: {"description": "The recording is too large."},
        422: {"description": "The audio is empty or not a supported type."},
        429: {"description": "The monthly AI limit has been reached."},
    },
)
async def transcribe(
    params: Annotated[VoiceTranscriptParams, Query()],
    request: Request,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    voice: VoiceServicesDep,
) -> VoiceTranscriptResponse:
    """With the person's transcription provider. The audio is sent to it and discarded."""
    audio = await read_body(request, limit=MAX_AUDIO_BYTES, what="Recordings")
    content_type = request.headers.get("content-type", "")
    with ai_errors(), _errors():
        transcript = await voice.service.transcribe(
            user.id, workspace.id, audio, content_type, params.language
        )
    return VoiceTranscriptResponse.of(transcript)


@router.post(
    "/speech",
    summary="Speak a sentence (streamed audio)",
    response_class=StreamingResponse,
    responses={
        200: {"description": "MP3 audio as it's generated.", "content": {"audio/mpeg": {}}},
        409: {"description": "AI is off, speech isn't set up, or cloud isn't allowed."},
        429: {"description": "The monthly AI limit has been reached."},
    },
)
async def speak(
    body: SpeakVoiceRequest, workspace: WorkspaceDep, user: CurrentUserDep, voice: VoiceServicesDep
) -> StreamingResponse:
    """The provider is asked first, so refusals are ordinary errors; then the audio streams."""
    stack = AsyncExitStack()
    with ai_errors(), _errors():
        try:
            chunks = await stack.enter_async_context(
                voice.service.speak(user.id, workspace.id, body.text)
            )
        except BaseException:
            await stack.aclose()
            raise

    async def stream() -> AsyncIterator[bytes]:
        async with stack:
            async for chunk in chunks:
                yield chunk

    return StreamingResponse(
        stream(),
        media_type=SPEECH_CONTENT_TYPE,
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/test", summary="Check the voice providers answer")
async def test_voice(
    workspace: WorkspaceDep, user: CurrentUserDep, voice: VoiceServicesDep
) -> VoiceTestResponse:
    """Speaks a short phrase and transcribes it with the configured providers."""
    with ai_errors(), _errors():
        return VoiceTestResponse.of(await voice.service.test(user.id, workspace.id))


# Confirmation


@router.post(
    "/confirmations",
    summary="Answer a pending action by voice",
    responses={409: {"description": "The approval changed, expired, or was already decided."}},
)
async def confirm(
    body: VoiceConfirmationRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    ai: AiServicesDep,
    agent: AgentServicesDep,
) -> VoiceConfirmationResponse:
    """The transcript is read on the server: only a short, clear yes approves, and only actions
    voice may approve (new records, low risk, not proposed from untrusted content); others are
    left for the screen. Approval runs through the same checks as a click."""
    if body.target == "proposal":
        assert body.conversation_id is not None
        with ai_errors(), _errors():
            await ai.config.require_enabled(user.id)
            decision = await answer_proposal(
                ai.proposals,
                workspace.id,
                user.id,
                body.id,
                body.conversation_id,
                body.transcript,
                body.timezone or user.timezone,
            )
        return VoiceConfirmationResponse.of(decision)
    assert body.arguments_hash is not None
    with agent_errors(), _errors():
        approval = await answer_approval(
            agent.service, workspace.id, user.id, body.id, body.arguments_hash, body.transcript
        )
    return VoiceConfirmationResponse.of(approval)


# History


@router.delete("/history", summary="Delete spoken conversations")
async def clear_voice_history(
    workspace: WorkspaceDep, user: CurrentUserDep, voice: VoiceServicesDep
) -> VoiceHistoryClearResponse:
    """Deletes the person's conversations in this workspace that include a spoken question,
    with their answers and proposals. Typed-only conversations are kept."""
    return VoiceHistoryClearResponse(
        removed=await voice.service.clear_history(workspace.id, user.id)
    )
