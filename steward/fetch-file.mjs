#!/usr/bin/env node
/* Download a file the owner pointed at — a card image, a screenshot, a PDF.
 *
 * Why this exists (owner, 2026-11-06): he sent "Mindburn has the wrong version"
 * with a Discord image LINK in the text, and the worker updated the card text,
 * left the old scan in place and asked him to paste the image in by hand. It
 * could not fetch it: curl and wget are denied in its settings (as they should
 * be: an unattended agent has no business pulling arbitrary pages), and
 * discord.mjs only saved ATTACHMENTS, never links written in the message.
 *
 * So the link is fetched in two places, both with this code:
 *   · discord.mjs, the moment a message arrives (inbox or reply): every link in
 *     it that serves an image or a PDF is saved beside the message, so the agent
 *     finds it on disk. This matters for Discord links in particular: their
 *     `ex=` signature expires in about a day, and a request can wait in the
 *     queue for longer than that.
 *   · the agent, by hand, for anything else:  node steward/fetch-file.mjs <url> [dir]
 *     (the skill's hard limits name it). Prints the saved path.
 *
 * Only images and PDFs are kept: this is for files the owner sent, not for
 * reading web pages. Anything else is refused with its content type.
 *
 * media.discordapp.net is Discord's resizing proxy; with `format=webp` it
 * re-encodes the image. cdn.discordapp.com serves the original bytes (the card
 * scans are 720x1000 JPEGs, and a webp would be a different file), so a proxy
 * link is rewritten to the CDN, keeping the ex/is/hm signature.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 25 * 1024 * 1024;
const KEEP = /^(image\/|application\/pdf)/i;

/** a link as the owner pasted it → the URL that serves the original file */
export function normalizeUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim().replace(/^<|>$/g, '')); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (u.hostname === 'media.discordapp.net' && u.pathname.startsWith('/attachments/')) {
    u.hostname = 'cdn.discordapp.com';
    for (const k of ['format', 'width', 'height', 'quality']) u.searchParams.delete(k);
  }
  // a trailing "=&" (Discord's own copy-link form) leaves an empty key behind
  u.searchParams.delete('');
  return u.toString();
}

/** every http(s) link in a message's text (and its embeds), normalized, de-duplicated */
export function linksIn(text, embeds = []) {
  const out = [];
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>`"')\]]+/g)) out.push(m[0].replace(/[.,;:!?]+$/, ''));
  for (const e of embeds || []) for (const k of ['url', 'image', 'video']) {
    const v = typeof e?.[k] === 'string' ? e[k] : e?.[k]?.url;
    if (v) out.push(v);
  }
  return [...new Set(out.map(normalizeUrl).filter(Boolean))];
}

/** a filename from the URL's last path segment, safe for any filesystem */
export function fileNameOf(url, contentType = '') {
  let base = 'file';
  try { base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'file'); } catch { /* keep "file" */ }
  base = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
  if (!/\.[A-Za-z0-9]{2,5}$/.test(base)) {
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' }[contentType.split(';')[0].trim().toLowerCase()];
    if (ext) base += ext;
  }
  return base;
}

/** fetch `url` into `dir`; resolves {path, url, type, bytes} or throws with a reason a human can read */
export async function download(url, dir, { prefix = '' } = {}) {
  const u = normalizeUrl(url);
  if (!u) throw new Error(`not an http(s) link: ${url}`);
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30e3), headers: { 'User-Agent': 'algomancy-steward (https://algomancy.online, 1)' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${new URL(u).hostname}${r.status === 404 && /discord/.test(u) ? ' (a Discord link expires about a day after it was copied — ask for the file as an attachment)' : ''}`);
  const type = r.headers.get('content-type') || '';
  if (!KEEP.test(type)) throw new Error(`not an image or PDF (${type || 'no content type'}) — this helper is for files, not pages`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error(`too large (${len} bytes)`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length} bytes)`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, prefix + fileNameOf(u, type));
  writeFileSync(path, buf);
  return { path, url: u, type: type.split(';')[0], bytes: buf.length };
}

function selftest() {
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); process.exitCode = 1; } else console.log(`✓ ${what}`); };
  const proxy = 'https://media.discordapp.net/attachments/1/2/CUsersCalebPycharmProjectscardgamebot_libraryMindburn.jpg?ex=6a&is=6b&hm=ff&=&format=webp';
  eq(normalizeUrl(proxy), 'https://cdn.discordapp.com/attachments/1/2/CUsersCalebPycharmProjectscardgamebot_libraryMindburn.jpg?ex=6a&is=6b&hm=ff', 'a media proxy link becomes the original on the CDN, signature kept');
  eq(normalizeUrl('ftp://x/y'), null, 'only http(s)');
  eq(linksIn(`The new card image file is here: \`${proxy}\`\n\n${proxy}\nand <https://example.com/a.png>.`).length, 2, 'links in backticks, bare and in <>, de-duplicated');
  eq(linksIn('see https://example.com/x.png, then').at(0), 'https://example.com/x.png', 'trailing punctuation is not part of the link');
  eq(linksIn('', [{ url: 'https://example.com/p', image: { url: 'https://example.com/i.jpg' } }]), ['https://example.com/p', 'https://example.com/i.jpg'], 'embed links');
  eq(fileNameOf(normalizeUrl(proxy)), 'CUsersCalebPycharmProjectscardgamebot_libraryMindburn.jpg', 'file name from the path');
  eq(fileNameOf('https://example.com/scan', 'image/png'), 'scan.png', 'an extension from the content type');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2);
  if (a === 'selftest') selftest();
  else if (!a) { console.error('usage: node steward/fetch-file.mjs <url> [dir]   (default dir: $STEWARD_STATE/downloads)'); process.exit(2); }
  else {
    const dir = b || join(process.env.STEWARD_STATE || join(homedir(), 'algomancy-steward', 'state'), 'downloads');
    try { const f = await download(a, dir); console.log(f.path); console.error(`saved ${f.bytes} bytes (${f.type}) from ${f.url}`); }
    catch (e) { console.error(`fetch-file: ${e.message}`); process.exit(1); }
  }
}
