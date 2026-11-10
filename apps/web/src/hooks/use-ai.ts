"use client";

import type {
  AiAssistRequest,
  AiAssistResult,
  AiCitation,
  AiConnectionTest,
  AiConversationDetail,
  AiConversationList,
  AiFoodEstimate,
  AiFoodIdeas,
  AiIndexStatus,
  AiInsight,
  AiModel,
  AiModelList,
  AiModule,
  AiProposal,
  AiProvider,
  AiProviderList,
  AiSettings,
  AiUsage,
  AiWorkoutSuggestion,
  CreateAiProviderRequest,
  TestAiProviderRequest,
  UpdateAiProviderRequest,
  UpdateAiSettingsRequest,
} from "@orbit/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import {
  aiIndexOptions,
  aiKeys,
  aiModelsOptions,
  aiProvidersOptions,
  aiSettingsOptions,
  aiUsageOptions,
  changeAiIndex,
  conversationOptions,
  conversationsOptions,
  createAiProvider,
  decideProposal,
  deleteAiProvider,
  deleteConversation,
  dismissInsight,
  estimateFood,
  insightsOptions,
  renameConversation,
  runAssist,
  streamAiMessage,
  suggestFoods,
  suggestWorkout,
  testAiProvider,
  updateAiProvider,
  updateAiSettings,
} from "@/api/ai";
import { describeApiError } from "@/api/client";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useActiveWorkspaceId, useViewerTimeZone } from "@/hooks/use-calendar";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

// Settings and providers

export function useAiSettings(): Resource<AiSettings> {
  const { withToken } = useAuth();
  return queryResource(useQuery(aiSettingsOptions(withToken)), "Couldn’t load AI settings.");
}

export function useUpdateAiSettings() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAiSettingsRequest) =>
      withToken((token) => updateAiSettings(token, body)),
    onSuccess: (settings) => {
      queryClient.setQueryData(aiKeys.settings(), settings);
      // The index and insights depend on which modules AI may read.
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[2] === "ai" });
    },
  });
}

export function useAiProviders(): Resource<AiProviderList> {
  const { withToken } = useAuth();
  return queryResource(useQuery(aiProvidersOptions(withToken)), "Couldn’t load providers.");
}

export function useAiModels(providerId: string | null): Resource<AiModelList> {
  const { withToken } = useAuth();
  return queryResource(useQuery(aiModelsOptions(withToken, providerId)), "Couldn’t list models.");
}

/** Every provider with the models it lists; a provider that can't list models comes back empty. */
export function useChatModelCatalog(): Resource<{ id: string; name: string; models: AiModel[] }[]> {
  const { withToken } = useAuth();
  const providers = useAiProviders();
  const list = providers.status === "success" ? providers.data.providers : [];
  const models = useQueries({
    queries: list.map((p) =>
      aiModelsOptions(withToken, p.capabilities.model_listing ? p.id : null),
    ),
  });
  if (providers.status !== "success") return providers;
  return {
    status: "success",
    data: list.map((provider, index) => ({
      id: provider.id,
      name: provider.name,
      models: models[index]?.data?.models ?? [],
    })),
  };
}

export function useAiUsage(): Resource<AiUsage> {
  const { withToken } = useAuth();
  return queryResource(useQuery(aiUsageOptions(withToken)), "Couldn’t load usage.");
}

export function useProviderMutations() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: aiKeys.me() });
  };
  const create = useMutation({
    mutationFn: (body: CreateAiProviderRequest) => withToken((t) => createAiProvider(t, body)),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAiProviderRequest }) =>
      withToken((t) => updateAiProvider(t, id, body)),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => withToken((t) => deleteAiProvider(t, id)),
    onSuccess: refresh,
  });
  const test = useMutation<AiConnectionTest, Error, TestAiProviderRequest>({
    mutationFn: (body) => withToken((t) => testAiProvider(t, body)),
  });
  return { create, update, remove, test };
}

export type ProviderSummary = Pick<AiProvider, "id" | "name" | "processing">;

// Conversations

export function useConversations(): Resource<AiConversationList> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery(conversationsOptions(withToken, workspaceId));
  useWorkspaceNotFound(result.error);
  return queryResource(result, "Couldn’t load your conversations.");
}

export function useConversation(conversationId: string | null): Resource<AiConversationDetail> {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery(conversationOptions(withToken, workspaceId, conversationId));
  return queryResource(result, "Couldn’t load this conversation.");
}

export function useConversationMutations() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: aiKeys.conversations(workspaceId) });
  };
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      withToken((t) => renameConversation(t, workspaceId ?? "", id, title)),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => withToken((t) => deleteConversation(t, workspaceId ?? "", id)),
    onSuccess: refresh,
  });
  return { rename, remove };
}

/** Approve or reject a proposal. Approval runs it through the module, once. */
export function useDecideProposal() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      withToken((t) => decideProposal(t, workspaceId ?? "", id, decision)),
    onSuccess: () => {
      // The approved action changed a module's data; let every view refresh.
      void queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId] });
    },
  });
}

// Streaming answers

export type PendingTurn = {
  question: string;
  text: string;
  citations: AiCitation[];
  status: "streaming" | "error";
  error: string | null;
  provider: { name: string; model: string; processing: "local" | "cloud" } | null;
};

/**
 * Send a message and follow its answer as it streams. When it finishes, the conversation is
 * reloaded from the API (the saved answer has checked citations and any proposals).
 */
