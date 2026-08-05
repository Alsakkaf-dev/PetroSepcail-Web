"use client";

import { useMemo, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  Page,
  RuleBuilder,
  Section,
  SectionHead,
  Select,
  Stack,
  TextField,
  isRuleValid,
  toRuleValue,
  type RuleCondition,
  type RuleCombinator,
  type RuleFieldOption
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t, type Locale } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

function ruleFields(locale: Locale): RuleFieldOption[] {
  return [
    {
      value: "order_total",
      label: t(locale, "admin.ruleFieldOrderTotal"),
      operators: ["gte", "lte"],
      type: "number"
    },
    {
      value: "family",
      label: t(locale, "admin.ruleFieldFamily"),
      operators: ["eq", "neq"],
      type: "enum",
      choices: [
        { value: "special", label: t(locale, "catalog.allFamilies") },
        { value: "petro", label: "Petrotoryon" },
        { value: "raval", label: "Raval" }
      ]
    },
    {
      value: "order_count",
      label: t(locale, "admin.ruleFieldOrderCount"),
      operators: ["gte", "lte"],
      type: "number"
    },
    {
      value: "first_order",
      label: t(locale, "admin.ruleFieldFirstOrder"),
      operators: ["eq"],
      type: "enum",
      choices: [
        { value: "true", label: t(locale, "admin.ruleTrue") },
        { value: "false", label: t(locale, "admin.ruleFalse") }
      ]
    }
  ];
}

let nextConditionId = 0;

