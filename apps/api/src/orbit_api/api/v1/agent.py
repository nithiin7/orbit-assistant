"""The personal agent and automation: configuration, tools, workflows, runs, history,
approvals, and memory, all under one workspace.

Everything is authorized by `WorkspaceDep` and scoped to the signed-in person; another person's
workflow, run, approval, or memory is 404. Permissions change only through `PATCH /agent`.
"""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import AgentServicesDep, SettingsDep
from orbit_api.schemas.agent import (
    AgentApprovalListResponse,
    AgentApprovalQueryParams,
    AgentApprovalResponse,
    AgentExecutionDetailResponse,
    AgentExecutionListResponse,
    AgentExecutionQueryParams,
    AgentExecutionResponse,
    AgentExecutionStepResponse,
    AgentMemoryListResponse,
    AgentMemoryQueryParams,
    AgentMemoryRequest,
    AgentMemoryResponse,
    AgentOverviewResponse,
    AgentResponse,
    AgentRuntimeResponse,
    AgentToolListResponse,
    AgentToolResponse,
    AgentWorkflowListResponse,
    AgentWorkflowRequest,
    AgentWorkflowResponse,
    ApproveAgentActionRequest,
    RunAgentWorkflowRequest,
    SetAgentWorkflowEnabledRequest,
    StartAgentRunRequest,
    UpdateAgentRequest,
)
from orbit_api.services.agent.models import (
    AgentDisabledError,
    ApprovalChangedError,
    ApprovalExpiredError,
    ApprovalNotFoundError,
    ApprovalNotPendingError,
    ExecutionFinishedError,
    ExecutionNotFoundError,
    ExecutionNotRetryableError,
    ExecutionQuery,
    InvalidWorkflowError,
    MemoryNotFoundError,
    RunLimitReachedError,
    WorkflowNotFoundError,
)
from orbit_api.services.ai.models import (
    AiDisabledError,
    AiNotConfiguredError,
    CloudProcessingNotAllowedError,
    ProviderNotFoundError,
    UsageLimitReachedError,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/agent",
    tags=["agent"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace (or record) does not exist or is not accessible."},
    },
)


@contextmanager
def _errors() -> Generator[None]:
    """Map the agent's errors to safe HTTP errors."""
    try:
        yield
    except AgentDisabledError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The agent is turned off. Turn it on in Automation → Settings.",
        ) from None
    except (WorkflowNotFoundError, ExecutionNotFoundError, ApprovalNotFoundError):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.") from None
    except MemoryNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found.") from None
    except InvalidWorkflowError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except ApprovalChangedError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This action changed since you reviewed it. Review it again before approving.",
        ) from None
    except ApprovalExpiredError:
        raise HTTPException(status.HTTP_409_CONFLICT, "This approval has expired.") from None
    except ApprovalNotPendingError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This approval was already decided."
        ) from None
    except ExecutionFinishedError:
        raise HTTPException(status.HTTP_409_CONFLICT, "This run already finished.") from None
    except ExecutionNotRetryableError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only failed runs can be retried.") from None
    except RunLimitReachedError:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Today's limit of runs has been reached."
        ) from None
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
    except ProviderNotFoundError:
        raise HTTPException(status.HTTP_409_CONFLICT, "The AI provider no longer exists.") from None
    except UsageLimitReachedError:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "This month's AI token limit has been reached."
        ) from None


# The agent


@router.get("", summary="Agent overview")
async def overview(
    workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep, settings: SettingsDep
) -> AgentOverviewResponse:
    """The person's agent here (created, turned off, the first time), recent activity, pending
    approvals, and where automations run."""
    result = await agent.service.overview(workspace.id, user.id)
    runtime = AgentRuntimeResponse(
        server_enabled=agent.service.server_enabled,
        storage_mode=settings.storage_mode,
        worker_embedded=settings.scheduler_embedded,
        poll_seconds=settings.scheduler_poll_seconds,
    )
    return AgentOverviewResponse.of(result, runtime)


