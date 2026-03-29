// Shared types used across the RAG pipeline and UI

export type SourceType = "scriptures" | "conference" | "handbook" | "liahona";
export type Language = "ita" | "eng";

export const ALL_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
  "liahona",
];

export const DEFAULT_SOURCES: SourceType[] = [
  "scriptures",
  "conference",
  "handbook",
];

export const SOURCE_LABELS: Record<SourceType, { it: string; en: string }> = {
  scriptures: { it: "Scritture", en: "Scriptures" },
  conference: { it: "Conferenza", en: "Conference" },
  handbook: { it: "Manuale", en: "Handbook" },
  liahona: { it: "Liahona", en: "Liahona" },
};

export const SOURCE_COLORS: Record<SourceType, string> = {
  scriptures: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  conference: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  handbook: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  liahona: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
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
