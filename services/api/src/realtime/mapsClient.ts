// DL-02 (S11) / ADR-19: Google Maps Platform Directions API, replacing the
// old self-hosted OSRM/Nominatim stack the pre-D-15 docs assumed. Plain
// `fetch` against the REST endpoint rather than the `@googlemaps/*` SDKs —
// one HTTP call, no client library needed, one fewer dependency to vet.
// Degrades gracefully (returns null) when GOOGLE_MAPS_API_KEY is unset, same
// posture as pusherClient.ts/minioClient.ts for every other optional vendor
// this build depends on but can't provision for itself (D-12 tension: ADR-19
// is a real paid-vendor decision, not self-hostable, RSK-020's billing cap
// is a manual dashboard step only the account owner can take).
export interface RouteLeg {
  fromTaskId: string | null;
  toTaskId: string;
  distanceM: number;
  durationS: number;
  geometry: string; // encoded polyline, as Google's API returns it
}

export interface RouteWaypoint {
  taskId: string;
  lat: number;
  lng: number;
}

function apiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

// D-13/ADR-14 parity gate: no hardcoded hosts/URLs in application source,
// even for a stable third-party vendor endpoint — it lives in .env like
// every other environment-specific value (scripts/parity-grep.mjs).
function directionsUrl(): string | null {
  return process.env.GOOGLE_MAPS_DIRECTIONS_URL || null;
}

export function isMapsConfigured(): boolean {
  return apiKey() !== null && directionsUrl() !== null;
}

interface DirectionsResponse {
  status: string;
  routes: Array<{
    waypoint_order: number[];
    legs: Array<{ distance: { value: number }; duration: { value: number } }>;
    overview_polyline: { points: string };
  }>;
}

// origin = the hub (single fulfillment origin of truth, D-14a) unless a
// future session threads a live driver position in. Waypoint-optimized so
// the returned order is the actual route sequence, not creation order.
export async function getOptimizedRoute(
  origin: { lat: number; lng: number },
  waypoints: RouteWaypoint[]
): Promise<{ legs: RouteLeg[]; totalDurationS: number; order: string[] } | null> {
  const key = apiKey();
  const baseUrl = directionsUrl();
  if (key === null || baseUrl === null || waypoints.length === 0) return null;

  const originParam = `${origin.lat},${origin.lng}`;
  const destination = waypoints[waypoints.length - 1]!;
  const destinationParam = `${destination.lat},${destination.lng}`;
  const intermediate = waypoints.slice(0, -1);
  const waypointsParam = intermediate.length
    ? `optimize:true|${intermediate.map((w) => `${w.lat},${w.lng}`).join("|")}`
    : "optimize:true";

  const url = new URL(baseUrl);
  url.searchParams.set("origin", originParam);
  url.searchParams.set("destination", destinationParam);
  url.searchParams.set("waypoints", waypointsParam);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const body = (await res.json()) as DirectionsResponse;
  if (body.status !== "OK" || body.routes.length === 0) return null;

  const route = body.routes[0]!;
  const orderedIntermediate = route.waypoint_order.map((i) => intermediate[i]!);
  const orderedWaypoints = [...orderedIntermediate, destination];

  const legs: RouteLeg[] = route.legs.map((leg, i) => ({
    fromTaskId: i === 0 ? null : orderedWaypoints[i - 1]!.taskId,
    toTaskId: orderedWaypoints[i]!.taskId,
    distanceM: leg.distance.value,
    durationS: leg.duration.value,
    geometry: route.overview_polyline.points
  }));
  const totalDurationS = legs.reduce((sum, l) => sum + l.durationS, 0);

  return { legs, totalDurationS, order: orderedWaypoints.map((w) => w.taskId) };
}
