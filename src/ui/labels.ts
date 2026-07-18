import type { TracepadLanguage, TracepadTurn } from "../core/types";

export function languageLabel(language: TracepadLanguage): string {
  return language === "r" ? "R" : language === "sql" ? "SQL" : language === "julia" ? "Julia" : "Python";
}

export function statusLabel(status: TracepadTurn["status"]): string {
  return status === "ready" ? "Ready to run"
    : status === "generating" ? "Generating"
      : status === "running" ? "Running"
        : status === "failed" ? "Failed"
          : status === "succeeded" ? "Complete"
            : status === "stale" ? "Changed since run"
              : "Draft";
}
