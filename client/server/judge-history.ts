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
