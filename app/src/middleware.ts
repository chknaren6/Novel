import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// The buyer-facing accept page is intentionally public — a buyer authenticates via the
// signed token in the URL (runB2CBuyerResponse / hashBuyerToken), not a Supabase
// account. Every other /market route is the internal operator dashboard and requires a
// logged-in operator (single-operator MVP: whoever is logged in sees everything).
const PUBLIC_MARKET_PATH = /^\/market\/[^/]+\/accept/;

// Same idea for B2B: the customer-facing counteroffer response page authenticates via
// the signed buyer token in the URL (runB2BCounterofferResponse / hashBuyerToken), not a
// Supabase account, so it must stay public. Every other /desk route is the operator's
// Commitment Desk and requires a logged-in operator, same as /market.
const PUBLIC_DESK_PATH = /^\/desk\/[^/]+\/respond/;

export async function middleware(request: NextRequest) {
  // Supabase isn't configured yet for local MVP validation (no project/keys set up) —
  // skip auth entirely rather than crash every request on a missing env var. Once
  // NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are set (real Supabase project), this middleware
  // starts enforcing the operator login automatically, with no code change needed.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Always call getUser() (not getSession()) here — it revalidates against Supabase's
  // auth server instead of trusting a possibly-stale cookie, per @supabase/ssr's own
  // guidance for middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtectedMarketRoute = pathname.startsWith("/market") && !PUBLIC_MARKET_PATH.test(pathname);
  const isProtectedDeskRoute = pathname.startsWith("/desk") && !PUBLIC_DESK_PATH.test(pathname);

  if ((isProtectedMarketRoute || isProtectedDeskRoute) && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/market/:path*", "/desk/:path*"],
};
