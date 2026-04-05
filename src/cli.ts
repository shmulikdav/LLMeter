#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as readline from 'readline';
import chalk from 'chalk';
import Table from 'cli-table3';
import { CostEvent, ReportOptions } from './types';
import { filterEvents, summarize, generateInsight } from './reporters/summary';
import { summaryToCsv } from './reporters/csv';
import { summaryToJson } from './reporters/json';

const DEFAULT_FILE = './.llm-costs/events.ndjson';

async function loadEvents(filePath: string): Promise<CostEvent[]> {
  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`File not found: ${filePath}`));
    console.error(
      chalk.gray('Run your app with llm-cost-meter to generate events, or use --file to specify a path.')
    );
    process.exit(1);
  }

  const events: CostEvent[] = [];
  let malformed = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformed++;
    }
  }

  if (malformed > 0) {
    console.error(
      chalk.yellow(`Warning: Skipped ${malformed} malformed line${malformed > 1 ? 's' : ''} in ${filePath}`)
    );
  }

  if (events.length === 0) {
    console.error(chalk.yellow(`No valid events found in ${filePath}`));
    process.exit(1);
  }

  return events;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(n: number): string {
  if (n < 0.01) {
    return `$${n.toFixed(5)}`;
  }
  return `$${n.toFixed(2)}`;
}

function printTable(options: ReportOptions, events: CostEvent[]): void {
  const groupBy = options.groupBy ?? 'feature';
  const filtered = filterEvents(events, options);

  if (filtered.length === 0) {
    console.log(chalk.yellow('No events found matching the given filters.'));
    return;
  }

  let rows = summarize(filtered, groupBy);

  if (options.top) {
    rows = rows.slice(0, options.top);
  }

  const timestamps = filtered.map((e) => e.timestamp).sort();
  const fromDate = timestamps[0]?.substring(0, 10) ?? '';
  const toDate = timestamps[timestamps.length - 1]?.substring(0, 10) ?? '';

  console.log('');
  console.log(chalk.bold(`llm-cost-meter report — ${fromDate} to ${toDate}`));
  console.log(
    chalk.gray(`Source: ${options.file ?? DEFAULT_FILE} (${formatNumber(filtered.length)} events)`)
  );
  console.log('');
  console.log(chalk.bold(`By ${groupBy}:`));

  const table = new Table({
    head: [
      chalk.white(groupBy.charAt(0).toUpperCase() + groupBy.slice(1)),
      chalk.white('Calls'),
      chalk.white('Total Tokens'),
      chalk.white('Avg Cost/Call'),
      chalk.white('Total Cost'),
    ],
    style: { head: [], border: [] },
  });

  let totalCalls = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const row of rows) {
    totalCalls += row.calls;
    totalTokens += row.totalTokens;
    totalCost += row.totalCost;

    table.push([
      row.key,
      formatNumber(row.calls),
      formatNumber(row.totalTokens),
      formatCost(row.avgCostPerCall),
      formatCost(row.totalCost),
    ]);
  }

  table.push([
    chalk.bold('TOTAL'),
    chalk.bold(formatNumber(totalCalls)),
    chalk.bold(formatNumber(totalTokens)),
    chalk.gray('—'),
    chalk.bold(formatCost(totalCost)),
  ]);

  console.log(table.toString());

  const insight = generateInsight(rows);
  if (insight) {
    console.log('');
    console.log(chalk.cyan(`Insight: ${insight}`));
  }
  console.log('');
}

const program = new Command();

program
  .name('llm-cost-meter')
  .description('Per-feature, per-user cost attribution and reporting for LLM API calls')
  .version('0.1.0');

program
  .command('report')
  .description('Generate a cost report from tracked LLM events')
  .option(
    '--group-by <dimension>',
    'Group results by dimension (feature, userId, model, env, provider, sessionId)',
    'feature'
  )
  .option('--feature <name>', 'Filter by feature name')
  .option('--env <environment>', 'Filter by environment')
  .option('--user <userId>', 'Filter by user ID')
  .option('--from <date>', 'Filter events from date (YYYY-MM-DD)')
  .option('--to <date>', 'Filter events to date (YYYY-MM-DD)')
  .option('--top <n>', 'Show top N results', parseInt)
  .option('--format <type>', 'Output format: table, csv, json', 'table')
  .option('--file <path>', 'Path to events NDJSON file', DEFAULT_FILE)
  .action(async (opts) => {
    const reportOptions: ReportOptions = {
      groupBy: opts.groupBy,
      feature: opts.feature,
      env: opts.env,
      userId: opts.user,
      from: opts.from,
      to: opts.to,
      top: opts.top,
      format: opts.format as 'table' | 'csv' | 'json',
      file: opts.file,
    };

    const events = await loadEvents(opts.file);

    switch (reportOptions.format) {
      case 'csv': {
        const filtered = filterEvents(events, reportOptions);
        let rows = summarize(filtered, reportOptions.groupBy ?? 'feature');
        if (reportOptions.top) rows = rows.slice(0, reportOptions.top);
        console.log(summaryToCsv(rows, reportOptions.groupBy ?? 'feature'));
        break;
      }
      case 'json': {
        const filtered = filterEvents(events, reportOptions);
        let rows = summarize(filtered, reportOptions.groupBy ?? 'feature');
        if (reportOptions.top) rows = rows.slice(0, reportOptions.top);
        console.log(summaryToJson(rows, reportOptions.groupBy ?? 'feature'));
        break;
      }
      default:
        printTable(reportOptions, events);
        break;
    }
  });

program.parse();
