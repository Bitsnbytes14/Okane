import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { StructuredErrorSchema } from "@/lib/contracts";
import { invokeModelSafely } from "@/lib/safe-model";

// Written against node:test. Moving to Vitest means swapping the first two
// imports for `vitest`; the describe, it and assert calls stay the same.

const OutputSchema = z.object({ ok: z.boolean() }).strict();
const VARS = ["OPENAI_API_KEY", "NEXT_PUBLIC_DEMO_MODE"] as const;

describe("invokeModelSafely with no API key", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("returns a structured MISSING_API_KEY error and does not throw when demo mode is off", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const result = await invokeModelSafely({ prompt: "hello", schema: OutputSchema });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "MISSING_API_KEY");
    assert.equal(result.source, "none");
    assert.equal(StructuredErrorSchema.safeParse(result.error).success, true);
  });

  it("returns the labelled deterministic mock when demo mode is on", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const request = { prompt: "hello", schema: OutputSchema, mockResponse: { ok: true } };
    const first = await invokeModelSafely(request);
    const second = await invokeModelSafely(request);
    assert.deepEqual(first, second);
    assert.equal(first.ok, true);
    assert.equal(first.source, "mock");
  });
});

const FAKE_KEY = "sk-test-abcdefghijklmnop1234567890";

class FakeApiError extends Error {
  status?: number;
  constructor(name: string, message: string, status?: number) {
    super(message);
    this.name = name;
    if (status !== undefined) this.status = status;
  }
}

describe("invokeModelSafely maps OpenAI failures", () => {
  const saved: Record<string, string | undefined> = {};
  const proto = ChatOpenAI.prototype as unknown as { invoke: unknown };
  const originalInvoke = proto.invoke;

  beforeEach(() => {
    for (const name of VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    process.env.OPENAI_API_KEY = FAKE_KEY;
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  });

  afterEach(() => {
    proto.invoke = originalInvoke;
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  function failWith(error: Error): void {
    proto.invoke = async () => {
      throw error;
    };
  }

  async function run() {
    const result = await invokeModelSafely({ prompt: "hello", schema: OutputSchema });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.source, "openai");
    assert.equal(result.error.message.includes(FAKE_KEY), false);
    assert.equal(/sk-/.test(result.error.message), false);
    return result.error.code;
  }

  it("maps 429 to RATE_LIMIT", async () => {
    failWith(new FakeApiError("RateLimitError", `429 rate limited for ${FAKE_KEY}`, 429));
    assert.equal(await run(), "RATE_LIMIT");
  });

  it("maps 401 to AUTH_FAILURE", async () => {
    failWith(new FakeApiError("AuthenticationError", `401 bad key ${FAKE_KEY}`, 401));
    assert.equal(await run(), "AUTH_FAILURE");
  });

  it("maps a timeout to TIMEOUT", async () => {
    failWith(new FakeApiError("APIConnectionTimeoutError", "Request timed out."));
    assert.equal(await run(), "TIMEOUT");
  });

  it("maps 500 to PROVIDER_ERROR", async () => {
    failWith(new FakeApiError("InternalServerError", `500 server error ${FAKE_KEY}`, 500));
    assert.equal(await run(), "PROVIDER_ERROR");
  });

  it("redacts the key from an unknown failure message", async () => {
    failWith(new FakeApiError("Error", `boom ${FAKE_KEY}`));
    assert.equal(await run(), "UNKNOWN");
  });
});
