import { z } from "zod";

// 60-platform-core/05-api-specification.md §3 (Notifications, PC-06).

export const notificationItem = z.object({
  id: z.string().uuid(),
  type: z.string(),
  params: z.record(z.string(), z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});
export type NotificationItem = z.infer<typeof notificationItem>;

// EP-PC-020 · GET /notifications · auth
export const notificationsListResponse = z.object({
  items: z.array(notificationItem),
  nextCursor: z.string().nullable()
});
export type NotificationsListResponse = z.infer<typeof notificationsListResponse>;
