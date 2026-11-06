/**
 * 1152 — the night worker gets the files the owner LINKS, not only the ones he attaches (BL-69).
 *
 * 2026-11-06: the owner sent Mindburn's new scan as a media.discordapp.net link in the text of a
 * #steward message. steward/discord.mjs saved attachments only, the worker cannot download (curl
 * and WebFetch are denied it), so the text change shipped with the old picture and the worker
 * asked him to paste the image in. Now every image/PDF link in an owner message is downloaded on
 * arrival through steward/fetch-file.mjs. Its link handling is what this pins; the whole Discord
 * loop with a fake server is `node steward/test-discord.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileNameOf, linksIn, normalizeUrl } from '../../../steward/fetch-file.mjs';

const PROXY = 'https://media.discordapp.net/attachments/1017104585581666324/1483571253771108505/'
  + 'CUsersCalebPycharmProjectscardgamebot_libraryMindburn.jpg?ex=6aeee926&is=6aed97a6&hm=e885&=&format=webp';

test('1152 a Discord media-proxy link becomes the original file on the CDN, its signature kept', () => {
  const u = new URL(normalizeUrl(PROXY)!);
  assert.equal(u.hostname, 'cdn.discordapp.com');
  assert.equal(u.searchParams.get('format'), null, 'no webp re-encode: the scans are the original JPEGs');
  assert.deepEqual([u.searchParams.get('ex'), u.searchParams.get('is'), u.searchParams.get('hm')], ['6aeee926', '6aed97a6', 'e885']);
});

test('1152 the owner\'s 2026-11-06 message yields its one link, however he quoted it', () => {
  const msg = `The new card image file is here: \`${PROXY}\`\n\n${PROXY}\n\nPlease download it.`;
  const links = linksIn(msg);
  assert.equal(links.length, 1, 'backticked and bare copies of one link are one file');
  assert.equal(fileNameOf(links[0]!), 'CUsersCalebPycharmProjectscardgamebot_libraryMindburn.jpg');
  assert.deepEqual(linksIn('see <https://example.com/a.png>, then https://example.com/b.pdf.'),
    ['https://example.com/a.png', 'https://example.com/b.pdf'], 'angle brackets and trailing punctuation are not part of a link');
  assert.equal(normalizeUrl('ftp://example.com/x.jpg'), null, 'only http(s)');
});
