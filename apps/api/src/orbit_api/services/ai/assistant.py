"""The Orbit assistant: conversations, and answering a message from the person's own data.

One turn:

1. **Prepare** (before the response starts, so failures are ordinary HTTP errors): AI must be
   on, a chat provider chosen, and cloud processing allowed if the provider is in the cloud.
   The person's message is saved.
2. **Ground:** the question is routed deterministically to the modules it is about; those the
   person allows answer with structured data (`context.py`), and hybrid retrieval finds notes,
   documents, and other records (`retrieval.py`). Each becomes a numbered source.
3. **Generate:** the model gets the rules, a short recent history (not the whole conversation),
   the sources fenced as untrusted data, and the question. Its answer streams back, with any
   action block held back from the stream.
4. **Check and save:** citations to unknown sources are removed; proposals are kept only if the
   person asked for an action, then validated and stored as pending. The answer is saved with
   its sources, provider, model, and token counts.
"""

import uuid
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final, Protocol
from zoneinfo import ZoneInfo

import anyio

from orbit_api.services.ai.actions import ProposalService
from orbit_api.services.ai.configuration import AiConfigService, ResolvedProvider
from orbit_api.services.ai.context import ContextBuilder, Viewer
from orbit_api.services.ai.models import (
    AI_MODULES,
    AiModule,
    AiSettings,
    ChatMessage,
    ChatRequest,
    Citation,
    Conversation,
    ConversationNotFoundError,
    Message,
    MessageStatus,
    Processing,
    Proposal,
    RecordRef,
    TokenUsage,
    UsageLimitReachedError,
)
from orbit_api.services.ai.prompts import (
    ActionFenceFilter,
    check_answer,
    fit_history,
    render_record,
    system_prompt,
)
from orbit_api.services.ai.providers import (
    ProviderError,
    ProviderRateLimitError,
    ProviderUnavailableError,
)
from orbit_api.services.ai.retrieval import Retriever
from orbit_api.services.ai.routing import Route, route_question
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

HISTORY_CHARS: Final = 6000
HISTORY_TURNS: Final = 8
CONTEXT_CHARS: Final = 16000
RETRIEVED: Final = 6
MAX_ANSWER_TOKENS: Final = 1500
TITLE_LENGTH: Final = 60


class ConversationRepository(Protocol):
    async def recent(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, limit: int
    ) -> list[Conversation]: ...

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> Conversation | None: ...

    async def add(self, conversation: Conversation) -> None: ...

    async def save(self, conversation: Conversation) -> None: ...

    async def delete(self, conversation: Conversation) -> None: ...

    async def messages(self, conversation_id: uuid.UUID) -> list[Message]: ...

    async def add_message(self, message: Message) -> None: ...


@dataclass(frozen=True, slots=True)
class Grounding:
    citations: list[Citation]
    # The sources, rendered for the model.
    context: str
    failed_modules: list[AiModule]
    semantic: bool


@dataclass(frozen=True, slots=True)
class Turn:
    conversation: Conversation
    settings: AiSettings
    provider: ResolvedProvider
    viewer: Viewer
    question: str
    history: list[ChatMessage]


@dataclass(frozen=True, slots=True)
class SourcesEvent:
    citations: list[Citation]


@dataclass(frozen=True, slots=True)
class DeltaEvent:
    text: str


@dataclass(frozen=True, slots=True)
class DoneEvent:
    message: Message
    proposals: list[Proposal]


@dataclass(frozen=True, slots=True)
class ErrorEvent:
    message: str


type AssistantEvent = SourcesEvent | DeltaEvent | DoneEvent | ErrorEvent


def viewer_for(workspace_id: uuid.UUID, user_id: uuid.UUID, timezone: str, now: datetime) -> Viewer:
    return Viewer(
        workspace_id=workspace_id,
        user_id=user_id,
        today=now.astimezone(ZoneInfo(timezone)).date(),
        timezone=timezone,
        now=now.astimezone(ZoneInfo(timezone)),
    )


