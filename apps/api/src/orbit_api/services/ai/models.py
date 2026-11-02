"""AI layer types: settings, provider connections, the retrieval index, conversations, action
proposals, usage, and insights. Plain dataclasses and errors, free of any vendor SDK."""

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Final, Literal, get_args

# Modules whose data the assistant may read, each switched on or off by the user. Health and
# finance are sensitive and off by default; documents too, since they often hold identity and
# insurance papers.
AiModule = Literal[
    "tasks", "notes", "calendar", "reminders", "habits", "documents", "finance", "health"
]
AI_MODULES: Final[tuple[AiModule, ...]] = get_args(AiModule)
DEFAULT_MODULES: Final[frozenset[AiModule]] = frozenset(
    {"tasks", "notes", "calendar", "reminders", "habits"}
)

ProviderKind = Literal["openai", "anthropic", "gemini", "ollama", "openai_compatible"]
PROVIDER_KINDS: Final[tuple[ProviderKind, ...]] = get_args(ProviderKind)

# Where a provider runs, decided from its endpoint's host: a loopback or private address is
# `local` (this machine or this network), anything else is `cloud`.
Processing = Literal["local", "cloud"]

ResponseStyle = Literal["concise", "balanced", "detailed"]

# What the index holds: text-rich records. Finance, reminders, and health are answered from
# structured queries instead, so their numbers come from the modules' own calculations.
SourceType = Literal["note", "document", "task", "event", "habit"]
SOURCE_TYPES: Final[tuple[SourceType, ...]] = get_args(SourceType)
SOURCE_MODULE: Final[dict[SourceType, AiModule]] = {
    "note": "notes",
    "document": "documents",
    "task": "tasks",
    "event": "calendar",
    "habit": "habits",
}

IndexStatus = Literal["pending", "indexed", "failed", "skipped"]
UsageOperation = Literal["chat", "assist", "embedding", "test"]


@dataclass(frozen=True, slots=True)
class AiSettings:
    """One person's AI configuration. Off until they turn it on."""

    user_id: uuid.UUID
    enabled: bool = False
    chat_provider_id: uuid.UUID | None = None
    chat_model: str | None = None
    embedding_provider_id: uuid.UUID | None = None
    embedding_model: str | None = None
    # Used only when the chat provider is unreachable or rate limited, and only if set. Orbit
    # never switches providers on its own.
    fallback_provider_id: uuid.UUID | None = None
    fallback_model: str | None = None
    # Consent to send data to providers that run in the cloud. Without it only local providers
    # are used, and requests to cloud ones are refused.
    allow_cloud: bool = False
    modules: frozenset[AiModule] = DEFAULT_MODULES
    response_style: ResponseStyle = "balanced"
    # Tokens per calendar month (UTC) across all requests; `None` is no limit.
    monthly_token_limit: int | None = None
    indexing_enabled: bool = True
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ProviderConnection:
    """A configured provider. The API key is stored encrypted and never leaves the server."""

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    kind: ProviderKind
    # `None` uses the provider's public endpoint (or `http://localhost:11434` for Ollama).
    base_url: str | None
    api_key_ciphertext: str | None
    # User-entered prices in micro-USD per million tokens, for cost estimates. Orbit ships no
    # price list, since prices change.
    input_price: int | None
    output_price: int | None
    created_at: datetime
    updated_at: datetime

    @property
    def has_api_key(self) -> bool:
        return self.api_key_ciphertext is not None


@dataclass(frozen=True, slots=True)
class Capabilities:
    chat: bool
    streaming: bool
    structured_output: bool
    embeddings: bool
    model_listing: bool
    usage_reporting: bool


@dataclass(frozen=True, slots=True)
class ModelInfo:
    id: str
    # Best effort: from the provider when it says (Gemini), else from the model's name.
    embeddings: bool
    chat: bool


# Conversation and generation


ChatRole = Literal["system", "user", "assistant"]


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: ChatRole
    content: str


