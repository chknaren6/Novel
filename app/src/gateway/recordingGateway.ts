import type { RoleId } from "@/lib/types";
import type { ModelGateway, RoleRunInput, RoleRunResult } from "./modelGateway";

export interface RecordedRoleCall {
  role: RoleId;
  toolCallName: string | null;
  toolArgs: unknown;
  decision: string; // output.decision
  evidenceRefsCount: number; // output.evidenceRefs.length
}

// A pure observer decorator around a ModelGateway. It never alters the inner
// gateway's behavior or its returned result — it only appends a record of what
// happened to `calls`, since roleRuntime.ts persists only `output` (not `toolCalls`)
// to the DomainDecision table, so tool-call data must be captured live during a run
// rather than read back from the database afterward (see the Task 31 spec's
// "Tool-call data is never persisted to the DB" note).
export class RecordingModelGateway implements ModelGateway {
  public readonly calls: RecordedRoleCall[] = [];

  constructor(private readonly inner: ModelGateway) {}

  async runRole(input: RoleRunInput): Promise<RoleRunResult> {
    const result = await this.inner.runRole(input);
    const toolCall = result.toolCalls[0] ?? null;
    this.calls.push({
      role: input.role,
      toolCallName: toolCall?.name ?? null,
      toolArgs: toolCall?.args ?? null,
      decision: result.output.decision,
      evidenceRefsCount: result.output.evidenceRefs.length,
    });
    return result;
  }

  reset(): void {
    this.calls.length = 0;
  }
}
