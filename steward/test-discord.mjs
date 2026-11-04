#!/usr/bin/env node
/* steward/discord.mjs against a FAKE Discord — the owner's whole reply loop,
 * offline, in a second:   node steward/test-discord.mjs   (a text channel; `… 15` = a forum)
 *
 * What it proves: a handoff becomes a post (and its Discord-ready block a
 * forwardable message of its own); the owner's "approve" becomes exactly one
 * action and a stranger's does not; an answer with a screenshot lands in
 * answers/ with the file saved; nothing is read twice; a changed handoff is
 * re-posted; a finished one closes its post; pause works from the night log;
 * the morning summary posts once a day.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = '111', STRANGER = '222', BOT = '999', FORUM = '500';
const KIND = Number(process.argv[2] ?? 0);   // 0 = a text channel (private threads), 15 = a forum
let next = 1000n; const id = () => String(next++);
const threads = new Map(); // id → { name, archived, msgs: [{id, author, content, attachments, files}] }
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('latin1');
  let body = {};
  if (/multipart/.test(req.headers['content-type'] || '')) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type']).slice(1).find(Boolean);
    const parts = Buffer.concat(chunks).toString('utf8').split('--' + boundary).slice(1, -1).map(pt => {
      const [head, ...rest] = pt.replace(/^\r\n/, '').split('\r\n\r\n'); return { head, data: rest.join('\r\n\r\n').replace(/\r\n$/, '') };
    });
    body = JSON.parse(parts.find(x => /name="payload_json"/.test(x.head)).data);
    body.__files = parts.map(x => /filename="([^"]+)"/.exec(x.head)?.[1]).filter(Boolean);
  } else if (raw) body = JSON.parse(raw);
  const u = new URL(req.url, 'http://x'); const p = u.pathname.replace(/^\/api/, '');
  const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  let m;
  if (p === '/files/shot.png') { res.writeHead(200); return res.end(PNG); }
  if (req.method === 'GET' && p === `/channels/${FORUM}`) return json({ id: FORUM, type: KIND });
  if (req.method === 'POST' && (m = /^\/channels\/(\d+)\/threads$/.exec(p)) && m[1] === FORUM) {
    const t = id();
    if (KIND === 15) threads.set(t, { name: body.name, archived: false, members: [], msgs: [{ id: t, author: { id: BOT, bot: true }, content: body.message.content, files: body.__files || [] }] });
    else { if (body.type !== 12) return json({ message: 'a text-channel thread must be private (type 12)' }, 400); threads.set(t, { name: body.name, archived: false, members: [], msgs: [] }); }
    return json({ id: t });
  }
  if (req.method === 'PUT' && (m = /^\/channels\/(\d+)\/thread-members\/(\d+)$/.exec(p))) { threads.get(m[1]).members.push(m[2]); res.writeHead(204); return res.end(); }
  if (req.method === 'POST' && (m = /^\/channels\/(\d+)\/messages$/.exec(p))) {
    const t = threads.get(m[1]); const msg = { id: id(), author: { id: BOT, bot: true }, content: body.content, files: body.__files || [] }; t.msgs.push(msg); return json(msg);
  }
  if (req.method === 'GET' && (m = /^\/channels\/(\d+)\/messages$/.exec(p))) {
    const after = BigInt(u.searchParams.get('after') || '0');
    return json(threads.get(m[1]).msgs.filter(x => BigInt(x.id) > after).reverse());
  }
  if (req.method === 'PUT' && /\/reactions\//.test(p)) { res.writeHead(204); return res.end(); }
  if (req.method === 'PATCH' && (m = /^\/channels\/(\d+)$/.exec(p))) { threads.get(m[1]).archived = !!body.archived; return json({}); }
  json({ message: 'unknown route ' + req.method + ' ' + p }, 404);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// a scratch state dir and a scratch repo with one staged branch (CT-1); CT-2 is a question, no branch
const T = mkdtempSync(join(tmpdir(), 'steward-discord-'));
const STATE = join(T, 'state'), REPO = join(T, 'repo');
mkdirSync(join(STATE, 'handoffs', 'done'), { recursive: true }); mkdirSync(REPO);
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { stdio: 'pipe' });
git('init', '-q'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
git('update-ref', 'refs/remotes/origin/steward/CT-1', 'HEAD');
writeFileSync(join(STATE, 'handoffs', 'CT-1.md'), '# CT-1 — a fix\n\n**Needs from you:** approve the branch\n\n## What I found\nVerified: it was broken.\n');
writeFileSync(join(STATE, 'handoffs', 'CT-2.md'), '# CT-2 — a rules question\n\n**Needs from you:** answer Q1\n\n## What I found\nTwo readings.\n\n## Questions\n### Q1 — A or B?\n\n**Discord-ready:**\n> Does X do Y?\n\nAnswer with: …\n');

const envv = { ...process.env, STEWARD_DISCORD_API: base, STEWARD_DISCORD_TOKEN: 't', STEWARD_DISCORD_FORUM: FORUM, STEWARD_DISCORD_OWNER: OWNER, STEWARD_STATE: STATE, STEWARD_REPO: REPO };
// async: a sync child would block this process's event loop, and with it the fake server
const run = async (...a) => (await promisify(execFile)('node', [join(HERE, 'discord.mjs'), ...a], { env: envv, encoding: 'utf8' })).stdout.trim();
const db = () => JSON.parse(readFileSync(join(STATE, 'discord.json'), 'utf8'));
const owner = (t, content, attachments = []) => threads.get(t).msgs.push({ id: id(), author: { id: OWNER }, content, attachments });
const stranger = (t, content) => threads.get(t).msgs.push({ id: id(), author: { id: STRANGER }, content, attachments: [] });

let fail = 0; const ok = (c, what) => { console.log(`${c ? '✓' : '✗'} ${what}`); if (!c) fail++; };

try {
  ok((await run('sync')) === '' && threads.size === 2, 'two handoffs → two posts, no actions');
  const t1 = db().items['CT-1'].thread, t2 = db().items['CT-2'].thread;
  if (KIND === 0) ok([...threads.values()].every(t => t.members.includes(OWNER)), 'text channel: every thread is private with the owner added');
  ok(/approve/.test(threads.get(t1).msgs[0].content) && threads.get(t1).msgs[0].files.includes('CT-1.md'), 'a branch post says how to approve and carries the write-up');
  ok(!/\*\*approve\*\*/.test(threads.get(t2).msgs[0].content), 'a question with no branch does not offer approve');
  ok(threads.get(t2).msgs[1]?.content.includes('Does X do Y?') && !threads.get(t2).msgs[1].content.includes('> '), 'the Discord-ready question is its own forwardable message, unquoted');

  (await run('log', 'hello')); const lt = db().log.thread;
  stranger(t1, 'approve'); owner(t1, 'approve');
  owner(t2, 'B — it enters with the Virus', [{ url: `${base}/files/shot.png`, filename: 'shot.png' }]);
  owner(t2, 'approve'); owner(lt, 'pause');
  const acts = (await run('sync')).split('\n');
  ok(JSON.stringify(acts) === JSON.stringify(['pause', 'approve CT-1']), `the owner's approve and pause, once each; the stranger's approve ignored (${acts.join(' | ')})`);
  const ans = readFileSync(join(STATE, 'answers', 'CT-2.md'), 'utf8');
  ok(ans.includes('B — it enters with the Virus') && /Screenshots/.test(ans), 'the answer is written for the worker');
  const shot = /- (\S+shot\.png)/.exec(ans)?.[1];
  ok(shot && existsSync(shot) && readFileSync(shot).equals(PNG), 'the screenshot is saved where the answer points');
  ok(threads.get(t2).msgs.some(m => /no branch to approve/.test(m.content || '')), 'approve on a question gets told there is nothing to approve');
  ok(/"outcome":"answered"/.test(readFileSync(join(STATE, 'journal.jsonl'), 'utf8')), 'the answer is journalled');
  ok((await run('sync')) === '', 'nothing is read twice');

  const before = threads.get(t2).msgs.length;
  appendFileSync(join(STATE, 'handoffs', 'CT-2.md'), '\nUpdated after your answer.\n');
  (await run('sync')); ok(threads.get(t2).msgs.length > before && /Updated/.test(threads.get(t2).msgs[before].content), 'a changed handoff is re-posted in its post');

  renameSync(join(STATE, 'handoffs', 'CT-1.md'), join(STATE, 'handoffs', 'done', 'CT-1.md'));
  appendFileSync(join(STATE, 'journal.jsonl'), JSON.stringify({ ts: new Date().toISOString(), item: 'CT-1', outcome: 'landed', sha: 'abcdef1234' }) + '\n');
  (await run('sync')); ok(threads.get(t1).archived && /Closed:\*\* landed/.test(threads.get(t1).msgs.at(-1).content), 'a finished item closes its post with the outcome');

  owner(t2, 'reject: wrong approach, do it in one batch');
  ok((await run('sync')) === 'reject CT-2 wrong approach, do it in one batch', 'reject carries its reason');

  (await run('summary')); const n = threads.get(lt).msgs.length; (await run('summary'));
  ok(/The night of/.test(threads.get(lt).msgs.at(-1).content) && threads.get(lt).msgs.length === n, 'the morning summary posts once a day');
} finally {
  server.close(); rmSync(T, { recursive: true, force: true });
}
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
