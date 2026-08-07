import { isDemoSessionActive } from "@/lib/auth-state";
import type { AIContextPack } from "@/lib/ai-project-context";
import type { AiLlmProvider } from "@/lib/ai-llm-provider";
import type {
  AssistantGroundingStatus,
  InferenceGroundingKind,
  LiveTextAssistantResult,
  LiveTextAssistantSource,
  LiveTextFollowUpPrompt,
  PresentationalWorkProposal,
} from "@/lib/ai-assistant-contract";
import type { AIAccess } from "@/types/entities";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type InferenceMode = "consult" | "proposal";

export interface InvokeLiveTextAssistantInput {
  projectId: string;
  contextPack: AIContextPack;
  userMessage: string;
  /** `"supabase"` triggers the hosted Edge Function; anything else uses the local mock. */
  workspaceKind: string;
  /** Effective AI access for the current user on this project. */
  aiAccess: AIAccess;
  /** Profile preference — drives localized mock copy, empty-answer fallback, and error sanitization. */
  aiOutputLanguage?: "ru" | "en" | "auto";
  /** Optional UUID — Layer B session continuity for hosted `ai-inference`. */
  chatId?: string;
  /** Optional bounded chat history fallback for hosted `ai-inference` when server continuity is empty. */
  priorTurns?: ReadonlyArray<AiInferencePriorTurn>;
  /** Hosted `ai-inference` — GigaChat vs Qwen (DashScope). Omit to use Edge default / env. */
  llmProvider?: AiLlmProvider;
  /** Tier-limit usage slot: 'chat' (default), 'doc', or 'photo'. Selects which monthly limit the server consumes. */
  usageType?: "chat" | "doc" | "photo";
}

export interface AiInferencePriorTurn {
  role: "user" | "assistant";
  text: string;
}

/** UI language for assistant chrome (errors, mock path, source labels). */
export type AiAssistantUiLanguage = "ru" | "en";

/** Resolves UI chrome language from profile `ai_output_language` and optional user message (for `auto`). */
export function resolveAiAssistantUiLanguage(
  aiOutputLanguage?: "ru" | "en" | "auto",
  userMessage?: string,
): AiAssistantUiLanguage {
  if (aiOutputLanguage === "ru") return "ru";
  if (aiOutputLanguage === "en") return "en";
  const hint = userMessage?.trim() ?? "";
  if (hint && /[\u0400-\u04FF]/.test(hint)) return "ru";
  if (hint && /[A-Za-z]/.test(hint)) return "en";
  // Default to Russian in the demo so the mock assistant matches the seeded RU content.
  try {
    if (isDemoSessionActive()) return "ru";
  } catch {
    // isDemoSessionActive relies on sessionStorage; ignore SSR/test environments without it.
  }
  return "en";
}

// ---------------------------------------------------------------------------
// Hosted path detection
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shouldUseHostedInference(workspaceKind: string, projectId: string): boolean {
  return workspaceKind === "supabase" && UUID_RE.test(projectId);
}

/** Explicit opt-out for hosted inference (Supabase + UUID) via `VITE_AI_LIVE_TEXT_ASSISTANT`. */
export function isLiveTextHostedKillSwitchEnabled(): boolean {
  const v = import.meta.env.VITE_AI_LIVE_TEXT_ASSISTANT;
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  if (s === "") return false;
  return s === "0" || s === "false" || s === "no" || s === "off";
}

/** Hosted edge path for project AI (default-on for Supabase + UUID; kill switch above). */
export function shouldUseHostedLiveTextAssistantPath(workspaceKind: string, projectId: string): boolean {
  return shouldUseHostedInference(workspaceKind, projectId) && !isLiveTextHostedKillSwitchEnabled();
}

// ---------------------------------------------------------------------------
// Mode picker
// ---------------------------------------------------------------------------

const PROPOSAL_INTENT_RE = /\b(estimate|scope|work|proposal|quote|budget)\b/i;

export function pickInferenceMode(userMessage: string, aiAccess: AIAccess): InferenceMode {
  if (aiAccess !== "project_pool") return "consult";
  if (PROPOSAL_INTENT_RE.test(userMessage)) return "proposal";
  return "consult";
}

