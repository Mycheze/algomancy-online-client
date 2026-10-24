/* League messages as the bell shows them.
 *
 * Every one is a row of the league's outbox (server/league-store.ts), the
 * same row the Discord bot turns into a DM — but the bot only reaches the
 * few players who linked Discord, and the bell reaches everybody. The words
 * follow bot/cogs/league.py's render(), shorter: a bell line is one sentence.
 *
 * Pure: the caller passes how to show a time, in the VIEWER's zone, so the
 * test can render every kind without a clock or a zone. 491 checks that every
 * kind the server's `OutboxKind` names has a line here.
 */
import { esc } from './util.ts';

export interface LeagueNote {
  id: number; kind: string; season: string; at: number; read: boolean;
  data: Record<string, unknown>;
}

/** what a note's one button does: open the League page, or press Play on the match */
export type NoteAction = 'league' | 'play' | null;

const name = (v: unknown): string =>
  esc((v as { name?: string } | undefined)?.name ?? 'someone');

/**
 * One note as a sentence of markup plus the button it carries. `time` shows
 * a unix-seconds instant in the viewer's zone.
 */
export function noteLine(n: LeagueNote, time: (unix: number) => string): { html: string; action: NoteAction } {
  const d = n.data;
  const season = `<b>${esc(d['season'] ?? 'the league')}</b>`;
  const at = typeof d['at'] === 'number' ? time(d['at']) : '';
  switch (n.kind) {
    case 'signup':
      return { html: `You're in ${season}.`, action: 'league' };
    case 'signups-open':
      return { html: `Sign-ups for ${season} are open.`, action: 'league' };
    case 'pairings': {
      const opps = ((d['opponents'] as { name?: string }[] | undefined) ?? []).map(o => `<b>${esc(o.name ?? '?')}</b>`);
      return { html: `${season} week ${esc(d['week'])}: you play ${opps.length ? opps.join(', ') : 'nobody'}.`, action: 'league' };
    }
    case 'sitting-out':
      return { html: d['skipped'] ? `You sit out week ${esc(d['week'])} of ${season}, as you asked.`
        : `No opponent for you in week ${esc(d['week'])} of ${season}.`, action: null };
    case 'week-pairings':
      return { html: `${season} week ${esc(d['week'])} is paired.`, action: 'league' };
    case 'week-closed':
      return { html: `${season} week ${esc(d['week'])} is over.`, action: 'league' };
    case 'final':
      return d['finalist']
        ? { html: `You're in the final of ${season}, against <b>${name(d['opponent'])}</b>!`, action: 'league' }
        : { html: `The ${season} final is set.`, action: 'league' };
    case 'result':
      return { html: `${d['won'] ? 'You beat' : 'You lost to'} <b>${name(d['opponent'])}</b>${d['final'] ? ' in the final' : ''}.`
        + (d['record'] ? ` Your record: ${esc(d['record'])}.` : ''), action: null };
    case 'challenge':
      return { html: `<b>${name(d['from'])}</b> started a sign-up week game with you.`, action: 'league' };
    case 'waiting':
      return { html: `<b>${name(d['from'])}</b> is waiting for you in your ${season} match.`, action: 'play' };
    case 'season':
      return { html: `${season} is over${d['place'] === 'champion' ? ' — you are the champion!' : d['place'] === 'finalist' ? ' — you reached the final.' : '.'}`,
        action: 'league' };
    case 'time':
      return { html: `<b>${name(d['from'])}</b> suggests playing ${at}.`, action: 'league' };
    case 'time-agreed':
      return { html: `<b>${name(d['from'])}</b> accepted: you play ${at}.`, action: 'league' };
    case 'time-reminder':
      return { html: `Your match against <b>${name(d['opponent'])}</b> starts at ${at}.`, action: 'play' };
    case 'dispute': {
      // to an organizer: the remedy is the override on the League page
      const said = String(d['note'] ?? '');
      return { html: `<b>${name(d['by'])}</b> disputed their ${season} match against <b>${name(d['opponent'])}</b>`
        + ` (${esc(d['code'] ?? '?')})${said ? `: “${esc(said.length > 120 ? `${said.slice(0, 119)}…` : said)}”` : '.'}`, action: 'league' };
    }
    default:
      // a kind newer than this page: still a line, never a gap in the list
      return { html: `News from ${season}.`, action: 'league' };
  }
}
