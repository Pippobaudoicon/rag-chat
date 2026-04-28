import { z } from "zod";
import { DEFAULT_SOURCES, SUPER_SOURCES } from "@/lib/types";
import type { Language, SourceType } from "@/lib/types";

const sourceValues = SUPER_SOURCES as [SourceType, ...SourceType[]];

export const uuidSchema = z.string().uuid();
export const languageSchema = z.enum(["ita", "eng"]) satisfies z.ZodType<Language>;
export const sourceSchema = z.enum(sourceValues);

const sourcesSchema = z
  .array(sourceSchema)
  .min(1)
  .max(SUPER_SOURCES.length)
  .transform((sources) => [...new Set(sources)] as SourceType[]);

const sourceChunkSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  source: sourceSchema,
  score: z.number().finite(),
  language: languageSchema,
  book: z.string().optional(),
  chapter: z.number().int().positive().optional(),
  verse: z.string().optional(),
  speaker: z.string().optional(),
  title: z.string().optional(),
  date: z.string().optional(),
  section: z.string().optional(),
  url: z.string().url().optional(),
});

export const chatRequestSchema = z.object({
  messages: z.array(z.any()).default([]),
  conversationId: uuidSchema.optional().nullable(),
  language: languageSchema.default("ita"),
  sources: sourcesSchema.default(DEFAULT_SOURCES),
  topK: z.number().int().min(1).max(50).default(20),
  fixedChunks: z.array(sourceChunkSchema).max(120).optional(),
  regenerateQuestion: z.string().max(4000).optional(),
  trigger: z.string().max(100).optional(),
  messageId: z.union([z.string().max(100), z.number().int().positive()]).optional(),
});

export const createConversationSchema = z.object({
  language: languageSchema.default("ita"),
  sources: sourcesSchema.default(DEFAULT_SOURCES),
});

export const searchParamsSchema = z.object({
  q: z.string().trim().min(1),
  language: languageSchema.default("ita"),
  sources: sourcesSchema.default(DEFAULT_SOURCES),
  topK: z.coerce.number().int().min(1).max(20).default(20),
});

export const feedbackRequestSchema = z.object({
  conversationId: uuidSchema,
  assistantMessageId: z.number().int().positive().nullable().optional(),
  clientMessageId: z.string().trim().min(1).max(200).nullable().optional(),
  feedback: z.enum(["up", "down"]),
  comment: z.string().trim().max(2000).nullable().optional(),
  question: z.string().trim().max(2000).nullable().optional(),
  answerText: z.string().trim().max(12000).nullable().optional(),
  sources: z.array(sourceChunkSchema).max(120).nullable().optional(),
});

export function badRequestFromZod(error: z.ZodError): Response {
  return Response.json(
    {
      error: "Bad Request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 }
  );
}

export function parseSourcesParam(value: string | null): SourceType[] | undefined {
  if (!value) return undefined;
  return value.split(",").filter(Boolean) as SourceType[];
}