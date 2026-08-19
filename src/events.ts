import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { mdToHtml } from './md.js';

export type MessageKind =
  | 'brief'
  | 'persona'
  | 'ideas'
  | 'debate'
  | 'vote'
  | 'round_summary'
  | 'synthesis'
  | 'signoff'
  | 'owner';

export interface BoardCard {
  id: string;
  seatId: string;
  title: string;
  one_liner: string;
  status: 'active' | 'dropped' | 'merged';
  statusReason?: string;
}

export interface LeaderboardCard {
  ideaId: string;
  title: string;
  weightedScore: number;
  firstPlaceVotes: number;
}

export type PanelEvent =
  | { type: 'phase'; phase: string; label: string }
  | { type: 'seat_working'; actor: string; activity: string }
  | { type: 'message'; actor: string; kind: MessageKind; round?: number; markdown: string }
  | { type: 'board'; ideas: BoardCard[] }
  | { type: 'leaderboard'; entries: LeaderboardCard[] }
  | { type: 'cost'; spentUsd: number; limitUsd: number }
  | { type: 'checkpoint' }
  | { type: 'checkpoint_done' }
  | { type: 'winner'; ideaId: string; title?: string; converged: boolean; round?: number }
  | { type: 'warning'; text: string }
  | { type: 'paused'; reason: string }
  | { type: 'error'; text: string }
  | { type: 'done' };

export type StampedEvent = PanelEvent & { seq: number; ts: string };

/** Message events carry pre-rendered HTML over the wire so the page never parses markdown. */
export type WireEvent = StampedEvent & { html?: string };

export function enrichEvent(event: StampedEvent): WireEvent {
  if (event.type === 'message') return { ...event, html: mdToHtml(event.markdown) };
  return event;
}

type Listener = (event: StampedEvent) => void;

/**
 * Append-only event log for one session. Durable (events.jsonl in the session
 * dir) and observable (live SSE subscribers). On resume it reloads the file so
 * sequence numbers continue and the UI can replay the whole run.
 */
export class EventLog {
  private seq = 0;
  private events: StampedEvent[] = [];
  private listeners = new Set<Listener>();

  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) {
      this.events = EventLog.loadFrom(filePath);
      this.seq = (this.events.at(-1)?.seq ?? -1) + 1;
    }
  }

  emit(event: PanelEvent): void {
    const stamped: StampedEvent = { ...event, seq: this.seq++, ts: new Date().toISOString() };
    this.events.push(stamped);
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, `${JSON.stringify(stamped)}\n`, 'utf8');
      } catch {
        // A failed event write must never take down the run.
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(stamped);
      } catch {
        // A broken subscriber must never take down the run.
      }
    }
  }

  all(): StampedEvent[] {
    return [...this.events];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  static loadFrom(filePath: string): StampedEvent[] {
    if (!existsSync(filePath)) return [];
    const events: StampedEvent[] = [];
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === 'object' && 'type' in parsed && 'seq' in parsed) {
          events.push(parsed as StampedEvent);
        }
      } catch {
        // skip corrupted lines rather than losing the whole log
      }
    }
    return events;
  }
}
