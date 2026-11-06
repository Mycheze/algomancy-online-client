#!/usr/bin/env node
/* The steward's daily look in the mirror — what made yesterday's runs slow,
 * stuck or half-done, read off their own transcripts.
 *
 * Why (owner, 2026-11-06): the worker updated Mindburn's text, could not fetch
 * the new card image (curl and WebFetch denied — three attempts, all in the
 * run's own log), shipped the card half done and asked him to paste the image
 * in. "Maybe it'd be good to have a daily check to see what's making the skill
 * take a long time and do an update to it to improve weak points or stop it
 * from getting stuck." Every one of those signals was already on disk: the
 * stream-json transcript of each run ends with a `result` record that lists
 * every permission denial, and the journal row says how long it took and how
 * it ended. Nobody read them.
 *
 *   node steward/retro.mjs digest [--hours 24] [--day YYYY-MM-DD]
 *       → writes $STEWARD_STATE/retro/<day>.md, prints its path; exit 3 = no runs to review
 *   node steward/retro.mjs selftest
 *
 * This file is deterministic: it MEASURES and ranks. The `retro <day>` queue
 * item (steward/queue.mjs) hands the digest to the agent, which follows the
 * skill's §15 to find the cause of the worst runs and fix it in the harness.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE = process.env.STEWARD_STATE || join(homedir(), 'algomancy-steward', 'state');
const BAD = new Set(['failed', 'gave-up', 'gate-red', 'gate-red-twice', 'needs-human', 'staged', 'skip']);
/** words a run uses when it stopped short — the Mindburn run's summary said "Not done: the new scan" */
const SHORT = /\b(not done|could not|couldn't|cannot|can't|unable|absent|missing|blocked|left (?:for|to) (?:you|the owner|him)|paste|attach (?:it|the)|no (?:download|network|internet))\b/i;
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1) + '…'; };

/** one run's transcript → the numbers that matter */
export function readRun(text) {
  const r = { tools: {}, errors: [], denials: [], bash: {}, tests: 0, result: null, lastText: '' };
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'assistant') {
      for (const c of o.message?.content || []) {
        if (c.type === 'text' && c.text) r.lastText = c.text;
        if (c.type !== 'tool_use') continue;
        r.tools[c.name] = (r.tools[c.name] || 0) + 1;
        if (c.name === 'Bash') {
          const cmd = clip(c.input?.command, 140);
          r.bash[cmd] = (r.bash[cmd] || 0) + 1;
          if (/node (--\S+ )*--test|npm (run )?test|run_all\.py|test-runner\.sh|test-discord\.mjs/.test(c.input?.command || '')) r.tests++;
        }
      }
    } else if (o.type === 'user') {
      for (const c of o.message?.content || []) {
        if (c.type === 'tool_result' && c.is_error) {
          const body = Array.isArray(c.content) ? c.content.map(x => x.text || '').join(' ') : c.content;
          r.errors.push(clip(body, 200));
        }
      }
    } else if (o.type === 'result') {
      r.result = o;
      for (const d of o.permission_denials || []) r.denials.push(`${d.tool_name}: ${clip(JSON.stringify(d.tool_input), 200)}`);
    }
  }
  return r;
}

/** how much a run deserves a look — the ranking, not a verdict */
export function badness(row, run) {
  let s = 0;
  if (BAD.has(String(row.outcome).replace(/^dry-/, ''))) s += 5;
  if (!run?.result) s += 6;                                   // killed: timeout, crash, usage limit
  s += 3 * (run?.denials.length || 0);
  s += Math.min(5, run?.errors.length || 0);
  s += Math.min(6, Math.floor((+row.minutes || 0) / 30));
  if (SHORT.test(`${row.summary || ''} ${run?.result?.result || ''}`)) s += 4;
  s += Object.values(run?.bash || {}).filter(n => n >= 3).length * 2;
  return s;
}

