import type { RoleId, RoleModelOutput } from "@/lib/types";

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  execute: (args: TArgs) => Promise<TResult>;
}

export interface RoleRunInput {
  role: RoleId;
  systemPrompt: string;
  // A pre-redacted, role-scoped snapshot of case facts — never the raw database row.
  contextSummary: Record<string, unknown>;
  readTools: ToolDefinition[];
  // At most one scoped mutation tool. Sales and Risk always pass null (03-AGENT-ARCHITECTURE.md).
  mutationTool: ToolDefinition | null;
  timeoutMs: number;
}

export interface RoleToolCallLog {
  name: string;
  args: unknown;
  result: unknown;
}

export interface RoleRunResult {
  output: RoleModelOutput;
  toolCalls: RoleToolCallLog[];
  modelId: string;
  gatewayRequestId: string | null;
}

// A role invokes at most one bounded reasoning/tool round (03-AGENT-ARCHITECTURE.md
// "Cost and latency controls"). Every implementation of this interface — real or fake —
// must therefore call each tool's `execute` at most once per `runRole` invocation.
export interface ModelGateway {
  runRole(input: RoleRunInput): Promise<RoleRunResult>;
}
