import type { AiSearchQuery } from "@orbit/contracts";
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  getAiIndex,
  getAiSettings,
  getAiUsage,
  getConversation,
  listAiModels,
  listAiProviders,
  listConversations,
  listInsights,
  semanticSearch,
} from "./requests";

export const aiKeys = {
  /** Per person, not per workspace: settings, providers, models, usage. */
  me: () => ["me", "ai"] as const,
  settings: () => [...aiKeys.me(), "settings"] as const,
  providers: () => [...aiKeys.me(), "providers"] as const,
  models: (providerId: string) => [...aiKeys.me(), "models", providerId] as const,
  usage: (days: number) => [...aiKeys.me(), "usage", days] as const,
  workspace: (workspaceId: string | null) => ["workspaces", workspaceId, "ai"] as const,
  conversations: (workspaceId: string | null) =>
    [...aiKeys.workspace(workspaceId), "conversations"] as const,
  conversation: (workspaceId: string | null, conversationId: string) =>
    [...aiKeys.conversations(workspaceId), conversationId] as const,
  insights: (workspaceId: string | null, timezone: string | undefined) =>
    [...aiKeys.workspace(workspaceId), "insights", timezone] as const,
  index: (workspaceId: string | null) => [...aiKeys.workspace(workspaceId), "index"] as const,
  search: (workspaceId: string | null, query: AiSearchQuery) =>
    [...aiKeys.workspace(workspaceId), "search", query] as const,
};

export function aiSettingsOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: aiKeys.settings(),
    queryFn: ({ signal }) => withToken((token) => getAiSettings(token, { signal })),
  });
}

export function aiProvidersOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: aiKeys.providers(),
    queryFn: ({ signal }) => withToken((token) => listAiProviders(token, { signal })),
  });
}

/** A provider's models. Asked of the provider itself, so cached for a few minutes. */
export function aiModelsOptions(withToken: WithToken, providerId: string | null) {
  return queryOptions({
    queryKey: aiKeys.models(providerId ?? ""),
    queryFn:
      providerId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listAiModels(token, providerId, { signal })),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function aiUsageOptions(withToken: WithToken, days = 30) {
  return queryOptions({
    queryKey: aiKeys.usage(days),
    queryFn: ({ signal }) => withToken((token) => getAiUsage(token, days, { signal })),
  });
}

export function conversationsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: aiKeys.conversations(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listConversations(token, workspaceId, { signal })),
  });
}

export function conversationOptions(
  withToken: WithToken,
  workspaceId: string | null,
  conversationId: string | null,
) {
  return queryOptions({
    queryKey: aiKeys.conversation(workspaceId, conversationId ?? ""),
    queryFn:
      workspaceId === null || conversationId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getConversation(token, workspaceId, conversationId, { signal })),
  });
}

export function insightsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  timezone: string | undefined,
) {
  return queryOptions({
    queryKey: aiKeys.insights(workspaceId, timezone),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listInsights(token, workspaceId, timezone, { signal })),
    staleTime: 5 * 60_000,
  });
}

export function aiIndexOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: aiKeys.index(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getAiIndex(token, workspaceId, { signal })),
  });
}

export function semanticSearchOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: AiSearchQuery,
) {
  return queryOptions({
    queryKey: aiKeys.search(workspaceId, query),
    queryFn:
      workspaceId === null || query.q.trim().length < 2
        ? skipToken
        : ({ signal }) =>
            withToken((token) => semanticSearch(token, workspaceId, query, { signal })),
    placeholderData: keepPreviousData,
  });
}
