import { decideRun } from "@/lib/ledger/decision";

// POST only. The server judges the decision from the stored run result.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ runId: string }> };

const HEADERS = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { runId } = await context.params;
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      payload = undefined;
    }
    const outcome = decideRun(runId, payload);
    if (!outcome.ok) {
      return Response.json({ error: outcome.error }, { status: outcome.status, headers: HEADERS });
    }
    return Response.json(
      { approvalStatus: outcome.approvalStatus, trade: outcome.trade },
      { status: 200, headers: HEADERS },
    );
  } catch {
    return Response.json(
      { error: { code: "UNKNOWN", message: "Unexpected failure while recording the decision" } },
      { status: 500, headers: HEADERS },
    );
  }
}
