/** Types for stat-quotes.mjs: a card's printed numbers quoted beside its name. */
import type { CardStats } from './extract.d.mts';

export interface StatQuote {
  name: string;
  what: 'stats' | 'cost' | 'pips' | 'ambush';
  said: string;
  printed: string;
  ok: boolean;
  /** where the claim starts in the text */
  at: number;
}
export function statQuoteScanner(cards: CardStats[]): (text: unknown) => StatQuote[];
