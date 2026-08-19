#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { EventLog } from './events.js';
import { renderDossier } from './report.js';
import { writeHtmlReport } from './report-html.js';
import { CheckpointBridge, PanelServer } from './ui/server.js';
import {
  applyOverrides,
  ConfigError,
  DEFAULT_CONFIG,
  loadConfig,
  type Config,
  type ConfigOverrides,
} from './config.js';
import { BudgetExceededError } from './cost.js';
import { runEngine, UserQuitError } from './engine.js';
import { log } from './log.js';
import { OpenRouterClient, OpenRouterError } from './openrouter.js';
import {
  createSession,
  initialState,
  loadSession,
  saveState,
  SessionError,
  type SessionPaths,
} from './session.js';
import type { SessionState } from './types.js';

const CONFIG_FILENAME = 'panel.config.json';

function loadDotEnv(dir: string): void {
  const path = join(dir, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^(["'])(.*)\1$/, '$2');
  }
}

function requireApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new ConfigError(
      'OPENROUTER_API_KEY is not set. Export it in your shell or put OPENROUTER_API_KEY=sk-or-... in a .env file ' +
        'in the directory you run from. Create a key at https://openrouter.ai/keys',
    );
  }
  return key;
}

async function validateModels(client: OpenRouterClient, config: Config): Promise<void> {
  let ids: Set<string>;
  try {
    ids = new Set((await client.listModels()).map((m) => m.id));
  } catch (err) {
    log.warn(
      `could not fetch the OpenRouter model list to validate your config (${err instanceof Error ? err.message : String(err)}) — continuing anyway`,
    );
    return;
  }
  const wanted = [...config.seats.map((s) => s.model), config.moderator.model];
  const unknown = [...new Set(wanted.filter((m) => !ids.has(m)))];
  if (unknown.length === 0) return;

  const lines = unknown.map((m) => {
    const vendor = m.split('/')[0];
    const suggestions = [...ids].filter((id) => id.startsWith(`${vendor}/`)).sort().slice(0, 8);
    return `  - "${m}" is not a known OpenRouter model.${
      suggestions.length > 0 ? ` Models from ${vendor}: ${suggestions.join(', ')}` : ''
    }`;
  });
  throw new ConfigError(
    `Your config references models OpenRouter does not list:\n${lines.join('\n')}\n` +
      `Browse with: research-panel models <filter>`,
  );
}

function parsePositiveNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new InvalidArgumentError('must be a positive number');
  return parsed;
}

function parseRounds(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new InvalidArgumentError('must be an integer between 1 and 12');
  }
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new InvalidArgumentError('must be a port number between 1024 and 65535');
  }
  return parsed;
}

function tryOpenBrowser(url: string): void {
  try {
    const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {
      // opening the browser is best-effort; the URL is printed either way
    });
    child.unref();
  } catch {
    // ignore — the URL is printed either way
  }
}

interface UiHandle {
  bridge: CheckpointBridge;
  server: PanelServer;
  url: string;
}

async function startUi(events: EventLog, state: SessionState, port: number): Promise<UiHandle> {
  const bridge = new CheckpointBridge();
  const server = new PanelServer({
    log: events,
    bridge,
    title: state.topic,
    getDossierMd: () => (state.synthesis ? renderDossier(state) : undefined),
  });
  const actualPort = await server.start(port);
  const url = `http://127.0.0.1:${actualPort}`;
  log.success(`live viewer: ${url}`);
  tryOpenBrowser(url);
  return { bridge, server, url };
}

function printCompletion(paths: SessionPaths, state: SessionState): void {
  const dissents = state.signoffs.filter((s) => s.verdict === 'dissent');
  log.phase('Done');
  log.success(`dossier: ${paths.dossierPath}`);
  log.plain(`   transcript: ${paths.transcriptPath}`);
  log.plain(`   total cost: $${state.costUsd.toFixed(3)}`);
  if (state.convergedAtRound) {
    log.plain(`   the panel converged in round ${state.convergedAtRound}`);
  } else if (state.forcedByCap) {
    log.plain('   the panel did NOT fully converge — the leaderboard leader was selected at the round cap');
  }
  if (dissents.length > 0) {
    log.warn(`${dissents.length} seat(s) dissented — read the "Panel verdict" section of the dossier`);
  }
  if (state.warnings.length > 0) {
    log.info(`   ${state.warnings.length} warning(s) recorded in the dossier`);
  }
}

