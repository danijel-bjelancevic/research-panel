import { describe, expect, it } from 'vitest';
import { activeIdeas, applyModeratorActions, applyMove, ideasFromDivergence } from '../src/board.js';
import type { Idea } from '../src/types.js';

function makeBoard(): Idea[] {
  return [
    ...ideasFromDivergence('claude', [
      { title: 'A', one_liner: 'a', description: 'da', why_now: 'w', risks: [], evidence: [] },
      { title: 'B', one_liner: 'b', description: 'db', why_now: 'w', risks: [], evidence: [] },
    ]),
    ...ideasFromDivergence('gpt', [
      { title: 'C', one_liner: 'c', description: 'dc', why_now: 'w', risks: [], evidence: [] },
    ]),
  ];
}

describe('ideasFromDivergence', () => {
  it('assigns stable seat-scoped ids', () => {
    const ideas = makeBoard();
    expect(ideas.map((i) => i.id)).toEqual(['claude-1', 'claude-2', 'gpt-1']);
    expect(ideas.every((i) => i.status === 'active')).toBe(true);
  });
});

describe('applyMove', () => {
  it('applies a revision to the seat\'s own idea', () => {
    const ideas = makeBoard();
    const warnings = applyMove(ideas, 'claude', {
      action: 'revise',
      idea_id: 'claude-1',
      revision: { title: 'A2', description: 'updated' },
      reasoning: 'sharpened',
    });
    expect(warnings).toEqual([]);
    const idea = ideas.find((i) => i.id === 'claude-1');
    expect(idea?.title).toBe('A2');
    expect(idea?.description).toBe('updated');
    expect(idea?.one_liner).toBe('a');
    expect(idea?.revisionNotes).toEqual(['sharpened']);
  });

  it('refuses to modify another seat\'s idea', () => {
    const ideas = makeBoard();
    const warnings = applyMove(ideas, 'gpt', { action: 'abandon', idea_id: 'claude-1', reasoning: 'no' });
    expect(warnings).toHaveLength(1);
    expect(ideas.find((i) => i.id === 'claude-1')?.status).toBe('active');
  });

  it('allows abandoning while more than two ideas remain', () => {
    const ideas = makeBoard();
    const warnings = applyMove(ideas, 'claude', { action: 'abandon', idea_id: 'claude-2', reasoning: 'beaten' });
    expect(warnings).toEqual([]);
    expect(activeIdeas(ideas)).toHaveLength(2);
  });

  it('refuses to abandon below two active ideas', () => {
    const ideas = makeBoard();
    applyMove(ideas, 'claude', { action: 'abandon', idea_id: 'claude-2', reasoning: 'beaten' });
    const warnings = applyMove(ideas, 'claude', { action: 'abandon', idea_id: 'claude-1', reasoning: 'beaten' });
    expect(warnings).toHaveLength(1);
    expect(activeIdeas(ideas)).toHaveLength(2);
  });
});

describe('applyModeratorActions', () => {
  it('merges an idea and records it on the keeper', () => {
    const ideas = makeBoard();
    const warnings = applyModeratorActions(ideas, {
      merges: [{ keep_id: 'claude-1', absorb_ids: ['gpt-1'], reason: 'same idea' }],
      drops: [],
      round_summary: 's',
    });
    expect(warnings).toEqual([]);
    expect(ideas.find((i) => i.id === 'gpt-1')?.status).toBe('merged');
    expect(ideas.find((i) => i.id === 'claude-1')?.revisionNotes.join(' ')).toContain('gpt-1');
  });

  it('ignores unknown ids with a warning instead of crashing', () => {
    const ideas = makeBoard();
    const warnings = applyModeratorActions(ideas, {
      merges: [{ keep_id: 'nope-1', absorb_ids: ['claude-1'], reason: 'x' }],
      drops: [{ idea_id: 'ghost-9', reason: 'x' }],
      round_summary: 's',
    });
    expect(warnings).toHaveLength(2);
    expect(activeIdeas(ideas)).toHaveLength(3);
  });

  it('never drops the board below two active ideas', () => {
    const ideas = makeBoard();
    const warnings = applyModeratorActions(ideas, {
      merges: [],
      drops: [
        { idea_id: 'claude-1', reason: 'weak' },
        { idea_id: 'claude-2', reason: 'weak' },
        { idea_id: 'gpt-1', reason: 'weak' },
      ],
      round_summary: 's',
    });
    expect(activeIdeas(ideas)).toHaveLength(2);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