// ---------------------------------------------------------------------------
// Wire types (match hosted ai-inference Edge Function JSON)
// ---------------------------------------------------------------------------

interface AIInferenceRequestBody {
  projectId: string;
  chatId?: string;
  priorTurns?: AiInferencePriorTurn[];
  llmProvider?: AiLlmProvider;
  usageType?: "chat" | "doc" | "photo";
  mode: InferenceMode;
  message: string;
  contextPack: {
    projectContext: Record<string, unknown>;
    documentExcerpts: unknown[];
  };
}

const MAX_PRIOR_TURNS = 20;
const MAX_PRIOR_TURN_TEXT_CHARS = 2000;

function sanitizePriorTurns(
  priorTurns?: ReadonlyArray<AiInferencePriorTurn>,
): AiInferencePriorTurn[] | undefined {
  if (!Array.isArray(priorTurns) || priorTurns.length === 0) return undefined;
  const bounded = priorTurns
    .slice(-MAX_PRIOR_TURNS)
    .map((turn): AiInferencePriorTurn | null => {
      if (!turn || (turn.role !== "user" && turn.role !== "assistant")) return null;
      const text = turn.text.trim();
      if (!text) return null;
      return {
        role: turn.role,
        text: text.length > MAX_PRIOR_TURN_TEXT_CHARS ? text.slice(0, MAX_PRIOR_TURN_TEXT_CHARS) : text,
      };
    })
    .filter((turn): turn is AiInferencePriorTurn => turn !== null);
  return bounded.length > 0 ? bounded : undefined;
}

type BackendGroundingStatus =
  | "client_attributed"
  | "partial_client_attributed"
  | "none"
  | "server_verified";

interface BackendGroundingSource {
  kind?: string;
  label?: string;
}

interface BackendWorkProposalStep {
  label?: string;
  note?: string;
  /** Hosted `ai-inference` / Gigachat schema uses title + description per step. */
  title?: string;
  description?: string;
}

interface BackendWorkProposal {
  title?: string;
  summary?: string;
  steps?: BackendWorkProposalStep[];
}

interface AIInferenceResponseBody {
  llmProvider?: string;
  responseVersion?: string;
  answerText?: string;
  groundingKind?: string;
  groundingDetails?: {
    serverSnapshotUsed?: boolean;
    domainsRetrieved?: unknown;
    evidenceTruncated?: boolean;
  };
  followUps?: unknown;
  freshnessHint?: unknown;
  optionalWorkProposalPreview?: BackendWorkProposal | null;
  explanation?: string;
  groundingStatus?: BackendGroundingStatus;
  groundingNote?: string;
  groundingSources?: BackendGroundingSource[];
  workProposal?: BackendWorkProposal | null;
}

// ---------------------------------------------------------------------------
// Response mappers (exported for tests)
// ---------------------------------------------------------------------------

const GROUNDING_MAP: Record<BackendGroundingStatus, AssistantGroundingStatus> = {
  client_attributed: "project_context_grounded",
  partial_client_attributed: "partial",
  none: "ungrounded",
  server_verified: "project_context_grounded",
};

export function mapGroundingStatus(raw: string | undefined): AssistantGroundingStatus {
  if (raw && raw in GROUNDING_MAP) return GROUNDING_MAP[raw as BackendGroundingStatus];
  return "ungrounded";
}