async function executeEngine(
  client: OpenRouterClient,
  paths: SessionPaths,
  state: SessionState,
  assumeYes: boolean,
  events: EventLog,
  ui?: UiHandle,
): Promise<void> {
  try {
    await runEngine({ client, paths, state, assumeYes, events, ...(ui ? { bridge: ui.bridge } : {}) });
    printCompletion(paths, state);
    log.plain(`   report: ${paths.reportPath}`);
  } catch (err) {
    if (err instanceof UserQuitError) {
      log.info(`Paused. Resume any time with: research-panel resume "${paths.dir}"`);
      return;
    }
    if (err instanceof BudgetExceededError) {
      log.error(err.message);
      log.info(`Session saved at ${paths.dir}`);
      process.exitCode = 1;
      return;
    }
    log.error(err instanceof Error ? err.message : String(err));
    log.info(`Progress was saved — resume with: research-panel resume "${paths.dir}"`);
    process.exitCode = 1;
  }
}

function handleFatal(err: unknown): void {
  if (
    err instanceof ConfigError ||
    err instanceof SessionError ||
    err instanceof OpenRouterError ||
    err instanceof BudgetExceededError
  ) {
    log.error(err.message);
  } else if (err instanceof Error) {
    log.error(err.stack ?? err.message);
  } else {
    log.error(String(err));
  }
  process.exitCode = 1;
}

const program = new Command();
program
  .name('research-panel')
  .description(
    'A panel of AI models (via OpenRouter) that researches a topic together: blind proposals, adversarial debate, voting, and a final signed recommendation.',
  )
  .version('0.1.0');

