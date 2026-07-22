// PC-10 (FR-PC10-003/TC-PC10-003): health-driven S1/S2/S3 alerting persists
// an incident record in `ops.incidents` so an alert is provably raised, and
// fixes a PDPL 72h assessment deadline the moment an incident touching
// customer data opens (08-security-and-compliance.md §8).

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export type IncidentSeverity = "S1" | "S2" | "S3";

export interface OpenIncidentInput {
  severity: IncidentSeverity;
  service: string;
  message: string;
  touchesData?: boolean;
}

const PDPL_ASSESSMENT_WINDOW_MS = 72 * 60 * 60 * 1000;

export function computePdplDueAt(openedAt: Date, touchesData: boolean): Date | null {
  return touchesData ? new Date(openedAt.getTime() + PDPL_ASSESSMENT_WINDOW_MS) : null;
}

export async function openIncident(db: Queryable, input: OpenIncidentInput): Promise<number> {
  const touchesData = input.touchesData ?? false;
  const openedAt = new Date();
  const pdplAssessmentDueAt = computePdplDueAt(openedAt, touchesData);
  const result = await db.query(
    `insert into ops.incidents (severity, service, message, touches_data, opened_at, pdpl_assessment_due_at)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [input.severity, input.service, input.message, touchesData, openedAt, pdplAssessmentDueAt]
  );
  return result.rows[0]!.id as number;
}

export async function resolveIncident(db: Queryable, incidentId: number): Promise<void> {
  await db.query(`update ops.incidents set resolved_at = now() where id = $1 and resolved_at is null`, [
    incidentId
  ]);
}

export async function findOpenIncident(db: Queryable, service: string): Promise<{ id: number } | null> {
  const result = await db.query(
    `select id from ops.incidents where service = $1 and resolved_at is null order by opened_at desc limit 1`,
    [service]
  );
  const row = result.rows[0];
  return row ? { id: row.id as number } : null;
}
