// src/state/certificateLifecycle.test.ts
import { describe, it, expect } from "vitest";
import { assertValidCertificateTransition } from "./certificateLifecycle";
import { ToolError } from "@/lib/types";

describe("assertValidCertificateTransition", () => {
  it("allows draft -> valid -> consumed -> broken -> compensated", () => {
    expect(() => assertValidCertificateTransition("draft", "valid")).not.toThrow();
    expect(() => assertValidCertificateTransition("valid", "consumed")).not.toThrow();
    expect(() => assertValidCertificateTransition("consumed", "broken")).not.toThrow();
    expect(() => assertValidCertificateTransition("broken", "compensated")).not.toThrow();
  });

  it("allows valid -> superseded", () => {
    expect(() => assertValidCertificateTransition("valid", "superseded")).not.toThrow();
  });

  it("rejects consuming a certificate that was never valid", () => {
    expect(() => assertValidCertificateTransition("draft", "consumed")).toThrow(ToolError);
  });

  it("rejects mutating a terminal certificate", () => {
    expect(() => assertValidCertificateTransition("compensated", "valid")).toThrow(ToolError);
    expect(() => assertValidCertificateTransition("superseded", "valid")).toThrow(ToolError);
  });
});
