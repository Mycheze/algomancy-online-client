/* Whether each durable store's last write reached the disk.
 *
 * A store's persist() reports every attempt here. The state is "did the LAST
 * write fail", so it clears by itself on the next write that succeeds. It is
 * logged on each transition only — a disk that stays full must not print one
 * line per game action. The admin overview shows it.
 */

export type StoreName = 'accounts' | 'league' | 'matches';

export interface StoreState {
  ok: boolean;
  /** epoch ms of the failure, while failing */
  since?: number;
  error?: string;
}

const failing = new Map<StoreName, { since: number; error: string }>();

/** Record one persist attempt: `err` null for a write that landed. */
export function notePersist(store: StoreName, err: unknown): void {
  const was = failing.get(store);
  if (err == null) {
    if (was) {
      failing.delete(store);
      console.log(`[${store}] writes are landing again`);
    }
    return;
  }
  const error = err instanceof Error ? err.message : String(err);
  if (!was) {
    failing.set(store, { since: Date.now(), error });
    console.error(`[${store}] could not persist (further failures are not logged until a write lands): ${error}`);
  } else was.error = error;
}

/** every store, failing or not */
export function storeHealth(): Record<StoreName, StoreState> {
  const one = (s: StoreName): StoreState => {
    const f = failing.get(s);
    return f ? { ok: false, since: f.since, error: f.error } : { ok: true };
  };
  return { accounts: one('accounts'), league: one('league'), matches: one('matches') };
}