function formatGroundingSourceFallbackLabel(
  kind: string | undefined,
  lang: AiAssistantUiLanguage,
): string {
  if (!kind || typeof kind !== "string") {
    return lang === "ru" ? "Источник" : "Source";
  }
  if (lang === "ru") {
    const map: Record<string, string> = {
      client_project_context: "Контекст проекта",
      client_document_metadata: "Метаданные документа",
      server_verified_estimate: "Данные сметы",
      server_verified_procurement: "Закупки и поставки",
      server_verified_tasks: "Задачи",
      server_verified_hr: "Кадры",
      server_verified_participants: "Участники проекта",
      server_verified_activity: "Недавняя активность",
      server_verified_documents_metadata: "Документы — только названия и метаданные (не полный текст)",
      server_verified_media_metadata: "Медиа — только имена файлов и метаданные (не содержимое)",
    };
    return map[kind] ?? kind.replace(/_/g, " ");
  }
  const map: Record<string, string> = {
    client_project_context: "Project context",
    client_document_metadata: "Document metadata",
    server_verified_estimate: "Estimate details",
    server_verified_procurement: "Procurement records",
    server_verified_tasks: "Task details",
    server_verified_hr: "HR details",
    server_verified_participants: "Project participants",
    server_verified_activity: "Recent project activity",
    server_verified_documents_metadata: "Documents — titles/metadata only (not full text)",
    server_verified_media_metadata: "Media — filenames/metadata only (not file contents)",
  };
  return map[kind] ?? kind.replace(/_/g, " ");
}

function softenProgrammaticCopy(
  value: string,
  lang: AiAssistantUiLanguage = "en",
): string {
  if (lang === "ru") {
    return value
      .replace(/\bserver[- ]verified\b/gi, "проверено")
      .replace(/\s*\(server\)/gi, "")
      .replace(/\bserver\b/gi, "система проекта")
      .replace(/\bfrontend\b/gi, "приложение")
      .replace(/\bbackend\b/gi, "система")
      .replace(/\bEvidence domains\b/gi, "Области проекта")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  return value
    .replace(/\bserver[- ]verified\b/gi, "checked")
    .replace(/\s*\(server\)/gi, "")
    .replace(/\bserver\b/gi, "project system")
    .replace(/\bfrontend\b/gi, "app")
    .replace(/\bbackend\b/gi, "system")
    .replace(/\bEvidence domains\b/gi, "Project areas")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function mapGroundingSources(
  raw: BackendGroundingSource[] | undefined,
  assistantUiLanguage: AiAssistantUiLanguage = "en",
): LiveTextAssistantSource[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const defaultSource = assistantUiLanguage === "ru" ? "Источник" : "Source";
  return raw.map((s) => {
    const kind = (s.kind === "project_summary" || s.kind === "recent_activity") ? s.kind : "other";
    const hasLabel = typeof s.label === "string" && s.label.trim();
    const label = hasLabel
      ? s.label!.trim()
      : (s.kind === "project_summary" || s.kind === "recent_activity")
        ? defaultSource
        : formatGroundingSourceFallbackLabel(s.kind, assistantUiLanguage);
    return { kind, label: softenProgrammaticCopy(label, assistantUiLanguage) };
  });
}

function mapWorkProposalStep(step: BackendWorkProposalStep): { label: string; note?: string } {
  const label = typeof step.label === "string" && step.label.trim()
    ? step.label
    : (typeof step.title === "string" ? step.title : "");
  const note = typeof step.note === "string"
    ? step.note
    : (typeof step.description === "string" ? step.description : undefined);
  return { label, note };
}

export function mapWorkProposal(raw: BackendWorkProposal | null | undefined): PresentationalWorkProposal | undefined {
  if (!raw || !raw.title) return undefined;
  return {
    proposalTitle: raw.title,
    proposalSummary: raw.summary ?? "",
    suggestedWorkItems: (raw.steps ?? []).map((step) => mapWorkProposalStep(step)),
  };
}

const INFERENCE_GROUNDING_KINDS: ReadonlySet<string> = new Set<InferenceGroundingKind>([
  "grounded_on_project_sources",
  "partially_grounded",
  "not_grounded_on_project_sources_but_general_guidance_available",
]);

export function mapGroundingKind(raw: string | undefined): AssistantGroundingStatus | undefined {
  if (!raw || !INFERENCE_GROUNDING_KINDS.has(raw)) return undefined;
  switch (raw as InferenceGroundingKind) {
    case "grounded_on_project_sources":
      return "project_context_grounded";
    case "partially_grounded":
      return "partial";
    case "not_grounded_on_project_sources_but_general_guidance_available":
      return "ungrounded";
    default:
      return undefined;
  }
}

function parseFollowUps(raw: unknown): LiveTextFollowUpPrompt[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: LiveTextFollowUpPrompt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.prompt !== "string" || !rec.prompt.trim()) continue;
    const intent = typeof rec.intent === "string" && rec.intent.trim() ? rec.intent : undefined;
    out.push({ prompt: rec.prompt.trim(), intent });
  }
  return out.length > 0 ? out : undefined;
}

