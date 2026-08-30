// src/gateway/openaiGateway.test.ts
import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { OpenAIModelGateway } from "./openaiGateway";
import { ToolError } from "@/lib/types";
import type { RoleRunInput } from "./modelGateway";

const VALID_OUTPUT = {
  decision: "approve",
  constraints: [],
  reservationRequests: [],
  counterterms: [],
  evidenceRefs: ["EVID-1"],
  explanation: "Stock covers the request.",
};

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function baseInput(overrides: Partial<RoleRunInput> = {}): RoleRunInput {
  return {
    role: "inventory",
    systemPrompt: "test prompt",
    contextSummary: { sku: "MAT-10001" },
    readTools: [],
    mutationTool: null,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("OpenAIModelGateway", () => {
  it("skips the tool round when no tools are offered and returns the parsed decision", async () => {
    const client = fakeClient([{ id: "resp-1", choices: [{ message: { content: JSON.stringify(VALID_OUTPUT) } }] }]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");
    const result = await gateway.runRole(baseInput());
    expect(result.output.decision).toBe("approve");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.gatewayRequestId).toBe("resp-1");
  });

  it("executes a tool call from round one before requesting the final structured decision", async () => {
    const execute = vi.fn().mockResolvedValue({ reservationId: "RES-1" });
    const mutationTool = { name: "hold_inventory", description: "hold stock", parametersSchema: {}, execute };
    const client = fakeClient([
      { id: "resp-1", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "hold_inventory", arguments: JSON.stringify({ quantity: 199 }) } }] } }] },
      { id: "resp-2", choices: [{ message: { content: JSON.stringify(VALID_OUTPUT) } }] },
    ]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");
    const result = await gateway.runRole(baseInput({ mutationTool }));
    expect(execute).toHaveBeenCalledWith({ quantity: 199 });
    expect(result.toolCalls).toEqual([{ name: "hold_inventory", args: { quantity: 199 }, result: { reservationId: "RES-1" } }]);
    expect(result.output.decision).toBe("approve");
  });

  it("rejects a final response that does not validate against RoleModelOutputSchema with a normalized ToolError", async () => {
    const client = fakeClient([{ id: "resp-1", choices: [{ message: { content: JSON.stringify({ decision: "maybe" }) } }] }]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");

    let thrown: unknown;
    try {
      await gateway.runRole(baseInput());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("INVALID_INPUT");
  });

  it("throws FORBIDDEN_TOOL when the model calls a tool that was not offered", async () => {
    const client = fakeClient([
      { id: "resp-1", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "hold_supplier_option", arguments: "{}" } }] } }] },
    ]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");

    let thrown: unknown;
    try {
      await gateway.runRole(baseInput({ readTools: [{ name: "get_stock", description: "read stock", parametersSchema: {}, execute: vi.fn() }] }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("FORBIDDEN_TOOL");
  });

  it("throws INVALID_INPUT when a tool call's arguments are not valid JSON", async () => {
    const execute = vi.fn().mockResolvedValue({ reservationId: "RES-1" });
    const mutationTool = { name: "hold_inventory", description: "hold stock", parametersSchema: {}, execute };
    const client = fakeClient([
      { id: "resp-1", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "hold_inventory", arguments: "not valid json" } }] } }] },
    ]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");

    let thrown: unknown;
    try {
      await gateway.runRole(baseInput({ mutationTool }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("INVALID_INPUT");
    expect(execute).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN_TOOL when the model returns a tool call of an unsupported type", async () => {
    const client = fakeClient([
      { id: "resp-1", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "custom", function: { name: "hold_inventory", arguments: "{}" } }] } }] },
    ]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");

    let thrown: unknown;
    try {
      await gateway.runRole(baseInput({ readTools: [{ name: "get_stock", description: "read stock", parametersSchema: {}, execute: vi.fn() }] }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("FORBIDDEN_TOOL");
  });

  it("throws PROVIDER_UNAVAILABLE when the tool-round OpenAI call rejects", async () => {
    const client = fakeClient([]);
    (client.chat.completions.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("rate limited"));
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");

    let thrown: unknown;
    try {
      await gateway.runRole(baseInput({ readTools: [{ name: "get_stock", description: "read stock", parametersSchema: {}, execute: vi.fn() }] }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((thrown as ToolError).retryable).toBe(true);
  });

  it("throws PROVIDER_UNAVAILABLE when the final structured-output OpenAI call rejects", async () => {
    const execute = vi.fn().mockResolvedValue({ reservationId: "RES-1" });
    const mutationTool = { name: "hold_inventory", description: "hold stock", parametersSchema: {}, execute };
    const client = fakeClient([
      { id: "resp-1", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "hold_inventory", arguments: JSON.stringify({ quantity: 199 }) } }] } }] },
    ]);
    (client.chat.completions.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("timeout"));
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");

    let thrown: unknown;
    try {
      await gateway.runRole(baseInput({ mutationTool }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((thrown as ToolError).retryable).toBe(true);
    expect(execute).toHaveBeenCalled();
  });

  it("throws a policy-violation ToolError when the model requests more than one tool call in a single round", async () => {
    const execute = vi.fn().mockResolvedValue({ reservationId: "RES-1" });
    const mutationTool = { name: "hold_inventory", description: "hold stock", parametersSchema: {}, execute };
    const client = fakeClient([
      {
        id: "resp-1",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "call-1", type: "function", function: { name: "hold_inventory", arguments: JSON.stringify({ quantity: 199 }) } },
                { id: "call-2", type: "function", function: { name: "hold_inventory", arguments: JSON.stringify({ quantity: 50 }) } },
              ],
            },
          },
        ],
      },
    ]);
    const gateway = new OpenAIModelGateway(client, "gpt-4o-mini");

    let thrown: unknown;
    try {
      await gateway.runRole(baseInput({ mutationTool }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ToolError);
    expect((thrown as ToolError).code).toBe("POLICY_VIOLATION");
    expect(execute).not.toHaveBeenCalled();
  });
});
