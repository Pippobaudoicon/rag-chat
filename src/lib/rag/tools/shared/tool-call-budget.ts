type ToolLike = { execute?: unknown };

export function withToolCallBudget<T extends Record<string, ToolLike>>(
  tools: T,
  limitedTools: Array<keyof T>,
  maxCalls: number = Number.POSITIVE_INFINITY
): T {
  const limited = new Set<string>(limitedTools.map(String));
  let calls = 0;

  return Object.fromEntries(
    Object.entries(tools).map(([name, toolDef]) => {
      if (!limited.has(name) || typeof toolDef.execute !== "function") {
        return [name, toolDef];
      }

      const originalExecute = toolDef.execute as (...args: unknown[]) => unknown;
      return [
        name,
        {
          ...toolDef,
          execute: async (...args: unknown[]) => {
            if (calls >= maxCalls) {
              return {
                limitReached: true,
                total: 0,
                chunks: [],
                note: "Retrieval limit reached. Answer using the sources already returned.",
              };
            }
            calls += 1;
            return originalExecute(...args);
          },
        },
      ];
    })
  ) as T;
}
