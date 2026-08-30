import type { PrismaClient } from "@prisma/client";
import type { ModelGateway } from "@/gateway/modelGateway";
import { DomainDecisionSchema, type DomainDecision, type PaymentTerms, type RoleId, type RoleModelOutput } from "@/lib/types";
import { newId } from "@/lib/ids";
import { toJsonColumn } from "@/lib/json-column";
import { ROLE_CONFIGS, buildSystemPrompt } from "./roleConfigs";
import { buildReadTool, buildMutationTool } from "./toolRegistry";

export interface RunRoleAgentInput {
  role: RoleId;
  caseId: string;
  caseVersion: number;
  termsHash: string;
  contextSummary: Record<string, unknown>;
  toolContext: { customerId: string; sku: string; destinationId: string; paymentTerms: PaymentTerms };
  traceId: string;
  timeoutMs: number;
}

const DECISION_FRESHNESS_MS = 15 * 60 * 1000;

// Loads only permitted context, exposes only allowed tools, calls the gateway with
// structured output enabled, validates the result, and persists the decision with
// trace and case-version metadata (03-AGENT-ARCHITECTURE.md "Shared runtime").
export async function runRoleAgent(db: PrismaClient, gateway: ModelGateway, input: RunRoleAgentInput, fallbackModelId: string): Promise<DomainDecision> {
  const config = ROLE_CONFIGS[input.role];
  const systemPrompt = buildSystemPrompt(config);
  const readTools = config.allowedReadTools.map((name) => buildReadTool(db, name, { caseId: input.caseId, customerId: input.toolContext.customerId, sku: input.toolContext.sku, destinationId: input.toolContext.destinationId }));
  const mutationTool = buildMutationTool(db, input.role, { caseId: input.caseId, caseVersion: input.caseVersion, termsHash: input.termsHash, sku: input.toolContext.sku, customerId: input.toolContext.customerId, paymentTerms: input.toolContext.paymentTerms });

  const attempt = () => withTimeout(gateway.runRole({ role: input.role, systemPrompt, contextSummary: input.contextSummary, readTools, mutationTool, timeoutMs: input.timeoutMs }), input.timeoutMs);

  // KNOWN P0 LIMITATION (not an oversight): a retry below is a fresh LLM reasoning
  // round, not a replay — nothing guarantees the second attempt requests the same
  // tool-call args as the first. The mutation-tool adapters derive their idempotency
  // key from caseId/caseVersion/actionType/resourceRef only, deliberately
  // content-independent (see deriveIdempotencyKey in policy/idempotency.ts), under the
  // documented assumption that "retries pass the identical input and therefore reuse
  // the identical key". If attempt 1 already created a reservation and a later step
  // then failed/timed out, and attempt 2's model requests different args (e.g. a
  // different quantity) at the same resourceRef, the adapter will silently return
  // attempt 1's existing reservation instead of attempt 2's actual request — with no
  // error and no log entry. Comparing/validating args across attempts and raising
  // IDEMPOTENCY_CONFLICT on mismatch is the correct fix but is out of scope for this
  // pass (mirrors the accepted gap documented in receipts/actionReceipt.ts).
  try {
    const result = await attempt();
    return persistDecision(db, input, result.output, result.modelId, result.gatewayRequestId);
  } catch (firstError) {
    try {
      const result = await attempt();
      return persistDecision(db, input, result.output, result.modelId, result.gatewayRequestId);
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      const fallback: RoleModelOutput = { decision: "unavailable", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: [], explanation: `Role unavailable after retry: ${message}` };
      return persistDecision(db, input, fallback, fallbackModelId, null);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new Error("Role run timed out")), timeoutMs);
  });
  // Clear the timer on either outcome so a settled `promise` (the common case) doesn't
  // leave an orphaned setTimeout running for the rest of timeoutMs.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

async function persistDecision(db: PrismaClient, input: RunRoleAgentInput, output: RoleModelOutput, modelId: string, gatewayRequestId: string | null): Promise<DomainDecision> {
  const decisionId = newId("DEC");
  const expiresAt = new Date(Date.now() + DECISION_FRESHNESS_MS).toISOString();
  const decision = DomainDecisionSchema.parse({
    ...output,
    decisionId,
    caseId: input.caseId,
    caseVersion: input.caseVersion,
    termsHash: input.termsHash,
    role: input.role,
    expiresAt,
  });
  await db.domainDecision.create({
    data: {
      id: decisionId,
      caseId: input.caseId,
      caseVersion: input.caseVersion,
      termsHash: input.termsHash,
      role: input.role,
      decision: output.decision,
      payload: toJsonColumn(decision), // FIX: JSON-in-TEXT column, not a bare cast
      evidenceRefs: toJsonColumn(output.evidenceRefs), // FIX: JSON-in-TEXT column, not a bare cast
      expiresAt: new Date(expiresAt),
      modelId,
      gatewayRequestId,
      traceId: input.traceId,
    },
  });
  return decision;
}
