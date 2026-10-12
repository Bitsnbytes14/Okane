import { ResearchWorkspace } from "@/components/research-workspace";
import { listPaperTrades } from "@/lib/ledger/ledger";

// Read the in memory ledger on every request so the list is never prerendered.
export const dynamic = "force-dynamic";

export default function Home() {
  return <ResearchWorkspace initialTrades={listPaperTrades()} />;
}
