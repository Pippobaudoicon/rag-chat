import { z } from "zod";
import { DEFAULT_SOURCES, SUPER_SOURCES } from "@/lib/types";
import type { CorpusLanguage, SourceType, UiLanguage } from "@/lib/types";
import { RESPONSE_STYLE_IDS } from "@/lib/rag/system-prompt";
import type { ResponseStyleId } from "@/lib/rag/system-prompt";

const sourceValues = SUPER_SOURCES as [SourceType, ...SourceType[]];

const responseStyleValues = RESPONSE_STYLE_IDS as readonly [
  ResponseStyleId,
  ...ResponseStyleId[]
];
export const responseStyleSchema = z.enum(
  responseStyleValues
) satisfies z.ZodType<ResponseStyleId>;

export const uuidSchema = z.string().uuid();
export const corpusLanguageSchema = z.enum(["ita", "eng"]) satisfies z.ZodType<CorpusLanguage>;
export const uiLanguageSchema = z.enum([
  "ita",
  "eng",
  "fra",
  "spa",
  "por",
  "deu",
]) satisfies z.ZodType<UiLanguage>;
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
  language: corpusLanguageSchema,
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
  language: uiLanguageSchema.default("ita"),
  sources: sourcesSchema.default(DEFAULT_SOURCES),
  // Per-turn response style for this conversation. Omitted = leave the stored
  // conversation/user default unchanged.
  responseStyle: responseStyleSchema.optional(),
  topK: z.number().int().min(1).max(50).default(20),
  fixedChunks: z.array(sourceChunkSchema).max(120).optional(),
  regenerateQuestion: z.string().max(4000).optional(),
  trigger: z.string().max(100).optional(),
  messageId: z.union([z.string().max(100), z.number().int().positive()]).optional(),
  // Returned by POST /api/conversations when the first turn is persisted before
  // generation. The chat route verifies ownership, role, and content before use.
  persistedUserMessageId: z.number().int().positive().optional(),
});

export const createConversationSchema = z.object({
  language: uiLanguageSchema.default("ita"),
  sources: sourcesSchema.default(DEFAULT_SOURCES),
  responseStyle: responseStyleSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  initialMessage: z.string().trim().min(1).max(12000).optional(),
});

// PATCH /api/conversations/[id] — rename and/or change the per-conversation
// response-style override. At least one field must be present.
export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    responseStyle: responseStyleSchema.optional(),
  })
  .refine((data) => data.title !== undefined || data.responseStyle !== undefined, {
    message: "At least one of title or responseStyle is required",
  });

// PUT /api/settings — update the user's persistent preferences. Every field is
// optional; the route applies whichever are present. At least one is required.
export const userSettingsSchema = z
  .object({
    defaultResponseStyle: responseStyleSchema.optional(),
    onboardingStatus: z.enum(["pending", "completed", "skipped"]).optional(),
    onboardingStep: z.number().int().min(0).max(50).optional(),
  })
  .refine(
    (data) =>
      data.defaultResponseStyle !== undefined ||
      data.onboardingStatus !== undefined ||
      data.onboardingStep !== undefined,
    { message: "At least one settings field is required" }
  );

export const searchParamsSchema = z.object({
  q: z.string().trim().min(1),
  language: uiLanguageSchema.default("ita"),
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
