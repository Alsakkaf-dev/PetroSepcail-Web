"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Container,
  DataList,
  DateTime,
  Page,
  Section,
  SectionHead,
  Segmented,
  Stack
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, dayKey, messageFor, t, type StringKey } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../../lib/authClient";
import { LoginForm } from "../../components/LoginForm";

interface NotificationItem {
  id: string;
  type: string;
  params: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  nextCursor: string | null;
}

// `core.notifications.type` is a closed vocabulary
// (services/api/src/notifications/templates.ts). An unmapped value gets the
// generic label rather than being printed raw — a customer must never read
// `identity_welcome` off a screen.
const TYPE_LABEL: Record<string, StringKey> = {
  email_verify: "notif.typeEmailVerify",
  password_reset: "notif.typePasswordReset",
  identity_welcome: "notif.typeWelcome"
};

// SCR-PC06-001 — EP-PC-020..022 have been callable since S05 and no screen in
// any app ever called them. Grouped by day, because a notification list read
// as one undifferentiated stream is a list nobody scrolls twice.
function NotificationsInner() {
  const locale = useLocale();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (after?: string | null) => {
      setError(null);
      const query = new URLSearchParams();
      if (unreadOnly) query.set("unread", "true");
      if (after) query.set("cursor", after);
      const suffix = query.toString();
      authedFetch<NotificationsResponse>(`/api/v1/notifications${suffix ? `?${suffix}` : ""}`)
        .then((page) => {
          setItems((previous) => (after && previous ? [...previous, ...page.items] : page.items));
          setCursor(page.nextCursor);
        })
        .catch((thrown) => setError(messageFor(locale, thrown)));
    },
    [locale, unreadOnly]
  );

  useEffect(() => {
    setItems(null);
    load(null);
  }, [load]);

  const markAllRead = useCallback(async () => {
    setBusy(true);
    try {
      await authedFetch("/api/v1/notifications/read-all", { method: "POST" });
      setItems((previous) =>
        previous ? previous.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })) : previous
      );
    } catch (thrown) {
      setError(messageFor(locale, thrown));
    } finally {
      setBusy(false);
    }
  }, [locale]);

  const markRead = useCallback(
    async (id: string) => {
      try {
        await authedFetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
        setItems((previous) =>
          previous ? previous.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)) : previous
        );
      } catch (thrown) {
        setError(messageFor(locale, thrown));
      }
    },
    [locale]
  );

  const unread = useMemo(() => (items ?? []).filter((item) => item.readAt === null).length, [items]);

  // One group per calendar day in Asia/Riyadh, newest first. The API already
  // returns them in that order, so grouping is a fold rather than a sort.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: NotificationItem[] }> = [];
    for (const item of items ?? []) {
      const { key, label } = dayKey(locale, item.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, label, items: [item] });
    }
    return out;
  }, [items, locale]);

  const state = error ? "error" : items === null ? "loading" : items.length === 0 ? "empty" : "ready";

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="notif-title">
        <Container>
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="notif-title"
              title={t(locale, "notif.title")}
              actions={
                unread > 0 ? (
                  <Button variant="dark" size="sm" busy={busy} onClick={markAllRead}>
                    {t(locale, "notif.markAllRead")}
                  </Button>
                ) : undefined
              }
            />

            {unread > 0 ? (
              <Banner tone="info" icon="bell">
                {t(locale, "notif.unreadCount", { count: count(unread) })}
              </Banner>
            ) : null}

            <Segmented
              label={t(locale, "common.filter")}
              value={unreadOnly ? "unread" : "all"}
              onChange={(value) => setUnreadOnly(value === "unread")}
              options={[
                { value: "all", label: t(locale, "notif.all") },
                { value: "unread", label: t(locale, "notif.unreadOnly") }
              ]}
            />

            {state === "ready" ? (
              groups.map((group) => (
                <Stack key={group.key} gap="sm">
                  <h2 className="ps-section-head__title">{group.label}</h2>
                  <DataList
                    label={group.label}
                    state="ready"
                    items={group.items.map((item) => ({
                      id: item.id,
                      title: t(locale, TYPE_LABEL[item.type] ?? "notif.typeGeneric"),
                      status:
                        item.readAt === null ? <Badge variant="info">{t(locale, "notif.unreadOnly")}</Badge> : undefined,
                      fields: [{ label: t(locale, "admin.auditAt"), value: <DateTime iso={item.createdAt} locale={locale} /> }],
                      actions:
                        item.readAt === null ? (
                          <Button variant="ghost" size="sm" onClick={() => markRead(item.id)}>
                            {t(locale, "notif.markRead")}
                          </Button>
                        ) : undefined
                    }))}
                  />
                </Stack>
              ))
            ) : (
              <DataList
                label={t(locale, "notif.title")}
                state={state}
                errorMessage={error ?? undefined}
                onRetry={() => load(null)}
                retryLabel={t(locale, "common.retry")}
                emptyTitle={t(locale, "notif.empty")}
                emptyDescription={t(locale, "notif.emptyHint")}
                items={[]}
              />
            )}

            {cursor ? (
              <Button variant="dark" onClick={() => load(cursor)}>
                {t(locale, "notif.loadMore")}
              </Button>
            ) : null}
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export default function NotificationsPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(Boolean(getToken())), []);
  if (signedIn === null) return null;
  if (!signedIn) return <LoginForm promptKey="auth.leadAccount" onLoggedIn={() => setSignedIn(true)} />;
  return <NotificationsInner />;
}
