"""The AI layer's API contract. API keys go in and never come out: responses say only whether
one is stored."""

import uuid
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from orbit_api.schemas.common import Name, TimeZoneName, single_line
from orbit_api.schemas.fitness import NutrientsModel
from orbit_api.services.ai.assist import AssistKind, AssistResult
from orbit_api.services.ai.configuration import ConnectionTest, ResolvedProvider
from orbit_api.services.ai.health_assist import (
    FoodDraftSuggestion,
    FoodEstimate,
    FoodIdeas,
    Provenance,
    WorkoutIdea,
)
from orbit_api.services.ai.models import (
    ActionKind,
    AiModule,
    AiSettings,
    Capabilities,
    Citation,
    Conversation,
    IndexStatus,
    IndexSummary,
    Insight,
    InsightKind,
    Message,
    MessageStatus,
    ModelInfo,
    Processing,
    Proposal,
    ProposalStatus,
    ProviderConnection,
    ProviderKind,
    RecordRef,
    ResponseStyle,
    SearchMatch,
    UsageOperation,
    UsageSummary,
)
from orbit_api.services.ai.providers import KIND_CAPABILITIES, base_url_of, processing_of
from orbit_api.services.fitness.models import TemplateCategory

ModelName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(single_line),
]
ApiKey = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
BaseUrl = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
# Micro-USD per million tokens: $3.00 per million is 3000000.
Price = Annotated[int, Field(ge=0, le=10**12)]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
ConversationTitle = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(single_line),
]


# Settings


class AiCapabilitiesModel(BaseModel):
    chat: bool
    streaming: bool
    structured_output: bool
    embeddings: bool
    model_listing: bool
    usage_reporting: bool

    @classmethod
    def of(cls, capabilities: Capabilities) -> "AiCapabilitiesModel":
        return cls(
            chat=capabilities.chat,
            streaming=capabilities.streaming,
            structured_output=capabilities.structured_output,
            embeddings=capabilities.embeddings,
            model_listing=capabilities.model_listing,
            usage_reporting=capabilities.usage_reporting,
        )


class AiSettingsResponse(BaseModel):
    server_enabled: bool = Field(description="False when the server operator turned AI off.")
    enabled: bool
    chat_provider_id: uuid.UUID | None
    chat_model: str | None
    embedding_provider_id: uuid.UUID | None
    embedding_model: str | None
    fallback_provider_id: uuid.UUID | None
    fallback_model: str | None
    allow_cloud: bool = Field(description="Consent to send data to cloud providers.")
    modules: list[AiModule] = Field(description="Modules AI may read.")
    response_style: ResponseStyle
    monthly_token_limit: int | None
    indexing_enabled: bool

    @classmethod
    def of(cls, settings: AiSettings, server_enabled: bool) -> "AiSettingsResponse":
        return cls(
            server_enabled=server_enabled,
            enabled=settings.enabled,
            chat_provider_id=settings.chat_provider_id,
            chat_model=settings.chat_model,
            embedding_provider_id=settings.embedding_provider_id,
            embedding_model=settings.embedding_model,
            fallback_provider_id=settings.fallback_provider_id,
            fallback_model=settings.fallback_model,
            allow_cloud=settings.allow_cloud,
            modules=sorted(settings.modules),
            response_style=settings.response_style,
            monthly_token_limit=settings.monthly_token_limit,
            indexing_enabled=settings.indexing_enabled,
        )


