// src/gateway/fakeGateway.test.ts
import { describe, it, expect, vi } from "vitest";
import { FakeModelGateway } from "./fakeGateway";
import { ToolError } from "@/lib/types";
import type { RoleRunInput } from "./modelGateway";

function baseInput(overrides: Partial<RoleRunInput> = {}): RoleRunInput {
  return {
    role: "inventory",
    systemPrompt: "test prompt",
    contextSummary: {},
    readTools: [],
    mutationTool: { name: "hold_inventory", description: "hold stock", parametersSchema: {}, execute: vi.fn().mockResolvedValue({ reservationId: "RES-1" }) },
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("FakeModelGateway", () => {
  it("executes the scripted tool call exactly once and returns its result", async () => {
    const gateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_inventory", args: { quantity: 199 } },
      output: { decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: ["EVID-1"], explanation: "Held." },
    }));
    const result = await gateway.runRole(baseInput());
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toEqual({ reservationId: "RES-1" });
    expect(result.output.decision).toBe("approve");
  });

  it("throws FORBIDDEN_TOOL when the script names a tool that was not offered", async () => {
    const gateway = new FakeModelGateway(() => ({
      toolCall: { name: "hold_supplier_option", args: {} },
      output: { decision: "approve", constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: [], explanation: "" },
    }));
    await expect(gateway.runRole(baseInput())).rejects.toThrow(ToolError);
  });

  it("validates the scripted output against RoleModelOutputSchema", async () => {
    const gateway = new FakeModelGateway(() => ({
      toolCall: null,
      output: { decision: "maybe" as never, constraints: [], reservationRequests: [], counterterms: [], evidenceRefs: [], explanation: "" },
    }));
    await expect(gateway.runRole(baseInput({ mutationTool: null }))).rejects.toThrow();
  });
});
