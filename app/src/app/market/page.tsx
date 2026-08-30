"use client";

import { useState } from "react";
import { Composer } from "./Composer";
import { LiveProgress } from "./LiveProgress";

export default function MarketPage() {
  const [active, setActive] = useState<{ caseId: string; buyerLink: string } | null>(null);

  if (active) {
    return <LiveProgress caseId={active.caseId} buyerLink={active.buyerLink} onNewRequest={() => setActive(null)} />;
  }
  return <Composer onCaseCreated={setActive} />;
}
