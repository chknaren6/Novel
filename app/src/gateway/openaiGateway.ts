import type OpenAI from "openai";
import { RoleModelOutputSchema, ToolError, type RoleModelOutput } from "@/lib/types";
import type { ModelGateway, RoleRunInput, RoleRunResult, ToolDefinition } from "./modelGateway";
import { ROLE_MODEL_OUTPUT_JSON_SCHEMA } from "./roleModelOutputJsonSchema";

function toOpenAITool(tool: ToolDefinition) {
  return { type: "function" as const, function: { name: tool.name, description: tool.description, parameters: tool.parametersSchema } };
}

// Concrete ModelGateway backed by real OpenAI calls (locked scope decision: this
// substitutes for the organizer's ApplyBee/Hive gateway, which is undocumented outside
// its hackathon). Runs at most one tool-calling round, then a second call with no
// tools offered and response_format=json_schema for the final typed decision — this is
// the "one bounded reasoning/tool round plus one schema-repair retry" from
// 03-AGENT-ARCHITECTURE.md, with the schema-repair retry handled by the caller
// (roleRuntime.ts, Task 22) rather than inside the gateway itself.
export class OpenAIModelGateway implements ModelGateway {
  constructor(
    private readonly client: OpenAI,
    private readonly modelId: string,
  ) {}

  async runRole(input: RoleRunInput): Promise<RoleRunResult> {
    const tools = [...input.readTools, ...(input.mutationTool ? [input.mutationTool] : [])];
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: JSON.stringify(input.contextSummary) },
    ];

    let toolCalls: RoleRunResult["toolCalls"] = [];
    let gatewayRequestId: string | null = null;

    if (tools.length > 0) {
      const first = await this.createChatCompletion(
        input,
        { model: this.modelId, messages, tools: tools.map(toOpenAITool), tool_choice: "auto" },
        "tool-round",
      );
      gatewayRequestId = first.id;
      const message = first.choices[0]!.message;
      messages.push(message);

      const requestedCalls = message.tool_calls ?? [];
      // Design decision: the Chat Completions API can return multiple entries in
      // message.tool_calls for one response, but 03-AGENT-ARCHITECTURE.md's "Cost and
      // latency controls" fixes the policy at *one* tool call per role invocation, and
      // RoleRunResult.toolCalls is typed as a zero-or-one tuple to enforce that at
      // compile time. Silently taking tool_calls[0] and dropping the rest would let a
      // model response quietly violate that policy (or mask a message-crafting bug that
      // caused the model to fan out into parallel calls) with no signal anywhere in the
      // system. So: more than one requested tool call in a single round is treated as a
      // policy violation and surfaced as a ToolError rather than silently truncated.
      if (requestedCalls.length > 1) {
        throw new ToolError(
          "POLICY_VIOLATION",
          `Role "${input.role}" model response requested ${requestedCalls.length} tool calls in a single round; at most one is permitted`,
          false,
        );
      }

      const call = requestedCalls[0];
      if (call && call.type === "function") {
        // Assumes tool names are unique across readTools and mutationTool for a given
        // role invocation; if that invariant is ever violated, the read tool silently wins
        // (concatenation order in `tools` above puts readTools first).
        const tool = tools.find((t) => t.name === call.function.name);
        // Design decision: mirror FakeModelGateway's FORBIDDEN_TOOL handling for the same
        // conceptual situation (a tool call naming something not offered to the role).
        // Staying silent here would let a hallucinated/unregistered tool name pass through
        // unnoticed instead of surfacing a real policy or prompting problem.
        if (!tool) {
          throw new ToolError(
            "FORBIDDEN_TOOL",
            `Role "${input.role}" attempted to call unregistered tool "${call.function.name}"`,
            false,
          );
        }
        // toOpenAITool doesn't set strict:true on the function definition, so — unlike the
        // final response_format=json_schema call below — OpenAI does not guarantee
        // call.function.arguments is valid JSON. Mirror the final-response parse's
        // try/catch so malformed arguments surface as a ToolError, not a raw SyntaxError.
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch (error) {
          throw new ToolError(
            "INVALID_INPUT",
            `Role "${input.role}" tool call to "${call.function.name}" had invalid JSON arguments (${call.function.arguments}): ${
              error instanceof Error ? error.message : String(error)
            }`,
            false,
          );
        }
        const result = await tool.execute(args);
        toolCalls = [{ name: tool.name, args, result }];
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      } else if (call) {
        // A tool_calls entry with a type other than "function" (e.g. a future
        // custom/built-in tool type). Proceeding as if no tool call had been requested
        // would silently ignore it; unregistered tool names are not silently ignored
        // above, so this shouldn't be either.
        throw new ToolError(
          "FORBIDDEN_TOOL",
          `Role "${input.role}" received an unsupported tool call type "${call.type}"`,
          false,
        );
      }
    }

    const final = await this.createChatCompletion(
      input,
      {
        model: this.modelId,
        messages: [...messages, { role: "user", content: "Return your final decision now as the required JSON object." }],
        response_format: { type: "json_schema", json_schema: { name: "role_model_output", strict: true, schema: ROLE_MODEL_OUTPUT_JSON_SCHEMA } },
      },
      "final-response",
    );
    gatewayRequestId = final.id;

    const raw = final.choices[0]!.message.content ?? "{}";
    // Convention established by fakeGateway.ts: normalize a schema-validation failure
    // into ToolError("INVALID_INPUT", ...) rather than letting a raw ZodError (or, here,
    // a raw JSON.parse SyntaxError) escape this gateway.
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new ToolError(
        "INVALID_INPUT",
        `Role "${input.role}" final response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }
    const parsed = RoleModelOutputSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new ToolError("INVALID_INPUT", `Role "${input.role}" final response failed validation: ${parsed.error.message}`, false);
    }
    const output: RoleModelOutput = parsed.data;

    return { output, toolCalls, modelId: this.modelId, gatewayRequestId };
  }

  // Normalizes any chat.completions.create rejection (network error, rate limit, timeout,
  // malformed OpenAI response) into ToolError("PROVIDER_UNAVAILABLE", ..., retryable: true)
  // instead of letting a raw OpenAI SDK exception escape this gateway. This is the first
  // real external-provider network call in this codebase; 03-AGENT-ARCHITECTURE.md's stated
  // requirement is "Timeout produces `unavailable`, not an assumed approval."
  private async createChatCompletion(
    input: RoleRunInput,
    params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    step: string,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    try {
      return await this.client.chat.completions.create(params, { timeout: input.timeoutMs });
    } catch (error) {
      throw new ToolError(
        "PROVIDER_UNAVAILABLE",
        `Role "${input.role}" OpenAI ${step} call failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
  }
}
