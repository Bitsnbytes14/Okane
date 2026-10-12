import assert from "node:assert/strict";
import { describe, it } from "node:test";
import normalFixture from "@/fixtures/normal.json";
import { FinalResponseSchema, type DemoScenario, type ResearchRequest } from "@/lib/contracts";
import { handleResearchRequest } from "@/app/api/research/route";

const validRequest: ResearchRequest = {
  symbol: "RELIANCE.NS",
  horizonDays: 5,
  portfolioValueInr: 1_000_000,
  mode: "paper",
};

const fixture = FinalResponseSchema.parse(normalFixture);

function recordingRunner() {
  const seen: Array<{ request: unknown; scenario: DemoScenario | undefined }> = [];
  return {
    seen,
    runner: async (request: unknown, scenario?: DemoScenario) => {
      seen.push({ request, scenario });
      return { ok: true as const, response: fixture };
    },
  };
}

describe("POST /api/research demo scenario handling", () => {
  it("4a. an unknown scenario value returns 400 and never runs the graph", async () => {
    for (const demoMode of [true, false]) {
      const { runner, seen } = recordingRunner();
      const response = await handleResearchRequest(
        { ...validRequest, scenario: "crash_the_market" },
        runner,
        demoMode,
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_REQUEST");
      assert.equal(seen.length, 0);
    }
  });

  it("4b. a scenario sent with demo mode off is ignored", async () => {
    const { runner, seen } = recordingRunner();
    const response = await handleResearchRequest(
      { ...validRequest, scenario: "risk_revision" },
      runner,
      false,
    );
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].scenario, undefined);
    assert.deepEqual(seen[0].request, validRequest);
  });

  it("4c. a valid scenario reaches the runner by name when demo mode is on", async () => {
    const { runner, seen } = recordingRunner();
    const response = await handleResearchRequest(
      { ...validRequest, scenario: "risk_revision" },
      runner,
      true,
    );
    assert.equal(response.status, 200);
    assert.equal(seen[0].scenario, "risk_revision");
    assert.deepEqual(seen[0].request, validRequest);
  });

  it("4d. a request with no scenario runs normally", async () => {
    const { runner, seen } = recordingRunner();
    await handleResearchRequest(validRequest, runner, true);
    assert.equal(seen[0].scenario, undefined);
  });
});
