import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import normalFixture from "@/fixtures/normal.json";
import insufficientFixture from "@/fixtures/insufficient_data.json";
import { POST } from "@/app/api/runs/[runId]/decision/route";
import {
  PaperTradingBanner,
  PAPER_TRADING_BANNER,
  decisionOutcomeText,
} from "@/components/paper-trading-banner";
import { LEDGER_DEFAULTS } from "@/lib/config";
import {
  FinalResponseSchema,
  PAPER_TRADE_LABEL,
  type FinalResponse,
  type PaperTrade,
} from "@/lib/contracts";
import { decideRun } from "@/lib/ledger/decision";
import { appendPaperTrade, clearLedger, listPaperTrades } from "@/lib/ledger/ledger";
import {
  clearRunResultStore,
  getRunResult,
  saveRunResult,
} from "@/lib/trace/run-result-store";

// node:test, no network. Runs are seeded straight into the result store.

const awaiting: FinalResponse = FinalResponseSchema.parse(normalFixture);
const insufficient: FinalResponse = FinalResponseSchema.parse(insufficientFixture);
const noTrade: FinalResponse = FinalResponseSchema.parse({
  ...insufficientFixture,
  requestId: "run_2026-10-08_003",
  status: "NO_TRADE",
});

function sampleTrade(index: number): PaperTrade {
  return {
    id: `trade_${index}`,
    runId: `run_${index}`,
    symbol: "RELIANCE.NS",
    direction: "BUY",
    entry: 100,
    target: 110,
    stop: 95,
    positionSizeShares: 10,
    approvedAt: "2026-10-08T10:00:00.000Z",
    dataMode: "fixture",
    source: "fixture",
    label: PAPER_TRADE_LABEL,
  };
}

function post(runId: string, body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/runs/x/decision", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ runId }) },
  );
}

beforeEach(() => {
  clearLedger();
  clearRunResultStore();
  saveRunResult(awaiting);
  saveRunResult(insufficient);
  saveRunResult(noTrade);
});

describe("human decision endpoint", () => {
  it("APPROVE records exactly one labelled paper trade", async () => {
    const response = await post(awaiting.requestId, { decision: "APPROVE" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.approvalStatus, "APPROVED");
    const trades = listPaperTrades();
    assert.equal(trades.length, 1);
    assert.equal(trades[0].label, PAPER_TRADE_LABEL);
    assert.equal(trades[0].runId, awaiting.requestId);
    assert.equal(trades[0].positionSizeShares, awaiting.riskReview.positionSizeShares);
    assert.equal(getRunResult(awaiting.requestId)?.approvalStatus, "APPROVED");
  });

  it("REJECT records nothing", async () => {
    const response = await post(awaiting.requestId, { decision: "REJECT" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).approvalStatus, "REJECTED");
    assert.equal(listPaperTrades().length, 0);
    assert.equal(getRunResult(awaiting.requestId)?.approvalStatus, "REJECTED");
  });

  it("cannot approve NO_TRADE or INSUFFICIENT_EVIDENCE runs", async () => {
    for (const run of [insufficient, noTrade]) {
      const response = await post(run.requestId, { decision: "APPROVE" });
      assert.equal(response.status, 409);
    }
    assert.equal(listPaperTrades().length, 0);
  });

  it("returns 409 on a repeat decision and never duplicates the trade", async () => {
    assert.equal((await post(awaiting.requestId, { decision: "APPROVE" })).status, 200);
    assert.equal((await post(awaiting.requestId, { decision: "APPROVE" })).status, 409);
    assert.equal((await post(awaiting.requestId, { decision: "REJECT" })).status, 409);
    assert.equal(listPaperTrades().length, 1);
  });

  it("returns 404 for unknown or malformed run ids and 400 for bad bodies", async () => {
    assert.equal((await post("run_unknown", { decision: "APPROVE" })).status, 404);
    assert.equal((await post("bad id!", { decision: "APPROVE" })).status, 404);
    assert.equal((await post(awaiting.requestId, { decision: "BUY" })).status, 400);
    assert.equal((await post(awaiting.requestId, "not json")).status, 400);
    assert.equal((await post(awaiting.requestId, {})).status, 400);
    assert.equal(listPaperTrades().length, 0);
  });

  it("judges the run by the stored result, not the request body", async () => {
    const claim = { decision: "APPROVE", status: "AWAITING_HUMAN_APPROVAL", riskReview: { decision: "APPROVE" } };
    assert.equal((await post(insufficient.requestId, claim)).status, 400);
    assert.equal((await post(insufficient.requestId, { decision: "APPROVE" })).status, 409);
    assert.equal(listPaperTrades().length, 0);
  });

  it("never stores or approves a run whose risk review is not APPROVE", () => {
    const tampered: FinalResponse = {
      ...awaiting,
      requestId: "run_risk_not_approved",
      riskReview: { ...awaiting.riskReview, decision: "REJECT" },
    };
    // The contract already refuses to store this run, so there is nothing to approve.
    saveRunResult(tampered);
    assert.equal(getRunResult(tampered.requestId), undefined);
    const outcome = decideRun(tampered.requestId, { decision: "APPROVE" });
    assert.equal(outcome.ok, false);
    assert.equal(listPaperTrades().length, 0);
  });
});

describe("paper trade ledger", () => {
  it("keeps only the last N trades", () => {
    for (let index = 0; index < LEDGER_DEFAULTS.maxTrades + 5; index += 1) {
      appendPaperTrade(sampleTrade(index));
    }
    const trades = listPaperTrades();
    assert.equal(trades.length, LEDGER_DEFAULTS.maxTrades);
    assert.equal(trades[0].id, "trade_5");
    assert.equal(trades.at(-1)?.id, `trade_${LEDGER_DEFAULTS.maxTrades + 4}`);
  });
});

describe("paper trading banner", () => {
  it("is present for approved, rejected and no trade results", () => {
    // react-dom/server is unavailable under the react-server condition, so inspect the element.
    const banner = PaperTradingBanner();
    assert.equal(banner.props.children, PAPER_TRADING_BANNER);
    assert.match(PAPER_TRADING_BANNER, /Paper trading, educational only/);
    assert.match(decisionOutcomeText("AWAITING_HUMAN_APPROVAL", "APPROVED"), /simulated trade/);
    assert.match(decisionOutcomeText("AWAITING_HUMAN_APPROVAL", "REJECTED"), /Nothing was recorded/);
    assert.match(decisionOutcomeText("NO_TRADE", "NOT_APPLICABLE"), /No trade/);
  });
});
