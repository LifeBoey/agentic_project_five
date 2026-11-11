// Risk API + static viewer on one port. links.json is re-read per request so new data batches show without a restart.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { loadLinks, getModels, getModelRisk, getChain, simulateCutoff } from './risk.js';
import { ask } from './agent.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const MAX_QUESTION = 500;

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error('body too large');
  }
  return JSON.parse(body || '{}');
}

async function askRoute(req, res, links) {
  let question;
  try { ({ question } = await readJson(req)); } catch { return send(res, 400, { error: 'invalid JSON body' }); }
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION) {
    return send(res, 400, { error: `question must be a non-empty string up to ${MAX_QUESTION} characters` });
  }
  try {
    return send(res, 200, await ask(question, { links, client: new Anthropic() }));
  } catch (e) {
    // The SDK reports missing credentials as a plain Error with no typed class, so match its message.
    const noCredentials = !(e instanceof Anthropic.APIError) && /resolve authentication method/i.test(e?.message);
    if (noCredentials || e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return send(res, 503, { error: 'query agent not configured' });
    }
    console.error(e);
    return send(res, 502, { error: 'query agent failed' });
  }
}

async function serveStatic(res, pathname) {
  const file = normalize(join(ROOT, 'web', pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!file.startsWith(join(ROOT, 'web') + sep)) return send(res, 404, { error: 'not found' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch { send(res, 404, { error: 'not found' }); }
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api') {
    if (url.pathname === '/') { res.writeHead(302, { location: '/web/' }); return res.end(); }
    return serveStatic(res, url.pathname.replace(/^\/web/, '') || '/');
  }

  let links;
  try { links = await loadLinks(); } catch (e) { return send(res, 500, { error: `links.json unreadable: ${e.message}` }); }
  const [, a, m, b, c] = parts;
  const found = v => (v == null ? send(res, 404, { error: 'not found' }) : send(res, 200, v));

  if (req.method === 'POST' && a === 'ask' && parts.length === 2) return askRoute(req, res, links);
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  if (a === 'models' && parts.length === 2) return send(res, 200, getModels(links));
  if (a === 'models' && b === 'risk' && parts.length === 4) return found(getModelRisk(links, m));
  if (a === 'models' && b === 'chain' && parts.length === 5) return found(getChain(links, m, c));
  if (a === 'cutoff' && parts.length === 3) return send(res, 200, simulateCutoff(links, m));
  return send(res, 404, { error: 'not found' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3001;
  createServer((req, res) => handle(req, res).catch(e => { console.error(e); send(res, 500, { error: 'internal error' }); }))
    .listen(port, () => console.log(`Drone dependency map on http://localhost:${port}`));
}
