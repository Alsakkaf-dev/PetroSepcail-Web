import type { PoolClient } from "pg";
import { publishEvent } from "../events/publishEvent.js";
import { sendEmail } from "./emailAdapter.js";
import { renderTemplate, type NotificationType } from "./templates.js";

export interface DeliverEmailInput {
  client: PoolClient;
  to: string;
  locale: "ar" | "en";
  type: NotificationType;
  params?: Record<string, string>;
  notificationId?: string | null;
}

// FR-PC06-005: "Every send writes a core.notification_log row; a hard
// failure emits EV-PC-051 for PC-10 alerting." A failed send is logged and
// alerted but never re-thrown — a notification failure must not fail the
// primary business transaction it was triggered from (e.g. registration
// still succeeds even if the welcome/verify email didn't go out; the user
// can request a resend).
export async function deliverEmail(input: DeliverEmailInput): Promise<void> {
  if (process.env.EMAIL_MODE === "onscreen") return; // caller shows the link/code in its own response instead

  const { subject, body } = renderTemplate(input.type, input.locale, input.params ?? {});
  try {
    await sendEmail(input.to, subject, body);
    await input.client.query(
      "insert into core.notification_log (notification_id, channel, status) values ($1, 'email', 'sent')",
      [input.notificationId ?? null]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await input.client.query(
      "insert into core.notification_log (notification_id, channel, status, error) values ($1, 'email', 'failed', $2)",
      [input.notificationId ?? null, message]
    );
    await publishEvent(input.client, {
      name: "platform.notification.failed",
      payload: { notification_id: input.notificationId ?? null, channel: "email", error: message }
    });
  }
}
