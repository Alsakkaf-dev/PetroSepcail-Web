// Shared E2E test helper: an in-process SMTP catcher, replacing the mailpit
// Docker container (D-15 hosting pivot retired Docker from this project).
// The app's real SMTP adapter (notifications/emailAdapter.ts) is plain
// nodemailer over unauthenticated SMTP (secure: false) — SmtpServer with no
// auth/TLS accepts it as-is, no code path in the app needs to change.
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

export interface CaughtMail {
  to: string[];
  subject: string;
  text: string;
}

export interface EphemeralSmtp {
  port: number;
  messages: CaughtMail[];
  stop: () => Promise<void>;
}

export async function startEphemeralSmtp(port: number): Promise<EphemeralSmtp> {
  const messages: CaughtMail[] = [];

  const server = new SMTPServer({
    disabledCommands: ["AUTH", "STARTTLS"],
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((parsed) => {
          const to = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
          messages.push({
            to: to.flatMap((addr) => addr.value.map((v) => v.address ?? "")),
            subject: parsed.subject ?? "",
            text: parsed.text ?? ""
          });
          callback();
        })
        .catch(callback);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    port,
    messages,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}
