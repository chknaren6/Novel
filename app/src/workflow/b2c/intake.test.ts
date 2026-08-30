import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { parseB2CRequirement } from "./intake";
import { ToolError } from "@/lib/types";

function fakeClient(responses: unknown[]) {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

describe("parseB2CRequirement", () => {
  it("parses a complete raw requirement into structured fields", async () => {
    const VALID = {
      itemDescription: "4mm copper wire", quantity: 500, unit: "metres",
      deliveryDeadline: "2026-09-15", location: "Bangalore", missingCriticalField: null,
    };
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(VALID) } }] }]);
    const result = await parseB2CRequirement(client, "gpt-5-nano", "Need 500 metres of 4mm copper wire, delivery by 15 September, Bangalore", 30_000);
    expect(result).toEqual(VALID);
  });

  it("carries a flagged missing critical field through instead of guessing silently", async () => {
    const VALID = {
      itemDescription: "HDPE granules", quantity: 200, unit: "kg",
      deliveryDeadline: "", location: "", missingCriticalField: "delivery deadline and location not stated",
    };
    const client = fakeClient([{ choices: [{ message: { content: JSON.stringify(VALID) } }] }]);
    const result = await parseB2CRequirement(client, "gpt-5-nano", "Looking for 200kg of HDPE granules, natural grade, urgent", 30_000);
    expect(result.missingCriticalField).toBe("delivery deadline and location not stated");
  });

  it("wraps a network failure as ToolError PROVIDER_UNAVAILABLE", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network down"));
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    await expect(parseB2CRequirement(client, "gpt-5-nano", "some text", 30_000)).rejects.toThrow(ToolError);
  });

  it("wraps a non-JSON response as ToolError INVALID_INPUT", async () => {
    const client = fakeClient([{ choices: [{ message: { content: "not json" } }] }]);
    await expect(parseB2CRequirement(client, "gpt-5-nano", "some text", 30_000)).rejects.toThrow(ToolError);
  });
});