program
  .command('init')
  .description(`Create a ${CONFIG_FILENAME} with sensible defaults in the current directory`)
  .option('--force', 'overwrite an existing config file')
  .action((opts: { force?: boolean }) => {
    try {
      const target = resolve(CONFIG_FILENAME);
      if (existsSync(target) && !opts.force) {
        throw new ConfigError(`${target} already exists. Use --force to overwrite it.`);
      }
      writeFileSync(target, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8');
      log.success(`wrote ${target}`);
      log.plain('Next steps:');
      log.plain('  1. Put your key in the environment: export OPENROUTER_API_KEY=sk-or-...  (or a .env file)');
      log.plain('  2. Adjust seats/models/personas in the config if you like (see: research-panel models)');
      log.plain('  3. Run: research-panel run "your research topic"');
    } catch (err) {
      handleFatal(err);
    }
  });

program
  .command('run')
  .description('Start a new panel session on a topic')
  .argument('<topic...>', 'the research question or topic')
  .option('-c, --config <path>', 'path to the panel config', CONFIG_FILENAME)
  .option('-n, --notes <file>', 'markdown file with your constraints/notes for the panel')
  .option('-r, --rounds <n>', 'maximum debate rounds (1–12)', parseRounds)
  .option('--no-search', 'disable web search for this run')
  .option('-y, --yes', 'skip the human checkpoint after divergence')
  .option('--max-cost <usd>', 'hard cost cap in USD for this run', parsePositiveNumber)
  .option('-o, --out <dir>', 'output directory (default from config)')
  .option('-u, --ui', 'open a live browser viewer for this run')
  .option('-p, --port <n>', 'preferred port for the live viewer', parsePort, 4820)
  .action(
    async (
      topicParts: string[],
      opts: {
        config: string;
        notes?: string;
        rounds?: number;
        search: boolean;
        yes?: boolean;
        maxCost?: number;
        out?: string;
        ui?: boolean;
        port: number;
      },
    ) => {
      try {
        loadDotEnv(process.cwd());
        const topic = topicParts.join(' ').trim();
        if (!topic) throw new ConfigError('the topic must not be empty');

        const overrides: ConfigOverrides = {};
        if (opts.rounds !== undefined) overrides.maxRounds = opts.rounds;
        if (!opts.search) overrides.webSearch = false;
        if (opts.maxCost !== undefined) overrides.maxCostUsd = opts.maxCost;
        if (opts.out !== undefined) overrides.outputDir = opts.out;
        const config = loadConfig(resolve(opts.config), overrides);

        const client = new OpenRouterClient(requireApiKey(), config.requestTimeoutMs);
        await validateModels(client, config);

        let ownerNotes: string | undefined;
        if (opts.notes) {
          const notesPath = resolve(opts.notes);
          if (!existsSync(notesPath)) throw new ConfigError(`notes file not found: ${notesPath}`);
          ownerNotes = readFileSync(notesPath, 'utf8').trim();
        }

        const paths = createSession(topic, config.outputDir);
        const state = initialState(topic, ownerNotes, config);
        saveState(paths, state);
        log.info(`session: ${paths.dir}`);
        log.info(
          `panel: ${config.seats.map((s) => `${s.id}=${s.model}`).join('  ')}  moderator=${config.moderator.model}`,
        );
        const events = new EventLog(paths.eventsPath);
        const ui = opts.ui ? await startUi(events, state, opts.port) : undefined;
        await executeEngine(client, paths, state, opts.yes ?? false, events, ui);
        if (ui) log.info(`the viewer is still running at ${ui.url} — press Ctrl+C to stop it`);
      } catch (err) {
        handleFatal(err);
      }
    },
  );

program
  .command('resume')
  .description('Resume a paused or interrupted session from its directory')
  .argument('<dir>', 'session directory (contains state.json)')
  .option('-y, --yes', 'skip any remaining human checkpoint')
  .option('--max-cost <usd>', 'raise or change the hard cost cap in USD', parsePositiveNumber)
  .option('-u, --ui', 'open a live browser viewer for the resumed run')
  .option('-p, --port <n>', 'preferred port for the live viewer', parsePort, 4820)
  .action(async (dir: string, opts: { yes?: boolean; maxCost?: number; ui?: boolean; port: number }) => {
    try {
      loadDotEnv(process.cwd());
      const { paths, state } = loadSession(dir);
      if (opts.maxCost !== undefined) {
        state.configSnapshot = applyOverrides(state.configSnapshot, { maxCostUsd: opts.maxCost });
      }
      if (state.nextPhase === 'done') {
        log.info(`this session is already complete — dossier: ${paths.dossierPath}`);
        return;
      }
      log.info(`resuming at phase "${state.nextPhase}" (spent so far: $${state.costUsd.toFixed(3)})`);
      const client = new OpenRouterClient(requireApiKey(), state.configSnapshot.requestTimeoutMs);
      const events = new EventLog(paths.eventsPath);
      const ui = opts.ui ? await startUi(events, state, opts.port) : undefined;
      await executeEngine(client, paths, state, opts.yes ?? false, events, ui);
      if (ui) log.info(`the viewer is still running at ${ui.url} — press Ctrl+C to stop it`);
    } catch (err) {
      handleFatal(err);
    }
  });

program
  .command('report')
  .description('Generate report.html for any session directory (finished, paused, or crashed)')
  .argument('<dir>', 'session directory (contains state.json)')
  .action((dir: string) => {
    try {
      const { paths, state } = loadSession(dir);
      const events = EventLog.loadFrom(paths.eventsPath);
      writeHtmlReport(paths, state, events);
      log.success(`wrote ${paths.reportPath}`);
      if (events.length === 0) {
        log.info('this session has no events.jsonl (recorded before the viewer existed) — the page shows only the dossier');
      }
    } catch (err) {
      handleFatal(err);
    }
  });

program
  .command('models')
  .description('List OpenRouter models with context size and pricing (optionally filtered)')
  .argument('[filter]', 'substring to filter model ids, e.g. "anthropic/" or "gpt"')
  .action(async (filter?: string) => {
    try {
      loadDotEnv(process.cwd());
      const client = new OpenRouterClient(process.env.OPENROUTER_API_KEY ?? '', 30_000);
      let models = await client.listModels();
      if (filter) models = models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()));
      models.sort((a, b) => a.id.localeCompare(b.id));
      const shown = models.slice(0, 200);
      for (const m of shown) {
        const ctx = m.contextLength ? `${Math.round(m.contextLength / 1000)}k ctx` : '?';
        const pricing =
          m.promptPricePerM !== undefined && m.completionPricePerM !== undefined
            ? `$${m.promptPricePerM.toFixed(2)}/M in · $${m.completionPricePerM.toFixed(2)}/M out`
            : 'pricing n/a';
        log.plain(`${m.id.padEnd(48)} ${ctx.padStart(9)}  ${pricing}`);
      }
      if (models.length > shown.length) {
        log.info(`…and ${models.length - shown.length} more — narrow it down with a filter`);
      }
      if (models.length === 0) log.info('no models matched that filter');
    } catch (err) {
      handleFatal(err);
    }
  });

await program.parseAsync(process.argv);
