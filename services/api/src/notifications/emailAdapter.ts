import nodemailer, { type Transporter } from "nodemailer";

// FR-PC06-004: EMAIL_MODE selects catcher (T1 Mailpit) | smtp (T2+ Postfix) |
// onscreen (no send). catcher/smtp are the SAME SMTP transport, just
// different SMTP_HOST/PORT env values (D-13/ADR-14: "no code change between
// modes") — only "onscreen" changes behavior (checked by the caller,
// deliverEmail.ts), so this module has exactly one code path.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: requireEnv("SMTP_HOST"),
    port: Number(requireEnv("SMTP_PORT")),
    secure: false
  });
  return transporter;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? "no-reply@petrospecial.com",
    to,
    subject,
    text
  });
}

export function closeEmailTransport(): void {
  transporter?.close();
  transporter = undefined;
}
