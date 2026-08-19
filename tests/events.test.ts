import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enrichEvent, EventLog } from '../src/events.js';

describe('EventLog', () => {
  it('stamps events with increasing sequence numbers', () => {
    const log = new EventLog();
    log.emit({ type: 'phase', phase: 'brief', label: 'Research brief' });
    log.emit({ type: 'done' });
    const events = log.all();
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
    expect(events[0]?.ts).toBeTruthy();
  });

  it('notifies subscribers and survives a throwing subscriber', () => {
    const log = new EventLog();
    const seen: string[] = [];
    log.subscribe(() => {
      throw new Error('broken subscriber');
    });
    log.subscribe((e) => seen.push(e.type));
    log.emit({ type: 'done' });
    expect(seen).toEqual(['done']);
  });

  it('persists to disk and continues sequence numbers on reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-events-'));
    const file = join(dir, 'events.jsonl');
    const first = new EventLog(file);
    first.emit({ type: 'phase', phase: 'brief', label: 'Research brief' });
    first.emit({ type: 'warning', text: 'w' });

    const second = new EventLog(file);
    second.emit({ type: 'done' });
    const events = second.all();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);

    const loaded = EventLog.loadFrom(file);
    expect(loaded).toHaveLength(3);
    expect(loaded[2]?.type).toBe('done');
  });

  it('skips corrupted lines instead of failing the whole log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-events-'));
    const file = join(dir, 'events.jsonl');
    const log = new EventLog(file);
    log.emit({ type: 'done' });
    appendFileSync(file, 'NOT JSON\n{"also": "not an event"}\n');
    expect(EventLog.loadFrom(file)).toHaveLength(1);
  });
});

describe('enrichEvent', () => {
  it('adds rendered html to message events only', () => {
    const message = enrichEvent({
      type: 'message',
      actor: 'claude',
      kind: 'debate',
      markdown: '**hi**',
      seq: 0,
      ts: 'now',
    });
    expect(message.html).toContain('<strong>hi</strong>');
    const other = enrichEvent({ type: 'done', seq: 1, ts: 'now' });
    expect(other.html).toBeUndefined();
  });
});