export function digest(rows, readLog, { day, hours }) {
  const runs = rows.filter(r => r.run && r.by !== 'owner').map(row => {
    let run = null; try { run = readRun(readLog(row.run)); } catch { /* log rotated away */ }
    return { row, run, score: badness(row, run) };
  }).sort((a, b) => b.score - a.score);
  const owner = rows.filter(r => r.by === 'owner' && r.outcome !== 'inbox');
  const tally = {}; for (const { row } of runs) tally[row.outcome] = (tally[row.outcome] || 0) + 1;
  const items = {}; for (const { row } of runs) items[row.item] = (items[row.item] || 0) + 1;
  const twice = Object.entries(items).filter(([, n]) => n > 1);
  const L = [];
  L.push(`# Steward retro — ${day} (the last ${hours} h)`, '');
  L.push(`${runs.length} run(s): ${Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}.`);
  L.push(`Total ${runs.reduce((n, x) => n + (+x.row.minutes || 0), 0)} min, ${runs.reduce((n, x) => n + (x.run?.result?.num_turns || 0), 0)} turns, $${runs.reduce((n, x) => n + (x.run?.result?.total_cost_usd || 0), 0).toFixed(2)} at list price.`);
  if (twice.length) L.push(`Taken more than once: ${twice.map(([k, n]) => `${k} ×${n}`).join(', ')} — rework is a signal.`);
  if (owner.length) {
    L.push('', '## What the owner said back', '');
    for (const r of owner) L.push(`- \`${r.item}\` ${r.outcome}: ${clip(r.note || r.why || '', 300)}`);
  }
  L.push('', '## Runs, worst first', '',
    'Score = how much a run deserves a look (bad outcome, killed, permission denials, tool errors, long, said it stopped short, repeated commands). Open the transcript of the top ones: `jq -c \'select(.type=="assistant") | .message.content[] | select(.type=="tool_use") | {name, input}\' <log>`.');
  for (const { row, run, score } of runs.slice(0, 12)) {
    L.push('', `### ${score} — \`${row.item}\` → ${row.outcome}${row.minutes ? `, ${row.minutes} min` : ''}`);
    if (row.title) L.push(`${clip(row.title, 200)}`);
    L.push(`- transcript: ${row.run}${run?.result ? ` (${run.result.num_turns ?? '?'} turns, ${Math.round((run.result.duration_ms || 0) / 60000)} min in the model, ${run.result.subtype})` : ' — **no result record: killed, timed out or crashed**'}`);
    if (run) {
      const top = Object.entries(run.tools).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ');
      if (top) L.push(`- tools: ${top}; test runs: ${run.tests}`);
      for (const d of run.denials) L.push(`- **denied** ${d}`);
      if (run.errors.length) L.push(`- ${run.errors.length} tool error(s); first: ${run.errors.slice(0, 3).map(e => `“${e}”`).join(' · ')}`);
      const rep = Object.entries(run.bash).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4);
      for (const [c, n] of rep) L.push(`- ran ${n}× \`${c}\``);
    }
    const said = `${row.summary || ''}`;
    if (SHORT.test(said)) L.push(`- **said it stopped short:** ${clip(said.slice(Math.max(0, said.search(SHORT) - 120)), 360)}`);
    else if (row.summary) L.push(`- summary: ${clip(row.summary, 300)}`);
  }
  return L.join('\n') + '\n';
}

function journal() {
  const f = join(STATE, 'journal.jsonl');
  return (existsSync(f) ? readFileSync(f, 'utf8') : '').split('\n').filter(Boolean)
    .flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function selftest() {
  const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error(`✗ ${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); process.exitCode = 1; } else console.log(`✓ ${what}`); };
  const log = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'curl -o x https://cdn/x.jpg' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Permission to use Bash with command curl has been denied.' }] } },
    ...[1, 2, 3].map(() => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node --test client/engine/test/44-hybrids-ld-a.test.ts' } }] } })),
    { type: 'result', subtype: 'success', num_turns: 40, duration_ms: 1200000, total_cost_usd: 1.5, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'curl -o x https://cdn/x.jpg' } }] },
  ].map(o => JSON.stringify(o)).join('\n');
  const run = readRun(log);
  eq(run.denials.length, 1, 'a permission denial is read off the result record');
  eq(run.errors.length, 1, 'a tool error is counted');
  eq(run.tests, 3, 'test runs are counted');
  eq(Object.values(run.bash).includes(3), true, 'a repeated command is counted');
  const half = { item: 'inbox-1', outcome: 'shipped', minutes: 45, run: 'a', summary: 'Not done: the new scan (no download from the box).' };
  const clean = { item: 'CT-1', outcome: 'shipped', minutes: 20, run: 'b', summary: 'Fixed.' };
  eq(badness(half, run) > badness(clean, readRun(log.split('\n').filter(l => !/curl|"is_error":true/.test(l)).join('\n'))), true, 'a half-done run with a denial ranks above a clean one');
  eq(badness(clean, null) >= 6, true, 'a run with no transcript (killed) ranks high');
  const md = digest([half, clean, { item: 'inbox-1', outcome: 'answered', by: 'owner', note: 'here is the image' }], () => log, { day: '2026-11-06', hours: 24 });
  eq(/\*\*denied\*\* Bash/.test(md) && /said it stopped short/.test(md) && /What the owner said back/.test(md), true, 'the digest names the denial, the short stop and the owner\'s reply');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = k => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'selftest') selftest();
  else if (cmd === 'digest') {
    const hours = Number(opt('hours') || 24);
    const day = opt('day') || new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - hours * 3600e3).toISOString();
    const rows = journal().filter(r => String(r.ts) >= since.slice(0, 19));
    if (!rows.some(r => r.run && r.by !== 'owner')) { console.error('retro: no runs to review'); process.exit(3); }
    const md = digest(rows, p => readFileSync(p, 'utf8'), { day, hours });
    mkdirSync(join(STATE, 'retro'), { recursive: true });
    const out = join(STATE, 'retro', `${day}.md`);
    writeFileSync(out, md); console.log(out);
  } else { console.error('usage: retro.mjs digest [--hours 24] [--day YYYY-MM-DD] | selftest'); process.exit(2); }
}
