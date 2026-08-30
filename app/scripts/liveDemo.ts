import { config } from "dotenv";

// Same convention as prisma/seed.ts: this repo keeps local env vars in .env.local.
config({ path: ".env.local" });
config();

import OpenAI from "openai";
import { db } from "@/lib/db";
import { seedFixture } from "@/fixtures/seedFixture";
import type { FixtureDefinition } from "@/fixtures/definitions";
import { OpenAIModelGateway } from "@/gateway/openaiGateway";
import { runDealSubmitted } from "@/workflow/dealSubmitted";
import { newId } from "@/lib/ids";
import { fromJsonColumn } from "@/lib/json-column";

/**
 * Live demo case built from real rows in `Data Crompton/*.csv` (repo root), not an
 * invented fixture. Source order: SO-13183661 (VBAK) — Shree Renuka Sugars Belgaum
 * ordering 138x MAT-CG-10008 ("Crompton IE2 Motor 15 HP 3-Phase"). Picked because it's
 * genuinely contested: inventory covers only 100 of 138 units at the fulfilling plant
 * (forces a Procurement/Logistics decision, not an auto-approve), and the customer is
 * already at 92% of their credit limit (forces real Finance/Risk tension).
 *
 * Field-by-field provenance:
 * - customer.creditLimitMinor / currentExposureMinor: KNKK_customer_credit.csv,
 *   CUST-1062 (KLIMK=Rs 12,00,000, SKFOR=Rs 10,99,002.64), converted to paise.
 * - customer.overdueReceivablesMinor: KNKK's CRBLB is blank for this customer -> 0.
 * - customer.allowedPaymentTerms / policyVersion: not present in the ERP extract (this
 *   is a Novel-side policy decision, not a raw data field) — reused verbatim from the
 *   existing fixtures' default policy (src/fixtures/definitions.ts).
 * - initialTerms.paymentTerms: KNKK.ZTERM = "NET30" for this customer. The engine's
 *   PaymentTerms enum only has NET_60 / ADVANCE_30 / OTHER_BOUNDED (deliberate P0 scope
 *   cut — see dealSubmitted.ts). NET30 and NET_60 share the economically relevant
 *   property this engine actually branches on (full exposure, no deposit collected up
 *   front), so it's mapped to NET_60 rather than OTHER_BOUNDED (which the engine treats
 *   as if a deposit had already been taken).
 * - initialTerms.sku / quantity / totalValueMinor: VBAK row (MATNR, KWMENG, NETWR).
 * - initialTerms.discountBps: derived by comparing NETWR (Rs 59,36,035.77) against
 *   MARA.NETPR list price (Rs 44,000 x 138 = Rs 60,72,000) -> ~2.24% -> 224 bps.
 * - initialTerms.deliveryDeadlineOffsetDays: VBAK.WADAT (2026-09-15) minus today.
 * - inventory: MARD row for MAT-CG-10008 at PL-CHE / WH-CHE-01 (LABST=100).
 * - supplierOptions: LFA1's best option for the 38-unit shortfall — VEND-3004
 *   (Crompton Authorized WD Bengaluru): closest lead time among Karnataka/South
 *   suppliers with capacity (5-day lead, 112 available, 0.94 reliability).
 * - deliveryPlans: TVRO route RT-CHE-SOUTH (WH-CHE-01 -> ZONE-SOUTH, matching the
 *   customer's KNKK.BZIRK), 1-day transit. TVRO has no freight-cost column, so
 *   costMinor is a policy estimate (not sourced from data), consistent with how the
 *   existing fixtures also estimate this field.
 * - unitCostMinor: MBEW.STPRS for MAT-CG-10008 (Rs 28,037.70) at the one plant MBEW
 *   carries a cost row for this material (PL-MUM) — also added to
 *   policy/economics.ts's SKU_UNIT_COST_MINOR so the workflow's own economics
 *   calculation (not just this fixture) prices it correctly.
 */
const LIVE_DEMO_FIXTURE: FixtureDefinition = {
  fixtureId: "CASE-LIVE-DEMO-CROMPTON-SO-13183661",
  companyName: "Shree Renuka Sugars Belgaum — Live Demo (SO-13183661)",
  customer: {
    name: "Shree Renuka Sugars Belgaum",
    creditLimitMinor: 120_000_000,
    currentExposureMinor: 109_900_264,
    overdueReceivablesMinor: 0,
    allowedPaymentTerms: ["ADVANCE_30", "OTHER_BOUNDED"],
    policyVersion: "credit-policy-v1",
  },
  inventory: [{ sku: "MAT-CG-10008", warehouseId: "WH-CHE-01", availableQuantity: 100 }],
  supplierOptions: [
    {
      supplierId: "VEND-3004",
      sku: "MAT-CG-10008",
      availableQuantity: 112,
      unitCostMinor: 2_712_401,
      leadDays: 5,
      optionTtlSeconds: 900,
      status: "available",
    },
  ],
  deliveryPlans: [
    {
      planId: "RT-CHE-SOUTH",
      originWarehouseId: "WH-CHE-01",
      destinationId: "ZONE-SOUTH",
      deliveredQuantity: 138,
      deliveryDateOffsetDays: 16,
      costMinor: 480_000,
      splitShipment: true,
      capacityRemaining: 138,
    },
  ],
  initialTerms: {
    sku: "MAT-CG-10008",
    quantity: 138,
    totalValueMinor: 593_603_577,
    discountBps: 224,
    paymentTerms: "NET_60",
    deliveryDeadlineOffsetDays: 16,
  },
  unitCostMinor: 2_803_770,
  // Not asserted anywhere — the whole point of this run is to find out live.
  expectedTerminalState: "prepared",
};

