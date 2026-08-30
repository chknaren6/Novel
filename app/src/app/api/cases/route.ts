import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listCases } from "@/api/casesService";

export async function GET() {
  const cases = await listCases(db);
  return NextResponse.json({ cases });
}
