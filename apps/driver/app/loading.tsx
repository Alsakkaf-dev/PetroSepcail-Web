import { RouteLoading } from "@petrospecial/app-shell/src/routeStates";

// Shown while a route segment resolves. Skeletons in the shape of a screen,
// never a bare spinner — a per-screen loading.tsx replaces this with one that
// matches its own layout as each screen is rebuilt.
export default function Loading() {
  return <RouteLoading />;
}