class UpdateAiSettingsRequest(BaseModel):
    """Change some settings. Omitted fields keep their values; `null` clears the nullable ones."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    chat_provider_id: uuid.UUID | None = None
    chat_model: ModelName | None = None
    embedding_provider_id: uuid.UUID | None = None
    embedding_model: ModelName | None = None
    fallback_provider_id: uuid.UUID | None = None
    fallback_model: ModelName | None = None
    allow_cloud: bool | None = None
    modules: list[AiModule] | None = Field(default=None, max_length=8)
    response_style: ResponseStyle | None = None
    monthly_token_limit: int | None = Field(default=None, ge=1000, le=10**10)
    indexing_enabled: bool | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        nullable = {
            "chat_provider_id",
            "chat_model",
            "embedding_provider_id",
            "embedding_model",
            "fallback_provider_id",
            "fallback_model",
            "monthly_token_limit",
        }
        for name in self.model_fields_set - nullable:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


# Providers


class AiProviderResponse(BaseModel):
    id: uuid.UUID
    name: str
    kind: ProviderKind
    base_url: str | None = Field(description="A custom endpoint; null uses the provider's own.")
    effective_base_url: str | None
    has_api_key: bool = Field(
        description="Whether a key is stored. The key itself never is returned."
    )
    processing: Processing = Field(description="Where this provider processes data.")
    capabilities: AiCapabilitiesModel
    input_price: int | None
    output_price: int | None
    created_at: datetime

    @classmethod
    def of(cls, connection: ProviderConnection) -> "AiProviderResponse":
        base = base_url_of(connection)
        return cls(
            id=connection.id,
            name=connection.name,
            kind=connection.kind,
            base_url=connection.base_url,
            effective_base_url=base,
            has_api_key=connection.has_api_key,
            processing=processing_of(connection.kind, base),
            capabilities=AiCapabilitiesModel.of(KIND_CAPABILITIES[connection.kind]),
            input_price=connection.input_price,
            output_price=connection.output_price,
            created_at=connection.created_at,
        )


class AiProviderListResponse(BaseModel):
    providers: list[AiProviderResponse]


class CreateAiProviderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    kind: ProviderKind
    base_url: BaseUrl | None = None
    api_key: ApiKey | None = None
    input_price: Price | None = None
    output_price: Price | None = None


class UpdateAiProviderRequest(BaseModel):
    """Omitted fields keep their values. `api_key: null` removes the stored key."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    base_url: BaseUrl | None = None
    api_key: ApiKey | None = None
    input_price: Price | None = None
    output_price: Price | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("include at least one field to change")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class TestAiProviderRequest(BaseModel):
    """Test a connection without saving it. Give the settings, or `provider_id` alone to test a
    saved one. With both, a missing key is taken from the saved connection."""

    model_config = ConfigDict(extra="forbid")

    provider_id: uuid.UUID | None = None
    kind: ProviderKind | None = None
    base_url: BaseUrl | None = None
    api_key: ApiKey | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.kind is None and self.provider_id is None:
            raise ValueError("give kind, or provider_id")
        return self


class AiConnectionTestResponse(BaseModel):
    ok: bool
    processing: Processing
    model_count: int
    message: str

    @classmethod
    def of(cls, test: ConnectionTest) -> "AiConnectionTestResponse":
        return cls(
            ok=test.ok,
            processing=test.processing,
            model_count=test.model_count,
            message=test.message,
        )


class AiModelResponse(BaseModel):
    id: str
    chat: bool
    embeddings: bool


class AiModelListResponse(BaseModel):
    models: list[AiModelResponse]

    @classmethod
    def of(cls, models: list[ModelInfo]) -> "AiModelListResponse":
        return cls(
            models=[AiModelResponse(id=m.id, chat=m.chat, embeddings=m.embeddings) for m in models]
        )


# Usage


class AiUsageLineResponse(BaseModel):
    provider_name: str
    model: str
    operation: UsageOperation
    requests: int
    failures: int
    input_tokens: int
    output_tokens: int
    cost_micros: int | None = Field(description="Estimated from your prices, in micro-USD.")


class AiUsageResponse(BaseModel):
    since: datetime
    lines: list[AiUsageLineResponse]
    month_tokens: int = Field(description="Tokens this calendar month (UTC).")
    monthly_token_limit: int | None
    near_limit: bool

    @classmethod
    def of(cls, summary: UsageSummary) -> "AiUsageResponse":
        return cls(
            since=summary.since,
            lines=[
                AiUsageLineResponse(
                    provider_name=line.provider_name,
                    model=line.model,
                    operation=line.operation,
                    requests=line.requests,
                    failures=line.failures,
                    input_tokens=line.input_tokens,
                    output_tokens=line.output_tokens,
                    cost_micros=line.cost_micros,
                )
                for line in summary.lines
            ],
            month_tokens=summary.month_tokens,
            monthly_token_limit=summary.monthly_token_limit,
            near_limit=summary.near_limit,
        )


class AiUsageParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days: int = Field(default=30, ge=1, le=366)


# Sources and conversations


class AiRecordRef(BaseModel):
    kind: str = Field(
        description="note, document, task, event, habit, transaction, reminder, loan, "
        "subscription, bill, budget, workout, or a *_summary calculated by Orbit."
    )
    id: uuid.UUID | None = Field(description="Null for a summary, which links to its module.")
    title: str
    day: date | None
    detail: str

    @classmethod
    def of(cls, ref: RecordRef) -> "AiRecordRef":
        return cls(kind=ref.kind, id=ref.id, title=ref.title, day=ref.day, detail=ref.detail)


class AiCitationResponse(BaseModel):
    number: int
    ref: AiRecordRef
    cited: bool = Field(description="Whether the answer cites it.")

    @classmethod
    def of(cls, citation: Citation) -> "AiCitationResponse":
        return cls(number=citation.number, ref=AiRecordRef.of(citation.ref), cited=citation.cited)


class AiProposalResponse(BaseModel):
    id: uuid.UUID
    kind: ActionKind
    payload: dict[str, object]
    summary: str
    status: ProposalStatus
    from_untrusted_context: bool = Field(
        description="Proposed while reading records, which may contain injected instructions."
    )
    result_kind: str | None
    result_id: uuid.UUID | None
    error: str | None
    message_id: uuid.UUID | None
    created_at: datetime

    @classmethod
    def of(cls, proposal: Proposal) -> "AiProposalResponse":
        return cls(
            id=proposal.id,
            kind=proposal.kind,
            payload=proposal.payload,
            summary=proposal.summary,
            status=proposal.status,
            from_untrusted_context=proposal.from_untrusted_context,
            result_kind=proposal.result_kind,
            result_id=proposal.result_id,
            error=proposal.error,
            message_id=proposal.message_id,
            created_at=proposal.created_at,
        )


class AiMessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    citations: list[AiCitationResponse]
    status: MessageStatus
    provider_name: str | None
    model: str | None
    processing: Processing | None
    input_tokens: int | None
    output_tokens: int | None
    created_at: datetime

    @classmethod
    def of(cls, message: Message) -> "AiMessageResponse":
        return cls(
            id=message.id,
            role=message.role,
            content=message.content,
            citations=[AiCitationResponse.of(c) for c in message.citations],
            status=message.status,
            provider_name=message.provider_name,
            model=message.model,
            processing=message.processing,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            created_at=message.created_at,
        )


class AiConversationResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, conversation: Conversation) -> "AiConversationResponse":
        return cls(
            id=conversation.id,
            title=conversation.title,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )


class AiConversationListResponse(BaseModel):
    conversations: list[AiConversationResponse]


class AiConversationDetailResponse(AiConversationResponse):
    messages: list[AiMessageResponse]
    proposals: list[AiProposalResponse]


class RenameAiConversationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: ConversationTitle


class SendAiMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: Question
    conversation_id: uuid.UUID | None = Field(
        default=None, description="Omit to start a new conversation."
    )
    timezone: TimeZoneName | None = Field(
        default=None, description="The viewer's zone for 'today'; defaults to the profile's."
    )


class AiTurnStarted(BaseModel):
    """The first event of a streamed answer."""

    conversation: AiConversationResponse
    provider_name: str
    model: str
    processing: Processing

    @classmethod
    def of(cls, conversation: Conversation, provider: ResolvedProvider) -> "AiTurnStarted":
        return cls(
            conversation=AiConversationResponse.of(conversation),
            provider_name=provider.connection.name,
            model=provider.model,
            processing=provider.processing,
        )


class AiStreamDone(BaseModel):
    """The last event of a streamed answer: the saved message and its proposals."""

    message: AiMessageResponse
    proposals: list[AiProposalResponse]


class AiTimezoneParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timezone: TimeZoneName | None = None


# Assist


class AiAssistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: AssistKind
    target_id: uuid.UUID | None = None
    text: str | None = Field(default=None, max_length=10_000)
    instruction: str | None = Field(default=None, max_length=300)
    start: date | None = None
    end: date | None = None
    timezone: TimeZoneName | None = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.start and self.end and self.end < self.start:
            raise ValueError("end must not be before start")
        if self.start and self.end and (self.end - self.start).days > 366:
            raise ValueError("the range can be at most a year")
        return self


class AiAssistItemResponse(BaseModel):
    label: str
    detail: str
    confidence: float | None
    ref: AiRecordRef | None


class AiAssistResponse(BaseModel):
    kind: AssistKind
    text: str
    items: list[AiAssistItemResponse]
    facts: list[str] = Field(description="Figures calculated by Orbit, not the model.")
    citations: list[AiCitationResponse]
    proposals: list[AiProposalResponse]
    provider_name: str | None
    model: str | None
    processing: Processing | None

    @classmethod
    def of(cls, result: AssistResult) -> "AiAssistResponse":
        processing: Processing | None = (
            "local" if result.processing == "local" else "cloud" if result.processing else None
        )
        return cls(
            kind=result.kind,
            text=result.text,
            items=[
                AiAssistItemResponse(
                    label=i.label,
                    detail=i.detail,
                    confidence=i.confidence,
                    ref=AiRecordRef.of(i.ref) if i.ref else None,
                )
                for i in result.items
            ],
            facts=result.facts,
            citations=[AiCitationResponse.of(c) for c in result.citations],
            proposals=[AiProposalResponse.of(p) for p in result.proposals],
            provider_name=result.provider_name,
            model=result.model,
            processing=processing,
        )


# Semantic search


class AiSearchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    q: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=500)]
    module: list[AiModule] = Field(
        default_factory=list[AiModule], description="Repeat to search some modules only."
    )
    date_from: date | None = None
    date_to: date | None = None
    limit: int = Field(default=10, ge=1, le=25)


class AiSearchMatchResponse(BaseModel):
    ref: AiRecordRef
    snippet: str
    score: float
    keyword: bool = Field(description="Found by the keyword search.")
    semantic: bool = Field(description="Found by meaning, with the embedding model.")

    @classmethod
    def of(cls, match: SearchMatch) -> "AiSearchMatchResponse":
        return cls(
            ref=AiRecordRef.of(match.ref),
            snippet=match.snippet,
            score=match.score,
            keyword=match.keyword,
            semantic=match.semantic,
        )


class AiSearchResponse(BaseModel):
    query: str
    matches: list[AiSearchMatchResponse]
    semantic: bool = Field(description="Whether semantic search ran (needs an embedding model).")
    semantic_error: str | None


# Insights


class AiInsightResponse(BaseModel):
    key: str
    kind: InsightKind
    module: AiModule
    title: str
    body: str
    period_start: date
    period_end: date
    refs: list[AiRecordRef]
    tone: str

    @classmethod
    def of(cls, insight: Insight) -> "AiInsightResponse":
        return cls(
            key=insight.key,
            kind=insight.kind,
            module=insight.module,
            title=insight.title,
            body=insight.body,
            period_start=insight.period_start,
            period_end=insight.period_end,
            refs=[AiRecordRef.of(r) for r in insight.refs],
            tone=insight.tone,
        )


class AiInsightListResponse(BaseModel):
    insights: list[AiInsightResponse]


class DismissAiInsightRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: Annotated[str, StringConstraints(min_length=1, max_length=200)]


# Index


class AiIndexResponse(BaseModel):
    active: bool = Field(
        description="An embedding model is configured and allowed, so indexing runs."
    )
    embedding_model: str | None
    counts: dict[IndexStatus, int]
    last_indexed_at: datetime | None

    @classmethod
    def of(cls, summary: IndexSummary) -> "AiIndexResponse":
        return cls(
            active=summary.active,
            embedding_model=summary.embedding_model,
            counts=summary.counts,
            last_indexed_at=summary.last_indexed_at,
        )


