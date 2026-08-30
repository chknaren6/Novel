import { afterEach, describe, expect, it } from "vitest";
import { getOpenAIClient } from "./openaiClient";

describe("getOpenAIClient", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("throws when OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_MODEL_ID = "gpt-5-nano";
    expect(() => getOpenAIClient()).toThrow(/OPENAI_API_KEY/);
  });

  it("throws when OPENAI_MODEL_ID is missing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    delete process.env.OPENAI_MODEL_ID;
    expect(() => getOpenAIClient()).toThrow(/OPENAI_MODEL_ID/);
  });

  it("returns a client, modelId, and a 30s default timeout when only the required vars are set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL_ID = "gpt-5-nano";
    delete process.env.OPENAI_REQUEST_TIMEOUT_MS;
    const result = getOpenAIClient();
    expect(result.modelId).toBe("gpt-5-nano");
    expect(result.timeoutMs).toBe(30_000);
    expect(result.client).toBeTruthy();
  });

  it("uses OPENAI_REQUEST_TIMEOUT_MS when set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL_ID = "gpt-5-nano";
    process.env.OPENAI_REQUEST_TIMEOUT_MS = "5000";
    expect(getOpenAIClient().timeoutMs).toBe(5000);
  });

  it("throws when OPENAI_REQUEST_TIMEOUT_MS is not a valid number", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL_ID = "gpt-5-nano";
    process.env.OPENAI_REQUEST_TIMEOUT_MS = "not-a-number";
    expect(() => getOpenAIClient()).toThrow(/OPENAI_REQUEST_TIMEOUT_MS/);
  });
});
