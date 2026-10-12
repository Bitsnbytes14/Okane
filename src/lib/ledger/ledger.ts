import { LEDGER_DEFAULTS } from "@/lib/config";
import type { PaperTrade } from "@/lib/contracts";

// Append only, in memory ledger of simulated trades. It resets on server restart
// and on serverless cold starts, so it is demo evidence, not durable storage.
// It hangs off globalThis so the route and the page share one instance. This is
// the only write a human approval can cause. No order is ever sent anywhere.

type GlobalWithLedger = typeof globalThis & { __okaneLedger?: PaperTrade[] };

function ledger(): PaperTrade[] {
  const holder = globalThis as GlobalWithLedger;
  holder.__okaneLedger ??= [];
  return holder.__okaneLedger;
}

export function appendPaperTrade(trade: PaperTrade): void {
  const trades = ledger();
  trades.push(trade);
  while (trades.length > LEDGER_DEFAULTS.maxTrades) trades.shift();
}

// Oldest first. Returns a copy so callers cannot edit the ledger.
export function listPaperTrades(): readonly PaperTrade[] {
  return [...ledger()];
}

export function hasTradeForRun(runId: string): boolean {
  return ledger().some((trade) => trade.runId === runId);
}

export function clearLedger(): void {
  ledger().length = 0;
}
