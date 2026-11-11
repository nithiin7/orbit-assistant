import type {
  AiAssistRequest,
  AiAssistResult,
  AiConnectionTest,
  AiConversation,
  AiConversationDetail,
  AiConversationList,
  AiFoodEstimate,
  AiFoodEstimateRequest,
  AiFoodIdeas,
  AiFoodIdeasRequest,
  AiIndexStatus,
  AiInsightList,
  AiModelList,
  AiProposal,
  AiProvider,
  AiProviderList,
  AiSearchQuery,
  AiSearchResults,
  AiSettings,
  AiUsage,
  AiWatchPicks,
  AiWorkoutSuggestion,
  AiWorkoutSuggestionRequest,
  CreateAiProviderRequest,
  TestAiProviderRequest,
  UpdateAiProviderRequest,
  UpdateAiSettingsRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

const ME = "/api/v1/me/ai";

// Settings, providers, and usage (per person)

export function getAiSettings(token: string, { signal }: Signal = {}): Promise<AiSettings> {
  return request<AiSettings>(`${ME}/settings`, { token, signal });
}

export function updateAiSettings(
  token: string,
  body: UpdateAiSettingsRequest,
): Promise<AiSettings> {
  return request<AiSettings>(`${ME}/settings`, { method: "PATCH", body, token });
}

export function listAiProviders(token: string, { signal }: Signal = {}): Promise<AiProviderList> {
  return request<AiProviderList>(`${ME}/providers`, { token, signal });
}

export function createAiProvider(
  token: string,
  body: CreateAiProviderRequest,
): Promise<AiProvider> {
  return request<AiProvider>(`${ME}/providers`, { method: "POST", body, token });
}

export function updateAiProvider(
  token: string,
  providerId: string,
  body: UpdateAiProviderRequest,
): Promise<AiProvider> {
  return request<AiProvider>(`${ME}/providers/${encodeURIComponent(providerId)}`, {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteAiProvider(token: string, providerId: string): Promise<void> {
  return request<void>(`${ME}/providers/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    token,
  });
}

/** Check a connection without saving it. Spends no tokens. */
export function testAiProvider(
  token: string,
  body: TestAiProviderRequest,
): Promise<AiConnectionTest> {
  return request<AiConnectionTest>(`${ME}/providers/test`, { method: "POST", body, token });
}

export function listAiModels(
  token: string,
  providerId: string,
  { signal }: Signal = {},
): Promise<AiModelList> {
  return request<AiModelList>(`${ME}/providers/${encodeURIComponent(providerId)}/models`, {
    token,
    signal,
  });
}

export function getAiUsage(token: string, days = 30, { signal }: Signal = {}): Promise<AiUsage> {
  return request<AiUsage>(`${ME}/usage${toQueryString({ days })}`, { token, signal });
}

// Conversations, proposals, and features (per workspace)

const ai = (workspaceId: string, suffix: string) => workspacePath(workspaceId, `/ai${suffix}`);

export function listConversations(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<AiConversationList> {
  return request<AiConversationList>(ai(workspaceId, "/conversations"), { token, signal });
}

export function getConversation(
  token: string,
  workspaceId: string,
  conversationId: string,
  { signal }: Signal = {},
): Promise<AiConversationDetail> {
  return request<AiConversationDetail>(
    ai(workspaceId, `/conversations/${encodeURIComponent(conversationId)}`),
    { token, signal },
  );
}

export function renameConversation(
  token: string,
  workspaceId: string,
  conversationId: string,
  title: string,
): Promise<AiConversation> {
  return request<AiConversation>(
    ai(workspaceId, `/conversations/${encodeURIComponent(conversationId)}`),
    { method: "PATCH", body: { title }, token },
  );
}

export function deleteConversation(
  token: string,
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  return request<void>(ai(workspaceId, `/conversations/${encodeURIComponent(conversationId)}`), {
    method: "DELETE",
    token,
  });
}

export function decideProposal(
  token: string,
  workspaceId: string,
  proposalId: string,
  decision: "approve" | "reject",
): Promise<AiProposal> {
  return request<AiProposal>(
    ai(workspaceId, `/proposals/${encodeURIComponent(proposalId)}/${decision}`),
    { method: "POST", token },
  );
}

export function runAssist(
  token: string,
  workspaceId: string,
  body: AiAssistRequest,
): Promise<AiAssistResult> {
  return request<AiAssistResult>(ai(workspaceId, "/assist"), { method: "POST", body, token });
}

// Health helpers: drafts only; the person saves them through the fitness routes.

export function estimateFood(
  token: string,
  workspaceId: string,
  body: AiFoodEstimateRequest,
): Promise<AiFoodEstimate> {
  return request<AiFoodEstimate>(ai(workspaceId, "/health/food-estimate"), {
    method: "POST",
    body,
    token,
  });
}

export function suggestFoods(
  token: string,
  workspaceId: string,
  body: AiFoodIdeasRequest,
): Promise<AiFoodIdeas> {
  return request<AiFoodIdeas>(ai(workspaceId, "/health/food-ideas"), {
    method: "POST",
    body,
    token,
  });
}

/** AI's picks among the watchlist's suggestions, each with a reason. */
export function pickWatchSuggestions(token: string, workspaceId: string): Promise<AiWatchPicks> {
  return request<AiWatchPicks>(ai(workspaceId, "/watchlist/suggestions"), {
    method: "POST",
    token,
  });
}

export function suggestWorkout(
  token: string,
  workspaceId: string,
  body: AiWorkoutSuggestionRequest,
): Promise<AiWorkoutSuggestion> {
  return request<AiWorkoutSuggestion>(ai(workspaceId, "/health/workout-suggestion"), {
    method: "POST",
    body,
    token,
  });
}

export function semanticSearch(
  token: string,
  workspaceId: string,
  query: AiSearchQuery,
  { signal }: Signal = {},
): Promise<AiSearchResults> {
  return request<AiSearchResults>(`${ai(workspaceId, "/search")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function listInsights(
  token: string,
  workspaceId: string,
  timezone: string | undefined,
  { signal }: Signal = {},
): Promise<AiInsightList> {
  return request<AiInsightList>(`${ai(workspaceId, "/insights")}${toQueryString({ timezone })}`, {
    token,
    signal,
  });
}

export function dismissInsight(token: string, workspaceId: string, key: string): Promise<void> {
  return request<void>(ai(workspaceId, "/insights/dismiss"), {
    method: "POST",
    body: { key },
    token,
  });
}

export function getAiIndex(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<AiIndexStatus> {
  return request<AiIndexStatus>(ai(workspaceId, "/index"), { token, signal });
}

export function changeAiIndex(
  token: string,
  workspaceId: string,
  action: "rebuild" | "retry" | "clear",
): Promise<void> {
  if (action === "clear") {
    return request<void>(ai(workspaceId, "/index"), { method: "DELETE", token });
  }
  return request<{ affected: number }>(ai(workspaceId, `/index/${action}`), {
    method: "POST",
    token,
  }).then(() => undefined);
}
