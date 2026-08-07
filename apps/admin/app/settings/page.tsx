"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Container,
  DataTable,
  DateTime,
  IdDisplay,
  Ltr,
  Page,
  Section,
  SectionHead,
  Stack,
  TextField
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { messageFor, t } from "@petrospecial/i18n";
import { authedFetch } from "../../lib/authClient";
import { LoginGate } from "../../lib/LoginGate";

interface ConfigRow {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string;
}

interface MeResponse {
  roles: string[];
}

/** The keys that move real money or file real tax documents.
 *
 * FR-PC12-001 calls these out by name. Two things follow from that and both
 * are here: they are visibly marked as dangerous *before* anyone types, and
 * their editor is disabled outright unless the signed-in actor is a super
 * admin. The API enforces the same rule for every key (see the SPEC-GAP note
 * at the top of services/api/src/routes/config.ts, which resolves it in
 * favour of 04-roles' matrix), so this is the UI agreeing with the server
 * rather than the UI being the gate. */
function isDangerous(key: string): boolean {
  return key.startsWith("payment") || key.startsWith("payments") || key.startsWith("zatca");
}

/** `core.settings.value` is jsonb, so a value is any JSON. Rendering it needs
 * to survive a string, a number, a boolean and an object without ever
 * printing `[object Object]` at somebody. */
function asText(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value ?? null);
}

interface PanelProps {
  title: string;
  rows: ConfigRow[] | null;
  error: string | null;
  canEdit: boolean;
  onRetry: () => void;
  onSave: (key: string, value: unknown) => Promise<void>;
}

