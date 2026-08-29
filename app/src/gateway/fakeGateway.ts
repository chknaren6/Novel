import { RoleModelOutputSchema, ToolError, type RoleModelOutput } from "@/lib/types";
import type { ModelGateway, RoleRunInput, RoleRunResult } from "./modelGateway";

export interface ScriptedToolCall {
  name: string;
  args: unknown;
}

export interface ScriptedRoleRun {
  toolCall: ScriptedToolCall | null;
  output: RoleModelOutput;
}

export type FakeRoleScript = (input: RoleRunInput) => ScriptedRoleRun;

// A deterministic stand-in for the LLM's tool-use decision. It executes the *real*
// tool-execution code (the same `execute` functions the OpenAI gateway would call), so
// workflow and coordinator tests exercise identical server-side logic without a network
// call. It is not meant to encode business judgment — each test scripts its own roles.
export class FakeModelGateway implements ModelGateway {
  constructor(private readonly script: FakeRoleScript) {}

  async runRole(input: RoleRunInput): Promise<RoleRunResult> {
    const { toolCall, output } = this.script(input);
    const toolCalls: RoleRunResult["toolCalls"] = [];

    if (toolCall) {
      const tool =
        input.readTools.find((t) => t.name === toolCall.name) ??
        (input.mutationTool?.name === toolCall.name ? input.mutationTool : undefined);
      if (!tool) {
        throw new ToolError("FORBIDDEN_TOOL", `Role "${input.role}" attempted to call unregistered tool "${toolCall.name}"`, false);
      }
      const result = await tool.execute(toolCall.args);
      toolCalls.push({ name: toolCall.name, args: toolCall.args, result });
    }

    return {
      output: RoleModelOutputSchema.parse(output),
      toolCalls,
      modelId: "fake-model-v1",
      gatewayRequestId: null,
    };
  }
}