// SCR-AC04-001 — AC-04.
//
// Was seventeen inline styles, placeholder-only inputs with no labels, three
// literal green status lines, headings carrying endpoint ids, and — the part
// this screen exists to fix — an eligibility rule authored by typing raw JSON
// into a `<textarea>` that defaulted to `{"all":[]}`. One misplaced brace and
// the whole thing failed with "invalid rule JSON".
//
// It is a RuleBuilder now: a fixed field list, operators that suit the field
// they belong to, live per-condition validation, and a save control that stays
// disabled until every condition has a value.
//
// Campaigns stay honest about what they are: the scheduler is not wired, so
// the screen says the submission is queued and audited, not applied.
function PromotionsInner() {
  const locale = useLocale();
  const fields = useMemo(() => ruleFields(locale), [locale]);

  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState("percent");
  const [couponValue, setCouponValue] = useState("");
  const [couponMinOrder, setCouponMinOrder] = useState("");

  const [campaignSegment, setCampaignSegment] = useState("");
  const [campaignStart, setCampaignStart] = useState("");
  const [campaignEnd, setCampaignEnd] = useState("");

  const [combinator, setCombinator] = useState<RuleCombinator>("and");
  const [conditions, setConditions] = useState<RuleCondition[]>([]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function post(key: string, path: string, body: unknown) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const res = await authedFetch<{ status: string; note: string }>(path, {
        method: "POST",
        body: JSON.stringify(body)
      });
      setDone(res.note);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  function addCondition() {
    const first = fields[0];
    if (!first) return;
    nextConditionId += 1;
    setConditions((prev) => [
      ...prev,
      { id: `c${nextConditionId}`, field: first.value, operator: first.operators[0] ?? "eq", value: "" }
    ]);
  }

  const operatorLabels = {
    gte: t(locale, "admin.ruleOpGte"),
    lte: t(locale, "admin.ruleOpLte"),
    eq: t(locale, "admin.ruleOpEq"),
    neq: t(locale, "admin.ruleOpNeq")
  };

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="promotions-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="promotions-title" title={t(locale, "nav.promotions")} />

            {error ? <Banner tone="danger">{error}</Banner> : null}
            {done ? <Banner tone="success">{done}</Banner> : null}

            <Card>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void post("coupon", "/api/v1/admin/promotions/coupons", {
                    code: couponCode,
                    type: couponType,
                    value: Number(couponValue),
                    ...(couponMinOrder ? { constraints: { minOrder: Number(couponMinOrder) } } : {})
                  });
                }}
              >
                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "admin.coupons")}</h2>
                  <TextField
                    label={t(locale, "admin.couponCode")}
                    required
                    forceLtr
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value)}
                  />
                  <Select
                    label={t(locale, "admin.couponType")}
                    value={couponType}
                    onChange={(event) => setCouponType(event.target.value)}
                    options={[
                      { value: "percent", label: t(locale, "admin.couponPercent") },
                      { value: "fixed", label: t(locale, "admin.couponFixed") }
                    ]}
                  />
                  <TextField
                    label={t(locale, "admin.couponValue")}
                    required
                    forceLtr
                    inputMode="decimal"
                    value={couponValue}
                    onChange={(event) => setCouponValue(event.target.value)}
                  />
                  <TextField
                    label={t(locale, "admin.minOrder")}
                    hint={t(locale, "common.optional")}
                    forceLtr
                    inputMode="decimal"
                    value={couponMinOrder}
                    onChange={(event) => setCouponMinOrder(event.target.value)}
                  />
                  <Cluster gap="sm">
                    <Button type="submit" variant="gold" busy={busy === "coupon"} disabled={!couponCode || !couponValue}>
                      {t(locale, "admin.saveCoupon")}
                    </Button>
                  </Cluster>
                </Stack>
              </form>
            </Card>

            <Card>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void post("campaign", "/api/v1/admin/promotions/campaigns", {
                    start: new Date(campaignStart).toISOString(),
                    end: new Date(campaignEnd).toISOString(),
                    segment: campaignSegment,
                    offers: []
                  });
                }}
              >
                <Stack gap="md">
                  <h2 className="ps-section-head__title">{t(locale, "admin.campaigns")}</h2>
                  {/* Said before the button, not discovered after it: nothing
                      here is applied yet. */}
                  <Banner tone="info">{t(locale, "admin.campaignQueuedNote")}</Banner>
                  <TextField
                    label={t(locale, "admin.campaignSegment")}
                    required
                    value={campaignSegment}
                    onChange={(event) => setCampaignSegment(event.target.value)}
                  />
                  <TextField
                    label={t(locale, "form.from")}
                    type="datetime-local"
                    required
                    forceLtr
                    value={campaignStart}
                    onChange={(event) => setCampaignStart(event.target.value)}
                  />
                  <TextField
                    label={t(locale, "form.to")}
                    type="datetime-local"
                    required
                    forceLtr
                    value={campaignEnd}
                    onChange={(event) => setCampaignEnd(event.target.value)}
                  />
                  <Cluster gap="sm">
                    <Button
                      type="submit"
                      variant="ghost"
                      busy={busy === "campaign"}
                      disabled={!campaignSegment || !campaignStart || !campaignEnd}
                    >
                      {t(locale, "admin.submitCampaign")}
                    </Button>
                  </Cluster>
                </Stack>
              </form>
            </Card>

            <Card>
              <Stack gap="md">
                <h2 className="ps-section-head__title">{t(locale, "admin.eligibilityRule")}</h2>
                <RuleBuilder
                  label={t(locale, "admin.eligibilityRule")}
                  fields={fields}
                  conditions={conditions}
                  combinator={combinator}
                  onCombinatorChange={setCombinator}
                  onConditionChange={(id, patch) =>
                    setConditions((prev) =>
                      prev.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition))
                    )
                  }
                  onAdd={addCondition}
                  onRemove={(id) => setConditions((prev) => prev.filter((condition) => condition.id !== id))}
                  labels={{
                    field: t(locale, "admin.ruleField"),
                    operator: t(locale, "admin.ruleOperator"),
                    value: t(locale, "admin.ruleValue"),
                    add: t(locale, "admin.ruleAdd"),
                    remove: t(locale, "admin.ruleRemove"),
                    and: t(locale, "admin.ruleAll"),
                    or: t(locale, "admin.ruleAny"),
                    empty: t(locale, "admin.ruleEmpty"),
                    valueRequired: t(locale, "admin.ruleValueRequired")
                  }}
                  operatorLabels={operatorLabels}
                />
                <Cluster gap="sm">
                  <Button
                    variant="gold"
                    busy={busy === "rule"}
                    disabled={!isRuleValid(conditions)}
                    onClick={() =>
                      void post("rule", "/api/v1/admin/promotions/rules", {
                        rule: toRuleValue(combinator, conditions)
                      })
                    }
                  >
                    {t(locale, "admin.saveRule")}
                  </Button>
                </Cluster>
              </Stack>
            </Card>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function PromotionsPage() {
  return (
    <LoginGate>
      <PromotionsInner />
    </LoginGate>
  );
}