function ConfigPanel({ title, rows, error, canEdit, onRetry, onSave }: PanelProps) {
  const locale = useLocale();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const state = error ? "error" : rows === null ? "loading" : rows.length === 0 ? "empty" : "ready";

  const save = async (row: ConfigRow) => {
    const raw = drafts[row.key] ?? asText(row.value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setInvalid((previous) => ({ ...previous, [row.key]: true }));
      return;
    }
    setInvalid((previous) => ({ ...previous, [row.key]: false }));
    setSavingKey(row.key);
    try {
      await onSave(row.key, parsed);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Stack gap="md">
      <h2 className="ps-section-head__title">{title}</h2>
      {/* Once above the table rather than under every row: the format rule is
          the same for all of them, and repeating it forty times is noise. */}
      <p className="ps-field__hint">{t(locale, "settings.jsonHint")}</p>
      <DataTable
        caption={title}
        state={state}
        stickyHeader
        errorMessage={error ?? undefined}
        onRetry={onRetry}
        retryLabel={t(locale, "common.retry")}
        emptyTitle={t(locale, "settings.empty")}
        emptyDescription={t(locale, "settings.emptyHint")}
        rows={rows ?? []}
        getRowKey={(row) => row.key}
        columns={[
          {
            key: "key",
            header: t(locale, "settings.key"),
            emphasis: "primary",
            render: (row) => (
              <Stack gap="xs">
                <Ltr>{row.key}</Ltr>
                {isDangerous(row.key) ? (
                  <Badge variant="warn">{t(locale, "settings.dangerousKey")}</Badge>
                ) : null}
              </Stack>
            )
          },
          {
            key: "value",
            header: t(locale, "settings.value"),
            render: (row) => (
              <TextField
                label={t(locale, "settings.value")}
                hideLabel
                name={`value-${row.key}`}
                forceLtr
                disabled={!canEdit}
                error={invalid[row.key] ? t(locale, "settings.invalidJson") : undefined}
                value={drafts[row.key] ?? asText(row.value)}
                onChange={(e) => setDrafts((previous) => ({ ...previous, [row.key]: e.target.value }))}
              />
            )
          },
          {
            key: "updatedBy",
            header: t(locale, "settings.updatedBy"),
            render: (row) =>
              row.updatedBy ? (
                <IdDisplay
                  id={row.updatedBy}
                  copy={{ label: t(locale, "common.copy"), copiedLabel: t(locale, "common.copied") }}
                />
              ) : (
                t(locale, "settings.never")
              )
          },
          {
            key: "updatedAt",
            header: t(locale, "settings.updatedAt"),
            render: (row) => <DateTime iso={row.updatedAt} locale={locale} />
          },
          {
            key: "save",
            header: t(locale, "common.save"),
            align: "end",
            render: (row) => (
              <Button
                variant="dark"
                size="sm"
                disabled={!canEdit}
                busy={savingKey === row.key}
                onClick={() => save(row)}
              >
                {t(locale, "settings.save")}
              </Button>
            )
          }
        ]}
      />
    </Stack>
  );
}

// SCR-PC12-001 — EP-PC-040..043 have been callable since S05 and nothing has
// ever called them. Two panels rather than one merged table: a setting is a
// operational value and a flag is a switch on behaviour, and reading them as
// one list is how someone flips `sms.enabled` while meaning to change a VAT
// rate.
function SettingsInner() {
  const locale = useLocale();
  const [settings, setSettings] = useState<ConfigRow[] | null>(null);
  const [flags, setFlags] = useState<ConfigRow[] | null>(null);
  const [roles, setRoles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      authedFetch<ConfigRow[]>("/api/v1/admin/settings"),
      authedFetch<ConfigRow[]>("/api/v1/admin/feature-flags"),
      authedFetch<MeResponse>("/api/v1/me")
    ])
      .then(([s, f, me]) => {
        setSettings(s);
        setFlags(f);
        setRoles(me.roles);
      })
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale]);

  useEffect(load, [load]);

  // The role decides whether the editors are usable at all. Until /me has
  // answered, nothing is editable — showing a live editor and then taking it
  // away is worse than showing a disabled one that turns on.
  const canEdit = roles !== null && roles.includes("super_admin");

  const put = useCallback(
    async (path: string, key: string, value: unknown) => {
      setSaved(null);
      try {
        await authedFetch(`${path}/${encodeURIComponent(key)}`, {
          method: "PUT",
          body: JSON.stringify({ value })
        });
        setSaved(key);
        load();
      } catch (thrown) {
        setError(messageFor(locale, thrown));
      }
    },
    [load, locale]
  );

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="settings-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead level={1} titleId="settings-title" title={t(locale, "settings.title")} />

            <Banner tone="info" icon="clipboard">
              {t(locale, "settings.auditNote")}
            </Banner>

            {/* Stated before anyone types, not after a rejected save. */}
            <Banner tone="warn" icon="lock">
              {t(locale, "settings.dangerousNote")}
            </Banner>

            {roles !== null && !canEdit ? (
              <Banner tone="warn" icon="lock">
                {t(locale, "settings.superAdminOnly")}
              </Banner>
            ) : null}

            {saved ? (
              <Banner tone="success" icon="check-circle">
                {t(locale, "settings.saved")}
              </Banner>
            ) : null}

            {error ? (
              <Banner
                tone="danger"
                action={
                  <Button variant="ghost" size="sm" onClick={load}>
                    {t(locale, "common.retry")}
                  </Button>
                }
              >
                {error}
              </Banner>
            ) : null}

            <ConfigPanel
              title={t(locale, "settings.settingsPanel")}
              rows={settings}
              error={error}
              canEdit={canEdit}
              onRetry={load}
              onSave={(key, value) => put("/api/v1/admin/settings", key, value)}
            />

            <ConfigPanel
              title={t(locale, "settings.flagsPanel")}
              rows={flags}
              error={error}
              canEdit={canEdit}
              onRetry={load}
              onSave={(key, value) => put("/api/v1/admin/feature-flags", key, value)}
            />
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function SettingsPage() {
  return (
    <LoginGate>
      <SettingsInner />
    </LoginGate>
  );
}
