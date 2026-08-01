import { bestsellersResponse, fulfillmentAnalyticsResponse, salesAnalyticsResponse } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { money } from "../catalog/pricing.js";
import { withServiceRoleTransaction } from "../db.js";
import { requirePermission } from "../gateway/requirePermission.js";

// 40-admin-center/05-api-specification.md §1 (AC-01, S17). All three views
// are k>=5 anonymity-floored aggregates (0065) — no PII column exists to
// leak, so these read over app_service_role like every other analytics
// surface in this codebase (route-level requirePermission("read","analytics")
// is the real access gate, matching 0065's own reasoning for not granting
// app_user broad SELECT on the underlying views).
export function registerAdminAnalyticsRoutes(app: FastifyInstance): void {
  // EP-AC-001 · GET /admin/analytics/sales · auth(admin)
  app.get(
    "/api/v1/admin/analytics/sales",
    { preHandler: requirePermission("read", "analytics") },
    async (_request, reply) => {
      const rows = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ day: Date; kind: string; orders: string; buyers: string; gross: string; discounts: string; reversed: string | null }>(
          "select day, kind, orders, buyers, gross, discounts, reversed from orders.v_sales_kpi order by day desc limit 200"
        );
        return res.rows;
      });
      return reply.code(200).send(
        salesAnalyticsResponse.parse({
          asOf: new Date().toISOString(),
          rows: rows.map((r) => ({
            day: r.day.toISOString().slice(0, 10),
            kind: r.kind,
            orders: Number(r.orders),
            buyers: Number(r.buyers),
            gross: money(Number(r.gross)),
            discounts: money(Number(r.discounts)),
            reversed: money(Number(r.reversed ?? 0))
          }))
        })
      );
    }
  );

  // EP-AC-002 · GET /admin/analytics/bestsellers · auth(admin)
  app.get(
    "/api/v1/admin/analytics/bestsellers",
    { preHandler: requirePermission("read", "analytics") },
    async (_request, reply) => {
      const rows = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ week: Date; sku_id: string; qty: string; revenue: string }>(
          "select week, sku_id, qty, revenue from orders.v_bestsellers_family order by week desc limit 200"
        );
        return res.rows;
      });
      return reply.code(200).send(
        bestsellersResponse.parse({
          asOf: new Date().toISOString(),
          rows: rows.map((r) => ({ week: r.week.toISOString().slice(0, 10), skuId: r.sku_id, qty: Number(r.qty), revenue: money(Number(r.revenue)) }))
        })
      );
    }
  );

  // EP-AC-003 · GET /admin/analytics/fulfillment · auth(admin) — honest nulls
  // for anything delivery.v_driver_kpis doesn't actually compute, same
  // precedent driverDelivery.ts's own individual driverKpisResponse already
  // set (S12 handover: "returns honest nulls... rather than fabricating").
  app.get(
    "/api/v1/admin/analytics/fulfillment",
    { preHandler: requirePermission("read", "analytics") },
    async (_request, reply) => {
      const row = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ avg_delivered: string | null; total_failed: string | null; total_tasks: string | null }>(
          `select avg(delivered_ratio) as avg_delivered, sum(failed_count) as total_failed,
                  (select count(*) from delivery.delivery_tasks) as total_tasks
           from delivery.v_driver_kpis`
        );
        return res.rows[0];
      });
      const totalTasks = Number(row?.total_tasks ?? 0);
      const totalFailed = Number(row?.total_failed ?? 0);
      return reply.code(200).send(
        fulfillmentAnalyticsResponse.parse({
          asOf: new Date().toISOString(),
          onTimePct: null, // no on-time-vs-eta comparison computed anywhere yet — honest gap, not fabricated
          fulfillmentRate: row?.avg_delivered !== null && row?.avg_delivered !== undefined ? Number(row.avg_delivered) * 100 : null,
          failedPct: totalTasks > 0 ? Number(((totalFailed / totalTasks) * 100).toFixed(2)) : null
        })
      );
    }
  );

  // EP-AC-004 · GET /admin/analytics/export · auth(admin) — the SAME
  // aggregate table already shown (sales KPI), text/csv. No per-customer
  // export exists anywhere (FR-AC10-002 / NFR-AC-002's own no-export rule).
  app.get(
    "/api/v1/admin/analytics/export",
    { preHandler: requirePermission("read", "analytics") },
    async (_request, reply) => {
      const rows = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ day: Date; kind: string; orders: string; buyers: string; gross: string }>(
          "select day, kind, orders, buyers, gross from orders.v_sales_kpi order by day desc limit 1000"
        );
        return res.rows;
      });
      const header = "day,kind,orders,buyers,gross\n";
      const body = rows.map((r) => `${r.day.toISOString().slice(0, 10)},${r.kind},${r.orders},${r.buyers},${r.gross}`).join("\n");
      reply.header("content-type", "text/csv");
      reply.header("content-disposition", "attachment; filename=sales-kpi.csv");
      return reply.code(200).send(header + body);
    }
  );
}
