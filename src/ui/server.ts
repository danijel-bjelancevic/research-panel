import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { enrichEvent, type EventLog } from '../events.js';
import { mdToHtml } from '../md.js';
import { renderPageHtml } from './page.js';

export type CheckpointAction =
  | { kind: 'continue' }
  | { kind: 'quit' }
  | { kind: 'drop'; ids: string[] }
  | { kind: 'steer'; note: string };

/**
 * Hands checkpoint decisions from the browser to the engine. The engine waits
 * on waitForAction(); the server resolves it when the page POSTs an action.
 */
export class CheckpointBridge {
  private resolver: ((action: CheckpointAction) => void) | null = null;

  waitForAction(): Promise<CheckpointAction> {
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Returns false when no checkpoint is currently waiting for input. */
  submit(action: CheckpointAction): boolean {
    if (!this.resolver) return false;
    const resolve = this.resolver;
    this.resolver = null;
    resolve(action);
    return true;
  }
}

export interface PanelServerOpts {
  log: EventLog;
  bridge: CheckpointBridge;
  title: string;
  /** Returns the dossier markdown once the run has produced one. */
  getDossierMd: () => string | undefined;
}

const MAX_BODY_BYTES = 64 * 1024;
const PORT_ATTEMPTS = 20;

function parseAction(raw: unknown): CheckpointAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  switch (body.action) {
    case 'continue':
      return { kind: 'continue' };
    case 'quit':
      return { kind: 'quit' };
    case 'drop': {
      if (!Array.isArray(body.ids)) return null;
      const ids = body.ids.filter((id): id is string => typeof id === 'string').slice(0, 20);
      return ids.length > 0 ? { kind: 'drop', ids } : null;
    }
    case 'steer': {
      if (typeof body.note !== 'string') return null;
      const note = body.note.trim().slice(0, 1000);
      return note ? { kind: 'steer', note } : null;
    }
    default:
      return null;
  }
}

export class PanelServer {
  private server: Server | null = null;
  private readonly sseClients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly opts: PanelServerOpts) {}

  /** Starts on the preferred port, walking upward if it is taken. Binds localhost only. */
  async start(preferredPort: number): Promise<number> {
    for (let port = preferredPort; port < preferredPort + PORT_ATTEMPTS; port++) {
      try {
        return await this.listen(port);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EADDRINUSE' && code !== 'EACCES') throw err;
      }
    }
    throw new Error(
      `no free port found between ${preferredPort} and ${preferredPort + PORT_ATTEMPTS - 1} — pass a different --port`,
    );
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.route(req, res));
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        this.server = server;
        this.heartbeat = setInterval(() => {
          for (const client of this.sseClients) client.write(': ping\n\n');
        }, 25_000);
        this.heartbeat.unref();
        this.opts.log.subscribe((event) => {
          const frame = `data: ${JSON.stringify(enrichEvent(event))}\n\n`;
          for (const client of this.sseClients) client.write(frame);
        });
        resolve(port);
      });
    });
  }

  private route(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/') {
      const html = renderPageHtml({ mode: 'live', title: this.opts.title });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      return;
    }
    if (req.method === 'GET' && url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      for (const event of this.opts.log.all()) {
        res.write(`data: ${JSON.stringify(enrichEvent(event))}\n\n`);
      }
      this.sseClients.add(res);
      req.on('close', () => this.sseClients.delete(res));
      return;
    }
    if (req.method === 'GET' && url === '/dossier.html') {
      const md = this.opts.getDossierMd();
      res
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(md ? mdToHtml(md) : '');
      return;
    }
    if (req.method === 'POST' && url === '/checkpoint') {
      this.readBody(req, res, (raw) => {
        const action = parseAction(raw);
        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":"unrecognized action"}');
          return;
        }
        const accepted = this.opts.bridge.submit(action);
        res
          .writeHead(accepted ? 200 : 409, { 'Content-Type': 'application/json' })
          .end(accepted ? '{"ok":true}' : '{"ok":false,"error":"no checkpoint is waiting"}');
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }

  private readBody(req: IncomingMessage, res: ServerResponse, done: (raw: unknown) => void): void {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":"invalid JSON"}');
      }
    });
    req.on('error', () => res.destroy());
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.sseClients) client.end();
    this.sseClients.clear();
    this.server?.close();
  }
}