class Grounder:
    """Turns a question into numbered sources: structured context first, then retrieval."""

    def __init__(self, context: ContextBuilder, retriever: Retriever) -> None:
        self._context = context
        self._retriever = retriever

    async def ground(
        self,
        viewer: Viewer,
        question: str,
        route: Route,
        settings: AiSettings,
        embedder: ResolvedProvider | None,
        *,
        retrieve: bool = True,
    ) -> Grounding:
        blocks, failed = await self._context.build(viewer, route, settings.modules)
        citations: list[Citation] = []
        rendered: list[str] = []
        seen: set[tuple[str, uuid.UUID]] = set()
        budget = CONTEXT_CHARS

        def add(ref: RecordRef, body: str) -> None:
            nonlocal budget
            if budget <= 0:
                return
            if ref.id is not None:
                if (ref.kind, ref.id) in seen:
                    return
                seen.add((ref.kind, ref.id))
            number = len(citations) + 1
            text = render_record(number, ref.kind, ref.title, body[: min(1500, budget)])
            budget -= len(text)
            citations.append(Citation(number=number, ref=ref))
            rendered.append(text)

        for block in blocks:
            rendered.append(f"## {block.heading}" if block.items else f"## {block.heading}: none")
            for item in block.items:
                add(item.ref, item.body)
        semantic = False
        if retrieve:
            retrieval = await self._retriever.search(
                viewer.workspace_id,
                question,
                modules=settings.modules,
                embedder=embedder,
                limit=RETRIEVED,
            )
            semantic = retrieval.semantic
            if retrieval.matches:
                rendered.append("## Records matching the question")
            for match in retrieval.matches:
                location = f"Location: {match.ref.detail}\n" if match.ref.detail else ""
                add(match.ref, f"{location}{match.snippet}")
        if not citations:
            rendered.append("No matching Orbit records were found for this question.")
        return Grounding(
            citations=citations,
            context="\n\n".join(rendered),
            failed_modules=failed,
            semantic=semantic,
        )


