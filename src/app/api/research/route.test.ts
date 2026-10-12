import assert from "node:assert/strict";
import { describe, it } from "node:test";
import normalFixture from "@/fixtures/normal.json";
import { FinalResponseSchema, type ResearchRequest } from "@/lib/contracts";
import { handleResearchRequest } from "@/app/api/research/route";

const validRequest: ResearchRequest = {
  symbol: "RELIANCE.NS",
  horizonDays: 5,
  portfolioValueInr: 1_000_000,
  mode: "paper",
};

describe("POST /api/research request boundary", () => {
  it("rejects malformed input before invoking the graph", async () => {
    let calls = 0;
    const response = await handleResearchRequest(
      { ...validRequest, horizonDays: 11 },
      async () => {
        calls += 1;
        throw new Error("runner must not run for invalid input");
      },
    );
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  });

  it("returns the graph's validated final response", async () => {
    const fixture = FinalResponseSchema.parse(normalFixture);
    const response = await handleResearchRequest(validRequest, async (received) => {
      assert.deepEqual(received, validRequest);
      return { ok: true, response: fixture };
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), fixture);
  });

  it("maps a graph failure to a safe response", async () => {
    const response = await handleResearchRequest(validRequest, async () => ({
      ok: false,
      error: { code: "TIMEOUT", message: "Market data request timed out", agent: "research" },
    }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "TIMEOUT");
  });
});
