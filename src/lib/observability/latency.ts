// Per-turn latency instrumentation. Records independent phase durations,
// ordered milestones, per-model-step and per-tool timings for a single chat
// turn, so response latency is quantifiable from real traffic and optimizations
// are provable. Persisted as `MessageDetails.latency` (see types.ts).
//
// Durations are measured independently with performance.now() — NOT as a
// cumulative running mark — so they stay correct even when phases overlap.

import type { LatencyTrace } from "@/lib/types";

type Milestone = keyof LatencyTrace["milestones"];
type ModelStep = NonNullable<LatencyTrace["modelSteps"]>[number];
type ToolTiming = NonNullable<LatencyTrace["tools"]>[number];

const round = (ms: number): number => Math.round(ms);

/**
 * Create a latency tracer for one request. `t0` is the handler-entry timestamp
 * (`performance.now()`); milestones are recorded as ms since `t0`.
 */
export function createLatencyTrace(t0: number) {
  const phases: Record<string, number> = {};
  const milestones: LatencyTrace["milestones"] = {};
  const modelSteps: ModelStep[] = [];
  const tools: ToolTiming[] = [];

  return {
    /** Measure `fn` in isolation and store its duration under `label`. */
    async phase<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        phases[label] = round(performance.now() - start);
      }
    },

    /** Record a milestone (ms since t0). Set-once — later calls are ignored. */
    milestone(name: Milestone): void {
      if (milestones[name] === undefined) {
        milestones[name] = round(performance.now() - t0);
      }
    },

    addStep(step: ModelStep): void {
      modelSteps.push(step);
    },

    addTool(tool: ToolTiming): void {
      tools.push(tool);
    },

    /** ms since t0 (for ad-hoc reads, e.g. final totalMs). */
    elapsed(): number {
      return round(performance.now() - t0);
    },

    build(path: LatencyTrace["path"]): LatencyTrace {
      return {
        version: 1,
        path,
        release: process.env.VERCEL_GIT_COMMIT_SHA,
        phases,
        milestones,
        modelSteps: modelSteps.length > 0 ? modelSteps : undefined,
        tools: tools.length > 0 ? tools : undefined,
      };
    },
  };
}

export type LatencyTracer = ReturnType<typeof createLatencyTrace>;

type ToolLike = { execute?: unknown };

/**
 * Wrap every tool's `execute` to record name / wall-time / success into the
 * tracer. Tools without an `execute` (e.g. client-resolved tools) pass through
 * untouched. Returns the same ToolSet shape so callers stay type-identical.
 */
export function withToolTiming<T extends Record<string, ToolLike>>(
  tools: T,
  addTool: (t: ToolTiming) => void
): T {
  const wrapped: Record<string, ToolLike> = {};

  for (const [name, toolDef] of Object.entries(tools)) {
    const exec = (toolDef as ToolLike).execute;
    if (typeof exec !== "function") {
      wrapped[name] = toolDef;
      continue;
    }

    const originalExecute = exec as (...args: unknown[]) => unknown;
    wrapped[name] = {
      ...(toolDef as object),
      execute: async (...args: unknown[]): Promise<unknown> => {
        const start = performance.now();
        let ok = true;
        try {
          return await originalExecute(...args);
        } catch (error) {
          ok = false;
          throw error;
        } finally {
          addTool({ name, durationMs: round(performance.now() - start), ok });
        }
      },
    };
  }

  return wrapped as T;
}
