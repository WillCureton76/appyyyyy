import 'dotenv/config';

function bool(v?: string, def=false) {
  if (v === undefined) return def;
  const s = v.toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  sharedSecret: process.env.SHARED_SECRET || '',
  enableDnsRebindingProtection: bool(process.env.ENABLE_DNS_REBINDING_PROTECTION, false),
  allowedHosts: (process.env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL || '',
  notion: {
    clientId: process.env.NOTION_CLIENT_ID || '',
    clientSecret: process.env.NOTION_CLIENT_SECRET || '',
    redirectUri: process.env.NOTION_REDIRECT_URI || '',
    staticToken: process.env.NOTION_STATIC_TOKEN || '',
    usePkce: bool(process.env.NOTION_USE_PKCE, false)
  }
};
