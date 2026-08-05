import Link from "next/link";
import { Container, Grid, NavTile, Page, Section, SectionHead, Stack } from "@petrospecial/ui";
import { getLocale } from "@petrospecial/app-shell/src/server";
import { t } from "@petrospecial/i18n";

// The console launcher. Was a bare <ul> of ten links whose labels carried
// internal spec IDs — "Audit Log (AC-07)", "Finance & Receivables (AC-08)".
// Those identifiers are how the specification refers to a screen; they mean
// nothing to the person using it, and 03-domain-glossary is explicit that no
// raw technical string reaches a surface.
const TILES = [
  { href: "/dashboard", icon: "dashboard", labelKey: "nav.dashboard", descKey: "admin.dashboardDesc" },
  { href: "/catalog", icon: "droplet", labelKey: "nav.catalog", descKey: "admin.catalogDesc" },
  { href: "/suppliers-credit", icon: "building", labelKey: "nav.suppliersCredit", descKey: "admin.creditDesc" },
  { href: "/promotions", icon: "tag", labelKey: "nav.promotions", descKey: "admin.promotionsDesc" },
  { href: "/interventions", icon: "warning", labelKey: "nav.interventions", descKey: "admin.interventionsDesc" },
  { href: "/users", icon: "users", labelKey: "nav.users", descKey: "admin.usersDesc" },
  { href: "/audit", icon: "clipboard", labelKey: "nav.auditLog", descKey: "admin.auditDesc" },
  { href: "/finance", icon: "banknote", labelKey: "nav.finance", descKey: "admin.financeDesc" },
  { href: "/fleet", icon: "truck", labelKey: "nav.fleet", descKey: "admin.fleetDesc" },
  { href: "/privacy", icon: "shield", labelKey: "nav.privacy", descKey: "admin.privacyDesc" }
] as const;

export default function AdminHome() {
  const locale = getLocale();

  return (
    <Page width="flush">
      <Section air="app" aria-labelledby="admin-home-title">
        <Container width="wide">
          <Stack gap="lg">
            <SectionHead
              level={1}
              titleId="admin-home-title"
              eyebrow={t(locale, "brand.tagline")}
              title={t(locale, "admin.title")}
              lead={t(locale, "admin.homeLead")}
            />
            <Grid cols="3">
              {TILES.map((tile) => (
                <NavTile
                  key={tile.href}
                  linkAs={Link}
                  href={tile.href}
                  icon={tile.icon}
                  // The privacy surface is the only place customer PII can be
                  // read, and every read is logged against a name. It gets the
                  // alert tone here so it never reads as one more admin page.
                  tone={tile.href === "/privacy" ? "danger" : "gold"}
                  title={t(locale, tile.labelKey)}
                  description={t(locale, tile.descKey)}
                />
              ))}
            </Grid>
          </Stack>
        </Container>
      </Section>
    </Page>
  );
}
