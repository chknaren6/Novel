import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// The buyer-facing accept page is intentionally public — a buyer authenticates via the
// signed token in the URL (runB2CBuyerResponse / hashBuyerToken), not a Supabase
// account. Every other /market route is the internal operator dashboard and requires a
// logged-in operator (single-operator MVP: whoever is logged in sees everything).
const PUBLIC_MARKET_PATH = /^\/market\/[^/]+\/accept/;

export async function middleware(request: NextRequest) {
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

  if (isProtectedMarketRoute && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/market/:path*"],
};
