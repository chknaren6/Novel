import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// This route is the codebase's one anonymous-buyer-facing HTTP surface, and its catch
// block is the single most safety-critical line here: it must NEVER leak
// error.message/String(error)/any internal detail to the client. These tests lock that
// contract in place so a future refactor that reintroduces a leak fails the suite.
//
// No existing precedent in this codebase mocks a Next.js route handler module, so this
// mocks the route's two throwing dependencies directly: @/workflow/buyerResponse
// (runBuyerResponse) and, for the second test, the missing-env-var throw inside
// createModelGateway(). @/lib/db is mocked to a stub object since the real `db` module
// constructs a live PrismaClient at import time and is never actually queried here —
// runBuyerResponse itself is mocked away.

const SECRET_MESSAGE = "internal secret: should-not-leak";

vi.mock("@/lib/db", () => ({ db: {} }));

function makeRequest(): Request {
  return new Request("http://localhost/api/buyer/tok/respond", {
    method: "POST",
    body: JSON.stringify({ response: "accept" }),
  });
}

describe("POST /api/buyer/[token]/respond error handling", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.BUYER_LINK_SIGNING_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.doUnmock("@/workflow/buyerResponse");
    vi.restoreAllMocks();
  });

  it("never leaks the internal error message when runBuyerResponse throws", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.doMock("@/workflow/buyerResponse", () => ({
      runBuyerResponse: vi.fn().mockRejectedValue(new Error(SECRET_MESSAGE)),
    }));

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), { params: { token: "tok" } });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(SECRET_MESSAGE);
    expect(text).not.toContain("internal secret");
  });

  it("returns a generic 500 without leaking details when createModelGateway throws synchronously (missing OPENAI_API_KEY)", async () => {
    delete process.env.OPENAI_API_KEY;
    vi.doMock("@/workflow/buyerResponse", () => ({
      runBuyerResponse: vi.fn(),
    }));

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), { params: { token: "tok" } });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("OPENAI_API_KEY");
  });
});
