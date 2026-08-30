import type { ReservationDomain } from "@/lib/types";

// B2C's required-domain set is deliberately different from B2B's REQUIRED_BASE_DOMAINS
// (src/workflow/dealSubmitted.ts): B2C never extends credit (commitos-b2c-product-spec.md
// §9, "does not extend credit to buyers") and, because it never places a supplier order
// until the buyer's advance is received (§4, "This eliminates inventory risk"), it never
// carries its own inventory exposure either — so "credit" and "inventory" never apply
// here. Only "supplier" (the confirmed purchase order) is required; "logistics" would be
// added by a future revision only if CommitOS ever books third-party freight itself.
export const B2C_REQUIRED_DOMAINS: ReservationDomain[] = ["supplier"];
