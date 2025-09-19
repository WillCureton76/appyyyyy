export async function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function httpWithRetry(
  method: string,
  url: string,
  headers: Record<string,string>,
  body?: any,
  opts: RetryOptions = {}
) {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 300;
  const maxDelay = opts.maxDelayMs ?? 3000;

  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

      // Handle retryable statuses
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
        const ra = res.headers.get('retry-after');
        let delay = ra ? parseInt(ra, 10) * 1000 : Math.min(maxDelay, baseDelay * Math.pow(2, attempt) + Math.floor(Math.random()*100));
        await sleep(delay);
        continue;
      }
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt) + Math.floor(Math.random()*100));
        await sleep(delay);
        continue;
      }
      return { ok: false, status: 0, json: { error: String(lastErr) } };
    }
  }
  return { ok: false, status: 0, json: { error: String(lastErr) } };
}
