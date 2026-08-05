"use client";

import { useRouter } from "next/navigation";
import { AuthShell, Brand } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { SignInForm } from "@petrospecial/app-shell/src/auth";
import { t } from "@petrospecial/i18n";
import { login } from "../../lib/authClient";

// SCR-PC01-002. Was the platform's one outright layout bug rather than merely
// a plain screen: a bare <h1> clipped at the viewport edge above an
// unconstrained row of default inputs that ran off the side of a phone. The
// form is the shared one now, inside a 26rem card that cannot overflow.
//
// The <Suspense> + PageInner() wrapper this file carried is gone with it: it
// existed only to satisfy useSearchParams() inside the old useLocale(), and
// locale comes from context now.
export default function DriverLoginPage() {
  const locale = useLocale();
  const router = useRouter();

  return (
    <AuthShell
      brand={
        <Brand
          size="lg"
          logoSrc="/brand/petrospecial.png"
          logoAlt={t(locale, "brand.name")}
          portal={t(locale, "brand.portalDriver")}
        />
      }
      title={t(locale, "auth.signInTitle")}
      lead={t(locale, "auth.leadDriver")}
    >
      <SignInForm
        signIn={({ email, password }) => login(email, password)}
        onSignedIn={() => router.push("/shift")}
      />
    </AuthShell>
  );
}