function normalizeFreshnessHint(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return null;
}

function parseGroundingDetails(raw: AIInferenceResponseBody["groundingDetails"]):
  LiveTextAssistantResult["groundingDetails"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const domainsRaw = raw.domainsRetrieved;
  const domainsRetrieved = Array.isArray(domainsRaw)
    ? domainsRaw.filter((d): d is string => typeof d === "string" && d.length > 0)
    : [];
  return {
    serverSnapshotUsed: typeof raw.serverSnapshotUsed === "boolean" ? raw.serverSnapshotUsed : false,
    domainsRetrieved,
    evidenceTruncated: typeof raw.evidenceTruncated === "boolean" ? raw.evidenceTruncated : false,
  };
}

function pickAnswerText(body: AIInferenceResponseBody, lang: AiAssistantUiLanguage): string {
  if (typeof body.answerText === "string" && body.answerText.trim()) return body.answerText;
  if (typeof body.explanation === "string" && body.explanation.trim()) return body.explanation;
  return lang === "ru"
    ? "Ассистент не смог подготовить ответ."
    : "The assistant could not prepare a reply.";
}

function mapEchoLlmProvider(raw: string | undefined): AiLlmProvider | undefined {
  if (raw === "gigachat" || raw === "qwen") return raw;
  return undefined;
}

