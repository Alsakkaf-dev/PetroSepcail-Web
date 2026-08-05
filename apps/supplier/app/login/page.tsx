"use client";

import { useRouter } from "next/navigation";
import { AuthShell, Brand } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { SignInForm } from "@petrospecial/app-shell/src/auth";
import { t } from "@petrospecial/i18n";
import { login } from "../../lib/authClient";

// SCR-PC01-002 — the shared sign-in screen. Was three inline style objects, a
// placeholder standing in for a label, and the API's raw English message
// shown to an Arabic reader.
//
// The <Suspense> + PageInner() wrapper is gone with it: it existed only to
// satisfy useSearchParams() inside the old useLocale(), and locale comes from
// context now.
export default function SupplierLoginPage() {
  const locale = useLocale();
  const router = useRouter();

  return (
    <AuthShell
      brand={
        <Brand
          size="lg"
          logoSrc="/brand/petrospecial.png"
          logoAlt={t(locale, "brand.name")}
          portal={t(locale, "brand.portalSupplier")}
        />
      }
      title={t(locale, "auth.signInTitle")}
      lead={t(locale, "auth.leadSupplier")}
      footer={t(locale, "auth.needAccount")}
    >
      <SignInForm
        signIn={({ email, password }) => login(email, password)}
        onSignedIn={() => router.push("/dashboard")}
      />
    </AuthShell>
  );
}
