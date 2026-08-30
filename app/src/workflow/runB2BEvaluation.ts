import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { runDealSubmitted, type RunDealSubmittedInput } from "./dealSubmitted";
import { runCommit } from "./commit";

// B2C waits for a buyer to click "accept" on a quote before ever calling runCommit —
// there is a real human approval gate between "prepared" and commit. B2B has no
// equivalent gate: once all six role agents (sales/finance/inventory/procurement/
// logistics/risk) and the deterministic feasibility check in runDealSubmitted clear a
// case to "prepared", the product's own commitment-desk mockup shows certificate
// issuance following automatically, right after the coordinator's verification step,
// with no separate approval click in between. So this file exists purely to chain
// runDealSubmitted -> runCommit for the B2B flow when (and only when) the case reaches
// "prepared" — anything else (negotiating, cannot_commit) is a stopping point that this
// function must pass through unchanged, not a case to force through runCommit.
export async function runB2BEvaluation(db: PrismaClient, gateway: ModelGateway, input: RunDealSubmittedInput) {
  const result = await runDealSubmitted(db, gateway, input);
  if (result.status !== "prepared") return result;
  return runCommit(db, { caseId: input.caseId, traceId: input.traceId });
}
