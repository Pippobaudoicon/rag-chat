type ToolLoopStep = {
  toolCalls?: readonly ({ toolName?: string } | undefined)[];
};

type StepPolicy = {
  activeTools?: Array<"citation_verifier">;
  toolChoice?: "none";
};

const RETRIEVAL_TOOLS = new Set([
  "semantic_search",
  "lookup_scripture_passage",
  "search_conference_talks",
]);

export function prepareChatToolStep(
  steps: readonly ToolLoopStep[],
  hasFixedChunks = false
): StepPolicy | undefined {
  if (hasFixedChunks && steps.length === 0) {
    return { activeTools: [], toolChoice: "none" };
  }

  const calledTools = steps.flatMap((step) =>
    (step.toolCalls ?? []).flatMap((call) =>
      call?.toolName ? [call.toolName] : []
    )
  );

  if (calledTools.includes("citation_verifier")) {
    return { activeTools: [], toolChoice: "none" };
  }

  if (calledTools.some((name) => RETRIEVAL_TOOLS.has(name))) {
    return { activeTools: ["citation_verifier"] };
  }

  return undefined;
}
