/* A SOCKET WITH NO NETWORK — the seam that lets a server live in the page.
 *
 * `main.ts` talks to the game server through exactly one function:
 *
 *     let openSocket: (url: string) => WebSocket = url => new WebSocket(url);
 *
 * Swap it and `NetBackend` — the redaction, the pacing, the reveal at each
 * hidden-segment barrier, the whole board renderer behind it — runs against
 * something else entirely without knowing. R297 did that first, for Learn to
 * Play: `ui/solo.ts` is a real room with a real engine in it, and the client
 * cannot tell it from the VPS. BL-38's replay viewer is the second, and there
 * will be more, so the socket half lives here rather than inside either.
 *
 * It implements only the surface `NetBackend` actually touches — `readyState`,
 * the three handlers, `send`, `close` — which is why it is a dozen lines and
 * not a WebSocket.
 *
 * ⚠ MESSAGES CROSS ON MICROTASKS, NOT TIMERS, and that is a bug fix rather
 * than a preference. A background tab throttles `setTimeout` to once a second
 * or worse; the tutorial bot ran on timers first and the owner reported it as
 * "the bot stopped passing" after switching tabs. Microtasks are not
 * throttled. A replay auto-advancing at 10 actions a second cares about this
 * for the same reason. `306 §7` and `319 §5` both read this file to check it.
 */

/** What the far end has to be able to do: take a client frame. */
export interface FakeServer {
  receive(data: string): void;
}

/**
 * The WebSocket surface `NetBackend` touches. Both directions are deferred by
 * one microtask so that neither side ever re-enters the other synchronously —
 * a real socket never delivers inside `send`, and code written against one
 * assumes it.
 */
export class FakeSocket {
  readonly readyState = 1;   // WebSocket.OPEN
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  private server: FakeServer;
  constructor(server: FakeServer) {
    this.server = server;
    queueMicrotask(() => this.onopen?.({}));
  }
  send(data: string): void { queueMicrotask(() => this.server.receive(data)); }
  close(): void { /* nothing to close */ }
  deliver(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg);
    queueMicrotask(() => this.onmessage?.({ data }));
  }
}
