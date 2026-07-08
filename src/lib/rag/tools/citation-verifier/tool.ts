import { tool } from "ai";
import { z } from "zod";
import type { RagToolContext } from "../shared/tool-context";
import { extractCitationMarkers, extractCitedClaims } from "./citation-markers";
import { auditClaimSupport, type ClaimAssessment } from "./claim-support";
import { isClaimSupportAuditEnabled } from "@/lib/rag/flags";

const inputSchema = z.object({
  answerText: z
    .string()
    .min(1)
    .describe("Draft assistant answer containing inline numeric citations"),
});

export interface CitationVerifierDeps {
  context: RagToolContext;
}

/**
 * `citation_verifier`: one always-on check and one optional check.
 *   1. Structural (deterministic): every `[N]` / `[Source N]` marker points at a
 *      chunk that exists in this turn's source list; malformed markers flagged.
 *   2. Optional claim support (LLM, fail-open): each cited sentence is backed by
 *      its sources. Disabled by default to avoid a nested model call.
 *
 * The tool is read-only — it does not register chunks or mutate state. It
 * relies on `context.citationCount()` for the live upper bound which grows as
 * other tools register new chunks during the same turn.
 */
export function createCitationVerifierTool({ context }: CitationVerifierDeps) {
  const claimAuditEnabled = isClaimSupportAuditEnabled();
  return tool({
    description:
      claimAuditEnabled
        ? "Validate inline numeric citations against the current source list and audit whether cited claims are supported."
        : "Validate inline numeric citations like [1], [2] against the current source list.",
    inputSchema,
    execute: async ({ answerText }) => {
      const { uniqueIndices: cited, malformedMarkers } = extractCitationMarkers(answerText);
      const maxIndex = context.citationCount();

      const invalid = cited.filter((n) => n > maxIndex);
      const valid = cited.filter((n) => n <= maxIndex);
      const uncitedSourceCount = Math.max(0, maxIndex - valid.length);
      const hasMalformed = malformedMarkers.length > 0;
      const hasInvalid = invalid.length > 0;

      // Claim-support audit (skipped when there are no valid citations or no
      // sources to check against). Returns null when unavailable — treated as
      // "not audited", never as "all supported".
      const claims = extractCitedClaims(answerText).filter((claim) =>
        claim.indices.every((n) => n <= maxIndex)
      );
      const audit =
        claimAuditEnabled && valid.length > 0 && maxIndex > 0
          ? await auditClaimSupport(claims, context.liveChunks())
          : null;
      const assessments = audit?.assessments ?? null;

      const unsupported = (assessments ?? []).filter((a) => a.support === "unsupported");
      const partial = (assessments ?? []).filter((a) => a.support === "partial");
      const supportOk = unsupported.length === 0;

      const summarizeClaim = (a: ClaimAssessment) => ({
        claim: a.sentence,
        citations: a.indices,
        reason: a.reason,
      });

      return {
        isValid: !hasInvalid && !hasMalformed && supportOk,
        totalContextSources: maxIndex,
        citedIndices: cited,
        validIndices: valid,
        invalidIndices: invalid,
        malformedMarkers,
        uncitedSourceCount,
        claimSupport: {
          // `audited` is true only when EVERY cited claim was assessed; a partial
          // audit (model omitted claims, or >20-claim cap) reports false so the
          // model does not read "no unsupported found" as a full clean bill.
          audited: audit?.complete ?? false,
          claimsChecked: assessments?.length ?? 0,
          claimsFound: claims.length,
          unsupportedClaims: unsupported.map(summarizeClaim),
          partiallySupportedClaims: partial.map(summarizeClaim),
        },
        note: buildNote({
          hasInvalid,
          hasMalformed,
          invalid,
          malformedMarkers,
          maxIndex,
          unsupported,
          partial,
          auditComplete: audit?.complete ?? false,
          auditUnavailable: audit === null,
          claimAuditEnabled,
        }),
      };
    },
  });
}

function buildNote(args: {
  hasInvalid: boolean;
  hasMalformed: boolean;
  invalid: number[];
  malformedMarkers: string[];
  maxIndex: number;
  unsupported: ClaimAssessment[];
  partial: ClaimAssessment[];
  auditComplete: boolean;
  auditUnavailable: boolean;
  claimAuditEnabled: boolean;
}): string {
  const { hasInvalid, hasMalformed, invalid, malformedMarkers, maxIndex, unsupported, partial, auditComplete, auditUnavailable, claimAuditEnabled } = args;

  if (!hasInvalid && !hasMalformed && unsupported.length === 0 && partial.length === 0) {
    if (!claimAuditEnabled) {
      return "Citation markers are valid and in range.";
    }
    // Only claim "supported" when the audit actually ran and covered every claim.
    if (auditComplete) {
      return "All citation markers are valid, in range, and supported by their cited sources.";
    }
    if (auditUnavailable) {
      return "Citation markers are valid and in range; claim support was NOT verified (no citable claims were found, or the audit was unavailable) — verify the assertions against their sources manually.";
    }
    return "Citation markers are valid and in range; no unsupported claims were found, but the support audit did not cover every claim — re-check any uncited or borderline assertions manually.";
  }

  return [
    hasInvalid ? `Out-of-range markers: ${invalid.map((n) => `[${n}]`).join(", ")}.` : undefined,
    hasMalformed
      ? `Malformed markers: ${malformedMarkers.join(", ")}. Use [N] or [Source N].`
      : undefined,
    unsupported.length > 0
      ? `Unsupported claims (the cited source does not back these — fix the claim or the citation): ${unsupported
          .map((a) => `"${a.sentence}" [${a.indices.join(",")}]`)
          .join("; ")}.`
      : undefined,
    partial.length > 0
      ? `Partially-supported claims (qualify or strengthen the citation): ${partial
          .map((a) => `"${a.sentence}" [${a.indices.join(",")}]`)
          .join("; ")}.`
      : undefined,
    hasInvalid || hasMalformed ? `Allowed citation range for this turn: [1]...[${maxIndex}].` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}
