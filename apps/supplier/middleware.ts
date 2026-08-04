import type { NextRequest } from "next/server";
import { localeMiddleware } from "@petrospecial/app-shell/src/middleware";

// PC-07 locale: keeps a ?lang= deep link and the ps-lang cookie in agreement,
// so <html lang dir> — resolved in the root layout, which cannot see
// searchParams — always matches the content the link asked for.
//
// Declared as a direct export with a literal matcher because Next statically
// analyses this file and does not follow a re-export from another package:
// re-exporting the function under the name "middleware" compiles cleanly and
// silently registers nothing at all.
export function middleware(request: NextRequest) {
  return localeMiddleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json).*)"]
};
