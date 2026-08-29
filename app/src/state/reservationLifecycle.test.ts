// src/state/reservationLifecycle.test.ts
import { describe, it, expect } from "vitest";
import { assertValidReservationTransition } from "./reservationLifecycle";
import { ToolError } from "@/lib/types";

describe("assertValidReservationTransition", () => {
  it("allows requested -> held -> committed", () => {
    expect(() => assertValidReservationTransition("requested", "held")).not.toThrow();
    expect(() => assertValidReservationTransition("held", "committed")).not.toThrow();
  });

  it("allows held -> released and held -> expired", () => {
    expect(() => assertValidReservationTransition("held", "released")).not.toThrow();
    expect(() => assertValidReservationTransition("held", "expired")).not.toThrow();
  });

  it("rejects resurrecting a released or expired reservation", () => {
    expect(() => assertValidReservationTransition("released", "held")).toThrow(ToolError);
    expect(() => assertValidReservationTransition("expired", "held")).toThrow(ToolError);
  });

  it("rejects committing directly from requested", () => {
    expect(() => assertValidReservationTransition("requested", "committed")).toThrow(ToolError);
  });
});
