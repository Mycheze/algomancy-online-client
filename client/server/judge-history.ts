/* CT-470: the /api/judge proxy forwards the judge box's conversation to the bot.
 * The caller is a browser, so nothing in the body is trusted: only user/assistant
 * turns with string content pass, capped to the bot's own ceilings
 * (bot/app.py Turn / AskRequest — 8 turns, 8000 characters), so a malformed
 * history is trimmed here rather than turning the whole question into a 422.
 * `role` is a closed choice: a "system" turn would be a second system prompt. */

export const MAX_TURNS = 8;
export const MAX_TURN_CHARS = 8000;

export interface Turn { role: 'user' | 'assistant'; content: string }

export function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const out: Turn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const { role, content } = t as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) continue;
    out.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
  }
  return out.slice(-MAX_TURNS);
}

/* BL-17 — WHO ASKED, WHEN IT WAS A JUDGE. "Rules questions … from badged
 * accounts are surfaced ahead of unbadged ones": the judges' review page
 * (api-judge-review.ts) lists a question a judge or the owner asked in a game
 * right after the flagged answers. Only this proxy knows the account, so it
 * tells the bot the asker's BADGE — never a name or an id; the bot's log keeps
 * no asker — and only over the shared ALGO_BOT_TOKEN: the bot drops `asker`
 * from any request without it, so a caller of its public /api/ask cannot claim
 * a badge. Unbadged, or no token: the request is exactly what it was. */

export interface AskerBadge { owner?: true; judge?: 1 | 2 | 3 }

/** the badge worth telling the bot, or null */
export function askerBadge(badge: { owner?: boolean; judge?: number } | null | undefined): AskerBadge | null {
  if (!badge) return null;
  if (badge.owner) return { owner: true };
  if (badge.judge === 1 || badge.judge === 2 || badge.judge === 3) return { judge: badge.judge };
  return null;
}

/** the headers and body the /api/judge proxy sends the bot's /api/ask */
export function judgeAskRequest(
  ask: { question: unknown; history: unknown; lesson: string },
  badge: { owner?: boolean; judge?: number } | null | undefined,
  botToken: string,
): { headers: Record<string, string>; body: string } {
  const asker = botToken ? askerBadge(badge) : null;
  return {
    headers: { 'content-type': 'application/json', ...(asker ? { 'x-algo-bot': botToken } : {}) },
    // CT-470: the judge box's own thread, so a follow-up is answered in it
    // (trimmed to the bot's ceilings; a lesson question stands alone)
    body: JSON.stringify({ question: String(ask.question ?? '').slice(0, 2000),
      history: ask.lesson ? [] : cleanHistory(ask.history), ...(ask.lesson ? { context: ask.lesson } : {}),
      ...(asker ? { asker } : {}) }),
  };
}
