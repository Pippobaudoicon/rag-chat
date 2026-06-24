// Conservative positive allowlist for P1 eager/speculative retrieval.
//
// Eager retrieval runs the default `semantic_search` during the preamble and
// injects the chunks as preloaded context. That is only a net win for genuine
// topical/doctrinal questions. For everything else — greetings, acknowledgements,
// response-edit / conversational follow-ups, scripture references, and requests
// for a SPECIFIC conference talk (which belong to `lookup_scripture_passage` /
// `search_conference_talks`) — speculatively retrieving adds latency and injects
// unrelated chunks that can shift output and citation ordering.
//
// CLASSIFY THE TRANSLATED SEARCH QUERY, NOT THE RAW PROMPT. The route only runs
// eager retrieval on the English index (`indexLanguage === "eng"`), where
// language routing has already translated the user's prompt into English as
// `languageRouting.searchQuery`. So this classifier always sees English and
// needs only English heuristics — an Italian "Rendilo più breve" arrives here as
// "Make it shorter", an Italian "Grazie" as "Thank you", etc. No multilingual
// regex lists.
//
// Deliberately biased toward FALSE NEGATIVES: when in doubt it returns `false`,
// so the turn falls back to the normal tool-first flow (no harm, just no
// speedup). A false positive — eager retrieval on a non-topical turn — is the
// costly case, so every gate below errs toward skipping. Scripture references
// are gated separately in the route via `parseScriptureSelection`.

// Genuine topical questions are rarely shorter than this. "What is faith?" (3)
// and "Explain the Atonement" (3) still pass; one- and two-word turns are almost
// always acknowledgements or follow-ups.
const MIN_TOPICAL_WORDS = 3;

// Greetings / acknowledgements / pure chit-chat (anchored at the start; a turn
// that merely OPENS with one of these is treated as non-topical — false-negative
// bias).
const CHITCHAT_RX =
  /^(hi|hello|hey|thanks?|thank you|thx|ty|ok|okay|k|cool|great|nice|got it|sounds good|perfect|awesome|wonderful|amazing|yes|yeah|yep|no|nope|sure|bye|goodbye|good (morning|afternoon|evening|night))\b/i;

// Response-edit / conversational follow-ups that operate on the PREVIOUS answer
// rather than introducing a new topic to retrieve.
const FOLLOWUP_EDIT_RX =
  /^(make (it|that|this)|shorten|lengthen|expand|elaborate|continue|go on|keep going|rephrase|reword|rewrite|summari[sz]e|simplify|clarify|translate|say (it|that) again|repeat|tl;?dr|in (english|italian|spanish|french|german|portuguese)\b|more\b|again\b)/i;

// Requests for a SPECIFIC conference talk → `search_conference_talks`, not the
// general semantic search. "talk about <topic>" is intentionally NOT matched
// (that is a topical phrasing, not a talk reference).
const CONFERENCE_TALK_RX =
  /\b(conference talk|general conference|the talk|that talk|talk by|address by|devotional|fireside)\b/i;

/**
 * True when `searchQuery` (the English-translated retrieval query) looks like a
 * genuine topical/doctrinal question that benefits from eager `semantic_search`
 * retrieval. Pure and deterministic.
 */
export function isEagerTopicalQuery(searchQuery: string): boolean {
  const q = searchQuery.trim();
  if (!q) return false;
  if (CHITCHAT_RX.test(q)) return false;
  if (q.split(/\s+/).length < MIN_TOPICAL_WORDS) return false;
  if (FOLLOWUP_EDIT_RX.test(q)) return false;
  if (CONFERENCE_TALK_RX.test(q)) return false;
  return true;
}
