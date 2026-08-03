"use client";

import { useState } from "react";
import { authedFetch } from "../../lib/authClient.js";
import { LoginGate } from "../../lib/LoginGate.js";

// AC-04 (S17, wired to real loyalty.admin_create_coupon/create_eligibility_rule
// in S20 — see routes/adminPromotions.ts). Campaigns (EP-AC-031) stay a thin
// audited "queued" stub server-side (campaign+coupon attachment authoring is
// a documented, separately-tracked gap) — this screen submits it honestly as
// "queued", not as applied.
function PromotionsInner() {
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState<"percent" | "fixed">("percent");
  const [couponValue, setCouponValue] = useState("");
  const [couponMinOrder, setCouponMinOrder] = useState("");
  const [couponStatus, setCouponStatus] = useState<string | null>(null);

  const [campaignSegment, setCampaignSegment] = useState("");
  const [campaignStart, setCampaignStart] = useState("");
  const [campaignEnd, setCampaignEnd] = useState("");
  const [campaignStatus, setCampaignStatus] = useState<string | null>(null);

  const [ruleJson, setRuleJson] = useState('{"all":[]}');
  const [ruleStatus, setRuleStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitCoupon(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await authedFetch<{ status: string; note: string }>("/api/v1/admin/promotions/coupons", {
        method: "POST",
        body: JSON.stringify({
          code: couponCode,
          type: couponType,
          value: Number(couponValue),
          constraints: couponMinOrder ? { minOrder: Number(couponMinOrder) } : undefined
        })
      });
      setCouponStatus(res.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function submitCampaign(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await authedFetch<{ status: string; note: string }>("/api/v1/admin/promotions/campaigns", {
        method: "POST",
        body: JSON.stringify({
          start: new Date(campaignStart).toISOString(),
          end: new Date(campaignEnd).toISOString(),
          segment: campaignSegment,
          offers: []
        })
      });
      setCampaignStatus(res.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function submitRule(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const rule = JSON.parse(ruleJson);
      const res = await authedFetch<{ status: string; note: string }>("/api/v1/admin/promotions/rules", {
        method: "POST",
        body: JSON.stringify({ rule })
      });
      setRuleStatus(res.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid rule JSON");
    }
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Promotions &amp; Loyalty (AC-04)</h1>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16 }}>Create coupon (EP-AC-030)</h2>
        <form onSubmit={submitCoupon} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
          <input placeholder="Code" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} />
          <select value={couponType} onChange={(e) => setCouponType(e.target.value as "percent" | "fixed")}>
            <option value="percent">Percent</option>
            <option value="fixed">Fixed (SAR)</option>
          </select>
          <input placeholder="Value" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} />
          <input placeholder="Min order (SAR, optional)" value={couponMinOrder} onChange={(e) => setCouponMinOrder(e.target.value)} />
          <button type="submit">Save coupon</button>
          {couponStatus && <p style={{ color: "#1a7f4e" }}>{couponStatus}</p>}
        </form>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16 }}>Submit campaign (EP-AC-031)</h2>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          Campaign+coupon attachment authoring is not yet wired to a live scheduler — submissions are audited and queued, not applied.
        </p>
        <form onSubmit={submitCampaign} style={{ display: "grid", gap: 8, maxWidth: 360 }}>
          <input placeholder="Segment" value={campaignSegment} onChange={(e) => setCampaignSegment(e.target.value)} />
          <label>
            Start
            <input type="datetime-local" value={campaignStart} onChange={(e) => setCampaignStart(e.target.value)} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            End
            <input type="datetime-local" value={campaignEnd} onChange={(e) => setCampaignEnd(e.target.value)} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Submit campaign</button>
          {campaignStatus && <p style={{ color: "#1a7f4e" }}>{campaignStatus}</p>}
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Create eligibility rule (EP-AC-032)</h2>
        <form onSubmit={submitRule} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
          <textarea rows={4} value={ruleJson} onChange={(e) => setRuleJson(e.target.value)} className="ps-ltr" />
          <button type="submit">Save rule</button>
          {ruleStatus && <p style={{ color: "#1a7f4e" }}>{ruleStatus}</p>}
        </form>
      </section>
    </main>
  );
}

export default function PromotionsPage() {
  return (
    <LoginGate>
      <PromotionsInner />
    </LoginGate>
  );
}
