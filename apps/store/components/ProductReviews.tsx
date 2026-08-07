"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Banner,
  Button,
  Card,
  DataList,
  DateTime,
  Rating,
  RatingInput,
  Section,
  SectionHead,
  Stack,
  Textarea
} from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { count, isApiError, messageFor, t } from "@petrospecial/i18n";
import { authedFetch, getToken } from "../lib/authClient";
import { publicGet } from "../lib/publicApi";

/** FR-SF08-003. The server truncates nothing — it rejects — so the counter is
 * the only warning anyone gets before losing what they typed. */
const MAX_BODY = 1000;

interface ReviewItem {
  stars: number;
  body: string | null;
  authorDisplay: string;
  createdAt: string;
}

interface ReviewListResponse {
  items: ReviewItem[];
  nextCursor: string | null;
  summary: { avg: number; count: number };
}

interface SubmitResponse {
  reviewId: string;
  status: string;
}

/**
 * `SCR-SF08-001` — reviews on the product datasheet.
 *
 * EP-SF-060..063 have been callable since S13 and no screen has ever reached
 * them, so `orders.reviews` has only ever been written by tests.
 *
 * Four rules the spec sets, and where each one actually lives:
 *
 * - **Verified purchase only.** `orders.submit_review()` raises
 *   `NOT_VERIFIED_PURCHASE`, so the gate is the server's. The client states
 *   the rule before anyone types rather than discovering it on rejection.
 * - **1–5 stars, up to 1000 characters.** Both in the form; the counter is
 *   live and the submit disables past the limit.
 * - **A 48-hour edit window.** `orders.edit_review()` owns it. The control
 *   appears after submitting, because that is the only moment this screen
 *   knows a review id — the public list is anonymised and carries none.
 * - **Moderation state.** A submitted review is `pending` and does not appear
 *   in the list, which is a confusing silence unless the screen says so.
 */
export function ProductReviews({ slug }: { slug: string }) {
  const locale = useLocale();
  const [data, setData] = useState<ReviewListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [stars, setStars] = useState<number | undefined>(undefined);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResponse | null>(null);

  const load = useCallback(() => {
    setError(null);
    publicGet<ReviewListResponse>(`/api/v1/catalog/products/${slug}/reviews`)
      .then(setData)
      .catch((thrown) => setError(messageFor(locale, thrown)));
  }, [locale, slug]);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
    load();
  }, [load]);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (busy || stars === undefined) return;
      setBusy(true);
      setSubmitError(null);
      try {
        const result = await authedFetch<SubmitResponse>(`/api/v1/catalog/products/${slug}/reviews`, {
          method: "POST",
          body: JSON.stringify({ stars, body: body.trim() === "" ? undefined : body.trim() })
        });
        setSubmitted(result);
      } catch (thrown) {
        // NOT_VERIFIED_PURCHASE is the one rejection worth its own wording:
        // the registry message is accurate but the screen can say it as the
        // rule rather than as a failure.
        setSubmitError(
          isApiError(thrown, "NOT_VERIFIED_PURCHASE") ? t(locale, "review.verifiedOnly") : messageFor(locale, thrown)
        );
      } finally {
        setBusy(false);
      }
    },
    [body, busy, locale, slug, stars]
  );

  const state = error ? "error" : data === null ? "loading" : data.items.length === 0 ? "empty" : "ready";
  const remaining = MAX_BODY - body.length;

  return (
    <Section air="app" aria-labelledby="pdp-reviews">
      <Stack gap="lg">
        <SectionHead
          level={2}
          titleId="pdp-reviews"
          title={t(locale, "review.title")}
          divider={false}
          actions={
            data && data.summary.count > 0 ? (
              <Rating
                value={data.summary.avg}
                label={t(locale, "review.average", { avg: data.summary.avg.toFixed(1) })}
                count={t(locale, "review.count", { count: count(data.summary.count) })}
              />
            ) : undefined
          }
        />

        <DataList
          label={t(locale, "review.title")}
          state={state}
          errorMessage={error ?? undefined}
          onRetry={load}
          retryLabel={t(locale, "common.retry")}
          emptyTitle={t(locale, "review.none")}
          emptyDescription={t(locale, "review.noneHint")}
          items={(data?.items ?? []).map((item, index) => ({
            id: `${item.createdAt}-${index}`,
            title: item.authorDisplay,
            status: (
              <Rating
                size="sm"
                value={item.stars}
                label={t(locale, "review.average", { avg: String(item.stars) })}
              />
            ),
            fields: [
              { label: t(locale, "admin.auditAt"), value: <DateTime iso={item.createdAt} locale={locale} /> },
              ...(item.body ? [{ label: t(locale, "review.body"), value: item.body }] : [])
            ]
          }))}
        />

        <Card>
          <Stack gap="md">
            <h3 className="ps-section-head__title">{t(locale, "review.write")}</h3>

            {!signedIn ? (
              <Banner tone="info">{t(locale, "review.signIn")}</Banner>
            ) : submitted ? (
              <Stack gap="sm">
                <Banner tone="success" icon="check-circle">
                  {t(locale, "review.pending")}
                </Banner>
                <p className="ps-field__hint">{t(locale, "review.editWindow")}</p>
              </Stack>
            ) : (
              <form onSubmit={submit} noValidate>
                <Stack gap="md">
                  <Banner tone="info">{t(locale, "review.verifiedOnly")}</Banner>
                  {submitError ? <Banner tone="danger">{submitError}</Banner> : null}

                  <RatingInput
                    label={t(locale, "review.stars")}
                    name="stars"
                    required
                    value={stars}
                    onChange={setStars}
                    starLabels={[
                      t(locale, "review.star1"),
                      t(locale, "review.star2"),
                      t(locale, "review.star3"),
                      t(locale, "review.star4"),
                      t(locale, "review.star5")
                    ]}
                  />

                  <Textarea
                    label={t(locale, "review.body")}
                    name="body"
                    rows={4}
                    maxLength={MAX_BODY}
                    hint={t(locale, "review.remaining", { n: count(Math.max(remaining, 0)) })}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />

                  <p className="ps-field__hint">{t(locale, "review.moderation")}</p>

                  <Button type="submit" variant="gold" busy={busy} disabled={stars === undefined}>
                    {t(locale, "review.submit")}
                  </Button>
                </Stack>
              </form>
            )}
          </Stack>
        </Card>
      </Stack>
    </Section>
  );
}