@dataclass(frozen=True, slots=True)
class TokenUsage:
    input_tokens: int | None = None
    output_tokens: int | None = None

    @property
    def total(self) -> int:
        return (self.input_tokens or 0) + (self.output_tokens or 0)


@dataclass(frozen=True, slots=True)
class ChatRequest:
    model: str
    messages: list[ChatMessage]
    temperature: float = 0.2
    max_tokens: int = 1024
    # Ask for a single JSON object, natively where the provider supports it.
    json_mode: bool = False


@dataclass(frozen=True, slots=True)
class Completion:
    text: str
    usage: TokenUsage = field(default_factory=TokenUsage)


@dataclass(frozen=True, slots=True)
class StreamChunk:
    """A piece of a streamed answer: some text, or (last) the usage the provider reported."""

    text: str = ""
    usage: TokenUsage | None = None


@dataclass(frozen=True, slots=True)
class Embeddings:
    vectors: list[list[float]]
    usage: TokenUsage = field(default_factory=TokenUsage)


# Retrieval


@dataclass(frozen=True, slots=True)
class RecordRef:
    """An Orbit record an answer can point to. `kind` is wider than `SourceType`: structured
    context also cites transactions, payments, reminders, budgets, and workouts."""

    kind: str
    # `None` for a summary Orbit calculated (a month's spending), which links to its module.
    id: uuid.UUID | None
    title: str
    # A date that places it: a task's due date, an event's day, a transaction's date.
    day: date | None = None
    # A short identifying line: a document page, a note section, an amount.
    detail: str = ""


@dataclass(frozen=True, slots=True)
class Citation:
    """A numbered source given to the model (`[S1]`). Created only from records Orbit
    retrieved, never from the model's output."""

    number: int
    ref: RecordRef
    cited: bool = False


@dataclass(frozen=True, slots=True)
class SearchMatch:
    ref: RecordRef
    source_type: SourceType | str
    snippet: str
    score: float
    keyword: bool
    semantic: bool


@dataclass(frozen=True, slots=True)
class SourceSection:
    """A piece of a record's text with where it came from: `Page 3`, `Goals`."""

    location: str
    text: str


@dataclass(frozen=True, slots=True)
class SourceContent:
    """What is indexed for one record."""

    source_type: SourceType
    source_id: uuid.UUID
    title: str
    day: date | None
    sections: list[SourceSection]


@dataclass(frozen=True, slots=True)
class SourceStamp:
    """A record as the catalog lists it: enough to tell whether it changed since indexing."""

    source_type: SourceType
    source_id: uuid.UUID
    title: str
    day: date | None
    content_hash: str


@dataclass(frozen=True, slots=True)
class IndexedSource:
    id: uuid.UUID
    workspace_id: uuid.UUID
    source_type: SourceType
    source_id: uuid.UUID
    title: str
    day: date | None
    content_hash: str
    status: IndexStatus
    attempts: int
    last_error: str | None
    embedding_model: str | None
    chunk_count: int
    indexed_at: datetime | None
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Chunk:
    position: int
    location: str
    text: str
    vector: list[float]


@dataclass(frozen=True, slots=True)
class StoredChunk:
    source_type: SourceType
    source_id: uuid.UUID
    title: str
    day: date | None
    location: str
    text: str
    vector: list[float]


@dataclass(frozen=True, slots=True)
class IndexSummary:
    counts: dict[IndexStatus, int]
    embedding_model: str | None
    last_indexed_at: datetime | None
    # Whether an embedding model is configured and permitted, so the worker indexes.
    active: bool


# Conversations

MessageStatus = Literal["complete", "error", "stopped"]


@dataclass(frozen=True, slots=True)
class Conversation:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class Message:
    id: uuid.UUID
    conversation_id: uuid.UUID
    workspace_id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    citations: tuple[Citation, ...]
    status: MessageStatus
    provider_name: str | None
    model: str | None
    processing: Processing | None
    usage: TokenUsage
    created_at: datetime


# Actions

