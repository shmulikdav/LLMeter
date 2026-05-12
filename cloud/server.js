#!/usr/bin/env node

/**
 * llm-cost-meter Cloud API
 *
 * Minimal cloud backend that receives events from CloudAdapter,
 * stores them, and serves them to the cloud dashboard.
 *
 * Usage:
 *   node server.js [--port 4000] [--data-dir ./data]
 *
 * Environment variables:
 *   PORT          — server port (default: 4000)
 *   DATA_DIR      — directory for event storage (default: ./data)
 *   ADMIN_KEY     — admin API key for creating workspace keys
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '4000', 10);
const DATA_DIR = process.env.DATA_DIR || './data';
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin_' + crypto.randomBytes(16).toString('hex');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(DATA_DIR, 'keys.json'))) {
  fs.writeFileSync(path.join(DATA_DIR, 'keys.json'), '{}');
}

// ── Key Management ──────────────────────────────────────────────

function loadKeys() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'keys.json'), 'utf-8'));
}

function saveKeys(keys) {
  fs.writeFileSync(path.join(DATA_DIR, 'keys.json'), JSON.stringify(keys, null, 2));
}

function validateApiKey(key) {
  if (!key) return null;
  const keys = loadKeys();
  return keys[key] || null;
}

function generateApiKey(workspaceName, plan) {
  const key = 'lm_live_' + crypto.randomBytes(20).toString('hex');
  const keys = loadKeys();
  keys[key] = {
    workspace: workspaceName,
    plan: plan || 'free',
    createdAt: new Date().toISOString(),
    eventsThisMonth: 0,
    monthReset: new Date().toISOString().substring(0, 7),
  };
  saveKeys(keys);
  return key;
}

// ── Event Storage ───────────────────────────────────────────────

function getEventsFile(workspace) {
  const safe = workspace.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safe}.ndjson`);
}

function storeEvents(workspace, events) {
  const file = getEventsFile(workspace);
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(file, lines);
}

function readEvents(workspace, options = {}) {
  const file = getEventsFile(workspace);
  if (!fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, 'utf-8');
  let events = content
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  // Apply filters
  if (options.feature) events = events.filter((e) => e.feature === options.feature);
  if (options.userId) events = events.filter((e) => e.userId === options.userId);
  if (options.from) {
    const d = new Date(options.from);
    events = events.filter((e) => new Date(e.timestamp) >= d);
  }
  if (options.to) {
    const d = new Date(options.to);
    d.setHours(23, 59, 59, 999);
    events = events.filter((e) => new Date(e.timestamp) <= d);
  }

  // Limit
  if (options.limit) events = events.slice(-options.limit);

  return events;
}

// ── Plan Limits ─────────────────────────────────────────────────

const PLAN_LIMITS = {
  free: { eventsPerMonth: 1000, retentionDays: 7 },
  pro: { eventsPerMonth: 100000, retentionDays: 90 },
  team: { eventsPerMonth: 1000000, retentionDays: 365 },
};

function checkPlanLimit(keyData, eventCount) {
  const currentMonth = new Date().toISOString().substring(0, 7);
  if (keyData.monthReset !== currentMonth) {
    keyData.eventsThisMonth = 0;
    keyData.monthReset = currentMonth;
  }

  const limits = PLAN_LIMITS[keyData.plan] || PLAN_LIMITS.free;
  if (keyData.eventsThisMonth + eventCount > limits.eventsPerMonth) {
    return { allowed: false, limit: limits.eventsPerMonth, used: keyData.eventsThisMonth };
  }

  keyData.eventsThisMonth += eventCount;
  return { allowed: true };
}

// ── HTTP Helpers ────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Source',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

// ── Server ──────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    json(res, 204, null);
    return;
  }

  // ── POST /v1/events — Ingest events from CloudAdapter ──
  if (req.method === 'POST' && url.pathname === '/v1/events') {
    const authHeader = req.headers.authorization || '';
    const apiKey = authHeader.replace('Bearer ', '');
    const keyData = validateApiKey(apiKey);

    if (!keyData) {
      json(res, 401, { error: 'Invalid API key' });
      return;
    }

    try {
      const body = JSON.parse(await readBody(req));
      const events = body.events || [];

      if (events.length === 0) {
        json(res, 400, { error: 'No events provided' });
        return;
      }

      // Check plan limits
      const limitCheck = checkPlanLimit(keyData, events.length);
      if (!limitCheck.allowed) {
        json(res, 429, {
          error: 'Monthly event limit exceeded',
          limit: limitCheck.limit,
          used: limitCheck.used,
          upgrade: 'Visit app.llmeter.dev to upgrade your plan',
        });
        return;
      }

      // Store events
      storeEvents(keyData.workspace, events);

      // Update key usage
      const keys = loadKeys();
      keys[apiKey] = keyData;
      saveKeys(keys);

      json(res, 200, { received: events.length, workspace: keyData.workspace });
    } catch (err) {
      json(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── GET /v1/events — Read events (for cloud dashboard) ──
  if (req.method === 'GET' && url.pathname === '/v1/events') {
    const authHeader = req.headers.authorization || '';
    const apiKey = authHeader.replace('Bearer ', '');
    const keyData = validateApiKey(apiKey);

    if (!keyData) {
      json(res, 401, { error: 'Invalid API key' });
      return;
    }

    const events = readEvents(keyData.workspace, {
      feature: url.searchParams.get('feature'),
      userId: url.searchParams.get('userId'),
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      limit: parseInt(url.searchParams.get('limit') || '10000', 10),
    });

    json(res, 200, { events, count: events.length, workspace: keyData.workspace });
    return;
  }

  // ── POST /v1/keys — Create API key (admin only) ──
  if (req.method === 'POST' && url.pathname === '/v1/keys') {
    const authHeader = req.headers.authorization || '';
    const adminKey = authHeader.replace('Bearer ', '');

    if (adminKey !== ADMIN_KEY) {
      json(res, 403, { error: 'Admin key required' });
      return;
    }

    try {
      const body = JSON.parse(await readBody(req));
      const workspace = body.workspace || 'default';
      const plan = body.plan || 'free';
      const key = generateApiKey(workspace, plan);
      json(res, 201, { apiKey: key, workspace, plan });
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // ── GET /v1/status — Health check ──
  if (req.method === 'GET' && url.pathname === '/v1/status') {
    const keys = loadKeys();
    json(res, 200, {
      status: 'ok',
      version: '0.1.0',
      workspaces: Object.values(keys).map((k) => k.workspace).filter((v, i, a) => a.indexOf(v) === i).length,
      totalKeys: Object.keys(keys).length,
    });
    return;
  }

  // 404
  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────┐');
  console.log('  │                                                      │');
  console.log('  │   llm-cost-meter Cloud API                           │');
  console.log(`  │   http://localhost:${String(PORT).padEnd(41)}│`);
  console.log('  │                                                      │');
  console.log(`  │   Admin key: ${ADMIN_KEY.substring(0, 20)}...${' '.repeat(17)}│`);
  console.log(`  │   Data dir:  ${DATA_DIR.padEnd(40)}│`);
  console.log('  │                                                      │');
  console.log('  │   Create a key:                                      │');
  console.log(`  │   curl -X POST http://localhost:${PORT}/v1/keys \\${' '.repeat(9)}│`);
  console.log('  │     -H "Authorization: Bearer $ADMIN_KEY" \\          │');
  console.log('  │     -d \'{"workspace":"my-app","plan":"free"}\'         │');
  console.log('  │                                                      │');
  console.log('  └──────────────────────────────────────────────────────┘');
  console.log('');
});