function rule(char = "─", width = 78) {
  console.log(char.repeat(width));
}

function money(minor: number): string {
  return `Rs ${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

async function main() {
  console.log("\nCommitOS — live demo run\n");
  rule("=");
  console.log(`Case:      SO-13183661 (Shree Renuka Sugars Belgaum)`);
  console.log(`SKU:       MAT-CG-10008 — Crompton IE2 Motor 15 HP 3-Phase`);
  console.log(`Requested: 138 units, ${money(593_603_577)}, NET30 -> mapped to NET_60`);
  console.log(`Model:     ${process.env.OPENAI_MODEL_ID} via ${process.env.MODEL_GATEWAY} gateway`);
  rule("=");

  console.log("\n[1/3] Seeding case from real Crompton ERP extract...");
  const { dealCase } = await seedFixture(db, LIVE_DEMO_FIXTURE);
  console.log(`      case ${dealCase.id} created, status=${dealCase.status}`);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set in .env.local");
  const client = new OpenAI({ apiKey });
  const gateway = new OpenAIModelGateway(client, process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini");
  const traceId = newId("TRACE");

  console.log("\n[2/3] Running the six-role evaluation live (real OpenAI calls)...");
  const t0 = Date.now();
  const result = await runDealSubmitted(db, gateway, {
    caseId: dealCase.id,
    modelId: process.env.OPENAI_MODEL_ID ?? "gpt-4o-mini",
    timeoutMs: 30_000,
    traceId,
    buyerLinkSigningSecret: process.env.BUYER_LINK_SIGNING_SECRET ?? "dev-secret",
  });
  const elapsedMs = Date.now() - t0;
  console.log(`      done in ${(elapsedMs / 1000).toFixed(1)}s`);

  console.log("\n[3/3] Role-by-role decisions (as persisted to DomainDecision):");
  rule();
  const decisions = await db.domainDecision.findMany({
    where: { caseId: dealCase.id },
    orderBy: { id: "asc" },
  });
  for (const d of decisions) {
    const payload = fromJsonColumn<{ explanation: string; constraints: unknown[]; counterterms: unknown[] }>(d.payload);
    const evidence = fromJsonColumn<string[]>(d.evidenceRefs);
    console.log(`\n  ${d.role.toUpperCase()}  ->  ${d.decision}   (model: ${d.modelId})`);
    console.log(`    explanation: ${payload.explanation}`);
    console.log(`    evidence:    ${evidence.join(", ") || "(none)"}`);
    if (payload.constraints?.length) console.log(`    constraints: ${JSON.stringify(payload.constraints)}`);
    if (payload.counterterms?.length) console.log(`    counterterms: ${JSON.stringify(payload.counterterms)}`);
  }

  rule();
  console.log("\nCase event timeline:");
  const events = await db.caseEvent.findMany({ where: { caseId: dealCase.id }, orderBy: { id: "asc" } });
  for (const e of events) {
    console.log(`  ${e.eventType.padEnd(24)} actor=${e.actorType}/${e.actorRef}`);
  }

  rule("=");
  console.log("\nFINAL OUTCOME:", result.status.toUpperCase());
  if (result.status === "prepared") {
    console.log(`  Commit Certificate: ${result.certificateId}`);
    console.log(`  Revenue:            ${money(result.economics.revenueMinor)}`);
    console.log(`  Cost:               ${money(result.economics.costMinor)}`);
    console.log(`  Contribution:       ${money(result.economics.contributionMinor)} (${(result.economics.contributionMarginBps / 100).toFixed(2)}%)`);
    console.log(`  Credit exposure:    ${money(result.economics.creditExposureMinor)}`);
    const cert = await db.commitCertificate.findUnique({ where: { id: result.certificateId } });
    console.log(`  Certificate status: ${cert?.status}`);
  } else if (result.status === "negotiating") {
    console.log(`  Counteroffer:  ${result.counterofferId}`);
    console.log(`  Sales explanation: ${result.salesExplanation}`);
  } else {
    console.log(`  Reason: ${result.reason}`);
  }
  rule("=");
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error("\nDemo run failed:", error);
    await db.$disconnect();
    process.exit(1);
  });
