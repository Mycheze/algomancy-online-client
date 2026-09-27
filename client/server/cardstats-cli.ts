/* The card stats fold, printed. Read-only: it parses the account store for
 * its history rows and never loads accounts.ts (whose store writes).
 *
 *   node server/cardstats-cli.ts [--games DIR] [--accounts FILE]
 *        [--mode draft|constructed|all] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *        [--rated] [--both-signed] [--user NAME] [--min N]
 *        [--sort games|gih|oh|played|pick|iwd|recycled|bottomed|passed]
 *        [--card NAME] [--sources] [--json] [--limit N]
 *
 * Defaults to the production mirror (`npm --prefix client run mirror`).
 * `--sources` is the backfill audit: every counted game, which rung of the
 * ledger ladder it stood on (cardledger.ts), and where a replay stopped
 * being trusted. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedger } from './cardledger.ts';
import { foldCardStats, type CardRow, type CardStatsFilter, type StatsGame, type Wr } from './cardstats.ts';
import type { RecordedGame } from './accounts.ts';

const MIRROR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'var', 'prod-mirror', 'snapshot');
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name: string): boolean => argv.includes(name);

const gamesDir = opt('--games') ?? join(MIRROR, 'games');
const accountsFile = opt('--accounts') ?? join(MIRROR, 'accounts.json');
const store = JSON.parse(readFileSync(accountsFile, 'utf8')) as { history: RecordedGame[]; accounts: { id: string; username: string }[] };

const userName = opt('--user');
const me = userName ? store.accounts.find(a => a.username.toLowerCase() === userName.toLowerCase())?.id ?? '∅' : null;
const filter: CardStatsFilter = {
  mode: (opt('--mode') as CardStatsFilter['mode']) ?? 'all',
  ...(opt('--from') ? { from: opt('--from') } : {}),
  ...(opt('--to') ? { to: opt('--to') } : {}),
  ...(flag('--rated') ? { rated: true } : {}),
  ...(flag('--both-signed') ? { bothSignedIn: true } : {}),
  ...(me ? { me } : {}),
};

const games: StatsGame[] = [];
const audits: string[] = [];
for (const h of store.history) {
  const r = readLedger(gamesDir, h.code);
  if (!r) { audits.push(`${h.code}  (no game file)`); continue; }
  games.push({ ...h, ledger: r.ledger });
  audits.push(`${h.code}  ${h.mode.padEnd(11)} ${r.audit.source.padEnd(11)} ${`${r.audit.validUpTo}/${r.audit.actions}`.padStart(9)}  `
    + `open ${r.ledger.coverage.open ? '✓' : '·'} draws ${r.ledger.coverage.draws ? '✓' : '·'}  ${r.audit.why}`);
}
const res = foldCardStats(games, filter);

// no process.exit() after output: it cuts a piped stdout off at 64 KB
if (flag('--json')) console.log(JSON.stringify(res, null, 1));
else if (flag('--sources')) {
  console.log(audits.join('\n'));
  console.log(`\nsources: ${JSON.stringify(res.sources)}`);
} else table();

function table(): void {

const pct = (w: Wr): string => (w.n ? `${Math.round((100 * w.w) / w.n)}%`.padStart(4) + ` (${w.n})`.padEnd(5) : '   ·     ');
const num = (x: number | null, d = 1): string => (x === null || !Number.isFinite(x) ? '·' : x.toFixed(d));
const rate = (a: number, b: number): number | null => (b ? a / b : null);
const iwd = (r: CardRow): number | null =>
  r.gih.n && r.gns.n ? r.gih.w / r.gih.n - r.gns.w / r.gns.n : null;

console.log(`${res.games} games · ${res.seatGames} seat-games · ${res.firstPlayed?.slice(0, 10)} → ${res.lastPlayed?.slice(0, 10)}`);
console.log(`coverage (seat-games): open ${res.coverage.open} · draws ${res.coverage.draws} · plays ${res.coverage.plays} · picks ${res.coverage.picks} · init ${res.coverage.init}`);
console.log(`sources: ${JSON.stringify(res.sources)}   on the play: ${pct(res.onPlay)}`);
console.log('\nelements (seat colours):');
for (const e of res.elements) console.log(`  ${e.el.padEnd(6)} ${pct(e.seat)}  picked ${num(e.picked, 1).padStart(5)}  played ${num(e.played, 1).padStart(5)}`);
console.log('pairs:', Object.entries(res.pairs).sort((a, b) => b[1].n - a[1].n).map(([k, w]) => `${k} ${pct(w).trim()}`).join(' · '));
console.log('trios:', Object.entries(res.trios).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log('game length (turns → games):', Object.entries(res.turns).map(([t, n]) => `${t}:${n}`).join(' '));

const min = Number(opt('--min') ?? 1);
const sortKey = opt('--sort') ?? 'games';
const cardName = opt('--card');
let cards = res.cards.filter(r => r.games >= min);
if (cardName) cards = cards.filter(r => r.card.toLowerCase().includes(cardName.toLowerCase()));
const by: Record<string, (r: CardRow) => number> = {
  games: r => r.games,
  gih: r => (r.gih.n ? r.gih.w / r.gih.n : -1),
  oh: r => (r.oh.n ? r.oh.w / r.oh.n : -1),
  played: r => r.timesPlayed,
  pick: r => rate(r.picked, r.offered) ?? -1,
  iwd: r => iwd(r) ?? -9,
  recycled: r => r.recycled,
  bottomed: r => r.bottomed,
  passed: r => r.offered - r.picked,
};
cards.sort((a, b) => (by[sortKey] ?? by['games']!)(b) - (by[sortKey] ?? by['games']!)(a));
console.log(`\n${'card'.padEnd(28)} games  GIH        OH         drawn      played     GNS        IWD    ×play  turn  recyc  bottm  offer pick%  pos  given  deck`);
for (const r of cards.slice(0, Number(opt('--limit') ?? 40))) {
  const i = iwd(r);
  console.log(`${r.card.slice(0, 27).padEnd(28)} ${String(r.games).padStart(5)}  ${pct(r.gih)}  ${pct(r.oh)}  ${pct(r.drawn)}  ${pct(r.played)}  ${pct(r.gns)}  `
    + `${(i === null ? '·' : `${i > 0 ? '+' : ''}${Math.round(i * 100)}`).padStart(4)}  ${String(r.timesPlayed).padStart(5)}  ${num(rate(r.firstTurnSum, r.firstTurnN)).padStart(4)}  `
    + `${String(r.recycled).padStart(5)}  ${String(r.bottomed).padStart(5)}  ${String(r.offered).padStart(5)}  ${num((rate(r.picked, r.offered) ?? NaN) * 100, 0).padStart(4)}  `
    + `${num(rate(r.pickPosSum, r.picked)).padStart(4)}  ${String(r.given).padStart(5)}  ${pct(r.deck)}`);
}
}
