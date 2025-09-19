import { Pool } from 'pg';

export interface UsageRecord {
  provider: string;
  tool_name: string;
  subject?: string | null;
  success: boolean;
  latency_ms?: number | null;
  error_message?: string | null;
}

export interface UsageStore {
  init?(): Promise<void>;
  log(rec: UsageRecord): Promise<void>;
  stats(): Promise<{ total: number, byProvider: Record<string, number>, byTool: Record<string, number> }>;
}

export class InMemoryUsageStore implements UsageStore {
  private arr: UsageRecord[] = [];
  async log(rec: UsageRecord) { this.arr.push(rec); }
  async stats() {
    const byProvider: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    for (const r of this.arr) {
      byProvider[r.provider] = (byProvider[r.provider] || 0) + 1;
      const key = `${r.provider}:${r.tool_name}`;
      byTool[key] = (byTool[key] || 0) + 1;
    }
    return { total: this.arr.length, byProvider, byTool };
  }
}

export class PostgresUsageStore implements UsageStore {
  private pool: Pool;
  constructor(conn: string) { this.pool = new Pool({ connectionString: conn, max: 3 }); }
  async init() {
    await this.pool.query(`
      create table if not exists tool_usage (
        id serial primary key,
        provider text not null,
        tool_name text not null,
        subject text,
        success boolean not null,
        latency_ms integer,
        error_message text,
        created_at timestamptz default now()
      );
    `);
  }
  async log(rec: UsageRecord) {
    await this.pool.query(
      `insert into tool_usage (provider, tool_name, subject, success, latency_ms, error_message)
       values ($1,$2,$3,$4,$5,$6)`,
      [rec.provider, rec.tool_name, rec.subject ?? null, rec.success, rec.latency_ms ?? null, rec.error_message ?? null]
    );
  }
  async stats() {
    const totalRes = await this.pool.query(`select count(*)::int as total from tool_usage`);
    const provRes = await this.pool.query(`select provider, count(*)::int c from tool_usage group by provider`);
    const toolRes = await this.pool.query(`select provider||':'||tool_name as key, count(*)::int c from tool_usage group by provider, tool_name`);
    const byProvider: Record<string, number> = {};
    for (const r of provRes.rows) byProvider[r.provider] = r.c;
    const byTool: Record<string, number> = {};
    for (const r of toolRes.rows) byTool[r.key] = r.c;
    return { total: totalRes.rows[0].total, byProvider, byTool };
  }
}
