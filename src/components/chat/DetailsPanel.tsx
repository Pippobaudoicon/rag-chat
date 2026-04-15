"use client";

import type { MessageDetails, Language } from "@/lib/types";

interface DetailRowsProps {
  details: MessageDetails;
  language?: Language;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function DetailRows({ details, language = "ita" }: DetailRowsProps) {
  const rows: { label: string; value: string }[] = [];

  if (details.model) {
    rows.push({
      label: language === "ita" ? "Modello" : "Model",
      value: details.model,
    });
  }
  if (details.inputTokens != null) {
    rows.push({
      label: language === "ita" ? "Token input" : "Input tokens",
      value: details.inputTokens.toLocaleString(),
    });
  }
  if (details.outputTokens != null) {
    rows.push({
      label: language === "ita" ? "Token output" : "Output tokens",
      value: details.outputTokens.toLocaleString(),
    });
  }
  if (details.reasoningTokens != null && details.reasoningTokens > 0) {
    rows.push({
      label: language === "ita" ? "Token ragionamento" : "Reasoning tokens",
      value: details.reasoningTokens.toLocaleString(),
    });
  }
  if (details.totalTokens != null) {
    rows.push({
      label: language === "ita" ? "Token totali" : "Total tokens",
      value: details.totalTokens.toLocaleString(),
    });
  }
  if (details.latencyMs != null) {
    rows.push({
      label: language === "ita" ? "Latenza" : "Latency",
      value: formatLatency(details.latencyMs),
    });
  }
  if (details.finishReason) {
    rows.push({
      label: language === "ita" ? "Fine generazione" : "Finish reason",
      value: details.finishReason,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-muted-foreground/60">{row.label}</span>
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
