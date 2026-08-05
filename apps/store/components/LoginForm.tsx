"use client";

import { AuthShell } from "@petrospecial/ui";
import { useLocale } from "@petrospecial/app-shell/src/client";
import { SignInForm } from "@petrospecial/app-shell/src/auth";
import { t, type StringKey } from "@petrospecial/i18n";
import { login } from "../lib/authClient";

// The gate on /cart, /orders and /account. The storefront has no /login route
// — you sign in where you were stopped, and stay there — so this is the panel
// variant of the same card the driver's and the distributor's own routes use.
//
// Was two unlabelled inputs, a `#b91c1c` error paragraph (--f-raval, the Raval
// product family, standing in for an error red) and three inline style
// objects.
export function LoginForm({
  promptKey,
  onLoggedIn
}: {
  promptKey: "auth.leadCart" | "auth.leadOrders" | "auth.leadAccount";
  onLoggedIn: () => void;
}) {
  const locale = useLocale();

  return (
    <AuthShell variant="panel" title={t(locale, "auth.signInTitle")} lead={t(locale, promptKey as StringKey)}>
      <SignInForm signIn={({ email, password }) => login(email, password)} onSignedIn={onLoggedIn} />
    </AuthShell>
  );
}
