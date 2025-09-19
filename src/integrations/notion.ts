import type { TokenStore, TokenRecord } from "../storage/tokenStore.js";
import type { UsageStore } from "../storage/usageStore.js";
import { Provider } from "../core/provider.js";
import { z } from "zod";
import express from "express";
import { httpWithRetry } from "../utils/http.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  staticToken?: string;
  usePkce?: boolean;
}

function basicAuthHeader(id: string, secret: string) {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function notionFetch(token: string, endpoint: string, method: string = "GET", data?: any) {
  const headers: Record<string,string> = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };
  return httpWithRetry(method, `${NOTION_API}/${endpoint}`, headers, data, { retries: 3 });
}

export class NotionProvider extends Provider {
  private cfg: NotionConfig;
  private store: TokenStore;
  private pkceByState = new Map<string, string>(); // state -> code_verifier

  constructor(cfg: NotionConfig, store: TokenStore, usage?: UsageStore) {
    super("notion", usage);
    this.cfg = cfg;
    this.store = store;

    const subjectField = z.object({ subject: z.string().optional() }).partial();

    this.registerTool({
      name: "getSelf",
      title: "Notion: Get Bot User",
      description: "Returns the bot user and workspace for the current token.",
      inputSchema: subjectField,
      handler: async (args) => {
        const { token, rec } = await this.getAccessToken(args.subject);
        let res = await notionFetch(token, "users/me", "GET");
        if (!res.ok && res.status === 401 && rec?.refresh_token) {
          const r = await this.refresh(rec.refresh_token);
          await this.upsertFromRefresh(rec, r);
          res = await notionFetch(r.access_token, "users/me", "GET");
        }
        if (!res.ok) throw new Error("getSelf failed: " + JSON.stringify(res.json));
        return { content: [{ type: "text", text: JSON.stringify(res.json, null, 2) }] };
      }
    });

    this.registerTool({
      name: "search",
      title: "Notion: Search",
      description: "Search your Notion workspace",
      inputSchema: z.object({
        subject: z.string().optional(),
        query: z.string().default(""),
        filter: z.any().optional(),
        sort: z.any().optional(),
        start_cursor: z.string().optional(),
        page_size: z.number().int().min(1).max(100).default(25)
      }),
      handler: async (args) => {
        const { token, rec } = await this.getAccessToken(args.subject);
        const body: any = { query: args.query, page_size: args.page_size };
        if (args.filter) body.filter = args.filter;
        if (args.sort) body.sort = args.sort;
        if (args.start_cursor) body.start_cursor = args.start_cursor;
        let res = await notionFetch(token, "search", "POST", body);
        if (!res.ok && res.status === 401 && rec?.refresh_token) {
          const r = await this.refresh(rec.refresh_token);
          await this.upsertFromRefresh(rec, r);
          res = await notionFetch(r.access_token, "search", "POST", body);
        }
        if (!res.ok) throw new Error("search failed: " + JSON.stringify(res.json));
        return { content: [{ type: "text", text: JSON.stringify(res.json, null, 2) }] };
      }
    });

    this.registerTool({
      name: "fetchPage",
      title: "Notion: Fetch Page",
      description: "Fetch page metadata by ID",
      inputSchema: z.object({ subject: z.string().optional(), page_id: z.string() }),
      handler: async (args) => {
        const { token, rec } = await this.getAccessToken(args.subject);
        let res = await notionFetch(token, `pages/${args.page_id}`, "GET");
        if (!res.ok && res.status === 401 && rec?.refresh_token) {
          const r = await this.refresh(rec.refresh_token);
          await this.upsertFromRefresh(rec, r);
          res = await notionFetch(r.access_token, `pages/${args.page_id}`, "GET");
        }
        if (!res.ok) throw new Error("fetchPage failed: " + JSON.stringify(res.json));
        return { content: [{ type: "text", text: JSON.stringify(res.json, null, 2) }] };
      }
    });

    this.registerTool({
      name: "queryDatabase",
      title: "Notion: Query Database",
      description: "Query a database with optional filter/sort",
      inputSchema: z.object({
        subject: z.string().optional(),
        database_id: z.string(),
        filter: z.any().optional(),
        sorts: z.any().optional(),
        start_cursor: z.string().optional(),
        page_size: z.number().int().min(1).max(100).default(25)
      }),
      handler: async (args) => {
        const { token, rec } = await this.getAccessToken(args.subject);
        const body: any = { page_size: args.page_size };
        if (args.filter) body.filter = args.filter;
        if (args.sorts) body.sorts = args.sorts;
        if (args.start_cursor) body.start_cursor = args.start_cursor;
        let res = await notionFetch(token, `databases/${args.database_id}/query`, "POST", body);
        if (!res.ok && res.status === 401 && rec?.refresh_token) {
          const r = await this.refresh(rec.refresh_token);
          await this.upsertFromRefresh(rec, r);
          res = await notionFetch(r.access_token, `databases/${args.database_id}/query`, "POST", body);
        }
        if (!res.ok) throw new Error("queryDatabase failed: " + JSON.stringify(res.json));
        return { content: [{ type: "text", text: JSON.stringify(res.json, null, 2) }] };
      }
    });

    this.registerTool({
      name: "createPage",
      title: "Notion: Create Page",
      description: "Create a new page (supply a parent and properties).",
      inputSchema: z.object({
        subject: z.string().optional(),
        parent: z.any(),
        properties: z.record(z.any()),
        children: z.array(z.any()).optional()
      }),
      handler: async (args) => {
        const { token, rec } = await this.getAccessToken(args.subject);
        const body: any = { parent: args.parent, properties: args.properties };
        if (args.children) body.children = args.children;
        let res = await notionFetch(token, `pages`, "POST", body);
        if (!res.ok && res.status === 401 && rec?.refresh_token) {
          const r = await this.refresh(rec.refresh_token);
          await this.upsertFromRefresh(rec, r);
          res = await notionFetch(r.access_token, `pages`, "POST", body);
        }
        if (!res.ok) throw new Error("createPage failed: " + JSON.stringify(res.json));
        return { content: [{ type: "text", text: JSON.stringify(res.json, null, 2) }] };
      }
    });
  }