class AssistantService:
    def __init__(
        self,
        *,
        config: AiConfigService,
        conversations: ConversationRepository,
        grounder: Grounder,
        proposals: ProposalService,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._config = config
        self._conversations = conversations
        self._grounder = grounder
        self._proposals = proposals
        self._transaction = transaction
        self._clock = clock

    # Conversations

    async def conversations(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, limit: int = 100
    ) -> list[Conversation]:
        return await self._conversations.recent(workspace_id, user_id, limit)

    async def conversation(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> tuple[Conversation, list[Message], list[Proposal]]:
        conversation = await self._get(workspace_id, user_id, conversation_id)
        messages = await self._conversations.messages(conversation.id)
        proposals = await self._proposals.for_messages(
            workspace_id, user_id, [m.id for m in messages if m.role == "assistant"]
        )
        return conversation, messages, proposals

    async def rename(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID, title: str
    ) -> Conversation:
        conversation = await self._get(workspace_id, user_id, conversation_id)
        renamed = replace(conversation, title=title, updated_at=self._clock())
        await self._conversations.save(renamed)
        await self._transaction.commit()
        return renamed

    async def delete(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> None:
        conversation = await self._get(workspace_id, user_id, conversation_id)
        await self._conversations.delete(conversation)
        await self._transaction.commit()

    # Answering

    async def prepare(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        conversation_id: uuid.UUID | None,
        question: str,
        timezone: str,
    ) -> Turn:
        settings = await self._config.require_enabled(user_id)
        provider = await self._config.chat_provider(settings, workspace_id, "chat")
        await self._config.usage.check_limit(user_id, settings.monthly_token_limit)
        now = self._clock()
        if conversation_id is None:
            conversation = Conversation(
                id=uuid.uuid4(),
                workspace_id=workspace_id,
                user_id=user_id,
                title=_title(question),
                created_at=now,
                updated_at=now,
            )
            await self._conversations.add(conversation)
            previous: list[Message] = []
        else:
            conversation = await self._get(workspace_id, user_id, conversation_id)
            previous = await self._conversations.messages(conversation.id)
            conversation = replace(conversation, updated_at=now)
            await self._conversations.save(conversation)
        await self._conversations.add_message(_message(conversation, "user", question, now=now))
        await self._transaction.commit()
        history = fit_history(
            [
                ChatMessage(role=m.role, content=m.content)
                for m in previous
                if m.status == "complete" and m.content
            ],
            HISTORY_CHARS,
            HISTORY_TURNS,
        )
        return Turn(
            conversation=conversation,
            settings=settings,
            provider=provider,
            viewer=viewer_for(workspace_id, user_id, timezone, now),
            question=question,
            history=history,
        )

    async def run(self, turn: Turn) -> AsyncIterator[AssistantEvent]:
        route = route_question(turn.question, turn.viewer.today)
        embedder = await self._config.embedding_provider(turn.settings, turn.viewer.workspace_id)
        grounding = await self._grounder.ground(
            turn.viewer, turn.question, route, turn.settings, embedder
        )
        yield SourcesEvent(grounding.citations)

        request = ChatRequest(
            model=turn.provider.model,
            messages=[
                ChatMessage(
                    role="system",
                    content=system_prompt(
                        today=turn.viewer.today,
                        timezone=turn.viewer.timezone,
                        now=turn.viewer.now,
                        style=turn.settings.response_style,
                        allow_actions=route.wants_action,
                        permitted=[m for m in AI_MODULES if m in turn.settings.modules],
                    ),
                ),
                *turn.history,
                ChatMessage(
                    role="user",
                    content=f"Sources from Orbit:\n\n{grounding.context}\n\n"
                    f"Question: {turn.question}",
                ),
            ],
            max_tokens=MAX_ANSWER_TOKENS,
        )
        provider = turn.provider
        parts: list[str] = []
        usage = TokenUsage()
        fence = ActionFenceFilter()
        finished = False
        try:
            while True:
                try:
                    async for chunk in provider.provider.stream(
                        replace(request, model=provider.model)
                    ):
                        if chunk.usage is not None:
                            usage = chunk.usage
                        if chunk.text:
                            parts.append(chunk.text)
                            visible = fence.feed(chunk.text)
                            if visible:
                                yield DeltaEvent(visible)
                    break
                except (ProviderUnavailableError, ProviderRateLimitError):
                    # The person's chosen fallback, only before anything was shown.
                    fallback = None
                    if not parts and provider is turn.provider:
                        fallback = await self._config.fallback_provider(
                            turn.settings, turn.viewer.workspace_id, "chat"
                        )
                    if fallback is None:
                        raise
                    provider = fallback
            rest = fence.flush()
            if rest:
                yield DeltaEvent(rest)
            finished = True
        except (ProviderError, UsageLimitReachedError) as exc:
            message = (
                exc.message
                if isinstance(exc, ProviderError)
                else "This month's AI token limit has been reached."
            )
            saved = await self._save(turn, message, [], "error", provider, usage)
            yield ErrorEvent(message)
            yield DoneEvent(saved, [])
            return
        finally:
            if not finished and parts:
                # Stopped by the person (the request was cancelled): keep what was written.
                with anyio.CancelScope(shield=True):
                    checked = check_answer("".join(parts), grounding.citations)
                    await self._save(
                        turn, checked.text, checked.citations, "stopped", provider, usage
                    )

        checked = check_answer("".join(parts), grounding.citations)
        saved = await self._save(turn, checked.text, checked.citations, "complete", provider, usage)
        proposals: list[Proposal] = []
        if route.wants_action and checked.actions:
            proposals = await self._proposals.propose(
                turn.viewer.workspace_id,
                turn.viewer.user_id,
                self._proposals.check(checked.actions, turn.viewer.timezone),
                conversation_id=turn.conversation.id,
                message_id=saved.id,
                from_untrusted_context=bool(grounding.citations),
            )
        yield DoneEvent(saved, proposals)

    async def _save(
        self,
        turn: Turn,
        text: str,
        citations: Sequence[Citation],
        status: MessageStatus,
        provider: ResolvedProvider,
        usage: TokenUsage,
    ) -> Message:
        message = _message(
            turn.conversation,
            "assistant",
            text[:100_000],
            now=self._clock(),
            citations=citations,
            status=status,
            provider=provider,
            usage=usage,
        )
        await self._conversations.add_message(message)
        await self._transaction.commit()
        return message

    async def _get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID
    ) -> Conversation:
        conversation = await self._conversations.get(workspace_id, user_id, conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        return conversation


def _title(question: str) -> str:
    title = " ".join(question.split())
    return title if len(title) <= TITLE_LENGTH else title[: TITLE_LENGTH - 1].rstrip() + "…"


def _message(
    conversation: Conversation,
    role: str,
    content: str,
    *,
    now: datetime,
    citations: Sequence[Citation] = (),
    status: MessageStatus = "complete",
    provider: ResolvedProvider | None = None,
    usage: TokenUsage | None = None,
) -> Message:
    processing: Processing | None = provider.processing if provider else None
    return Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        workspace_id=conversation.workspace_id,
        role="user" if role == "user" else "assistant",
        content=content,
        citations=tuple(citations),
        status=status,
        provider_name=provider.connection.name if provider else None,
        model=provider.model if provider else None,
        processing=processing,
        usage=usage or TokenUsage(),
        created_at=now,
    )
