import { writeFileSync } from 'node:fs';
import { enrichEvent, type StampedEvent } from './events.js';
import { mdToHtml } from './md.js';
import { renderDossier } from './report.js';
import { renderPageHtml } from './ui/page.js';
import type { SessionPaths } from './session.js';
import type { SessionState } from './types.js';

/**
 * Writes report.html: the full session replayed as a static deliberation-
 * chamber page with the dossier at the end. Self-contained — no server needed.
 */
export function writeHtmlReport(paths: SessionPaths, state: SessionState, events: StampedEvent[]): void {
  const html = renderPageHtml({
    mode: 'static',
    title: state.topic,
    events: events.map(enrichEvent),
    dossierHtml: state.synthesis ? mdToHtml(renderDossier(state)) : undefined,
  });
  writeFileSync(paths.reportPath, html, 'utf8');
}
