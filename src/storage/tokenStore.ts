import { Pool } from 'pg';
import { logger } from '../logger.js';

export type Provider = 'notion';

export interface TokenRecord {
  provider: Provider;
  subject: string; // tenant/workspace id
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  scope?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  bot_id?: string | null;
  raw?: any;
  created_at?: string;
  updated_at?: string;
}

export interface TokenStore {
  init?(): Promise<void>;
  upsertToken(record: TokenRecord): Promise<void>;
  getToken(provider: Provider, subject?: string): Promise<TokenRecord | null>;
}

export class InMemoryTokenStore implements TokenStore {
  private map = new Map<string, TokenRecord>();
  async upsertToken(record: TokenRecord) {
    const key = `${record.provider}:${record.subject}`;
    this.map.set(key, { ...record, updated_at: new Date().toISOString(), created_at: this.map.get(key)?.created_at ?? new Date().toISOString() });
  }
  async getToken(provider: Provider, subject = 'default') {
    return this.map.get(`${provider}:${subject}`) || null;
  }
}

export class PostgresTokenStore implements TokenStore {
  private pool: Pool;
  constructor(connString: string) {
    this.pool = new Pool({ connectionString: connString, max: 3 });
  }
  async init() {
    await this.pool.query(`
      create table if not exists oauth_tokens (
        provider text not null,
        subject text not null,
        access_token text not null,
        refresh_token text,
        expires_at timestamptz,
        scope text,
        workspace_id text,
        workspace_name text,
        bot_id text,
        raw jsonb,
        created_at timestamptz default now(),
        updated_at timestamptz default now(),
        primary key (provider, subject)
      );
    `);
  }
  async upsertToken(record: TokenRecord) {
    await this.pool.query(
      `insert into oauth_tokens
        (provider, subject, access_token, refresh_token, expires_at, scope, workspace_id, workspace_name, bot_id, raw)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (provider, subject) do update set
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         workspace_id = excluded.workspace_id,
         workspace_name = excluded.workspace_name,
         bot_id = excluded.bot_id,
         raw = excluded.raw,
         updated_at = now()`,
      [
        record.provider,
        record.subject,
        record.access_token,
        record.refresh_token ?? null,
        record.expires_at ? new Date(record.expires_at) : null,
        record.scope ?? null,
        record.workspace_id ?? null,
        record.workspace_name ?? null,
        record.bot_id ?? null,
        record.raw ?? null
      ]
    );
  }
  async getToken(provider: Provider, subject = 'default') {
    const { rows } = await this.pool.query(
      `select provider, subject, access_token, refresh_token,
              case when expires_at is null then null else to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end as expires_at,
              scope, workspace_id, workspace_name, bot_id, raw,
              to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
       from oauth_tokens where provider=$1 and subject=$2`,
      [provider, subject]
    );
    return rows[0] || null;
  }
}
