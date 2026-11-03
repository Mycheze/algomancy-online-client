/* Status message — one line telling the player how something went.
 *
 * Today it is `.deckmsg` (17 uses: gold 12px text) for everything, plus
 * `.qerr`, `.joinerr`, `.psnote` and `.acctmsg` (which has no rule at all),
 * so an error and a success mostly look the same (inventory, Part 2). The
 * tones here are the status tokens:
 *
 *   ok     success green      warn   warning amber
 *   error  danger red         info   the rules page's blue
 *   note   the accent gold — exactly today's .deckmsg, for a page that keeps its look
 *
 * An error is `role="alert"` (read out at once), the rest `role="status"`.
 * `boxed` puts it on its tone's tinted background with a border, for a
 * message that must not read as part of the content around it. */
import { type Common, rootAttrs, textOrHtml } from './_shared.ts';

export const STATUS_TONES = ['ok', 'warn', 'error', 'info', 'note'] as const;
export type StatusTone = typeof STATUS_TONES[number];

export interface StatusProps extends Common {
  text?: string;
  textHtml?: string;
  tone?: StatusTone;
  boxed?: boolean;
}

export function statusMessage(p: StatusProps): string {
  const tone = p.tone ?? 'note';
  const own = `ui-status ui-status--${tone}${p.boxed ? ' ui-status--boxed' : ''}`;
  return `<div${rootAttrs(own, p, { role: tone === 'error' ? 'alert' : 'status' })}>${textOrHtml(p.text, p.textHtml)}</div>`;
}