export function useAssistantChat(
  conversationId: string | null,
  onConversation: (id: string) => void,
) {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const timezone = useViewerTimeZone();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [proposals, setProposals] = useState<AiProposal[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (question: string) => {
      if (!workspaceId) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setProposals([]);
      setPending({
        question,
        text: "",
        citations: [],
        status: "streaming",
        error: null,
        provider: null,
      });
      let target = conversationId;
      try {
        await withToken((token) =>
          streamAiMessage(
            token,
            workspaceId,
            { content: question, conversation_id: conversationId, timezone },
            (event) => {
              switch (event.type) {
                case "start":
                  target = event.data.conversation.id;
                  setPending(
                    (turn) =>
                      turn && {
                        ...turn,
                        provider: {
                          name: event.data.provider_name,
                          model: event.data.model,
                          processing: event.data.processing,
                        },
                      },
                  );
                  if (conversationId === null) onConversation(event.data.conversation.id);
                  break;
                case "sources":
                  setPending((turn) => turn && { ...turn, citations: event.citations });
                  break;
                case "delta":
                  setPending((turn) => turn && { ...turn, text: turn.text + event.text });
                  break;
                case "error":
                  setPending((turn) => turn && { ...turn, status: "error", error: event.message });
                  break;
                case "done":
                  setProposals(event.data.proposals);
                  break;
              }
            },
            { signal: controller.signal },
          ),
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = describeApiError(error, "The assistant couldn’t answer just now.");
          setPending((turn) => turn && { ...turn, status: "error", error: message });
        }
      } finally {
        abortRef.current = null;
        void queryClient.invalidateQueries({ queryKey: aiKeys.conversations(workspaceId) });
        // Show the saved answer (checked citations, proposals) before the streamed copy goes.
        if (target) {
          await queryClient.invalidateQueries({
            queryKey: aiKeys.conversation(workspaceId, target),
          });
        }
        setPending((turn) =>
          turn?.status === "error" && !controller.signal.aborted ? turn : null,
        );
      }
    },
    [conversationId, onConversation, queryClient, timezone, withToken, workspaceId],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    setPending(null);
    setProposals([]);
  }, []);

  return {
    pending,
    proposals,
    send,
    stop,
    reset,
    streaming: pending?.status === "streaming",
    ready: workspaceId !== null,
  };
}

// Features, insights, index

export function useAssist() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const timezone = useViewerTimeZone();
  return useMutation<AiAssistResult, Error, Omit<AiAssistRequest, "timezone">>({
    mutationFn: (body) => withToken((t) => runAssist(t, workspaceId ?? "", { ...body, timezone })),
  });
}

/**
 * Whether AI features can run: AI on for the server and the person, with a chat model chosen,
 * and, when `module` is given, permission to read it. False while settings load.
 */
export function useAiReady(module?: AiModule): boolean {
  const settings = useAiSettings();
  if (settings.status !== "success") return false;
  const s = settings.data;
  return (
    s.server_enabled &&
    s.enabled &&
    s.chat_model !== null &&
    (module === undefined || s.modules.includes(module))
  );
}

// Health helpers. Each returns a draft; nothing is saved until the person saves it.

export function useEstimateFood(workspaceId: string) {
  const { withToken } = useAuth();
  return useMutation<AiFoodEstimate, Error, string>({
    mutationFn: (description) => withToken((t) => estimateFood(t, workspaceId, { description })),
  });
}

export function useSuggestFoods(workspaceId: string) {
  const { withToken } = useAuth();
  return useMutation<AiFoodIdeas, Error, string>({
    mutationFn: (cuisine) => withToken((t) => suggestFoods(t, workspaceId, { cuisine })),
  });
}

export function useSuggestWorkout(workspaceId: string) {
  const { withToken } = useAuth();
  const timezone = useViewerTimeZone();
  return useMutation<AiWorkoutSuggestion, Error, string>({
    mutationFn: (focus) => withToken((t) => suggestWorkout(t, workspaceId, { focus, timezone })),
  });
}

export function useInsights(enabled: boolean): {
  resource: Resource<AiInsight[]>;
  dismiss: (key: string) => void;
} {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const timezone = useViewerTimeZone();
  const queryClient = useQueryClient();
  const result = useQuery({ ...insightsOptions(withToken, workspaceId, timezone), enabled });
  const page = queryResource(result, "Couldn’t load insights.");
  const dismiss = useMutation({
    mutationFn: (key: string) => withToken((t) => dismissInsight(t, workspaceId ?? "", key)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: aiKeys.insights(workspaceId, timezone) }),
  });
  const resource: Resource<AiInsight[]> =
    page.status === "success" ? { status: "success", data: page.data.insights } : page;
  return { resource, dismiss: (key) => dismiss.mutate(key) };
}

export function useAiIndex(): {
  resource: Resource<AiIndexStatus>;
  change: (action: "rebuild" | "retry" | "clear") => Promise<void>;
} {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const resource = queryResource(
    useQuery(aiIndexOptions(withToken, workspaceId)),
    "Couldn’t load the index status.",
  );
  const change = async (action: "rebuild" | "retry" | "clear") => {
    if (!workspaceId) return;
    await withToken((t) => changeAiIndex(t, workspaceId, action));
    await queryClient.invalidateQueries({ queryKey: aiKeys.index(workspaceId) });
  };
  return { resource, change };
}
