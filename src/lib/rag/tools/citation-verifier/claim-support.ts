// Claim-support audit for the citation verifier: checks whether each cited
// claim in a draft answer is actually supported by the sources it cites — the
// dangerous failure mode that pure index validation misses (a well-formed [3]
// pointing at a real chunk that does not back the sentence). Uses one bounded,
// structured LLM pass and FAILS OPEN (returns null) so it can never block an
// answer on its own error.

import {
  generateText,
  gateway,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import { z } from "zod";
import type { SourceChunk } from "@/lib/types";
import type { CitedClaim } from "./citation-markers";

const DEFAULT_AUDIT_MODEL = "openai/gpt-5.4-mini";
const MAX_CLAIMS = 20;
const MAX_SOURCE_CHARS = 700;

export type ClaimSupport = "supported" | "partial" | "unsupported";

export interface ClaimAssessment {
  sentence: string;
  indices: number[];
  support: ClaimSupport;
  reason?: string;
}

export interface ClaimAudit {
  assessments: ClaimAssessment[];
  /**
   * True only when every cited claim was actually assessed exactly once — i.e.
   * no claim was dropped by the 20-claim cap and the model returned a verdict
   * for each. When false, callers must NOT treat "no unsupported found" as a
   * clean bill of health: some claims went unchecked.
   */
  complete: boolean;
}

const auditSchema = z.object({
  assessments: z.array(
    z.object({
      claim: z.number().int().describe("1-based index of the claim in the provided list"),
      support: z.enum(["supported", "partial", "unsupported"]),
      reason: z
        .string()
        .max(240)
        .optional()
        .describe("Brief reason, required when support is partial or unsupported"),
    })
  ),
});

function sourcesForClaim(claim: CitedClaim, liveChunks: SourceChunk[]): string {
  return claim.indices
    .map((n) => {
      const chunk = liveChunks[n - 1];
      if (!chunk) return `  [${n}] (no such source)`;
      const label = [chunk.title, chunk.speaker, chunk.book].filter(Boolean).join(" — ");
      const text = (chunk.text ?? "").slice(0, MAX_SOURCE_CHARS);
      return `  [${n}]${label ? ` ${label}:` : ""} ${text}`;
    })
    .join("\n");
}

/**
 * Assess whether each cited claim is supported by its cited sources. Returns the
 * per-claim assessments plus a `complete` flag (every claim assessed exactly
 * once), or `null` if the audit could not run (no claims, or the LLM call
 * failed) — callers treat `null` as "audit unavailable", not "all supported".
 */
export async function auditClaimSupport(
  claims: CitedClaim[],
  liveChunks: SourceChunk[],
  model: string = process.env.CITATION_AUDIT_MODEL ?? DEFAULT_AUDIT_MODEL
): Promise<ClaimAudit | null> {
  const limited = claims.slice(0, MAX_CLAIMS);
  if (limited.length === 0) return null;
  // Truncation by the cap already means we cannot fully audit this answer.
  const truncated = claims.length > MAX_CLAIMS;

  const claimsBlock = limited
    .map(
      (claim, i) =>
        `Claim ${i + 1}: "${claim.sentence}"\nCited sources:\n${sourcesForClaim(claim, liveChunks)}`
    )
    .join("\n\n");

  try {
    const result = await generateText({
      model: gateway(model),
      system: [
        "You audit whether each claim in a draft answer is supported by the SPECIFIC sources it cites.",
        "For each claim decide: 'supported' (the cited sources clearly state or directly imply it), 'partial' (only partly supported, or needs a qualification the sources do not give), or 'unsupported' (the cited sources do not back the claim).",
        "Judge ONLY against the sources cited for that claim. Faithful paraphrase counts as supported; do not require verbatim wording.",
        "Return one assessment per claim. Give a brief reason for any 'partial' or 'unsupported' verdict.",
      ].join("\n"),
      prompt: `Claims to audit:\n\n${claimsBlock}`,
      maxOutputTokens: 800,
      output: Output.object({ schema: auditSchema }),
    });

    // Keep the first verdict per claim number; ignore out-of-range or duplicate
    // entries the model may emit. Coverage is judged against the de-duplicated
    // set so an omitted claim is not silently counted as audited.
    const seen = new Map<number, ClaimAssessment>();
    for (const a of result.output.assessments) {
      if (a.claim < 1 || a.claim > limited.length || seen.has(a.claim)) continue;
      seen.set(a.claim, {
        sentence: limited[a.claim - 1].sentence,
        indices: limited[a.claim - 1].indices,
        support: a.support,
        reason: a.reason,
      });
    }

    const assessments = [...seen.values()];
    return {
      assessments,
      complete: !truncated && seen.size === limited.length,
    };
  } catch (error) {
    if (
      NoOutputGeneratedError.isInstance(error) ||
      NoObjectGeneratedError.isInstance(error)
    ) {
      console.warn(
        `Claim-support audit returned no valid structured output (${error.name}); skipping support check`
      );
    } else {
      console.error("Claim-support audit failed; skipping support check", error);
    }
    return null;
  }
}
