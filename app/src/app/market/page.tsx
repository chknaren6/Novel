"use client";

import { useState } from "react";
import { NavBar } from "@/app/NavBar";
import { Composer } from "./Composer";
import { LiveProgress } from "./LiveProgress";

export default function MarketPage() {
  const [active, setActive] = useState<{ caseId: string; buyerLink: string } | null>(null);

  return (
    <>
      <NavBar />
      {active ? (
        <LiveProgress caseId={active.caseId} buyerLink={active.buyerLink} onNewRequest={() => setActive(null)} />
      ) : (
        <Composer onCaseCreated={setActive} />
      )}
    </>
  );
}
