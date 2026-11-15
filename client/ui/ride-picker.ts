/*
 * THE RIDE-ALONG DIALOG — after Attack! (or a counterattack's Confirm), the
 * spell tokens that may come along, as cards you click in and out, with
 * Bring all, Bring none, the confirm and Go back.
 *
 * Pure: a view in, markup out. ui/main.ts builds the view from the same
 * mirrors of the engine the board uses (ui/battle.ts ridableTokens and
 * sendableTokens), so the dialog can never offer a token the declaration
 * would refuse. Each tile is `data-act="token"`, the same click as the token
 * in the strip: picking here and picking there toggle the one list.
 *
 * Enter answers only with the confirm, never with Bring none: declining is a
 * choice the player makes, not a key they were already holding.
 */
import { esc } from './util.ts';
import type { Badge } from './inspect.ts';

/** one spell token that may ride */
export interface RideToken { id: number; card: string; x?: number; on: boolean }

/** everything the dialog draws */
export interface RideView {
  /** the player being asked */
  who: string;
  /** the attack's question, or the counterattack's */
  side: 'attack' | 'counter';
  tokens: RideToken[];
  /** how many are picked, as the declaration will carry them */
  picked: number;
}

/** how the dialog draws one card — ui/main.ts's cardHtml */
type CardFn = (name: string, opts: {
  playable?: boolean; selected?: boolean; badges?: Badge[]; data?: string; die?: number;
}) => string;

/** the confirm button's words: what goes, and how many ride with it */
export function rideConfirmLabel(side: RideView['side'], n: number): string {
  return `${side === 'counter' ? 'Counterattack' : 'Attack'} — ${n} token${n === 1 ? '' : 's'} riding`;
}

/** the dialog, or nothing when there is no view */
export function ridePickerHtml(v: RideView | null, card: CardFn): string {
  if (!v) return '';
  const tile = (t: RideToken): string => `<div class="ridecard${t.on ? ' on' : ''}">${card(t.card, {
    die: t.x, playable: !t.on, selected: t.on,
    badges: t.on ? [{ t: '✓ riding', mod: true }] : [],
    data: `data-act="token" data-id="${t.id}"`,
  })}</div>`;
  const n = v.picked;
  return `<div class="overlay mainonly rideover"><div class="overlaybox ridebox" role="dialog" aria-label="Bring spell tokens into the battle">
    <h3>Bring spell tokens into the battle?</h3>
    <div class="hint"><b>${esc(v.who)}:</b> Select the spell tokens you wish to bring into the attacked region, or select Bring none.</div>
    <div class="zone ridezone">${v.tokens.map(tile).join('')}</div>
    <div class="ridefoot">
      <button data-btn="ridecancel">Go back <span class="kh">(esc)</span></button>
      <span class="ridegap"></span>
      <button data-btn="ridenone"${n ? '' : ' class="primary"'}>Bring none</button>
      <button data-btn="rideall">Bring all ${v.tokens.length}</button>
      ${n ? `<button class="primary" data-btn="rideconfirm">${rideConfirmLabel(v.side, n)} <span class="kh">(enter)</span></button>` : ''}
    </div>
  </div></div>`;
}
