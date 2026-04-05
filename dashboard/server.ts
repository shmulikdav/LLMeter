#!/usr/bin/env node

/**
 * llm-cost-meter Dashboard Server
 *
 * Usage:
 *   node dist/dashboard/server.js [--port 3000] [--file ./.llm-costs/events.ndjson]
 *   npm run dashboard
 *
 * Then open http://localhost:3000 in your browser.
 * Share the URL with your team — no login required.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PORT = parseInt(getArg('--port', '3000'), 10);
const EVENTS_FILE = getArg('--file', './.llm-costs/demo-events.ndjson');

// Resolve dashboard HTML location — works from both src/ and dist/
function findDashboardDir(): string {
  const candidates = [
    path.join(__dirname, '..', 'dashboard'),  // from dist/dashboard/server.js
    __dirname,                                  // from dashboard/server.ts via ts-node
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return __dirname;
}

const DASHBOARD_DIR = findDashboardDir();

function loadEvents(): any[] {
  const filePath = path.resolve(process.cwd(), EVENTS_FILE);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: Events file not found at ${filePath}`);
    console.warn('Run "npm run demo" first to generate sample data.\n');
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // API: return events as JSON
  if (url.pathname === '/api/events') {
    const events = loadEvents();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(events));
    return;
  }

  // Serve static files from dashboard/
  const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = path.join(DASHBOARD_DIR, filePath);
  const ext = path.extname(fullPath);

  if (!fs.existsSync(fullPath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const content = fs.readFileSync(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
  res.end(content);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │                                                  │');
  console.log('  │   llm-cost-meter Dashboard                       │');
  console.log(`  │   http://localhost:${String(PORT).padEnd(37)}│`);
  console.log('  │                                                  │');
  console.log(`  │   Events: ${EVENTS_FILE.padEnd(39)}│`);
  console.log('  │   Share this URL with your team.                 │');
  console.log('  │                                                  │');
  console.log('  └──────────────────────────────────────────────────┘');
  console.log('');
});