export function mapInferenceResponse(
  body: AIInferenceResponseBody,
  assistantUiLanguage: AiAssistantUiLanguage = "en",
): LiveTextAssistantResult {
  const fromKind = mapGroundingKind(body.groundingKind);
  const grounding = fromKind ?? mapGroundingStatus(body.groundingStatus);
  const proposal = mapWorkProposal(body.optionalWorkProposalPreview ?? body.workProposal ?? undefined);
  const freshnessHint = normalizeFreshnessHint(body.freshnessHint);

  const groundingKind = body.groundingKind && INFERENCE_GROUNDING_KINDS.has(body.groundingKind)
    ? (body.groundingKind as InferenceGroundingKind)
    : undefined;

  return {
    llmProvider: mapEchoLlmProvider(body.llmProvider),
    assistantUiLanguage,
    explanation: pickAnswerText(body, assistantUiLanguage),
    grounding,
    groundingNote: typeof body.groundingNote === "string"
      ? softenProgrammaticCopy(body.groundingNote, assistantUiLanguage)
      : undefined,
    sources: mapGroundingSources(body.groundingSources, assistantUiLanguage),
    workProposal: proposal,
    responseVersion: typeof body.responseVersion === "string" ? body.responseVersion : undefined,
    groundingKind,
    groundingDetails: parseGroundingDetails(body.groundingDetails),
    followUps: parseFollowUps(body.followUps),
    freshnessHint: freshnessHint === undefined ? undefined : freshnessHint,
  };
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

export function buildInferenceRequestBody(
  projectId: string,
  mode: InferenceMode,
  userMessage: string,
  contextPack: AIContextPack,
  priorTurns?: ReadonlyArray<AiInferencePriorTurn>,
  chatId?: string,
  llmProvider?: AiLlmProvider,
  usageType?: "chat" | "doc" | "photo",
): AIInferenceRequestBody {
  const { _meta: _, ...safeContext } = contextPack;
  const body: AIInferenceRequestBody = {
    projectId,
    mode,
    message: userMessage,
    contextPack: {
      projectContext: safeContext as unknown as Record<string, unknown>,
      documentExcerpts: [],
    },
  };
  if (chatId && UUID_RE.test(chatId)) {
    body.chatId = chatId;
  }
  const safePriorTurns = sanitizePriorTurns(priorTurns);
  if (safePriorTurns) {
    body.priorTurns = safePriorTurns;
  }
  if (llmProvider) {
    body.llmProvider = llmProvider;
  }
  if (usageType) {
    body.usageType = usageType;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Edge invoke errors (mirror workspace-source invite flow)
// ---------------------------------------------------------------------------

function parseEdgeFunctionErrorBody(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object" && record.error !== null && "message" in record.error) {
    const m = (record.error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return null;
}

/** User-visible copy for known provider / schema failures logged server-side. */
export function sanitizeAiInferenceUserMessage(
  raw: string,
  lang: AiAssistantUiLanguage = "en",
): string {
  const t = raw.trim();
  const fallback = lang === "ru"
    ? "Ассистент не смог выполнить запрос. Попробуйте ещё раз."
    : "The assistant could not complete this request. Please try again.";
  if (!t) return fallback;
  const lower = t.toLowerCase();
  if (lower === "quota_exceeded" || lower.includes("quota_exceeded")) {
    // ai-inference returns body.error = "quota_exceeded" with status 402 when a
    // usage credit can't be consumed. The visual paywall (AIQuotaGate) normally
    // pre-empts this, but it's reachable on the stale-cache / multi-tab race.
    return lang === "ru"
      ? "Лимит ИИ исчерпан. Откройте Настройки → Биллинг, чтобы увидеть детали и обновить тариф."
      : "AI usage limit reached. Open Settings → Billing for details and to upgrade.";
  }
  if (
    lower.includes("invalid json")
    || lower.includes("provider returned")
    || lower.includes("invalid provider")
    || lower.includes("failed to parse")
  ) {
    return lang === "ru"
      ? "Ассистенту не удалось подготовить устойчивый ответ. Попробуйте через короткое время."
      : "The assistant had trouble preparing a reliable reply. Please try again in a moment.";
  }
  if (t.length > 400) return fallback;
  return t;
}

async function resolveAiInferenceInvokeFailureMessage(
  error: unknown,
  data: unknown,
  lang: AiAssistantUiLanguage,
): Promise<string> {
  const fromData = parseEdgeFunctionErrorBody(data);
  if (fromData) return sanitizeAiInferenceUserMessage(fromData, lang);

  if (error && typeof error === "object" && "context" in error) {
    const ctx = (error as { context?: unknown }).context;
    if (typeof Response !== "undefined" && ctx instanceof Response) {
      const status = ctx.status;
      const raw = await ctx.clone().text().catch(() => "");
      const trimmed = raw.trim();
      if (trimmed) {
        try {
          const j = JSON.parse(trimmed) as Record<string, unknown>;
          if (typeof j.error === "string") return sanitizeAiInferenceUserMessage(j.error, lang);
          if (j.error && typeof j.error === "object" && j.error !== null && "message" in j.error) {
            const m = (j.error as { message?: unknown }).message;
            if (typeof m === "string") return sanitizeAiInferenceUserMessage(m, lang);
          }
          if (typeof j.message === "string") return sanitizeAiInferenceUserMessage(j.message, lang);
        } catch {
          /* not JSON */
        }
        const clipped = trimmed.length <= 400 ? trimmed : `${trimmed.slice(0, 400)}…`;
        return sanitizeAiInferenceUserMessage(clipped, lang);
      }
      const statusText = ctx.statusText?.trim();
      if (lang === "ru") {
        return statusText
          ? `Запрос не выполнен (${status} ${statusText}). Попробуйте снова.`
          : `Запрос не выполнен (HTTP ${status}). Попробуйте снова.`;
      }
      return statusText
        ? `Request failed (${status} ${statusText}). Please try again.`
        : `Request failed (HTTP ${status}). Please try again.`;
    }
  }

  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return sanitizeAiInferenceUserMessage(m, lang);
  }

  return sanitizeAiInferenceUserMessage("", lang);
}

/** Safe message to show in the assistant bubble when `invokeLiveTextAssistant` throws. */
export function userVisibleLiveTextAssistantError(
  err: unknown,
  lang: AiAssistantUiLanguage = "en",
): string {
  const fallback = lang === "ru"
    ? "Ассистент не смог выполнить запрос. Попробуйте ещё раз."
    : "The assistant could not complete this request. Please try again.";
  if (!(err instanceof Error)) return fallback;
  const m = err.message.trim();
  if (!m) return fallback;
  if (m.length > 420) return fallback;
  if (/\bat\s+[\w.$/]+\s*\([^)]*:\d+:\d+\)/.test(m)) return fallback;
  return m;
}

// ---------------------------------------------------------------------------
// Hosted invoke
// ---------------------------------------------------------------------------

async function invokeHosted(
  projectId: string,
  mode: InferenceMode,
  userMessage: string,
  contextPack: AIContextPack,
  assistantUiLanguage: AiAssistantUiLanguage,
  priorTurns?: ReadonlyArray<AiInferencePriorTurn>,
  chatId?: string,
  llmProvider?: AiLlmProvider,
  usageType?: "chat" | "doc" | "photo",
): Promise<LiveTextAssistantResult> {
  const { supabase } = await import("@/integrations/supabase/client");
  const body = buildInferenceRequestBody(
    projectId,
    mode,
    userMessage,
    contextPack,
    priorTurns,
    chatId,
    llmProvider,
    usageType,
  );

  const { data, error } = await supabase.functions.invoke("ai-inference", { body });

  const bodyError = parseEdgeFunctionErrorBody(data);

  if (bodyError) {
    throw new Error(sanitizeAiInferenceUserMessage(bodyError, assistantUiLanguage));
  }

  if (error) {
    const msg = await resolveAiInferenceInvokeFailureMessage(error, data, assistantUiLanguage);
    throw new Error(msg);
  }

  const responseBody = data as AIInferenceResponseBody | null;
  if (!responseBody || typeof responseBody !== "object") {
    const unreliable = assistantUiLanguage === "ru"
      ? "Ассистент не смог подготовить устойчивый ответ."
      : "The assistant could not prepare a reliable reply.";
    throw new Error(sanitizeAiInferenceUserMessage(unreliable, assistantUiLanguage));
  }

  return mapInferenceResponse(responseBody, assistantUiLanguage);
}

// ---------------------------------------------------------------------------
// Mock fallback (preserved from Wave 1)
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

function buildMockSources(pack: AIContextPack, lang: AiAssistantUiLanguage): LiveTextAssistantSource[] {
  const sources: LiveTextAssistantSource[] = [];
  const title = pack.project.title.trim();
  if (title) {
    const type = pack.project.type || "—";
    sources.push({
      kind: "project_summary",
      label: lang === "ru"
        ? `Проект: ${title} (${type}) · прогресс ${pack.project.progress}`
        : `Project: ${title} (${type}) · progress ${pack.project.progress}`,
    });
  }
  if (pack.recentEvents.length > 0) {
    sources.push({
      kind: "recent_activity",
      label: lang === "ru"
        ? `Недавняя активность: ${pack.recentEvents.length} тип(ов) событий (текст событий в ассистент не передаётся).`
        : `Recent activity: ${pack.recentEvents.length} recent event type(s) (no payload text sent to the assistant).`,
    });
  }
  return sources;
}

function pickMockGrounding(pack: AIContextPack, lang: AiAssistantUiLanguage): {
  grounding: AssistantGroundingStatus;
  groundingNote?: string;
} {
  if (!pack.project.title.trim()) {
    return {
      grounding: "ungrounded",
      groundingNote: lang === "ru"
        ? "В собранном контексте нет названия проекта, поэтому ответ не привязан к конкретной записи проекта."
        : "Project title is missing in the assembled context, so the answer is not tied to a specific project record.",
    };
  }
  if (pack._meta.hiddenDomains.length > 0) {
    return {
      grounding: "partial",
      groundingNote: lang === "ru"
        ? `Часть областей проекта скрыта для вашей роли (${pack._meta.hiddenDomains.join(", ")}). Ответ опирается только на видимый контекст.`
        : `Some project areas are hidden for your role (${pack._meta.hiddenDomains.join(", ")}). This answer uses only the visible context pack.`,
    };
  }
  return { grounding: "project_context_grounded" };
}

function maybeMockWorkProposal(
  userMessage: string,
  pack: AIContextPack,
  lang: AiAssistantUiLanguage,
): PresentationalWorkProposal | undefined {
  if (!PROPOSAL_INTENT_RE.test(userMessage)) return undefined;
  if (lang === "ru") {
    return {
      proposalTitle: `Черновик объёма для ${pack.project.title || "этого проекта"}`,
      proposalSummary:
        "Примерные работы для обсуждения — в смету не записываются. Проверьте и внесите вручную на вкладке сметы.",
      suggestedWorkItems: [
        { label: "Обследование объекта и исходные условия", note: "Подтвердите допущения до оценки." },
        { label: "Черновые / первичные работы", note: "Согласуйте с текущим этапом, если применимо." },
        { label: "Отделка и сдача", note: "Скорректируйте под договорной объём." },
      ],
    };
  }
  return {
    proposalTitle: `Draft scope for ${pack.project.title || "this project"}`,
    proposalSummary:
      "Illustrative work items for discussion only — not applied to the estimate. Review and enter manually on the estimate tab.",
    suggestedWorkItems: [
      { label: "Site verification & existing conditions", note: "Confirm assumptions before pricing." },
      { label: "Rough-in / first-fix", note: "Align with current stage plan if applicable." },
      { label: "Finish & handover", note: "Adjust to match your contract scope." },
    ],
  };
}

async function invokeMock(
  input: InvokeLiveTextAssistantInput,
  assistantUiLanguage: AiAssistantUiLanguage,
): Promise<LiveTextAssistantResult> {
  await delay(320);
  const { contextPack, userMessage } = input;
  const { grounding, groundingNote } = pickMockGrounding(contextPack, assistantUiLanguage);
  const sources = buildMockSources(contextPack, assistantUiLanguage);
  const preview = userMessage.trim().slice(0, 200);
  const projectTitle = contextPack.project.title || (assistantUiLanguage === "ru" ? "этого проекта" : "this project");
  const explanation = assistantUiLanguage === "ru"
    ? [
      `Кратко по запросу «${preview}${userMessage.length > 200 ? "…" : ""}» для **${projectTitle}**.`,
      "",
      grounding === "project_context_grounded"
        ? "Это демо-ответ: он согласован с видимым контекстом (роли, скрытые области и сводки, доступные вам)."
        : grounding === "partial"
        ? "Это демо-ответ: используется только часть контекста, потому что для роли скрыты некоторые области."
        : "Это демо-ответ: он слабо привязан к источникам проекта (мало или нет контекста).",
      "",
      "_Локальный демо-режим без сервера — подключите развёрнутый `ai-inference`, когда будете готовы._",
    ].join("\n")
    : [
      `Here is a concise take on "${preview}${userMessage.length > 200 ? "…" : ""}" for **${projectTitle}**.`,
      "",
      grounding === "project_context_grounded"
        ? "This demo response matches the visible project context pack (roles, hidden domains, and summaries you are allowed to see)."
        : grounding === "partial"
        ? "This demo response uses partial context because some domains are hidden for your role."
        : "This demo response is not reliably tied to project sources (missing or insufficient context).",
      "",
      "_Local demo mode — connect hosted `ai-inference` when you are ready._",
    ].join("\n");
  return {
    llmProvider: input.llmProvider,
    assistantUiLanguage,
    explanation,
    grounding,
    groundingNote,
    sources: sources.length > 0 ? sources : undefined,
    workProposal: maybeMockWorkProposal(userMessage, contextPack, assistantUiLanguage),
  };
}

// ---------------------------------------------------------------------------
// Public API — single entry point used by AISidebar
// ---------------------------------------------------------------------------

export async function invokeLiveTextAssistant(
  input: InvokeLiveTextAssistantInput,
): Promise<LiveTextAssistantResult> {
  const assistantUiLanguage = resolveAiAssistantUiLanguage(
    input.aiOutputLanguage,
    input.userMessage,
  );
  if (shouldUseHostedLiveTextAssistantPath(input.workspaceKind, input.projectId)) {
    const mode = pickInferenceMode(input.userMessage, input.aiAccess);
    return invokeHosted(
      input.projectId,
      mode,
      input.userMessage,
      input.contextPack,
      assistantUiLanguage,
      input.priorTurns,
      input.chatId,
      input.llmProvider,
      input.usageType,
    );
  }
  return invokeMock(input, assistantUiLanguage);
}
