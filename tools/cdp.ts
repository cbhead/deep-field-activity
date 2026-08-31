/**
 * A minimal DevTools Protocol client, and the headless Chrome to point it at.
 *
 * Extracted from tools/shots.ts when a second tool needed the same thing.
 * Both are here for the same reason: the sim only advances on animation frames,
 * so any harness that wants to observe the *running* game has to drive a real
 * browser rather than a DOM shim. `ws` is already a dependency of the relay, so
 * this still adds nothing to install.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Pending {
  resolve(v: Record<string, unknown>): void;
  reject(e: Error): void;
}

export class Cdp {
  private id = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly ws: WebSocket;

  // Longhand rather than a parameter property: Node's type-stripping loader
  // rejects those, and the whole harness runs under it.
  private readonly events = new Map<string, ((params: Record<string, unknown>) => void)[]>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        error?: { message: string };
        result?: Record<string, unknown>;
      };
      // No id means an event rather than a reply. Uncaught page exceptions
      // arrive this way, and a harness that ignored them would report a clean
      // run over a page that threw.
      if (msg.id === undefined) {
        if (msg.method === undefined) return;
        for (const cb of this.events.get(msg.method) ?? []) cb(msg.params ?? {});
        return;
      }
      const p = this.pending.get(msg.id);
      if (p === undefined) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result ?? {});
    });
  }

  on(method: string, cb: (params: Record<string, unknown>) => void): void {
    this.events.set(method, [...(this.events.get(method) ?? []), cb]);
  }

  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Cdp(ws);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

export interface LaunchOptions {
  port: number;
  width: number;
  height: number;
  profileDir: string;
  /** Extra flags — shots.ts needs real GL so its captures have glow. */
  args?: readonly string[];
}

/**
 * Start headless Chrome and connect to its first page target. Returns the
 * client and the process, so the caller owns killing it.
 */
export async function launch(opts: LaunchOptions): Promise<{ cdp: Cdp; chrome: ChildProcess }> {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${opts.port}`,
    `--window-size=${opts.width},${opts.height}`,
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${opts.profileDir}`,
    ...(opts.args ?? []),
    'about:blank',
  ]);
  chrome.on('error', (e) => {
    console.error('could not start Chrome:', e.message);
  });

  // Chrome takes a moment to open the debug port.
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 40 && target === undefined; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/json/list`);
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === 'page');
    } catch {
      // not up yet
    }
  }
  if (target === undefined) throw new Error('Chrome debug port never opened');

  return { cdp: await Cdp.open(target.webSocketDebuggerUrl), chrome };
}
