import { ResearchRequestSchema, type FinalResponse, type StructuredError } from "@/lib/contracts";
import { runOkaneGraph, type OkaneGraphResult } from "@/lib/graph/okane-graph";
import { saveRunResult } from "@/lib/trace/run-result-store";

export const dynamic = "force-dynamic";

type GraphRunner = (request: unknown) => Promise<OkaneGraphResult>;

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
  runner: GraphRunner = runOkaneGraph,
): Promise<Response> {
  const parsed = ResearchRequestSchema.safeParse(payload);
  if (!parsed.success) return invalidRequest("Check the symbol, 1–10 day horizon, and positive portfolio value");

  const result = await runner(parsed.data);
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
