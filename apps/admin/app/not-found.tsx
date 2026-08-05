import { RouteNotFound } from "@petrospecial/app-shell/src/routeStates";

// Replaces Next.js's stock 404, which notFound() used to render: an
// unbranded, English-only, left-to-right page in the middle of an Arabic
// platform.
export default function NotFound() {
  return <RouteNotFound />;
}
