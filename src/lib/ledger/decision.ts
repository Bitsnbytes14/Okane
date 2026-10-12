import {
  DecisionRequestSchema,
  PAPER_TRADE_LABEL,
  PaperTradeSchema,
  type ApprovalStatus,
  type PaperTrade,
  type StructuredError,
} from "@/lib/contracts";
import { appendPaperTrade } from "@/lib/ledger/ledger";
import { getRunResult, setRunApprovalStatus } from "@/lib/trace/run-result-store";
import { isValidRunId } from "@/lib/trace/trace-store";

// Human decision on a stored run. Every rule reads the stored result, never the
// request body. The checks and the write run synchronously with no await between
// them, so two requests cannot both pass the pending check.

export type DecisionOutcome =
  | { ok: true; status: 200; approvalStatus: ApprovalStatus; trade: PaperTrade | null }
  | { ok: false; status: 400 | 404 | 409 | 422; error: StructuredError };

function failure(status: 400 | 404 | 409 | 422, message: string): DecisionOutcome {
  return {
    ok: false,
    status,
    error: { code: "INVALID_REQUEST", message },
  };
}

export function decideRun(
  runId: string,
  payload: unknown,
  clock: () => Date = () => new Date(),
): DecisionOutcome {
  if (!isValidRunId(runId)) return failure(404, "Run not found");

  const parsed = DecisionRequestSchema.safeParse(payload);
  if (!parsed.success) return failure(400, "Body must be exactly { decision: APPROVE or REJECT }");

  const run = getRunResult(runId);
  if (run === undefined) return failure(404, "Run not found");
  if (run.status !== "AWAITING_HUMAN_APPROVAL") {
    return failure(409, "This run is not awaiting human approval");
  }
  const proposal = run.tradeProposal;
  if (proposal === undefined) return failure(422, "This run has no trade proposal");
  if (run.riskReview.decision !== "APPROVE") {
    return failure(422, "The risk review did not approve this run");
  }
  if (run.approvalStatus !== "PENDING_HUMAN") {
    return failure(409, "A decision was already made for this run");
  }

  if (parsed.data.decision === "REJECT") {
    setRunApprovalStatus(runId, "REJECTED");
    return { ok: true, status: 200, approvalStatus: "REJECTED", trade: null };
  }

  const candidate = {
    id: `trade_${runId}`,
    runId,
    symbol: proposal.symbol,
    direction: proposal.direction,
    entry: proposal.entry,
    target: proposal.target,
    stop: proposal.stop,
    positionSizeShares: run.riskReview.positionSizeShares,
    approvedAt: clock().toISOString(),
    dataMode: run.dataMode,
    source: [...new Set(run.evidence.map((item) => item.source))].join(", "),
    label: PAPER_TRADE_LABEL,
  };
  const trade = PaperTradeSchema.safeParse(candidate);
  if (!trade.success) {
    return failure(422, "The approved proposal could not be recorded as a valid paper trade");
  }
  appendPaperTrade(trade.data);
  setRunApprovalStatus(runId, "APPROVED");
  return { ok: true, status: 200, approvalStatus: "APPROVED", trade: trade.data };
}
