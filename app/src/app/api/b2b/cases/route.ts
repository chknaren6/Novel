import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// The operator's Commitment Desk inbox: every B2B case still sitting at "intake" (i.e.
// not yet submitted for the six-agent evaluation). Note that DealCase.customerId is a
// bare column, not a Prisma relation (prisma/schema.prisma has no `customer` relation
// field on either DealCase or Customer), so it can't be pulled in via `include` the way
// `company` and `termsVersions` can — Customer rows are fetched separately below and
// joined in memory by id.
export async function GET() {
  const cases = await db.dealCase.findMany({
    where: { channel: "b2b", status: "intake" },
    include: { company: true, termsVersions: true },
    // Oldest-first: an inbox is a queue, and the case that has been waiting longest
    // for an operator to run it through evaluation belongs at the top.
    orderBy: { createdAt: "asc" },
  });

  const customers = await db.customer.findMany({
    where: { id: { in: cases.map((dealCase) => dealCase.customerId) } },
  });
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  const summaries = cases.flatMap((dealCase) => {
    const customer = customerById.get(dealCase.customerId);
    const activeTerms = dealCase.termsVersions.find(
      (terms) => terms.version === dealCase.activeTermsVersion
    );
    // Both should always exist for a properly-seeded case; skip defensively rather than
    // throw, so one malformed row can't take down the whole inbox listing.
    if (!customer || !activeTerms) return [];

    return [
      {
        caseId: dealCase.id,
        customerName: customer.name,
        companyName: dealCase.company.name,
        sku: activeTerms.sku,
        quantity: activeTerms.quantity,
        totalValueMinor: activeTerms.totalValueMinor,
        paymentTerms: activeTerms.paymentTerms,
        deliveryDeadline: activeTerms.deliveryDeadline,
      },
    ];
  });

  return NextResponse.json({ cases: summaries });
}
