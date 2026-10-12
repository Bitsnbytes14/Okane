import "server-only";

import { isDemoMode } from "@/lib/config";
import {
  MarketSnapshotSchema,
  type DemoScenario,
  type ResearchRequest,
  type RiskReview,
  type TradeProposal,
} from "@/lib/contracts";
import marketInsufficient from "@/fixtures/market_insufficient_data.json";
import marketNormal from "@/fixtures/market_normal.json";
import { runResearchAgent } from "@/lib/agents/research";
import {
  RISK_LIMITS,
  calculatePositionSize,
  calculateStopDistance,
  runRiskGuardrail,
} from "@/lib/agents/risk";
import {
  runOkaneGraph,
  type GraphAgents,
  type OkaneGraphOptions,
  type OkaneGraphResult,
} from "@/lib/graph/okane-graph";
import { invokeModelSafely } from "@/lib/safe-model";

// Demo only scenarios for presentations. Every scenario runs the real graph, the
// real routing and the real agents. Market data always comes from a saved,
// labelled fixture, never from a provider. The browser sends only the scenario
// name; nothing in this file accepts prices or agent outputs from a caller.

const SCRIPTED_LABEL = "Scripted demo scenario";
const SCRIPTED_RISK_REWARD = 1.2;

function fixtureResearch(market: unknown): GraphAgents["research"] {
  const snapshot = MarketSnapshotSchema.parse(market);
  return (request, observeSnapshot) => {
    observeSnapshot(snapshot);
    return runResearchAgent(request, {
      getMarketSnapshot: async () => ({ ok: true, snapshot }),
      invokeModel: invokeModelSafely,
    });
  };
}

// The only scripted piece. The first review asks for one revision; every later
// review comes from the real Risk Guardrail. Sizing uses the real calculations.
// The route reason of the REVISE row carries the scripted label, because the
// graph builds that text from the review reasons.
function scriptedRisk(): GraphAgents["risk"] {
  let calls = 0;
  return (proposal: TradeProposal, portfolioValueInr: number): RiskReview => {
    calls += 1;
    if (calls > 1) return runRiskGuardrail(proposal, portfolioValueInr);
    const stopDistance = calculateStopDistance(proposal.entry, proposal.stop);
    const sizing = calculatePositionSize(portfolioValueInr, stopDistance);
    return {
      decision: "REVISE",
      positionSizeShares: sizing?.positionSizeShares ?? 0,
      maxLossInr: sizing?.maxLossInr ?? 0,
      riskRewardRatio: SCRIPTED_RISK_REWARD,
      reasons: [
        `${SCRIPTED_LABEL}: risk to reward ${SCRIPTED_RISK_REWARD.toFixed(2)} is below the ${RISK_LIMITS.minRiskRewardRatio.toFixed(1)} minimum`,
        "Revise entry, target, or stop before this paper-trade hypothesis can proceed",
      ],
    };
  };
}

function agentsFor(scenario: DemoScenario): Partial<GraphAgents> {
  switch (scenario) {
    case "normal":
      return { research: fixtureResearch(marketNormal) };
    case "insufficient_data":
      return { research: fixtureResearch(marketInsufficient) };
    case "risk_revision":
      return { research: fixtureResearch(marketNormal), risk: scriptedRisk() };
  }
}

// The fixtures are saved for one symbol, so the scenario run is for that symbol.
function fixtureSymbol(scenario: DemoScenario): string {
  return MarketSnapshotSchema.parse(
    scenario === "insufficient_data" ? marketInsufficient : marketNormal,
  ).symbol;
}

// Never throws. Refuses to run unless the existing demo flag is on.
export async function runDemoScenario(
  scenario: DemoScenario,
  request: ResearchRequest,
  options: OkaneGraphOptions = {},
): Promise<OkaneGraphResult> {
  if (!isDemoMode()) {
    return {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Demo scenarios are available only when demo mode is on",
        agent: "request_validator",
      },
    };
  }
  return runOkaneGraph(
    { ...request, symbol: fixtureSymbol(scenario) },
    { ...options, agents: { ...agentsFor(scenario), ...options.agents } },
  );
}
