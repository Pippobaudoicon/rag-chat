// Shared types used across the RAG pipeline and UI

export type SourceType =
  | "scriptures"
  | "conference"
  | "handbook"
  | "study_helps"
  | "gospel_topics"
  | "gospel_selfreliance"
  | "gospel_teachings"
  | "gospel_other"
  | "gospel_music"
  | "gospel_study"
  | "gospel_history"
  | "gospel_youth";
export type CorpusLanguage = "ita" | "eng";
export type UiLanguage = "ita" | "eng" | "fra" | "spa" | "por" | "deu";
export type Language = CorpusLanguage;
export const INDEXED_LANGUAGES: CorpusLanguage[] = ["ita", "eng"];
export const SUPPORTED_UI_LANGUAGES: UiLanguage[] = [
  "ita",
  "eng",
  "fra",
  "spa",
  "por",
  "deu",
];

/** Sources shown as individual toggles in the settings bar. */
export const ALL_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
  "study_helps",
  "gospel_topics",
];

export const DEFAULT_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
  "study_helps",
];

/** Every Pinecone namespace — used by the "Super" toggle.
 * gospel_music is kept as a planned-but-empty namespace (not yet scraped). */
export const SUPER_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
  "study_helps",
  "gospel_topics",
  "gospel_selfreliance",
  "gospel_teachings",
  "gospel_other",
  "gospel_music",
  "gospel_study",
  "gospel_history",
  "gospel_youth",
];

export const SOURCE_LABELS: Record<SourceType, { it: string; en: string }> = {
  scriptures: { it: "Scritture", en: "Scriptures" },
  conference: { it: "Conferenza", en: "Conference" },
  handbook: { it: "Manuale", en: "Handbook" },
  study_helps: { it: "Sussidi per lo studio", en: "Study Helps" },
  gospel_topics: { it: "Argomenti", en: "Topics" },
  gospel_selfreliance: { it: "Autosufficienza", en: "Self-Reliance" },
  gospel_teachings: { it: "Insegnamenti", en: "Teachings" },
  gospel_other: { it: "Altro", en: "Other" },
  gospel_music: { it: "Musica", en: "Music" },
  gospel_study: { it: "Studio", en: "Study" },
  gospel_history: { it: "Storia", en: "History" },
  gospel_youth: { it: "Giovani", en: "Youth" },
};

export const SOURCE_COLORS: Record<SourceType, string> = {
  scriptures: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  conference: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  handbook: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  study_helps: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  gospel_topics: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  gospel_selfreliance: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  gospel_teachings: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  gospel_other: "bg-gray-500/15 text-gray-400 border-gray-500/20",
  gospel_music: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  gospel_study: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  gospel_history: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  gospel_youth: "bg-lime-500/15 text-lime-400 border-lime-500/20",
};

export interface SourceChunk {
  id: string;
  text: string;
  source: SourceType;
  score: number; // 0.0–1.0 cosine similarity
  language: CorpusLanguage;
  // Optional metadata (varies by namespace)
  book?: string;
  chapter?: number;
  verse?: string;
  speaker?: string;
  title?: string;
  date?: string;
  section?: string;
  url?: string;
  // Cross-reference graph projection: ids of related chunks (footnotes, TG/BD/GS
  // links, citations) for fetch-by-id context expansion.
  relatedIds?: string[];
  // Enrichment (present on enriched namespaces: scriptures, conference).
  summary?: string;
  topics?: string[];
  entities?: { people?: string[]; places?: string[]; doctrines?: string[] };
  references?: string[];
}

export interface AssistantVersion {
  text: string;
  sources: SourceChunk[];
}

/** Per-tool retrieval event captured during a turn (one per retrieval tool call). */
export interface RetrievalToolEvent {
  toolName?: string;
  sourceCount?: number;
  cacheHit?: boolean;
  elapsedMs?: number;
}

/**
 * Retrieval trace persisted alongside an assistant message so real conversations
 * can be mined into the eval gold set and so retrieval behavior is debuggable
 * after the fact. The retrieved chunks themselves live in `sourcesJson`; this
 * captures the *how* (query routing, flags, per-tool timings/cache hits).
 */
export interface RetrievalTrace {
  inputLanguageCode?: string;
  searchQuery?: string;
  indexLanguage?: string;
  sources: SourceType[];
  topK: number;
  /** Retrieval ranking-flag signature, e.g. "rr1mq0mmr0" (see flags.ts). */
  flags: string;
  tools: RetrievalToolEvent[];
}

/**
 * Per-turn latency trace persisted on assistant messages so chat response
 * latency is quantifiable (and optimizations provable) from real traffic.
 * Records the *where* (independent phase durations + ordered milestones +
 * per-step / per-tool timings); the existing single `latencyMs` is retained
 * separately for backward-compat.
 *
 * NOTE: written on completed responses only — aborted/rejected/errored requests
 * are absent, so percentiles derived from this are an optimization baseline, not
 * an operational request SLO.
 */
export interface LatencyTrace {
  version: 1;
  /** "generated" = full cold generation; cache-hit and regenerate paths differ. */
  path: "generated" | "answer-cache" | "regenerate";
  /** Deploy identifier for before/after comparison (VERCEL_GIT_COMMIT_SHA). */
  release?: string;
  /** Independent durations (ms) per pre-stream phase, measured in isolation. */
  phases: Record<string, number>;
  /** Milestones as ms since handler entry. */
  milestones: {
    /** Everything before streamText() started. */
    preStreamMs?: number;
    /** First stream chunk of any type (tool-call or text). */
    firstModelChunkMs?: number;
    /** First tool-call chunk — exposes the empty tool-decision turn. */
    firstToolCallMs?: number;
    /** First text-delta emitted by the server (post-smoothStream, not browser paint). */
    serverFirstTextMs?: number;
    /** Total handler wall time. */
    totalMs?: number;
  };
  /** Per model step (one streamText "step" = one model turn). */
  modelSteps?: Array<{
    index: number;
    durationMs: number;
    finishReason?: string;
    toolCalls?: number;
  }>;
  /** Per tool execution (name, wall time, success, retrieval-cache hit). */
  tools?: Array<{
    name: string;
    durationMs: number;
    ok: boolean;
    cacheHit?: boolean;
  }>;
}

export interface MessageDetails {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  model?: string;
  finishReason?: string;
  toolNames?: string[];
  retrieval?: RetrievalTrace;
  latency?: LatencyTrace;
}

export type ChatProgressPhase =
  | "queued"
  | "memory"
  | "sources"
  | "tools"
  | "drafting"
  | "complete";

export interface ChatProgressData {
  phase: ChatProgressPhase;
  conversationId?: string;
  title?: string;
  toolName?: string;
  sourceCount?: number;
  cacheHit?: boolean;
  elapsedMs?: number;
}

// Type for UIMessage metadata that includes sources
export interface MessageMetadata {
  sources?: SourceChunk[];
  versions?: AssistantVersion[];
  details?: MessageDetails;
}
