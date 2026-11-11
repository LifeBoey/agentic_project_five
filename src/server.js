// Risk API + static viewer on one port. links.json is re-read per request so new data batches show without a restart.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
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

let client;

async function askRoute(req, res, links) {
  let question;
  try { ({ question } = await readJson(req)); } catch { return send(res, 400, { error: 'invalid JSON body' }); }
  if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION) {
    return send(res, 400, { error: `question must be a non-empty string up to ${MAX_QUESTION} characters` });
  }
  try {
    // Created on first use, after .env is loaded, and reused so requests share one connection.
    client ??= new Anthropic();
    return send(res, 200, await ask(question, { links, client }));
  } catch (e) {
    // shortcut: the SDK (1.8.0) reports missing credentials as a plain Error with no typed class, so match its
    // message; switch to a typed check if the SDK adds one. A pre-check on env vars would miss profile-based auth.
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
  try { links = await loadLinks(); } catch (e) { return send(res, 500, { error: `links.json rejected: ${e.message}` }); }
  // /api/<resource>/<name>/<view>/<component>, e.g. /api/models/Falcon X/chain/motors or /api/cutoff/CN
  const [, resource, name, view, component] = parts;
  const found = v => (v == null ? send(res, 404, { error: 'not found' }) : send(res, 200, v));

  if (req.method === 'POST' && resource === 'ask' && parts.length === 2) return askRoute(req, res, links);
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  if (resource === 'models' && parts.length === 2) return send(res, 200, getModels(links));
  if (resource === 'models' && view === 'risk' && parts.length === 4) return found(getModelRisk(links, name));
  if (resource === 'models' && view === 'chain' && parts.length === 5) return found(getChain(links, name, component));
  if (resource === 'cutoff' && parts.length === 3) return send(res, 200, simulateCutoff(links, name));
  return send(res, 404, { error: 'not found' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // .env overrides the shell on purpose: some shells (e.g. Claude Code) already set ANTHROPIC_BASE_URL,
  // and node --env-file would silently keep that one.
  try {
    Object.assign(process.env, parseEnv(readFileSync(join(ROOT, '.env'), 'utf8')));
    console.log('Loaded .env');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const port = Number(process.env.PORT) || 3001;
  createServer((req, res) => handle(req, res).catch(e => { console.error(e); send(res, 500, { error: 'internal error' }); }))
    .listen(port, () => console.log(`Drone dependency map on http://localhost:${port}`));
}
