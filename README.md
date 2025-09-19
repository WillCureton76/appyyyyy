# MCP Tool Hub – Hardened Hybrid (Railway-ready)

**Base:** Official MCP TypeScript SDK (Streamable HTTP + SSE).  
**Patterns:** Provider/Registry, multi-tenant tokens, usage analytics.  
**Hardened:** optional shared-secret, DNS rebinding protection, retry/backoff, optional PKCE.

## What’s new vs. Hybrid 0.2
- Optional **shared-secret** for /mcp, /sse, /messages (`X-MCP-KEY`).
- **DNS rebinding protection** knobs (ENABLE_DNS_REBINDING_PROTECTION, ALLOWED_HOSTS).
- **httpWithRetry** wrapper (exponential backoff + Retry-After).
- **PKCE scaffolding** (disabled by default; Notion may not support — enable only if your provider does).
- **Compression** middleware.

## Quick start
```bash
cp .env.example .env
# Fill NOTION_* and DATABASE_URL (Railway Postgres)
npm i
npm run dev
# http://localhost:8080/health
# http://localhost:8080/auth/notion  -> complete consent
```

## Deploy to Railway
- Add **Postgres** and set `DATABASE_URL`
- Set `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REDIRECT_URI`
- (Optional) `NOTION_STATIC_TOKEN` for single-user testing
- (Optional) `SHARED_SECRET` to require `X-MCP-KEY` header on MCP endpoints
- (Optional) `ENABLE_DNS_REBINDING_PROTECTION=true` and `ALLOWED_HOSTS=your.domain,localhost`

## Endpoints
- **MCP (Streamable HTTP):** `POST/GET/DELETE /mcp`
- **MCP (SSE legacy):** `GET /sse`, `POST /messages`
- **OAuth start:** `GET /auth/notion`
- **Health:** `GET /health`
- **Providers:** `GET /providers`
- **Stats:** `GET /stats`

## Tools (Notion)
- `notion.getSelf({ subject? })`
- `notion.search({ subject?, query, filter?, sort?, start_cursor?, page_size? })`
- `notion.fetchPage({ subject?, page_id })`
- `notion.queryDatabase({ subject?, database_id, filter?, sorts?, start_cursor?, page_size? })`
- `notion.createPage({ subject?, parent, properties, children? })`

## Notes
- PKCE is **optional** and provider-dependent. This server supports it, but Notion’s OAuth may prefer client-secret + Basic auth. Enable `NOTION_USE_PKCE=true` only if you confirm support.
- Streamable HTTP is recommended; SSE kept for compatibility.

MIT license – adapt as you like.
