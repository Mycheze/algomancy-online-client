// CR 108.4b states which copies are tokens on its own terms, and rests on the
// designer's ruling as the owner relayed it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CR_JSON, CR_RULES_DIR, ISSUES_SNAPSHOT } from '../scripts/paths.mjs';

const KEY = 'concepts.cards.copies.token-copy';

test('BL-81 #419: CR 108.4b says a copy of a card an effect creates in play is a token, without assuming it', () => {
  const doc = JSON.parse(readFileSync(CR_JSON, 'utf8')) as { rules: { key: string; num: string; text: string }[] };
  const row = doc.rules.find(r => r.key === KEY);
  assert.ok(row, `${KEY} is a live rule`);
  assert.equal(row.num, '108.4b');
  assert.match(row.text, /^A copy of a card that an effect creates in play is a token\b/);
  assert.match(row.text, /whether or not the effect calls it a token/, 'the word "token" on the card is not what makes it one');
});

test('BL-81 #419: CR 108.4b cites Caleb\'s "copies are tokens" ruling as the owner relayed it', () => {
  const recs = JSON.parse(readFileSync(join(CR_RULES_DIR, 'U03.json'), 'utf8')) as
    { key: string; sources: { owner?: { quote: string; from: string }[] } }[];
  const rec = recs.find(r => r.key === KEY)!;
  const quotes = (rec.sources.owner ?? []).filter(o => o.from.startsWith('report #419')).map(o => o.quote);
  assert.ok(quotes.includes('Yeah copies are tokens'), `the ruling is cited: ${JSON.stringify(quotes)}`);
  const report = readFileSync(ISSUES_SNAPSHOT, 'utf8').split('\n')[419]!;
  for (const q of quotes) assert.ok(JSON.parse(report).note.includes(q), `"${q}" is verbatim in report #419`);
});
