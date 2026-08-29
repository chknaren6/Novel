import type { PrismaClient, Prisma } from "@prisma/client";
import { type CaseStatus, ToolError } from "@/lib/types";

type Db = PrismaClient | Prisma.TransactionClient;

// Allowed transitions from 04-DATA-AND-STATE-SPEC.md. `evaluating -> repaired` is a
// special case documented separately in the spec ("evaluating → repaired when
// processing a repair version") and is gated by the `isRepairVersion` flag below rather
// than being unconditionally listed here.
const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  intake: ["evaluating"],
  evaluating: ["negotiating", "prepared", "cannot_commit"],
  negotiating: ["evaluating", "cannot_commit"],
  prepared: ["committing", "aborting"],
  committing: ["committed", "aborting"],
  aborting: ["cannot_commit", "escalated"],
  committed: ["repair_needed"],
  cannot_commit: [],
  repair_needed: ["compensating", "escalated"],
  compensating: ["evaluating", "repaired", "escalated"],
  repaired: [],
  escalated: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: CaseStatus, to: CaseStatus) {
    super(`Cannot transition case from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

export interface TransitionOptions {
  isRepairVersion?: boolean;
}

export function assertValidTransition(from: CaseStatus, to: CaseStatus, options: TransitionOptions = {}): void {
  if (from === "evaluating" && to === "repaired") {
    if (!options.isRepairVersion) throw new InvalidTransitionError(from, to);
    return;
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new InvalidTransitionError(from, to);
}

export interface TransitionCaseInput {
  caseId: string;
  expectedStatus: CaseStatus;
  expectedVersion: number;
  nextStatus: CaseStatus;
  isRepairVersion?: boolean;
}

// The one function allowed to change `deal_case.status`. It verifies the transition is
// legal, then performs an optimistic-concurrency update: the WHERE clause must match
// both the expected status and the expected case version, or zero rows update and we
// treat that as a stale version (04-DATA-AND-STATE-SPEC.md "Concurrency control").
export async function transitionCase(db: Db, input: TransitionCaseInput): Promise<void> {
  assertValidTransition(input.expectedStatus, input.nextStatus, { isRepairVersion: input.isRepairVersion });
  const result = await db.dealCase.updateMany({
    where: { id: input.caseId, status: input.expectedStatus, activeTermsVersion: input.expectedVersion },
    data: { status: input.nextStatus },
  });
  if (result.count === 0) {
    throw new ToolError(
      "STALE_CASE_VERSION",
      `Case ${input.caseId} is not in status "${input.expectedStatus}" at version ${input.expectedVersion}`,
      true,
    );
  }
}