class AiIndexActionResponse(BaseModel):
    affected: int


# Health helpers


HealthPrompt = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(single_line),
]


def _processing(provenance: Provenance) -> Processing:
    return "local" if provenance.processing == "local" else "cloud"


class AiFoodEstimateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: HealthPrompt = Field(
        description='The food and, optionally, the serving, as typed ("masala dosa, 1 piece").'
    )


class AiFoodIdeasRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cuisine: HealthPrompt = Field(description='A region or cuisine ("Kerala", "Mexican").')


class AiWorkoutSuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    focus: Annotated[
        str,
        StringConstraints(strip_whitespace=True, max_length=200),
        AfterValidator(single_line),
    ] = Field(default="", description="What the workout should be like, in the person's words.")
    timezone: TimeZoneName | None = None


class AiFoodDraftResponse(BaseModel):
    """A food for the person to review and save; nothing is saved by the AI."""

    name: str
    serving_quantity_milli: int
    serving_unit: str
    nutrients: NutrientsModel = Field(description="Estimated, for one serving.")
    note: str

    @classmethod
    def of(cls, food: FoodDraftSuggestion) -> "AiFoodDraftResponse":
        return cls(
            name=food.name,
            serving_quantity_milli=food.serving_quantity_milli,
            serving_unit=food.serving_unit,
            nutrients=NutrientsModel.of(food.nutrients),
            note=food.note,
        )


class AiFoodEstimateResponse(BaseModel):
    food: AiFoodDraftResponse
    provider_name: str
    model: str
    processing: Processing

    @classmethod
    def of(cls, result: FoodEstimate) -> "AiFoodEstimateResponse":
        p = result.provenance
        return cls(
            food=AiFoodDraftResponse.of(result.food),
            provider_name=p.provider_name,
            model=p.model,
            processing=_processing(p),
        )


class AiFoodIdeasResponse(BaseModel):
    cuisine: str
    foods: list[AiFoodDraftResponse]
    provider_name: str
    model: str
    processing: Processing

    @classmethod
    def of(cls, result: FoodIdeas) -> "AiFoodIdeasResponse":
        provenance = result.provenance
        return cls(
            cuisine=result.cuisine,
            foods=[AiFoodDraftResponse.of(f) for f in result.foods],
            provider_name=provenance.provider_name,
            model=provenance.model,
            processing=_processing(provenance),
        )


class AiSuggestedExerciseResponse(BaseModel):
    exercise_id: uuid.UUID
    exercise_name: str
    sets: int
    target_reps_min: int | None
    target_reps_max: int | None
    target_duration_s: int | None
    target_distance_m: int | None
    rest_seconds: int | None
    notes: str


class AiWorkoutSuggestionResponse(BaseModel):
    """A workout draft from the person's own exercises, to save as a template or discard."""

    name: str
    category: TemplateCategory
    description: str
    notes: str
    exercises: list[AiSuggestedExerciseResponse]
    provider_name: str
    model: str
    processing: Processing

    @classmethod
    def of(cls, result: WorkoutIdea) -> "AiWorkoutSuggestionResponse":
        w, p = result.workout, result.provenance
        return cls(
            name=w.name,
            category=w.category,
            description=w.description,
            notes=w.notes,
            exercises=[
                AiSuggestedExerciseResponse(
                    exercise_id=e.exercise.id,
                    exercise_name=e.exercise.details.name,
                    sets=e.plan.sets,
                    target_reps_min=e.plan.target_reps_min,
                    target_reps_max=e.plan.target_reps_max,
                    target_duration_s=e.plan.target_duration_s,
                    target_distance_m=e.plan.target_distance_m,
                    rest_seconds=e.plan.rest_seconds,
                    notes=e.plan.notes,
                )
                for e in w.exercises
            ],
            provider_name=p.provider_name,
            model=p.model,
            processing=_processing(p),
        )
