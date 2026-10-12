import { TRACE_DEFAULTS } from "@/lib/config";
import { FinalResponseSchema, type ApprovalStatus, type FinalResponse } from "@/lib/contracts";

// In memory store of the final response of each run, keyed by run id, so the
// server can judge a human decision from what the graph produced and never from
// what the browser sends. Resets on server restart and on serverless cold starts.

type Store = Map<string, FinalResponse>;
type GlobalWithStore = typeof globalThis & { __okaneRunResultStore?: Store };

function store(): Store {
  const holder = globalThis as GlobalWithStore;
  holder.__okaneRunResultStore ??= new Map();
  return holder.__okaneRunResultStore;
}

// Never throws. A response that fails validation is not stored.
export function saveRunResult(response: FinalResponse): void {
  try {
    const parsed = FinalResponseSchema.parse(response);
    const runs = store();
    runs.delete(parsed.requestId);
    runs.set(parsed.requestId, parsed);
    while (runs.size > TRACE_DEFAULTS.maxRuns) {
      const oldest = runs.keys().next();
      if (oldest.done) break;
      runs.delete(oldest.value);
    }
  } catch {
    // Recording a result must never break a run.
  }
}

export function getRunResult(runId: string): FinalResponse | undefined {
  return store().get(runId);
}

// Replaces the stored approval status. Returns false if the run is unknown.
export function setRunApprovalStatus(runId: string, approvalStatus: ApprovalStatus): boolean {
  const runs = store();
  const current = runs.get(runId);
  if (current === undefined) return false;
  runs.set(runId, { ...current, approvalStatus });
  return true;
}

export function clearRunResultStore(): void {
  store().clear();
}
