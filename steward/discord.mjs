#!/usr/bin/env node
/* The steward's Discord channel — how the owner hears from the night worker and
 * answers it, without a terminal (owner, 2026-11-04: "I can't just know these
 * things"; he checks Discord every morning anyway).
 *
 * #steward in Ben's Personal Server: one thread per item waiting on the owner,
 * and one "night log" thread. In a text channel each is a PRIVATE thread with
 * only the owner added (hidden even if the channel is not); in a forum, a post.
 * The owner replies in a post:
 *
 *   approve            the runner lands the branch (rebase, full gate, master, deploy)
 *   reject <why>       dropped; the reason goes in the journal the worker reads
 *   retry <why>        dropped, but the worker may try again, differently
 *   anything else      his answer — screenshots, and any image or PDF he LINKS, are saved beside it — and the
 *                      worker resumes the item on its next night run
 *   (night log)        pause · resume
 *
 * The INBOX (owner, 2026-11-04): a plain message of his in the channel itself —
 * not in a thread — is a request, taken like a report. It becomes
 * state/inbox/inbox-<message id>.md (screenshots saved beside it), the queue
 * offers it right after triage, and a thread opened ON his message is where the
 * worker asks, shows, and says it is done.
 *
 * Only the owner's messages count (STEWARD_DISCORD_OWNER): anyone else in the
 * server could otherwise approve code onto the live site. A ✅ says one was taken.
 *
 *   node steward/discord.mjs sync          post new/changed handoffs, close finished ones, read replies.
 *                                          Prints one action per line for the runner, which owns git:
 *                                          approve <slug> | reject <slug> <why> | retry <slug> <why> | pause | resume
 *   node steward/discord.mjs log "<text>"  one line in the night log
 *   node steward/discord.mjs summary       the morning summary of the night (the runner calls it once a day)
 *   node steward/discord.mjs inbox         ONLY take new inbox messages (✅ + a "queued" thread). Its own
 *                                          timer runs it every minute (algomancy-steward-inbox.timer), so a
 *                                          request is acknowledged at once, not when the tick in progress
 *                                          ends — that can be hours (owner, 2026-11-06: "when it's fully
 *                                          silent … Idk what's happening"). It skips a minute if busy.
 *   node steward/discord.mjs selftest      the parsing, offline
 *
 * Env: STEWARD_DISCORD_TOKEN, STEWARD_DISCORD_FORUM (the channel id: text or forum),
 * STEWARD_DISCORD_OWNER (his user id); STEWARD_STATE; STEWARD_REPO (the clone).
 * Unconfigured = a quiet no-op, exit 0. A Discord failure never fails a tick.
 * One run at a time (state/discord.lock): the tick and the inbox timer share discord.json.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, linksIn } from './fetch-file.mjs';

const env = process.env;
const API = env.STEWARD_DISCORD_API || 'https://discord.com/api/v10';   // the override is a test seam (steward/test-discord.mjs)
const TOKEN = env.STEWARD_DISCORD_TOKEN, FORUM = env.STEWARD_DISCORD_FORUM, OWNER = env.STEWARD_DISCORD_OWNER;
const STATE = env.STEWARD_STATE || join(homedir(), 'algomancy-steward', 'state');
const REPO = env.STEWARD_REPO || join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(STATE, 'discord.json');
const HANDOFFS = join(STATE, 'handoffs');
const TZ = env.STEWARD_TZ || 'Europe/Prague';

// ── pure parsing (selftest covers these) ─────────────────────────────────────
/** what an owner message asks for */
export function classify(text, inLog = false) {
  const t = String(text || '').trim();
  if (inLog) {
    const m = /^(pause|resume)[.!]*$/i.exec(t);
    return m ? { verb: m[1].toLowerCase() } : { verb: 'note' };
  }
  // the bare word only: "Approve, but change the wording" is an ANSWER, not an approval.
  // "accept" and a lone 👍/✅ are approvals too (2026-11-08: his "accept" on BL-17 was filed as an answer).
  const APPROVE = /^(?:approve|approved|accept|accepted|lgtm|ship it|👍|✅)[\s.!👍✅]*$/iu;
  if (APPROVE.test(t)) return { verb: 'approve' };
  // the word alone on its first paragraph, then something else: approved, and the rest is a NEW request
  // (2026-11-08, BL-11: "approve" then "That reminds me too, there needs to be a tooltip…")
  const para = /^([^\n]*)\n\s*\n([\s\S]+)$/.exec(t);
  if (para && APPROVE.test(para[1].trim())) return { verb: 'approve', more: para[2].trim() };
  let m = /^(reject|rejected)\b[\s:—–-]*([\s\S]*)$/i.exec(t);
  if (m) return { verb: 'reject', why: m[2].trim() };
  m = /^retry\b[\s:—–-]*([\s\S]*)$/i.exec(t);
  if (m) return { verb: 'retry', why: m[1].trim() };
  return { verb: 'answer', text: t };
}
export const titleOf = (md, slug) => (/^# (.+)$/m.exec(md)?.[1] ?? slug).trim();
export const needsOf = md => (/^\*\*Needs from you:\*\*\s*(.+)$/m.exec(md)?.[1] ?? '').trim();
export function sectionOf(md, heading) {
  const lines = md.split('\n'); const i = lines.findIndex(l => l.replace(/\s+$/, '') === `## ${heading}`);
  if (i < 0) return '';
  const out = []; for (const l of lines.slice(i + 1)) { if (/^## /.test(l)) break; out.push(l); }
  return out.join('\n').trim();
}
/** the "Discord-ready" quote block, unquoted — forwardable as it stands */
export function discordReadyOf(md) {
  const lines = md.split('\n'); const i = lines.findIndex(l => /^\*\*Discord-ready:?\*\*/.test(l.trim()));
  if (i < 0) return '';
  const out = [];
  for (const l of lines.slice(i + 1)) { if (/^>/.test(l)) out.push(l.replace(/^>\s?/, '')); else if (out.length && l.trim() === '') break; else if (out.length) break; }
  return out.join('\n').trim();
}
export function clip(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; }
/** split for Discord's 2000-character messages, at paragraph then line boundaries */
export function chunks(s, n = 1900) {
  const out = []; let cur = '';
  for (const para of String(s).split(/\n(?=\n)/)) {
    if ((cur + para).length <= n) { cur += para; continue; }
    if (cur) out.push(cur.trim()), cur = '';
    let p = para;
    while (p.length > n) { const k = p.lastIndexOf('\n', n) > n / 2 ? p.lastIndexOf('\n', n) : n; out.push(p.slice(0, k).trim()); p = p.slice(k); }
    cur = p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const byId = (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

// ── state ────────────────────────────────────────────────────────────────────
const load = () => { try { return JSON.parse(readFileSync(DB, 'utf8')); } catch { return { log: null, items: {}, summaryDay: null }; } };
const save = db => writeFileSync(DB, JSON.stringify(db, null, 1));
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const ls = d => (existsSync(d) ? readdirSync(d) : []);
const journalRows = () => (existsSync(join(STATE, 'journal.jsonl')) ? readFileSync(join(STATE, 'journal.jsonl'), 'utf8') : '')
  .split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
const jnote = (item, outcome, note) => appendFileSync(join(STATE, 'journal.jsonl'),
  JSON.stringify({ ts: new Date().toISOString().slice(0, 19) + 'Z', item, outcome, note, by: 'owner', via: 'discord' }) + '\n');
const branchExists = slug => { try { execFileSync('git', ['-C', REPO, 'rev-parse', '-q', '--verify', `refs/remotes/origin/steward/${slug}`], { stdio: 'ignore' }); return true; } catch { return false; } };

// ── Discord REST ─────────────────────────────────────────────────────────────
async function api(method, path, body, files) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers = { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'algomancy-steward (https://algomancy.online, 1)' };
    let payload;
    if (files?.length) {
      payload = new FormData();
      payload.append('payload_json', JSON.stringify(body));
      files.forEach((f, i) => payload.append(`files[${i}]`, new Blob([f.data]), f.name));
    } else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(API + path, { method, headers, body: payload });
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise(res => setTimeout(res, 1000 * (j.retry_after ?? 2) + 250)); continue; }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  }
  throw new Error(`${method} ${path}: rate-limited three times`);
}
const say = (thread, content) => api('POST', `/channels/${thread}/messages`, { content: clip(content, 1990), allowed_mentions: { parse: [] } });
const react = (thread, msg) => api('PUT', `/channels/${thread}/messages/${msg}/reactions/${encodeURIComponent('✅')}/@me`).catch(() => {});

const HOWTO = 'Reply here — **approve** · **reject** <why> · **retry** <why> · or just answer in words (screenshots welcome).';
const HOWTO_Q = 'Reply here with your answer (screenshots welcome) — or **reject** <why>.';

function firstMessage(slug, md) {
  const hasBranch = branchExists(slug);
  // the post is "Needs from you" + "In short" (+ "The choice"), written for the owner;
  // the technical record stays in the attached file (2026-11-05: posts that opened on
  // "Verified: the second gate's only failure was 409 (6)…" could not be read)
  const short = sectionOf(md, 'In short');
  const choice = sectionOf(md, 'The choice').replace(/\*\*Discord-ready:?\*\*[\s\S]*$/, '').trim();
  const found = short ? '' : sectionOf(md, 'What I found');          // a handoff written before 2026-11-05
  const q = short ? '' : sectionOf(md, 'Questions');
  const parts = [`**Needs from you:** ${needsOf(md) || '(see the attached write-up)'}`];
  if (short) parts.push(clip(short, choice ? 1000 : 1500));
  if (choice) parts.push(clip(choice, 700));
  if (found) parts.push(clip(found, q ? 700 : 1300));
  if (q) parts.push(clip(q.replace(/\*\*Discord-ready:?\*\*[\s\S]*$/, '').trim(), 700));
  parts.push('-# The full write-up, with the technical details, is the attached file.');
  parts.push(`-# ${hasBranch ? HOWTO : HOWTO_Q}`);
  return clip(parts.join('\n\n'), 1990);
}
const mdFile = (slug, md) => [{ name: `${slug}.md`, data: md }];

/** a new thread holding `content` (+ files) as its first message; returns its id */
async function openThread(db, name, content, files) {
  if (db.channelType === undefined) db.channelType = (await api('GET', `/channels/${FORUM}`)).type;
  const message = { content, allowed_mentions: { parse: [] } };
  if (db.channelType === 15) return (await api('POST', `/channels/${FORUM}/threads`, { name, message }, files)).id;
  // a text channel: a PRIVATE thread (type 12), the owner added — only he (and server
  // moderators) can see it, even when the channel itself is not private
  const t = await api('POST', `/channels/${FORUM}/threads`, { name, type: 12, invitable: false, auto_archive_duration: 10080 });
  await api('PUT', `/channels/${t.id}/thread-members/${OWNER}`);
  await api('POST', `/channels/${t.id}/messages`, message, files);
  return t.id;
}

async function ensureLog(db) {
  if (db.log) return db.log;
  const t = { id: await openThread(db, '📓 night log',
    'What the steward did, as it happens, and a summary every morning.\n-# Type **pause** or **resume** here to stop or restart the worker.') };
  db.log = { thread: t.id, lastSeen: t.id }; save(db);
  return db.log;
}

async function postItem(db, slug, md) {
  const t = { id: await openThread(db, clip(`${slug} — ${titleOf(md, slug).replace(/^\S+\s+—\s+/, '')}`, 100), firstMessage(slug, md), mdFile(slug, md)) };
  const answered = join(STATE, 'answers', `${slug}.md`);
  if (existsSync(answered)) {
    // answered already (in a terminal, or before this channel existed): say so, do not ask again
    await say(t.id, `✅ **You already answered this** — the worker picks it up on its next night run:\n> ${clip(readFileSync(answered, 'utf8').replace(/^# .*\n+/, '').trim(), 1500).replace(/\n/g, '\n> ')}`);
  } else {
    const ready = discordReadyOf(md);
    if (ready) await say(t.id, `**Discord-ready** — forward this message to ask the server:\n\n${ready}`);
  }
  db.items[slug] = { thread: t.id, hash: hash(md), lastSeen: t.id, closed: false };
  save(db);
}

async function updateItem(db, slug, md) {
  const it = db.items[slug];
  await api('POST', `/channels/${it.thread}/messages`, { content: clip('**Updated.**\n\n' + firstMessage(slug, md), 1990), allowed_mentions: { parse: [] } }, mdFile(slug, md));
  const ready = discordReadyOf(md);
  if (ready) await say(it.thread, `**Discord-ready** — forward this message to ask the server:\n\n${ready}`);
  it.hash = hash(md); save(db);
}

/** an inbox item is finished only when the journal says so (it has no handoff while it waits) */
const FINISHED = new Set(['shipped', 'landed', 'already-fixed', 'not-a-bug', 'rejected', 'gave-up', 'skip', 'failed', 'gate-red-twice']);
const lastRow = slug => journalRows().filter(r => r.item === slug && r.by !== 'owner').at(-1);
const finished = slug => FINISHED.has(String(lastRow(slug)?.outcome ?? '').replace(/^dry-/, ''));

async function closeItem(db, slug) {
  const it = db.items[slug];
  const last = lastRow(slug) ?? journalRows().filter(r => r.item === slug).at(-1);
  const what = last ? `${last.outcome}${last.title ? ` — ${last.title}` : ''}${last.note ? ` — ${last.note}` : ''}${last.sha ? ` (${String(last.sha).slice(0, 8)})` : ''}` : 'done';
  const why = last?.summary ? `\n\n${clip(last.summary, 1400)}` : '';
  await say(it.thread, `✅ **Closed:** ${clip(what, 500)}${why}`).catch(() => {});
  await api('PATCH', `/channels/${it.thread}`, { archived: true }).catch(() => {});
  it.closed = true; save(db);
}

/** the owner's new messages in a thread, oldest first; advances lastSeen past everyone's */
async function newOwnerMessages(rec) {
  const msgs = (await api('GET', `/channels/${rec.thread}/messages?after=${rec.lastSeen}&limit=100`)) || [];
  msgs.sort(byId);
  if (msgs.length) rec.lastSeen = msgs.at(-1).id;
  return msgs.filter(m => m.author?.id === OWNER && !m.author?.bot);
}

/** his attachments AND every image/PDF link in his text, saved now — a Discord link expires in about
 *  a day, and a request can wait longer than that (2026-11-06: a card-image link in the text was never
 *  fetched, and the worker, which cannot download, asked him to paste the image in). Returns
 *  {saved: [{path, from}], failed: [{url, why}]}; a failure is reported to the agent, never fatal. */
async function saveAttachments(slug, m) {
  const dir = join(STATE, 'answers', 'files', slug); const saved = [], failed = [];
  for (const a of m.attachments || []) {
    try {
      const r = await fetch(a.url); if (!r.ok) { failed.push({ url: a.url, why: `${r.status}` }); continue; }
      mkdirSync(dir, { recursive: true });
      const p = join(dir, `${m.id}-${String(a.filename).replace(/[^A-Za-z0-9._-]/g, '_')}`);
      writeFileSync(p, Buffer.from(await r.arrayBuffer())); saved.push({ path: p, from: 'attachment' });
    } catch (e) { failed.push({ url: a.url, why: e.message }); }
  }
  const attached = new Set((m.attachments || []).map(a => String(a.url).split('?')[0]));
  for (const url of linksIn(m.content, m.embeds)) {
    if (attached.has(url.split('?')[0].replace('media.discordapp.net', 'cdn.discordapp.com'))) continue;
    try { const f = await download(url, dir, { prefix: `${m.id}-` }); saved.push({ path: f.path, from: url }); }
    catch (e) {
      // a link to a web page is not a failure — only say so when it looked like a file
      if (!/not an image or PDF/.test(e.message) || /\.(jpe?g|png|webp|gif|pdf)(\?|$)/i.test(url)) failed.push({ url, why: e.message });
    }
  }
  return { saved, failed };
}
/** the lines the agent reads under his words */
export function filesBlock({ saved, failed }) {
  const out = [];
  if (saved.length) out.push('Files he sent — ALREADY DOWNLOADED, Read them (a card image goes into data/cards/, see the skill):',
    ...saved.map(f => `- ${f.path}${f.from === 'attachment' ? '' : `  (from his link ${f.from})`}`));
  if (failed.length) out.push('Links that did NOT download — try `node steward/fetch-file.mjs <url>`; if that fails too, ask him to attach the file:',
    ...failed.map(f => `- ${f.url} — ${f.why}`));
  return out.length ? `\n${out.join('\n')}\n` : '';
}

async function readReplies(db, actions) {
  // the night log: pause / resume
  if (db.log) {
    for (const m of await newOwnerMessages(db.log)) {
      const c = classify(m.content, true);
      if (c.verb === 'pause' || c.verb === 'resume') { actions.push(c.verb); await react(db.log.thread, m.id); }
    }
    save(db);
  }
  for (const [slug, it] of Object.entries(db.items)) {
    if (it.closed) continue;
    for (const m of await newOwnerMessages(it)) {
      const c = classify(m.content);
      const files = await saveAttachments(slug, m);
      if (c.verb === 'approve' && !branchExists(slug) && c.more) {
        c.verb = 'answer'; c.text = String(m.content || '').trim();   // nothing to approve: it is all an answer
      }
      if (c.verb === 'approve') {
        if (!branchExists(slug)) { await say(it.thread, `There is no branch to approve for ${slug} — reply with your answer instead.`); continue; }
        actions.push(`approve ${slug}`);
        await react(it.thread, m.id);
        await say(it.thread, 'Approved. It runs through the full tests (about an hour), then goes live once nobody is in a game. I will post here when it is live.');
        if (c.more) {
          const t2 = await queueRequest(db, `inbox-${m.id}`, c.more, files, `added when approving \`${slug}\``);
          await say(it.thread, `What you wrote under the approval is queued as its own request: <#${t2}>.`);
        }
      } else if (c.verb === 'reject' || c.verb === 'retry') {
        actions.push(`${c.verb} ${slug} ${(c.why || '(no reason given)').replace(/\s+/g, ' ')}`);
        await react(it.thread, m.id);
        await say(it.thread, c.verb === 'retry' ? 'Rejected — the worker will try again, differently, with your reason in hand.' : 'Rejected and dropped. Your reason is in the journal the worker reads every night.');
      } else {
        const text = c.text || '(a screenshot only)';
        const f = join(STATE, 'answers', `${slug}.md`);
        mkdirSync(dirname(f), { recursive: true });
        const block = `${existsSync(f) ? '\n\n---\n\n' : `# Owner answer — ${slug} (${new Date().toISOString().slice(0, 10)}, on Discord)\n\n`}${text}` +
          filesBlock(files);
        appendFileSync(f, block + '\n');
        jnote(slug, 'answered', clip(text, 400));
        await react(it.thread, m.id);
      }
    }
    save(db);
  }
}

/** the owner's plain messages in the channel → inbox requests, each with a thread on it */
async function readInbox(db) {
  if (db.channelType === undefined) db.channelType = (await api('GET', `/channels/${FORUM}`)).type;
  if (db.channelType === 15) return;                 // a forum has no top-level messages
  if (!db.inboxLastSeen) db.inboxLastSeen = FORUM;   // the channel's own id is its creation time
  const msgs = ((await api('GET', `/channels/${FORUM}/messages?after=${db.inboxLastSeen}&limit=100`)) || []).sort(byId);
  if (!msgs.length) return;
  db.inboxLastSeen = msgs.at(-1).id; save(db);
  for (const m of msgs) {
    if (m.author?.id !== OWNER || m.author?.bot || ![0, 19].includes(m.type ?? 0)) continue;
    const slug = `inbox-${m.id}`;
    const text = String(m.content || '').trim() || '(a screenshot only)';
    const files = await saveAttachments(slug, m);
    await queueRequest(db, slug, text, files, null, m.id);
    await react(FORUM, m.id);
  }
}

/** write state/inbox/<slug>.md and give it a thread: a top-level message gets a thread ON it
 *  (onMessage); a request written under an approval in another thread gets a private one */
async function queueRequest(db, slug, text, files, from, onMessage) {
  const id = slug.replace(/^inbox-/, '');
  const day = new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString().slice(0, 10);
  mkdirSync(join(STATE, 'inbox'), { recursive: true });
  writeFileSync(join(STATE, 'inbox', `${slug}.md`),
    `# Inbox — from the owner, ${day} (Discord message ${id}${from ? `, ${from}` : ''})\n\n${text}\n` + filesBlock(files));
  const first = text.split('\n').find(l => l.trim()) || 'request';
  const hello = `Got it — queued as \`${slug}\`. The worker takes it after the item it is on now. It will ask here if it needs anything, and say here when it is done.`;
  let thread;
  if (onMessage) {
    thread = (await api('POST', `/channels/${FORUM}/messages/${onMessage}/threads`, { name: clip(first, 90), auto_archive_duration: 10080 })).id;
    await say(thread, hello);
  } else thread = await openThread(db, clip(first, 90), `> ${clip(text, 1500).replace(/\n/g, '\n> ')}\n\n${hello}`);
  db.items[slug] = { thread, hash: null, lastSeen: thread, closed: false, inbox: true };
  save(db);
  jnote(slug, 'inbox', clip(text, 400));
  return thread;
}

async function sync() {
  const db = load(); const actions = [];
  // replies first: an approval should land on this very tick
  await readReplies(db, actions);
  await readInbox(db);
  const open = ls(HANDOFFS).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  for (const slug of open) {
    const md = readFileSync(join(HANDOFFS, `${slug}.md`), 'utf8');
    const it = db.items[slug];
    if (!it || it.closed) await postItem(db, slug, md);
    else if (it.hash !== hash(md)) await updateItem(db, slug, md);
  }
  for (const [slug, it] of Object.entries(db.items)) {
    if (it.closed || open.includes(slug)) continue;
    if (it.inbox && !finished(slug)) continue;   // queued or in progress: its thread stays open
    await closeItem(db, slug);
  }
  if (actions.length) console.log(actions.join('\n'));
}

async function log(text) { const db = load(); const l = await ensureLog(db); await say(l.thread, text); }

async function summary() {
  const db = load();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  if (db.summaryDay === day) return;
  const since = db.summaryTs || new Date(Date.now() - 864e5).toISOString();
  const rows = journalRows().filter(r => r.ts > since && !['idle', 'note'].includes(r.outcome) && r.by !== 'owner');
  const count = o => rows.filter(r => r.outcome.replace(/^dry-/, '') === o).length;
  const lines = [`**The night of ${day}** — shipped ${count('shipped') + count('landed')} · staged ${count('staged')} · red ${count('gate-red') + count('gate-red-twice')} · questions ${count('needs-human')}`];
  for (const r of rows.slice(-25)) lines.push(`• \`${r.item}\` ${r.outcome}${r.title ? ` — ${clip(r.title, 120)}` : r.note ? ` — ${clip(r.note, 120)}` : ''}`);
  const waiting = Object.entries(db.items).filter(([, it]) => !it.closed);
  lines.push(waiting.length ? `\n**Waiting on you:** ${waiting.map(([s, it]) => `<#${it.thread}> (${s})`).join(' · ')}` : '\nNothing is waiting on you.');
  const l = await ensureLog(db);
  for (const c of chunks(lines.join('\n'))) await say(l.thread, c);
  db.summaryDay = day; db.summaryTs = new Date().toISOString(); save(db);
}

function selftest() {
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); process.exitCode = 1; } else console.log(`✓ ${what}`); };
  eq(classify('approve'), { verb: 'approve' }, 'approve');
  eq(classify('  Approved! 👍 '), { verb: 'approve' }, 'approved with punctuation');
  eq(classify('Approve, but change the wording to X').verb, 'answer', 'a qualified approve is an answer');
  eq(classify('accept'), { verb: 'approve' }, 'accept is approve');
  eq(classify('👍'), { verb: 'approve' }, 'a lone thumbs-up is approve');
  eq(classify('Accept the B reading').verb, 'answer', '"accept the B reading" is an answer');
  eq(classify('approve\n\nThat reminds me, a tooltip for zoom.'), { verb: 'approve', more: 'That reminds me, a tooltip for zoom.' }, 'approve, then a new request');
  eq(classify('approve\nbut make it blue').verb, 'answer', 'approve with a qualifier on the next line is an answer');
  eq(classify('A: approve').verb, 'answer', 'an option letter is an answer');
  eq(classify('reject: the green is on purpose'), { verb: 'reject', why: 'the green is on purpose' }, 'reject with a reason');
  eq(classify('retry - do it in one batch'), { verb: 'retry', why: 'do it in one batch' }, 'retry');
  eq(classify('Rejection is wrong here, B is right').verb, 'answer', '"Rejection…" is not a reject');
  eq(classify('B — it enters with the Virus'), { verb: 'answer', text: 'B — it enters with the Virus' }, 'an answer');
  eq(classify('pause', true), { verb: 'pause' }, 'pause in the log');
  eq(classify('pause the music', true), { verb: 'note' }, 'chatter in the log');
  const md = '# CT-426 — does a Virus erase it?\n\n**Needs from you:** answer Q1.\n\n## What I found\nVerified: x\n\n## Questions\n### Q1 — y\n\n**Discord-ready:**\n> Quick one.\n> Second line.\n\nAnswer with: z\n';
  eq(titleOf(md, 'CT-426'), 'CT-426 — does a Virus erase it?', 'title');
  eq(needsOf(md), 'answer Q1.', 'needs line');
  eq(sectionOf(md, 'What I found'), 'Verified: x', 'section');
  eq(discordReadyOf(md), 'Quick one.\nSecond line.', 'discord-ready block, unquoted');
  const md2 = '# CT-9 — glow\n\n**Needs from you:** A or B?\n\n## In short\nThe glow is cut off.\n\n## The choice\n- **A:** smaller\n- **B:** more room\n\n## Details\nVerified: 777 red.\n';
  eq(sectionOf(md2, 'In short'), 'The glow is cut off.', 'in-short section');
  eq(sectionOf(md2, 'The choice'), '- **A:** smaller\n- **B:** more room', 'choice section');
  eq(chunks('a'.repeat(50) + '\n\n' + 'b'.repeat(50), 60).length, 2, 'chunks split at a paragraph');
  eq(chunks('x'.repeat(4500)).every(c => c.length <= 1900), true, 'chunks never exceed the limit');
  eq(filesBlock({ saved: [], failed: [] }), '', 'no files, no block');
  eq(filesBlock({ saved: [{ path: '/s/a.jpg', from: 'https://x/a.jpg' }], failed: [] }).includes('ALREADY DOWNLOADED'), true, 'a linked file is announced as downloaded');
}

/** one discord.mjs at a time — every command loads discord.json, changes it and saves it whole, and
 *  the inbox timer runs beside the tick. mkdir is atomic; a lock older than ten minutes is a crash's. */
function lock(waitMs) {
  const L = join(STATE, 'discord.lock'); const until = Date.now() + waitMs;
  mkdirSync(STATE, { recursive: true });
  for (;;) {
    try { mkdirSync(L); return () => rmSync(L, { recursive: true, force: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    try { if (Date.now() - statSync(L).mtimeMs > 10 * 60e3) { rmSync(L, { recursive: true, force: true }); continue; } } catch { continue; }
    if (Date.now() >= until) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'selftest') selftest();
else if (!TOKEN || !FORUM || !OWNER) { if (cmd === 'log') process.exitCode = 3; /* unconfigured: the runner falls back to its webhook */ }
else {
  const run = { sync, inbox: () => readInbox(load()), log: () => log(rest.join(' ')), summary }[cmd];
  if (!run) { console.error('usage: discord.mjs sync | inbox | log "<text>" | summary | selftest'); process.exit(2); }
  // the inbox check is every minute: busy now = next minute. The tick waits its turn (a check takes seconds).
  const unlock = lock(cmd === 'inbox' ? 0 : 120e3);
  if (!unlock) { if (cmd !== 'inbox') { console.error('discord: discord.json is locked'); process.exitCode = 1; } }
  else try { await run(); } catch (e) { console.error(`discord: ${e.message}`); process.exitCode = 1; } finally { unlock(); }
}
