import { withServiceRoleTransaction } from "../db.js";
import { money } from "../catalog/pricing.js";

// SF-04 (S08): EP-X-005 (`POST /api/v1/delivery/quote`) is DL-01's endpoint
// (06-integration-contracts.md) — DL-01 doesn't exist until S10. This is the
// contract's literal shape implemented as an in-process seam, matching the
// roadmap's own stub-seam pattern for SF-03's coupon/LE-02 dependency.
// Radius check uses a straight-line (haversine) distance from an approximate
// plant location — no real geocoding exists yet (nominatim/osrm are still
// S00's alpine placeholders) — SPEC-GAP, superseded once DL-01 owns real
// zone/route-based quoting.
const JEDDAH_PLANT = { lat: 21.5433, lng: 39.1728 }; // Old Makkah Road, Km 8, Jeddah — [BUSINESS-CONFIRM] approximate

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface DeliverySlot {
  code: "same_day" | "next_am" | "next_pm";
  label: string;
  cutoffPassed: boolean;
}

export interface DeliveryQuote {
  inRadius: boolean;
  deliveryFee: string;
  freeDelivery: boolean;
  slots: DeliverySlot[];
}

async function getSettingNumber(key: string): Promise<number> {
  return withServiceRoleTransaction(async (client) => {
    const res = await client.query<{ value: string }>("select core.get_setting($1) as value", [key]);
    return Number(res.rows[0]?.value ?? 0);
  });
}

// FR-SF04-004: same-day cutoff 14:00 Asia/Riyadh (UTC+3, no DST).
function buildSlots(now: Date): DeliverySlot[] {
  const riyadhHour = (now.getUTCHours() + 3) % 24;
  const sameDayCutoffPassed = riyadhHour >= 14;
  const slots: DeliverySlot[] = [];
  if (!sameDayCutoffPassed) {
    slots.push({ code: "same_day", label: "same_day", cutoffPassed: false });
  }
  slots.push({ code: "next_am", label: "next_am", cutoffPassed: false });
  slots.push({ code: "next_pm", label: "next_pm", cutoffPassed: false });
  return slots;
}

export async function quoteDelivery(
  address: { lat: number | null; lng: number | null },
  subtotalInclVat: number
): Promise<DeliveryQuote> {
  const [radiusKm, freeThreshold, flatFee] = await Promise.all([
    getSettingNumber("delivery_radius_km"),
    getSettingNumber("free_delivery_threshold"),
    getSettingNumber("delivery_fee_flat")
  ]);

  let inRadius = true;
  if (address.lat !== null && address.lng !== null) {
    const distanceKm = haversineKm(JEDDAH_PLANT.lat, JEDDAH_PLANT.lng, address.lat, address.lng);
    inRadius = distanceKm <= radiusKm;
  }

  const freeDelivery = subtotalInclVat >= freeThreshold;
  const deliveryFee = !inRadius ? 0 : freeDelivery ? 0 : flatFee;

  return { inRadius, deliveryFee: money(deliveryFee), freeDelivery, slots: buildSlots(new Date()) };
}