  mountOAuth(app: express.Express) {
    app.get("/auth/notion", (_req, res) => {
      if (this.cfg.staticToken) return res.status(200).send("Static token mode enabled; OAuth not required.");
      if (!this.cfg.clientId || !this.cfg.redirectUri) {
        return res.status(400).send("Notion OAuth not configured. Set NOTION_CLIENT_ID and NOTION_REDIRECT_URI.");
      }
      const state = Math.random().toString(36).slice(2);
      const url = new URL("https://api.notion.com/v1/oauth/authorize");
      url.searchParams.set("client_id", this.cfg.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("owner", "user");
      url.searchParams.set("redirect_uri", this.cfg.redirectUri);
      url.searchParams.set("state", state);
      if (this.cfg.usePkce) {
        const code_verifier = [...Array(64)].map(()=>Math.random().toString(36)[2]).join('');
        const enc = new TextEncoder();
        // S256 challenge
        // @ts-ignore
        const cryptoObj = globalThis.crypto || (await import('node:crypto')).webcrypto;
        // @ts-ignore
        const digest = await cryptoObj.subtle.digest('SHA-256', enc.encode(code_verifier));
        const base64url = Buffer.from(new Uint8Array(digest)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("code_challenge", base64url);
        this.pkceByState.set(state, code_verifier);
      }
      res.redirect(url.toString());
    });

    app.get("/oauth/notion/callback", async (req, res) => {
      const code = (req.query.code as string) || "";
      const state = (req.query.state as string) || "";
      if (!code) return res.status(400).send("Missing code");
      try {
        const headers: Record<string,string> = {
          "Accept": "application/json",
          "Content-Type": "application/json"
        };
        let body: any = { grant_type: "authorization_code", code, redirect_uri: this.cfg.redirectUri };
        if (this.cfg.usePkce) {
          const verifier = this.pkceByState.get(state);
          if (!verifier) return res.status(400).send("Missing PKCE verifier for state");
          body.code_verifier = verifier;
        } else {
          headers["Authorization"] = basicAuthHeader(this.cfg.clientId, this.cfg.clientSecret);
        }
        const { ok, status, json } = await httpWithRetry("POST", `${NOTION_API}/oauth/token`, headers, body, { retries: 1 });
        if (!ok) throw new Error(`Notion token exchange failed (${status}): ${JSON.stringify(json)}`);
        const subject = json.workspace_id || "default";
        const rec: TokenRecord = {
          provider: "notion",
          subject,
          access_token: json.access_token,
          refresh_token: json.refresh_token,
          scope: Array.isArray(json.scope) ? json.scope.join(" ") : (json.scope || null),
          workspace_id: json.workspace_id,
          workspace_name: json.workspace_name,
          bot_id: json.bot_id,
          raw: json
        };
        await this.store.upsertToken(rec);
        res.status(200).send("✅ Notion authorized. You can close this tab.");
      } catch (e: any) {
        res.status(500).send("❌ Notion OAuth failed: " + e.message);
      } finally {
        if (state) this.pkceByState.delete(state);
      }
    });
  }

  private async getAccessToken(subject?: string): Promise<{ token: string, rec: TokenRecord | null }> {
    if (this.cfg.staticToken) return { token: this.cfg.staticToken, rec: null };
    const s = subject || "default";
    const rec = await this.store.getToken("notion", s);
    if (!rec) throw new Error(`No Notion token for subject '${s}'. Visit /auth/notion or set NOTION_STATIC_TOKEN.`);
    return { token: rec.access_token, rec };
  }

  private async upsertFromRefresh(old: TokenRecord, refreshed: any) {
    const rec: TokenRecord = {
      provider: "notion",
      subject: old.subject,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? old.refresh_token,
      scope: Array.isArray(refreshed.scope) ? refreshed.scope.join(" ") : (refreshed.scope || old.scope || null),
      workspace_id: refreshed.workspace_id ?? old.workspace_id,
      workspace_name: refreshed.workspace_name ?? old.workspace_name,
      bot_id: refreshed.bot_id ?? old.bot_id,
      raw: refreshed
    };
    await this.store.upsertToken(rec);
  }

  private async refresh(refresh_token: string) {
    const headers: Record<string,string> = {
      "Accept": "application/json",
      "Content-Type": "application/json"
    };
    let body: any = { grant_type: "refresh_token", refresh_token };
    if (!this.cfg.usePkce) {
      headers["Authorization"] = basicAuthHeader(this.cfg.clientId, this.cfg.clientSecret);
    }
    const { ok, status, json } = await httpWithRetry("POST", `${NOTION_API}/oauth/token`, headers, body, { retries: 1 });
    if (!ok) throw new Error(`Notion refresh failed (${status}): ${JSON.stringify(json)}`);
    return json;
  }
}
