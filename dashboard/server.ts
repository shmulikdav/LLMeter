#!/usr/bin/env npx ts-node

/**
 * llm-cost-meter Dashboard Server
 *
 * Usage:
 *   npx ts-node dashboard/server.ts [--port 3000] [--file ./.llm-costs/demo-events.ndjson]
 *
 * Then open http://localhost:3000 in your browser.
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
const DASHBOARD_DIR = path.join(__dirname);

function loadEvents(): any[] {
  const filePath = path.resolve(process.cwd(), EVENTS_FILE);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: Events file not found at ${filePath}`);
    console.warn('Run "npx ts-node demo.ts" first to generate sample data.\n');
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
};

const server = http.createServer((req, res) => {
  // API: return events as JSON
  if (req.url === '/api/events') {
    const events = loadEvents();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(events));
    return;
  }

  // Serve static files from dashboard/
  let filePath = req.url === '/' ? '/index.html' : req.url!;
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
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │                                              │');
  console.log('  │   llm-cost-meter Dashboard                   │');
  console.log(`  │   http://localhost:${PORT}                      │`);
  console.log('  │                                              │');
  console.log(`  │   Events: ${EVENTS_FILE.padEnd(35)}│`);
  console.log('  │                                              │');
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
});
