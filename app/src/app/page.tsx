import { redirect } from "next/navigation";

// The root route has no content of its own yet — the operator dashboard is /market.
export default function HomePage() {
  redirect("/market");
}