ActionKind = Literal[
    "create_task",
    "create_reminder",
    "create_event",
    "create_note",
    "append_to_note",
    "add_note_tags",
    "update_document_details",
]
ACTION_KINDS: Final[tuple[ActionKind, ...]] = get_args(ActionKind)
ProposalStatus = Literal["pending", "executing", "executed", "rejected", "failed"]


@dataclass(frozen=True, slots=True)
class Proposal:
    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    conversation_id: uuid.UUID | None
    message_id: uuid.UUID | None
    kind: ActionKind
    # Validated against the target module's own request schema before it is stored.
    payload: dict[str, object]
    summary: str
    status: ProposalStatus
    # Proposed while the model was reading records (which may contain injected instructions),
    # so the preview asks for extra care.
    from_untrusted_context: bool
    result_kind: str | None
    result_id: uuid.UUID | None
    error: str | None
    created_at: datetime
    decided_at: datetime | None


@dataclass(frozen=True, slots=True)
class ActionResult:
    kind: str
    id: uuid.UUID
    title: str


# Usage


@dataclass(frozen=True, slots=True)
class UsageRecord:
    """One provider call. Never the prompt or the answer."""

    user_id: uuid.UUID
    workspace_id: uuid.UUID | None
    provider_kind: ProviderKind
    provider_name: str
    model: str
    operation: UsageOperation
    usage: TokenUsage
    cost_micros: int | None
    duration_ms: int
    success: bool
    error_type: str | None
    processing: Processing
    created_at: datetime


@dataclass(frozen=True, slots=True)
class UsageLine:
    provider_name: str
    model: str
    operation: UsageOperation
    requests: int
    failures: int
    input_tokens: int
    output_tokens: int
    cost_micros: int | None


@dataclass(frozen=True, slots=True)
class UsageSummary:
    since: datetime
    lines: list[UsageLine]
    month_tokens: int
    monthly_token_limit: int | None

    @property
    def near_limit(self) -> bool:
        limit = self.monthly_token_limit
        return limit is not None and self.month_tokens >= limit * 0.8


# Insights

InsightKind = Literal[
    "spending_trend",
    "budget",
    "upcoming_payments",
    "habit_consistency",
    "task_completion",
    "calendar_workload",
    "document_expiry",
]


@dataclass(frozen=True, slots=True)
class Insight:
    """A deterministic observation about recorded data. `key` includes the period, so
    dismissing it hides it until the period changes."""

    key: str
    kind: InsightKind
    module: AiModule
    title: str
    body: str
    period_start: date
    period_end: date
    refs: tuple[RecordRef, ...] = ()
    tone: Literal["neutral", "positive", "attention"] = "neutral"


# Errors


class AiDisabledError(Exception):
    """AI is turned off for this person, or for the whole server."""


class AiNotConfiguredError(Exception):
    """No provider or model is selected for what was asked."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class CloudProcessingNotAllowedError(Exception):
    """The provider runs in the cloud and the person hasn't allowed cloud processing."""


class ModuleNotPermittedError(Exception):
    """The person hasn't allowed AI to read this module."""

    def __init__(self, module: AiModule) -> None:
        super().__init__(module)
        self.module = module


class UsageLimitReachedError(Exception):
    """This month's token limit has been reached."""


class ProviderNotFoundError(Exception):
    """The provider connection doesn't exist for this person."""


class ProviderNameTakenError(Exception):
    """Another provider connection has this name."""


class CredentialsUnavailableError(Exception):
    """The server can't store or read API keys (no encryption key is configured)."""


class EndpointNotAllowedError(ValueError):
    """The endpoint points somewhere this server doesn't allow providers to be reached."""


class ConversationNotFoundError(Exception):
    """The conversation doesn't exist for this person in this workspace."""


class ProposalNotFoundError(Exception):
    """The proposal doesn't exist for this person in this workspace."""


class ProposalNotPendingError(Exception):
    """The proposal was already approved, rejected, or is being executed."""


class InvalidActionError(ValueError):
    """A proposed action failed validation. The message is safe to show."""


class SourceNotFoundError(Exception):
    """The record an assist request is about doesn't exist or isn't readable."""
