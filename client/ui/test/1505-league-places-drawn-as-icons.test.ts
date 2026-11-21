/* 1505 — A LEAGUE PLACE IS DRAWN FROM THE ICON SET, NEVER AN EMOJI (BL-10;
 * docs/23-ui-inventory/02 §8.3 item 13, "🏆 🥈 🏅 trophies", and §8.1 item 6,
 * "`.badgechip.trophy.participant` has no rule").
 *
 * An emoji is drawn by each device's own font: a colour picture that ignores
 * the chip's colour and looks different on every phone (the owner on the
 * seat badges: "Better to find actual assets that look good and render the
 * same on all devices"). The board's badges moved to components/icon.ts; the
 * profile's place chips, the league's champion marks and the cube event's
 * winner had not.
 *
 * §1 each place chip carries its icon and its word, and no emoji
 * §2 a champion's mark beside a name is the trophy icon, named when spoken
 * §3 each place has a rule of its own, in the place tokens, not a literal
 * §4 the census: no ui/ source draws 🏆 🥈 🏅 but the league's Discord post,
 *    which Discord itself draws
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { championMarkHtml, trophyChipHtml } from '../pages/profile.ts';
import { readStyles } from './read-styles.ts';

const PLACE_EMOJI = /[\u{1F3C6}\u{1F948}\u{1F3C5}]/u; // 🏆 🥈 🏅

test('§1 BL-10: each league place chip is its icon and its word, with no emoji', () => {
  const want = { champion: 'league', finalist: 'league', participant: 'medal' } as const;
  for (const [place, glyph] of Object.entries(want) as [keyof typeof want, string][]) {
    const chip = trophyChipHtml({ name: 'October 2026', place });
    assert.match(chip, new RegExp(`^<span class="badgechip trophy ${place}"[^>]*><svg class="ui-icon ui-icon--${glyph}"`), place);
    assert.match(chip, new RegExp(`</svg> ${place[0]!.toUpperCase()}${place.slice(1)} · October 2026</span>$`), place);
    assert.doesNotMatch(chip, PLACE_EMOJI, place);
    assert.match(chip, /aria-hidden="true"/, `${place}: the word beside it says it, so the icon is silent`);
  }
});

test('§2 BL-10: a champion beside a name is the trophy icon, named only when nothing near it says so', () => {
  const spoken = championMarkHtml(true);
  assert.match(spoken, /^<svg class="ui-icon ui-icon--league champmark"[^>]*role="img"[^>]*><title>Champion<\/title>/);
  const quiet = championMarkHtml(false);
  assert.match(quiet, /^<svg class="ui-icon ui-icon--league champmark"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(quiet, /<title>/);
});

test('§3 BL-10: every place has a rule of its own, coloured by the place tokens', () => {
  const css = readStyles();
  for (const place of ['champion', 'finalist', 'participant']) {
    const rule = new RegExp(`\\.badgechip\\.trophy\\.${place}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
    assert.ok(rule, `.badgechip.trophy.${place} has no rule: it falls back to the accent outline`);
    assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${place}: a colour literal, not a token`);
  }
  assert.match(css, /\.badgechip\.trophy\.champion\s*\{[^}]*var\(--color-place-champion\)/);
  assert.match(css, /\.badgechip\.trophy\.finalist\s*\{[^}]*var\(--color-place-finalist\)/);
  assert.match(css, /\.champmark\s*\{[^}]*color:\s*var\(--color-place-champion\)/);
  assert.match(css, /--color-place-champion:\s*#/, 'the token is defined');
});

/** the source with the league's Discord post cut out: that text is pasted into Discord, which draws its emoji */
function withoutDiscordPost(file: string, src: string): string {
  if (!file.endsWith('pages/league.ts')) return src;
  const at = src.indexOf('export function postText(');
  assert.ok(at > 0, 'pages/league.ts postText moved: the census cannot cut it out');
  const end = src.indexOf('\n}\n', at);
  return src.slice(0, at) + src.slice(end);
}

test('§4 BL-10 census: no ui/ source draws a league place as an emoji', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const hits: string[] = [];
  let read = 0;
  for (const dir of ['', 'pages/', 'components/']) {
    for (const f of readdirSync(root + dir)) {
      // updates.ts is the dated changelog players read: its words are history
      if (!f.endsWith('.ts') || f === 'updates.ts') continue;
      const file = dir + f;
      const src = withoutDiscordPost(file, readFileSync(root + file, 'utf8'));
      read++;
      src.split('\n').forEach((line, i) => { if (PLACE_EMOJI.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`); });
    }
  }
  assert.ok(read > 100, `only ${read} sources read`);
  assert.ok(PLACE_EMOJI.test(readFileSync(root + 'pages/league.ts', 'utf8')), 'the Discord post still draws its trophy: the census is reading the file');
  assert.deepEqual(hits, [], 'a league place drawn as an emoji: use icon(\'league\') / icon(\'medal\') or championMarkHtml()');
});
