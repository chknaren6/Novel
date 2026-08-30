import { type ReservationStatus, ToolError } from "@/lib/types";

// From 04-DATA-AND-STATE-SPEC.md "Reservation lifecycle". Release and expiry are
// terminal for that row; repair creates new reservation rows instead of reviving one.
const RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  requested: ["held", "failed"],
  held: ["committed", "released", "expired", "failed"],
  committed: [],
  released: [],
  expired: [],
  failed: [],
};

export function assertValidReservationTransition(from: ReservationStatus, to: ReservationStatus): void {
  const allowed = RESERVATION_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ToolError("POLICY_VIOLATION", `Cannot transition reservation from "${from}" to "${to}"`, false);
  }
}
