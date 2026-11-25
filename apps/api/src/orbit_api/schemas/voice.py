"""Voice settings, speech, and spoken confirmation.

Raw audio never appears here: transcription takes the audio as the request body and returns
text; speech returns `audio/mpeg`. Neither is stored.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from orbit_api.schemas.agent import AgentApprovalResponse
from orbit_api.schemas.ai import AiProposalResponse
from orbit_api.schemas.common import TimeZoneName
from orbit_api.services.ai.models import Processing, ProviderKind
from orbit_api.services.voice.approvals import ApprovalDecision, Outcome, ProposalDecision
from orbit_api.services.voice.confirmation import Reply
from orbit_api.services.voice.models import (
    MAX_SPEECH_CHARS,
    AudioProviderInfo,
    ListeningMode,
    SpeechEngine,
    SpeechProcessing,
    Transcript,
    VoiceOption,
    VoiceSettings,
    VoiceStatus,
    VoiceTest,
)

# A BCP 47 tag such as `en-IN`, `hi-IN`, or `en`; or `auto`.
Language = Annotated[
    str,
    StringConstraints(
        min_length=2, max_length=35, pattern=r"^(auto|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3})$"
    ),
]
ModelName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
VoiceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VoiceProviderResponse(BaseModel):
    id: uuid.UUID
    name: str
    kind: ProviderKind
    processing: Processing

    @classmethod
    def of(cls, provider: AudioProviderInfo) -> Self:
        return cls(
            id=provider.id, name=provider.name, kind=provider.kind, processing=provider.processing
        )


class VoiceSettingsResponse(BaseModel):
    stt_engine: SpeechEngine
    stt_provider_id: uuid.UUID | None
    stt_model: str | None
    tts_engine: SpeechEngine
    tts_provider_id: uuid.UUID | None
    tts_model: str | None
    tts_voice: str | None
    recognition_language: str
    response_language: str | None
    listening_mode: ListeningMode
    silence_ms: int
    sensitivity: int
    auto_speak: bool
    speaking_rate: int = Field(description="Percent of normal speed.")
    history_days: int | None = Field(
        description="Spoken conversations are deleted this long after their last message; "
        "`null` keeps them until deleted."
    )
    updated_at: datetime | None
    server_enabled: bool = Field(description="Whether AI is allowed on this server.")
    ai_enabled: bool = Field(description="Whether AI is on for this person.")
    allow_cloud: bool
    stt_processing: SpeechProcessing | None
    tts_processing: SpeechProcessing | None
    providers: list[VoiceProviderResponse] = Field(
        description="The person's AI providers that can transcribe or speak."
    )
    stores_audio: bool = Field(description="Always false: Orbit never stores audio.")

    @classmethod
    def of(cls, settings: VoiceSettings, status: VoiceStatus) -> Self:
        return cls(
            stt_engine=settings.stt_engine,
            stt_provider_id=settings.stt_provider_id,
            stt_model=settings.stt_model,
            tts_engine=settings.tts_engine,
            tts_provider_id=settings.tts_provider_id,
            tts_model=settings.tts_model,
            tts_voice=settings.tts_voice,
            recognition_language=settings.recognition_language,
            response_language=settings.response_language,
            listening_mode=settings.listening_mode,
            silence_ms=settings.silence_ms,
            sensitivity=settings.sensitivity,
            auto_speak=settings.auto_speak,
            speaking_rate=settings.speaking_rate,
            history_days=settings.history_days,
            updated_at=settings.updated_at,
            server_enabled=status.server_enabled,
            ai_enabled=status.ai_enabled,
            allow_cloud=status.allow_cloud,
            stt_processing=status.stt_processing,
            tts_processing=status.tts_processing,
            providers=[VoiceProviderResponse.of(p) for p in status.providers],
            stores_audio=False,
        )


class UpdateVoiceSettingsRequest(_Request):
    """Replaces the settings. Provider engines need a provider and model (and a voice for
    speech); browser engines ignore them."""

    stt_engine: SpeechEngine
    stt_provider_id: uuid.UUID | None
    stt_model: ModelName | None
    tts_engine: SpeechEngine
    tts_provider_id: uuid.UUID | None
    tts_model: ModelName | None
    tts_voice: VoiceName | None
    recognition_language: Language
    response_language: Language | None
    listening_mode: ListeningMode
    silence_ms: int = Field(ge=300, le=5000)
    sensitivity: int = Field(ge=1, le=10)
    auto_speak: bool
    speaking_rate: int = Field(ge=50, le=200)
    history_days: int | None = Field(ge=1, le=3650)

    def to_settings(self, user_id: uuid.UUID) -> VoiceSettings:
        return VoiceSettings(
            user_id=user_id,
            stt_engine=self.stt_engine,
            stt_provider_id=self.stt_provider_id,
            stt_model=self.stt_model,
            tts_engine=self.tts_engine,
            tts_provider_id=self.tts_provider_id,
            tts_model=self.tts_model,
            tts_voice=self.tts_voice,
            recognition_language=self.recognition_language,
            response_language=None if self.response_language == "auto" else self.response_language,
            listening_mode=self.listening_mode,
            silence_ms=self.silence_ms,
            sensitivity=self.sensitivity,
            auto_speak=self.auto_speak,
            speaking_rate=self.speaking_rate,
            history_days=self.history_days,
        )


class VoiceOptionResponse(BaseModel):
    id: str
    name: str

    @classmethod
    def of(cls, option: VoiceOption) -> Self:
        return cls(id=option.id, name=option.name)


class VoiceOptionListResponse(BaseModel):
    voices: list[VoiceOptionResponse] = Field(
        description="Empty when the provider doesn't list its voices: type a voice name."
    )


class VoiceTranscriptParams(_Request):
    language: Language | None = Field(
        default=None, description="Overrides the recognition language for this utterance."
    )


class VoiceTranscriptResponse(BaseModel):
    text: str
    language: str | None
    duration_ms: int = Field(description="How long the provider took.")

    @classmethod
    def of(cls, transcript: Transcript) -> Self:
        return cls(
            text=transcript.text, language=transcript.language, duration_ms=transcript.duration_ms
        )


class SpeakVoiceRequest(_Request):
    text: str = Field(min_length=1, max_length=MAX_SPEECH_CHARS)


class VoiceTestResponse(BaseModel):
    ok: bool
    message: str
    transcription_ms: int | None
    speech_ms: int | None

    @classmethod
    def of(cls, test: VoiceTest) -> Self:
        return cls(
            ok=test.ok,
            message=test.message,
            transcription_ms=test.transcription_ms,
            speech_ms=test.speech_ms,
        )


class VoiceConfirmationRequest(_Request):
    """A spoken reply to one pending action, checked on the server. For a proposal, name the
    conversation it was proposed in; for an agent approval, send the `arguments_hash` that was
    read out, so only that exact action can run."""

    target: Literal["proposal", "agent_approval"]
    id: uuid.UUID
    transcript: str = Field(min_length=1, max_length=500)
    conversation_id: uuid.UUID | None = None
    arguments_hash: str | None = Field(default=None, min_length=64, max_length=64)
    timezone: TimeZoneName | None = None

    @model_validator(mode="after")
    def _check_binding(self) -> Self:
        if self.target == "proposal" and self.conversation_id is None:
            raise ValueError("A proposal reply needs its conversation_id.")
        if self.target == "agent_approval" and self.arguments_hash is None:
            raise ValueError("An approval reply needs the arguments_hash that was read out.")
        return self


_SAY: dict[Outcome, str] = {
    "approved": "Done.",
    "rejected": "Okay, I won't do that.",
    "unclear": "I didn't catch a clear yes or no. Say yes to go ahead, or no to cancel.",
    "needs_screen": "Please check this one and confirm it on screen.",
    "not_pending": "That was already handled.",
}


class VoiceConfirmationResponse(BaseModel):
    outcome: Outcome = Field(
        description="`approved` or `rejected` ran the decision; `unclear` and `needs_screen` "
        "changed nothing; `not_pending` means it was already decided."
    )
    reply: Reply = Field(description="How the transcript was read.")
    message: str = Field(description="A short sentence to speak back.")
    proposal: AiProposalResponse | None
    approval: AgentApprovalResponse | None

    @classmethod
    def of(cls, decision: ProposalDecision | ApprovalDecision) -> Self:
        match decision:
            case ProposalDecision():
                return cls(
                    outcome=decision.outcome,
                    reply=decision.reply,
                    message=_SAY[decision.outcome],
                    proposal=AiProposalResponse.of(decision.proposal),
                    approval=None,
                )
            case ApprovalDecision():
                return cls(
                    outcome=decision.outcome,
                    reply=decision.reply,
                    message=_SAY[decision.outcome],
                    proposal=None,
                    approval=AgentApprovalResponse.of(decision.approval),
                )


class VoiceHistoryClearResponse(BaseModel):
    removed: int = Field(description="Conversations deleted.")
