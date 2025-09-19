import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { InMemoryTokenStore, PostgresTokenStore, TokenStore } from './storage/tokenStore.js';
import { InMemoryUsageStore, PostgresUsageStore, UsageStore } from './storage/usageStore.js';
import { ProviderRegistry } from './core/registry.js';
import { NotionProvider } from './integrations/notion.js';

const app = express();
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: config.corsOrigin,
  exposedHeaders: ['Mcp-Session-Id'],
  allowedHeaders: ['Content-Type', 'mcp-session-id', 'x-mcp-key']
}));

// Optional shared-secret auth for all MCP endpoints
function requireSharedSecret(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!config.sharedSecret) return next();
  const provided = (req.headers['x-mcp-key'] as string) || '';
  if (provided !== config.sharedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---- Storage ----
let tokenStore: TokenStore;
let usageStore: UsageStore;
if (config.databaseUrl) {
  const pgToken = new PostgresTokenStore(config.databaseUrl);
  await pgToken.init?.();
  tokenStore = pgToken;
  const pgUsage = new PostgresUsageStore(config.databaseUrl);
  await pgUsage.init?.();
  usageStore = pgUsage;
  logger.info('Using Postgres stores');
} else {
  tokenStore = new InMemoryTokenStore();
  usageStore = new InMemoryUsageStore();
  logger.warn('Using in-memory stores (not persistent). Set DATABASE_URL to persist.');
}

// ---- Providers ----
const registry = new ProviderRegistry();
const notion = new NotionProvider({
  clientId: config.notion.clientId,
  clientSecret: config.notion.clientSecret,
  redirectUri: config.notion.redirectUri,
  staticToken: config.notion.staticToken || undefined,
  usePkce: config.notion.usePkce
}, tokenStore, usageStore);
registry.add(notion);

// OAuth mounts
registry.mountAllOAuth(app);

// ---- MCP server ----
function buildServer() {
  const server = new McpServer({ name: 'mcp-tool-hub-hardened', version: '0.3.0' });
  registry.registerAll(server);
  return server;
}

// ---- Streamable HTTP transport (preferred) ----
const transports: Record<string, StreamableHTTPServerTransport> = {};
app.post('/mcp', requireSharedSecret, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport | undefined;
  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else {
    const isInitialize = req.body?.method === 'initialize';
    if (!isInitialize) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport!;
        res.setHeader('Mcp-Session-Id', sid);
      },
      enableDnsRebindingProtection: config.enableDnsRebindingProtection,
      allowedHosts: config.allowedHosts.length ? config.allowedHosts : undefined,
    });
    const server = buildServer();
    await server.connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
});
async function handleSessionRequest(req: express.Request, res: express.Response) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
}
app.get('/mcp', requireSharedSecret, handleSessionRequest);
app.delete('/mcp', requireSharedSecret, handleSessionRequest);

// ---- Legacy SSE transport ----
const sseTransports: Record<string, SSEServerTransport> = {};
app.get('/sse', requireSharedSecret, async (_req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  sseTransports[transport.sessionId] = transport;
  res.on('close', () => { delete sseTransports[transport.sessionId]; });
  const server = buildServer();
  await server.connect(transport);
});
app.post('/messages', requireSharedSecret, async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

// ---- Utility routes ----
app.get('/providers', (_req, res) => {
  res.json({
    providers: registry.list().map(p => p.constructor.name),
    tools: registry.listTools().map(t => t.name)
  });
});
app.get('/stats', async (_req, res) => {
  res.json(await usageStore.stats());
});
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---- Start ----
app.listen(config.port, () => {
  console.log(`MCP Tool Hub Hardened listening on :${config.port}`);
  console.log(` - Streamable HTTP: POST/GET/DELETE /mcp`);
  console.log(` - Legacy SSE: GET /sse  + POST /messages`);
  console.log(` - Notion OAuth start: GET /auth/notion`);
  if (config.sharedSecret) console.log(' - Shared-secret auth enforced for MCP endpoints');
});
