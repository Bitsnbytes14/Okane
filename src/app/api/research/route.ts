import { isDemoMode } from "@/lib/config";
import {
  DemoScenarioSchema,
  ResearchRequestSchema,
  type DemoScenario,
  type FinalResponse,
  type StructuredError,
} from "@/lib/contracts";
import { runDemoScenario } from "@/lib/demo-scenarios";
import { runOkaneGraph, type OkaneGraphResult } from "@/lib/graph/okane-graph";
import { saveRunResult } from "@/lib/trace/run-result-store";

export const dynamic = "force-dynamic";

// The scenario is passed only for a valid name while demo mode is on.
type GraphRunner = (request: unknown, scenario?: DemoScenario) => Promise<OkaneGraphResult>;

const defaultRunner: GraphRunner = (request, scenario) => {
  if (scenario === undefined) return runOkaneGraph(request);
  const parsed = ResearchRequestSchema.safeParse(request);
  if (!parsed.success) return runOkaneGraph(request);
  return runDemoScenario(scenario, parsed.data);
};

// Splits the optional scenario name from the request fields. The request schema
// stays strict, so the scenario never reaches it.
function splitScenario(payload: unknown): { request: unknown; scenario: unknown } {
  if (typeof payload !== "object" || payload === null || !("scenario" in payload)) {
    return { request: payload, scenario: undefined };
  }
  const { scenario, ...request } = payload as Record<string, unknown>;
  return { request, scenario };
}

type ErrorBody = { error: StructuredError };

function invalidRequest(message: string): Response {
  const body: ErrorBody = {
    error: { code: "INVALID_REQUEST", message, agent: "request_validator" },
  };
  return Response.json(body, { status: 400, headers: { "Cache-Control": "no-store" } });
}

function graphError(error: StructuredError): Response {
  const status = error.code === "INVALID_REQUEST" ? 400 : 502;
  return Response.json({ error } satisfies ErrorBody, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Exported separately so the request boundary can be tested without a running
// Next.js server or a real model/data-provider call.
export async function handleResearchRequest(
  payload: unknown,
  runner: GraphRunner = defaultRunner,
  demoMode: boolean = isDemoMode(),
): Promise<Response> {
  const { request, scenario } = splitScenario(payload);
  const parsedScenario =
    scenario === undefined ? undefined : DemoScenarioSchema.safeParse(scenario);
  if (parsedScenario !== undefined && !parsedScenario.success) {
    return invalidRequest("Unknown demo scenario");
  }
  const parsed = ResearchRequestSchema.safeParse(request);
  if (!parsed.success) return invalidRequest("Check the symbol, 1–10 day horizon, and positive portfolio value");

  // With demo mode off the scenario is ignored and the normal run happens.
  const activeScenario = demoMode ? parsedScenario?.data : undefined;
  const result = await runner(parsed.data, activeScenario);
  if (!result.ok) return graphError(result.error);
  // Kept so a later human decision is judged from this stored result.
  saveRunResult(result.response);
  return Response.json(result.response satisfies FinalResponse, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleResearchRequest(await request.json());
  } catch {
    return invalidRequest("Request body must be valid JSON");
  }
}
