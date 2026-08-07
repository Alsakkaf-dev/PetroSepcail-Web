"use client";

import { useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  CopyButton,
  Icon,
  Ltr,
  Page,
  ReasonGate,
  Section,
  SectionHead,
  Select,
  Stack,
  Tabs,
  TextField,
  type ReasonOption
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t, type Locale, type StringKey } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

interface ProvisionResult {
  identityId: string;
  role: string;
  status: string;
  activationLink?: string;
}

const SUSPEND_REASONS: Array<{ value: string; labelKey: StringKey; requiresNote?: boolean }> = [
  { value: "policy_violation", labelKey: "admin.reasonPolicyViolation" },
  { value: "fraud_suspected", labelKey: "admin.reasonFraudSuspected" },
  { value: "customer_request", labelKey: "admin.reasonCustomerRequest" },
  { value: "other_with_note", labelKey: "admin.reasonOtherWithNote", requiresNote: true }
];

function suspendOptions(locale: Locale): ReasonOption[] {
  return SUSPEND_REASONS.map((reason) => ({
    value: reason.value,
    label: t(locale, reason.labelKey),
    ...(reason.requiresNote ? { requiresNote: true } : {})
  }));
}

/** EP-AC-050..052. Three roles, one form. */
function ProvisionForm({ endpoint, title, note }: { endpoint: string; title: string; note?: string }) {
  const locale = useLocale();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await authedFetch<ProvisionResult>(endpoint, {
          method: "POST",
          body: JSON.stringify({ fullName, email, phone })
        })
      );
      setFullName("");
      setEmail("");
      setPhone("");
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <h2 className="ps-section-head__title">{title}</h2>
        {note ? <Banner tone="warn">{note}</Banner> : null}
        <TextField
          label={t(locale, "form.fullName")}
          required
          autoComplete="off"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
        <TextField
          label={t(locale, "form.email")}
          type="email"
          required
          forceLtr
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label={t(locale, "form.phone")}
          required
          forceLtr
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Cluster gap="sm">
          <Button type="submit" variant="gold" busy={busy}>
            {t(locale, "common.confirm")}
          </Button>
        </Cluster>

        {result ? (
          <Banner tone="success" title={t(locale, "admin.userCreated")}>
            <Stack gap="sm">
              <Cluster gap="sm">
                <span>{t(locale, "admin.identityId")}:</span>
                <Ltr as="code">{result.identityId}</Ltr>
                <CopyButton
                  value={result.identityId}
                  label={t(locale, "common.copy")}
                  copiedLabel={t(locale, "common.copied")}
                />
              </Cluster>
              {result.activationLink ? (
                <Cluster gap="sm">
                  <span>{t(locale, "admin.activationLink")}:</span>
                  <CopyButton
                    value={result.activationLink}
                    label={t(locale, "common.copy")}
                    copiedLabel={t(locale, "common.copied")}
                  />
                </Cluster>
              ) : null}
            </Stack>
          </Banner>
        ) : null}
      </Stack>
    </form>
  );
}

/** EP-AC-053/054. No user-listing endpoint exists, so this takes an account id
 * directly — an honest reflection of what the API exposes rather than a picker
 * with nothing behind it. */
