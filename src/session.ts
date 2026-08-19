import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Config } from './config.js';
import { SessionStateSchema, type SessionState } from './types.js';

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionPaths {
  dir: string;
  statePath: string;
  transcriptPath: string;
  dossierPath: string;
  eventsPath: string;
  reportPath: string;
}

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function slugify(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'panel';
}

function sessionPaths(dir: string): SessionPaths {
  return {
    dir,
    statePath: join(dir, 'state.json'),
    transcriptPath: join(dir, 'transcript.md'),
    dossierPath: join(dir, 'dossier.md'),
    eventsPath: join(dir, 'events.jsonl'),
    reportPath: join(dir, 'report.html'),
  };
}

export function createSession(topic: string, outputDir: string): SessionPaths {
  const base = resolve(expandHome(outputDir));
  mkdirSync(base, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  let dir = join(base, `${date}-${slugify(topic)}`);
  for (let n = 2; existsSync(dir); n++) {
    dir = join(base, `${date}-${slugify(topic)}-${n}`);
  }
  mkdirSync(dir);
  return sessionPaths(dir);
}

export function initialState(topic: string, ownerNotes: string | undefined, config: Config): SessionState {
  const state: SessionState = {
    version: 1,
    topic,
    startedAt: new Date().toISOString(),
    configSnapshot: config,
    personas: [],
    ideas: [],
    rounds: [],
    steerNotes: [],
    nextPhase: 'brief',
    nextRound: 1,
    signoffs: [],
    citations: [],
    warnings: [],
    costUsd: 0,
  };
  if (ownerNotes) state.ownerNotes = ownerNotes;
  return state;
}

/** Atomic write: never leaves a half-written state.json behind. */
export function saveState(paths: SessionPaths, state: SessionState): void {
  const tmp = `${paths.statePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, paths.statePath);
}

export function loadSession(dir: string): { paths: SessionPaths; state: SessionState } {
  const resolved = resolve(expandHome(dir));
  const paths = sessionPaths(resolved);
  let raw: string;
  try {
    raw = readFileSync(paths.statePath, 'utf8');
  } catch {
    throw new SessionError(`No session found at ${resolved} (missing state.json).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SessionError(`state.json at ${resolved} is corrupted (invalid JSON).`);
  }
  const result = SessionStateSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new SessionError(`state.json at ${resolved} does not match the expected format: ${issues}`);
  }
  return { paths, state: result.data };
}

export function appendTranscript(paths: SessionPaths, chunk: string): void {
  appendFileSync(paths.transcriptPath, chunk.endsWith('\n') ? chunk : `${chunk}\n`, 'utf8');
}