@router.patch("", summary="Update the agent's settings and permissions")
async def update_agent(
    body: UpdateAgentRequest, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentResponse:
    with _errors():
        return AgentResponse.of(
            await agent.service.update(workspace.id, user.id, body.to_changes())
        )


@router.get("/tools", summary="The tool registry, with what the agent may do with each")
async def list_tools(
    workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentToolListResponse:
    current = await agent.service.agent(workspace.id, user.id)
    views = await agent.service.tools(workspace.id, user.id)
    return AgentToolListResponse(tools=[AgentToolResponse.of(v, current) for v in views])


# Runs


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED, summary="Ask the agent to do something")
async def start_run(
    body: StartAgentRunRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentExecutionResponse:
    """Queues an agent run; the worker plans and runs it, asking for approval where needed.
    Needs AI to be set up. The same `idempotency_key` returns the same run."""
    with _errors():
        execution = await agent.service.start_run(
            workspace.id, user.id, body.goal, body.idempotency_key
        )
    return AgentExecutionResponse.of(execution)


@router.get("/executions", summary="Execution history")
async def list_executions(
    params: Annotated[AgentExecutionQueryParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentExecutionListResponse:
    executions = await agent.service.executions(
        workspace.id,
        user.id,
        ExecutionQuery(
            statuses=frozenset(params.status), workflow_id=params.workflow_id, limit=params.limit
        ),
    )
    return AgentExecutionListResponse(executions=[AgentExecutionResponse.of(e) for e in executions])


@router.get("/executions/{execution_id}", summary="One execution with its steps")
async def get_execution(
    execution_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentExecutionDetailResponse:
    with _errors():
        execution, steps, approvals = await agent.service.execution(
            workspace.id, user.id, execution_id
        )
    return AgentExecutionDetailResponse(
        execution=AgentExecutionResponse.of(execution),
        steps=[AgentExecutionStepResponse.of(s) for s in steps],
        approvals=[AgentApprovalResponse.of(a) for a in approvals],
    )


@router.post("/executions/{execution_id}/cancel", summary="Cancel a run")
async def cancel_execution(
    execution_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentExecutionResponse:
    """A queued or waiting run stops now (its pending approvals are cancelled); a running one
    stops before its next step."""
    with _errors():
        return AgentExecutionResponse.of(
            await agent.service.cancel(workspace.id, user.id, execution_id)
        )


@router.post("/executions/{execution_id}/retry", summary="Retry a failed run")
async def retry_execution(
    execution_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentExecutionResponse:
    """Resumes from the step that failed. That step's change, if any, was never saved, so
    nothing is done twice."""
    with _errors():
        return AgentExecutionResponse.of(
            await agent.service.retry(workspace.id, user.id, execution_id)
        )


# Workflows


@router.get("/workflows", summary="List workflows")
async def list_workflows(
    workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentWorkflowListResponse:
    workflows = await agent.service.workflows(workspace.id, user.id)
    return AgentWorkflowListResponse(workflows=[AgentWorkflowResponse.of(w) for w in workflows])


@router.post("/workflows", status_code=status.HTTP_201_CREATED, summary="Create a workflow")
async def create_workflow(
    body: AgentWorkflowRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentWorkflowResponse:
    with _errors():
        return AgentWorkflowResponse.of(
            await agent.service.create_workflow(workspace.id, user.id, body.to_draft())
        )


@router.get("/workflows/{workflow_id}", summary="Get a workflow")
async def get_workflow(
    workflow_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentWorkflowResponse:
    with _errors():
        return AgentWorkflowResponse.of(
            await agent.service.workflow(workspace.id, user.id, workflow_id)
        )


@router.put("/workflows/{workflow_id}", summary="Replace a workflow's definition")
async def update_workflow(
    workflow_id: uuid.UUID,
    body: AgentWorkflowRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentWorkflowResponse:
    with _errors():
        return AgentWorkflowResponse.of(
            await agent.service.update_workflow(workspace.id, user.id, workflow_id, body.to_draft())
        )


@router.post("/workflows/{workflow_id}/enabled", summary="Turn a workflow on or off")
async def set_workflow_enabled(
    workflow_id: uuid.UUID,
    body: SetAgentWorkflowEnabledRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentWorkflowResponse:
    with _errors():
        return AgentWorkflowResponse.of(
            await agent.service.set_workflow_enabled(
                workspace.id, user.id, workflow_id, body.enabled
            )
        )


@router.delete(
    "/workflows/{workflow_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a workflow",
)
async def delete_workflow(
    workflow_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> Response:
    """Its waiting runs are cancelled; its history stays."""
    with _errors():
        await agent.service.delete_workflow(workspace.id, user.id, workflow_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/workflows/{workflow_id}/run",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Run a workflow now",
)
async def run_workflow(
    workflow_id: uuid.UUID,
    body: RunAgentWorkflowRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentExecutionResponse:
    with _errors():
        execution = await agent.service.run_workflow(
            workspace.id, user.id, workflow_id, body.idempotency_key
        )
    return AgentExecutionResponse.of(execution)


# Approvals


@router.get("/approvals", summary="Approval requests")
async def list_approvals(
    params: Annotated[AgentApprovalQueryParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentApprovalListResponse:
    """Approvals past their expiry are expired as they are listed."""
    approvals = await agent.service.approvals(
        workspace.id, user.id, frozenset(params.status), params.limit
    )
    return AgentApprovalListResponse(approvals=[AgentApprovalResponse.of(a) for a in approvals])


@router.post("/approvals/{approval_id}/approve", summary="Approve and run an exact action")
async def approve(
    approval_id: uuid.UUID,
    body: ApproveAgentActionRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentApprovalResponse:
    """`arguments_hash` must be the one shown with the approval: a decision only ever runs the
    action that was reviewed. Permissions and the target record are checked again first; a
    second approval is 409."""
    with _errors():
        return AgentApprovalResponse.of(
            await agent.service.approve(workspace.id, user.id, approval_id, body.arguments_hash)
        )


@router.post("/approvals/{approval_id}/reject", summary="Reject an action")
async def reject(
    approval_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentApprovalResponse:
    with _errors():
        return AgentApprovalResponse.of(
            await agent.service.reject(workspace.id, user.id, approval_id)
        )


# Memory


@router.get("/memories", summary="What the agent remembers")
async def list_memories(
    params: Annotated[AgentMemoryQueryParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentMemoryListResponse:
    memories = await agent.service.memories(workspace.id, user.id, params.category)
    return AgentMemoryListResponse(memories=[AgentMemoryResponse.of(m) for m in memories])


@router.post("/memories", status_code=status.HTTP_201_CREATED, summary="Save a preference")
async def add_memory(
    body: AgentMemoryRequest, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> AgentMemoryResponse:
    with _errors():
        return AgentMemoryResponse.of(
            await agent.service.add_memory(workspace.id, user.id, body.content)
        )


@router.patch("/memories/{memory_id}", summary="Edit a memory")
async def update_memory(
    memory_id: uuid.UUID,
    body: AgentMemoryRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    agent: AgentServicesDep,
) -> AgentMemoryResponse:
    with _errors():
        return AgentMemoryResponse.of(
            await agent.service.update_memory(workspace.id, user.id, memory_id, body.content)
        )


@router.delete(
    "/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Forget a memory"
)
async def delete_memory(
    memory_id: uuid.UUID, workspace: WorkspaceDep, user: CurrentUserDep, agent: AgentServicesDep
) -> Response:
    with _errors():
        await agent.service.delete_memory(workspace.id, user.id, memory_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