function ManageUserForm() {
  const locale = useLocale();
  const options = suspendOptions(locale);
  const [identityId, setIdentityId] = useState("");
  const [role, setRole] = useState("customer");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function grant(action: "grant" | "revoke") {
    setBusy(action);
    setError(null);
    setDone(null);
    try {
      const res = await authedFetch<{ roles: string[] }>(`/api/v1/admin/users/${identityId}/grants`, {
        method: "POST",
        body: JSON.stringify({ action, role })
      });
      setDone(res.roles.join(", "));
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  // The reason used to come from window.prompt(), which is unlabelled,
  // unstyleable, untranslatable and impossible to validate. It is a real
  // gated field now, and the request cannot be sent without it.
  async function setStatus(status: "suspended" | "active") {
    setBusy(status);
    setError(null);
    setDone(null);
    try {
      const res = await authedFetch<{ status: string }>(`/api/v1/admin/users/${identityId}/status`, {
        method: "POST",
        body: JSON.stringify({ status, reason: note.trim() ? `${reason}: ${note.trim()}` : reason })
      });
      setDone(res.status);
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack gap="md">
      <h2 className="ps-section-head__title">{t(locale, "admin.manageUser")}</h2>
      <p className="ps-line-note ps-line-note--muted">{t(locale, "admin.noUserList")}</p>

      <TextField
        label={t(locale, "admin.identityId")}
        required
        forceLtr
        autoComplete="off"
        value={identityId}
        onChange={(event) => setIdentityId(event.target.value)}
      />

      <Select
        label={t(locale, "auth.role")}
        value={role}
        onChange={(event) => setRole(event.target.value)}
        options={[
          { value: "customer", label: t(locale, "brand.portalStore") },
          { value: "supplier", label: t(locale, "brand.portalSupplier") },
          { value: "driver", label: t(locale, "brand.portalDriver") },
          { value: "admin", label: t(locale, "brand.portalAdmin") },
          { value: "super_admin", label: t(locale, "nav.settings") }
        ]}
      />

      <Cluster gap="sm">
        <Button variant="ghost" busy={busy === "grant"} disabled={!identityId} onClick={() => grant("grant")}>
          {t(locale, "admin.approve")}
        </Button>
        <Button variant="ghost" busy={busy === "revoke"} disabled={!identityId} onClick={() => grant("revoke")}>
          {t(locale, "admin.reject")}
        </Button>
      </Cluster>

      <Banner tone="warn">{t(locale, "admin.suspendWarning")}</Banner>

      <ReasonGate
        label={t(locale, "admin.reasonCode")}
        name="user-status"
        options={options}
        value={reason}
        onChange={setReason}
        note={note}
        onNoteChange={setNote}
        noteLabel={t(locale, "admin.reasonNote")}
        noteHint={t(locale, "admin.reasonNoteHint")}
        hint={t(locale, "admin.reasonRequired")}
      >
        {(ready) => (
          <>
            <Button
              variant="danger"
              busy={busy === "suspended"}
              disabled={!ready || !identityId}
              onClick={() => setStatus("suspended")}
            >
              {t(locale, "admin.suspend")}
            </Button>
            <Button
              variant="gold"
              busy={busy === "active"}
              disabled={!ready || !identityId}
              onClick={() => setStatus("active")}
            >
              {t(locale, "admin.activate")}
            </Button>
          </>
        )}
      </ReasonGate>

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {done ? (
        <span role="status">
          <Badge variant="success">
            <Icon name="check-circle" size="sm" />
            {done}
          </Badge>
        </span>
      ) : null}
    </Stack>
  );
}

// SCR-AC06-001 — AC-06.
//
// Was sixteen inline styles and, more to the point, its own private sign-in
// form and its own private api() helper — the same pre-shell pattern
// /catalog carried. Both are gone.
//
// Roles are tabs rather than three stacked forms, so provisioning a driver and
// provisioning an admin can never be mistaken for one another, and the
// super-admin-only rule is stated on the tab it applies to.
function UsersInner() {
  const locale = useLocale();
  const [tab, setTab] = useState("supplier");

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="users-title">
        <Container>
          <Stack gap="lg">
            <SectionHead level={1} titleId="users-title" title={t(locale, "nav.users")} />

            <Card>
              <Tabs
                label={t(locale, "nav.users")}
                value={tab}
                onChange={setTab}
                items={[
                  { id: "supplier", label: t(locale, "brand.portalSupplier") },
                  { id: "driver", label: t(locale, "brand.portalDriver") },
                  { id: "admin", label: t(locale, "brand.portalAdmin") }
                ]}
              >
                {tab === "supplier" ? (
                  <ProvisionForm
                    endpoint="/api/v1/admin/users/suppliers"
                    title={t(locale, "admin.provisionSupplier")}
                  />
                ) : null}
                {tab === "driver" ? (
                  <ProvisionForm endpoint="/api/v1/admin/users/drivers" title={t(locale, "admin.provisionDriver")} />
                ) : null}
                {tab === "admin" ? (
                  <ProvisionForm
                    endpoint="/api/v1/admin/users/admins"
                    title={t(locale, "admin.provisionAdmin")}
                    note={t(locale, "admin.adminSuperOnly")}
                  />
                ) : null}
              </Tabs>
            </Card>

            <Card>
              <ManageUserForm />
            </Card>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function AdminUsersPage() {
  return (
    <LoginGate>
      <UsersInner />
    </LoginGate>
  );
}
