"use client";

import { useEffect } from "react";
import {
  Button,
  ButtonLink,
  Cluster,
  Container,
  IconWell,
  Page,
  Section,
  SectionHead,
  Skeleton,
  Stack
} from "@petrospecial/ui";
import { DEFAULT_LOCALE, dirFor, messageFor, t, type Locale } from "@petrospecial/i18n";
import { useLocale } from "./client";

/**
 * The four route-level screens the App Router asks every app for, written
 * once and re-exported by each app's `loading.tsx` / `error.tsx` /
 * `not-found.tsx` / `global-error.tsx`.
 *
 * All four were missing platform-wide: `notFound()` in the storefront rendered
 * Next.js's stock black-and-white 404, a thrown error rendered the framework's
 * own error page, and a slow route rendered nothing at all.
 */

/** `loading.tsx` — the shape of a screen, not a spinner.
 *
 * A route-level fallback cannot know what is coming, so this is the most
 * honest generic: a heading block and three content bars on the warm
 * recessed surface. Per-screen loading states replace it with skeletons that
 * match their own layout as each screen is rebuilt. */
export function RouteLoading() {
  const locale = useLocale();
  return (
    <Page>
      {/* One live region for the whole screen: a screen reader should hear
          "loading" once, not once per bar. The bars themselves are
          aria-hidden inside Skeleton. */}
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="ps-visually-hidden">{t(locale, "state.loadingLabel")}</span>
        <Stack gap="lg">
          <Stack gap="sm">
            <Skeleton width="1/3" />
            <Skeleton variant="block" size="sm" width="1/2" />
          </Stack>
          <Stack gap="sm">
            <Skeleton variant="block" size="lg" />
            <Skeleton variant="block" size="lg" />
            <Skeleton variant="block" size="lg" />
          </Stack>
        </Stack>
      </div>
    </Page>
  );
}

/** `not-found.tsx` — a wrong link, said in the reader's language, with the
 * way back. */
export function RouteNotFound({ homeHref = "/" }: { homeHref?: string }) {
  const locale = useLocale();
  return (
    <Page>
      <Section air="app" aria-labelledby="route-not-found-title">
        <Container width="narrow">
          <Stack gap="lg">
            <IconWell name="search" tone="gold" />
            <SectionHead
              level={1}
              titleId="route-not-found-title"
              title={t(locale, "route.notFoundTitle")}
              lead={t(locale, "route.notFoundBody")}
            />
            <Cluster gap="md">
              <ButtonLink href={homeHref} variant="gold">
                {t(locale, "route.goHome")}
              </ButtonLink>
            </Cluster>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export interface RouteErrorProps {
  error: Error & { digest?: string };
  /** Next's own reset(), which re-renders the segment. A retry that does not
   * retry is worse than no retry at all. */
  reset: () => void;
  homeHref?: string;
}

/** `error.tsx` — a working retry and a translated message.
 *
 * The thrown error's own text is never rendered: it is a developer string
 * ("Failed to fetch", "GET /api/v1/cart failed: 500") and, when it does come
 * from the API, it is English regardless of who is reading. `messageFor()`
 * resolves it through the registry into the reader's language, and anything
 * unrecognised becomes the generic message rather than leaking. */
export function RouteError({ error, reset, homeHref = "/" }: RouteErrorProps) {
  const locale = useLocale();

  useEffect(() => {
    // The browser console is where a developer string belongs.
    console.error(error);
  }, [error]);

  return (
    <Page>
      <Section air="app" aria-labelledby="route-error-title">
        <Container width="narrow">
          <Stack gap="lg">
            <IconWell name="warning" tone="warn" />
            <SectionHead
              level={1}
              titleId="route-error-title"
              title={t(locale, "route.errorTitle")}
              lead={messageFor(locale, error)}
            />
            <Cluster gap="md">
              <Button variant="gold" onClick={reset}>
                {t(locale, "common.retry")}
              </Button>
              <ButtonLink href={homeHref} variant="ghost">
                {t(locale, "route.goHome")}
              </ButtonLink>
            </Cluster>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}

export interface GlobalErrorScreenProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** `global-error.tsx` replaces the root layout, so there is no
   * `LocaleProvider` above it and no cookie read — the locale has to be
   * handed in or defaulted. Arabic is the platform default (FR-PC07-002). */
  locale?: Locale;
}

/**
 * `global-error.tsx` — the last resort, shown when the root layout itself
 * threw.
 *
 * It replaces the whole document, so it renders its own `<html>` and
 * `<body>`; nothing above it survives, including the stylesheet import, which
 * is why each app's `global-error.tsx` imports `globals.css` for itself.
 * Deliberately the plainest screen in the platform: no shell, no nav, no
 * data — the one thing it must do is come up when everything else did not.
 */
export function GlobalErrorScreen({ error, reset, locale = DEFAULT_LOCALE }: GlobalErrorScreenProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <Page>
          <Section air="app" aria-labelledby="global-error-title">
            <Container width="narrow">
              <Stack gap="lg">
                <IconWell name="warning" tone="danger" />
                <SectionHead
                  level={1}
                  titleId="global-error-title"
                  title={t(locale, "route.errorTitle")}
                  lead={t(locale, "route.errorBody")}
                />
                <Cluster gap="md">
                  <Button variant="gold" onClick={reset}>
                    {t(locale, "common.retry")}
                  </Button>
                </Cluster>
              </Stack>
            </Container>
          </Section>
        </Page>
      </body>
    </html>
  );
}
