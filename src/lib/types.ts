// Shared types used across the RAG pipeline and UI

export type SourceType =
  | "scriptures"
  | "conference"
  | "handbook"
  | "liahona"
  | "gospel_topics"
  | "gospel_selfreliance"
  | "gospel_teachings"
  | "gospel_other"
  | "gospel_music"
  | "gospel_family"
  | "gospel_study"
  | "gospel_history"
  | "gospel_youth"
  | "gospel_videos"
  | "gospel_handbook";
export type Language = "ita" | "eng";

/** Sources shown as individual toggles in the settings bar. */
export const ALL_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
  "liahona",
  "gospel_topics",
];

export const DEFAULT_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
];

/** Every Pinecone namespace — used by the "Super" toggle. */
export const SUPER_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
  "liahona",
  "gospel_topics",
  "gospel_selfreliance",
  "gospel_teachings",
  "gospel_other",
  "gospel_music",
  "gospel_family",
  "gospel_study",
  "gospel_history",
  "gospel_youth",
  "gospel_videos",
  "gospel_handbook",
];

export const SOURCE_LABELS: Record<SourceType, { it: string; en: string }> = {
  scriptures: { it: "Scritture", en: "Scriptures" },
  conference: { it: "Conferenza", en: "Conference" },
  handbook: { it: "Manuale", en: "Handbook" },
  liahona: { it: "Liahona", en: "Liahona" },
  gospel_topics: { it: "Argomenti", en: "Topics" },
  gospel_selfreliance: { it: "Autosufficienza", en: "Self-Reliance" },
  gospel_teachings: { it: "Insegnamenti", en: "Teachings" },
  gospel_other: { it: "Altro", en: "Other" },
  gospel_music: { it: "Musica", en: "Music" },
  gospel_family: { it: "Famiglia", en: "Family" },
  gospel_study: { it: "Studio", en: "Study" },
  gospel_history: { it: "Storia", en: "History" },
  gospel_youth: { it: "Giovani", en: "Youth" },
  gospel_videos: { it: "Video", en: "Videos" },
  gospel_handbook: { it: "Manuale Vangelo", en: "Gospel Handbook" },
};

export const SOURCE_COLORS: Record<SourceType, string> = {
  scriptures: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  conference: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  handbook: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  liahona: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  gospel_topics: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  gospel_selfreliance: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  gospel_teachings: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  gospel_other: "bg-gray-500/15 text-gray-400 border-gray-500/20",
  gospel_music: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  gospel_family: "bg-teal-500/15 text-teal-400 border-teal-500/20",
  gospel_study: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  gospel_history: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  gospel_youth: "bg-lime-500/15 text-lime-400 border-lime-500/20",
  gospel_videos: "bg-red-500/15 text-red-400 border-red-500/20",
  gospel_handbook: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/20",
};

export interface SourceChunk {
  id: string;
  text: string;
  source: SourceType;
  score: number; // 0.0–1.0 cosine similarity
  language: Language;
  // Optional metadata (varies by namespace)
  book?: string;
  chapter?: number;
  verse?: string;
  speaker?: string;
  title?: string;
  date?: string;
  section?: string;
  url?: string;
}

export interface AssistantVersion {
  text: string;
  sources: SourceChunk[];
}

export interface MessageDetails {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  model?: string;
  finishReason?: string;
}

// Type for UIMessage metadata that includes sources
export interface MessageMetadata {
  sources?: SourceChunk[];
  versions?: AssistantVersion[];
  details?: MessageDetails;
}
