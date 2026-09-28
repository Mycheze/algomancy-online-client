# 20 — The Algomancy Online League

*Owner, 2026-09-28: a monthly league "to get people playing". The Discord poll
had 5 very interested and 5 more interested but unsure of their schedules.
The ask: sign up, set a time zone and general availability, get 3 opponents a
week matched on overlapping time slots first and on record second, coordinate
through Discord DMs, get the next week's pairings when a week ends, and finish
the month with a final between the top two. The prizes are a participation
badge and a winner badge. The format is live draft, full random (random
initiative, random 3 elements). Constructed or a chosen-trio draft may come
later. It must be testable by one person in Ben's Personal Server.*

This is the investigation and the plan. Nothing is built yet. **§9 lists the
owner's decisions.** Four were answered on 2026-09-28 and are marked
**DECIDED**. The rest take the recommended default unless overruled. The first
season is a **mid-October pilot** (§10).

It is a scheduled cousin of backlog **BL-04 (Tournaments)**. BL-04's settled
answers apply unchanged:
- games are ordinary 1v1 rooms,
- the tiebreak is OMW%,
- the clock is 60 minutes,
- a timed-out game resolves by BL-27's rule.

Its dependencies, BL-01, BL-26 and BL-27, are all done.

---

## 1. What already exists, and what is missing

| need | today | gap |
|---|---|---|
| Accounts, and a place for league data | One store, `var/accounts/accounts.json`, written atomically. An unknown top-level field survives a restart with no migration (`accounts.ts loadAccounts`). | Add `Account.league` at the **top level**, never on `profile`: `rebuildProfiles()` wipes the profile on every finished game. It needs a `STORED_ACCOUNT` line in `ui/legal.ts` (the 267 contract). |
| Discord ↔ account | `Account.linked.discord {id, username}` via `/link`. Lookup by Discord id is a linear scan (fine at this size). | Nothing. The league **requires** a link. |
| Time zones | **None anywhere.** The server stores UTC ISO strings and the UI never calls `Intl`. | Everything is new: an IANA zone and a weekly grid. |
| A room for two named accounts | Only the internal `createMatch` (the queue) and `createRematch` pre-bind `room.users`. `seatVerdict` then refuses anyone else. `/api/bot/invite` only reserves a code: the reservation expires after 6 hours, is open to anyone with the link, and binds no accounts. | A `createLeagueRoom(match)` modelled on `createMatch`. |
| Random initiative | **Already random**: `apply.ts createGame` rolls it from the room seed. | Nothing. |
| Random trio | The lobby's methods are `pick-one`, `fresh`, `rank` and `again`. `trio.ts draw()` exists. | A `'random'` `TrioMethod`, fixed for league rooms (§5). |
| A room tag | None. `persist`/`restoreRooms` write an explicit field list, so an unknown field is dropped. | `league?: {season, matchId}` threaded like `rated`/`custom`: Room → persist → restore → SavedRoom/importGame → recordLiveGame → RecordedGame → createRematch. |
| A result reaching the league | `recordFinishedGame` (`main.ts`) is the single sink for a win, a concession and a timeout. | A league hook in it. The `game.finished` event is **declared and never emitted**. |
| No-shows | **A disconnected player's clock never runs** (`clockRunning` requires both sockets), so a no-show never loses on time. | A league rule for unplayed matches (§9 Q2). |
| Bot DMs | **The bot has never sent a DM.** There is no `user.send` anywhere. | New, with handling for `Forbidden` (DMs closed). |
| Reliable server→bot delivery | The push is fire-and-forget. The ring holds 500 events, but **the bot never calls `/api/bot/events`**, so anything sent while the bot restarts is lost. | A league **outbox the bot pulls and acknowledges** (§6). A lost pairings DM is not acceptable. |
| Scheduled jobs | One `tasks.loop` (CardWatch, daily) on the bot. The server's only timer is its 1-second sweep. | A league tick on the server and an outbox loop on the bot. |
| A fake clock | None. A few queue and link functions take `now`, but every caller passes `Date.now()`. | A league clock with a test override (§8). |
| Honours | `Account.badge` is the owner/judge **trust mark**, replaced whole by `setBadge`, and BL-17 defines it. Achievements are a fixed "counter ≥ goal" catalogue: sticky, timestamped, with a game-over toast. | League honours stored on `Account.league.seasons[]`, shown as trophy chips, **plus** derived achievements. Not on `badge`. |
| Admin | The `?admin=1` dashboard has four tabs; `api-admin.ts` is gated on an admin session. | Built instead as the **organizer panel on the League page**, shown to admins (§7). |
| A second bot for testing | None. The laptop's `.env` holds the prod `DISCORD_TOKEN`. Two processes on one token answer everything twice. | A **second Discord application** (§8). |

## 2. The shape of a season

One season per calendar month, named `2026-11` and so on. It runs through
these stages:

```
 draft ──► signup ──► week 1 ──► week 2 ──► week 3 ──► week 4 ──► final ──► closed
 (admin)   (open)     (pairings go out at each week's start; results close at its end)
```

- **Week boundary:** Monday 00:00 UTC. That is Sunday afternoon or evening in
  the Americas, Monday morning in Europe, and Monday midday in Asia/Oceania.
  Each season has one boundary and the scheduler reads it from the season
  record, so it can change without code (§9 Q1).
- **Worked example, November 2026:**
  - Sign-ups open Mon 19 Oct and close Mon 2 Nov 00:00 UTC.
  - Week 1 runs 2–8 Nov, week 2 9–15, week 3 16–22, week 4 23–29.
  - The final runs Mon 30 Nov to Sun 6 Dec.

  A season is "the month its weeks start in", and the final spilling into the
  next month is expected.
- **Opponents per week:** 3 by default, a per-season setting capped at
  `entrants − 1`.
- **Every match is one game (Bo1), the final included** (DECIDED, §9 Q5).

**What small numbers mean.** Everyone playing exactly 3 needs an even field:
3 × N must be even.
- **10 players:** 12 matches per person over the month means about 3 repeats
  in week 4, because there are only 9 opponents.
- **5 players:** someone plays 2 each week, and every pair meets about 3 times
  in the month.

That is fine for a friendly league. It is why repeats are a *soft* penalty,
not a rule.

## 3. Availability

**The model.** Each account has:
- `tz`, an IANA zone. The editor defaults it from
  `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `grid`, 7 × 24 booleans (one per hour), **in the player's own local time**.

Storing local time plus the zone, rather than UTC, is deliberate. "Weeknights
7–10pm" should stay 7–10pm across a DST change.

**October–November 2026 has two DST changes inside a season:** the UK on
25 Oct and the US on 1 Nov. Overlap is always computed for a *concrete week*,
by turning each player's grid into real UTC instants for that week. The tests
pin exactly these two weeks.

**Overlap between two players in a given week:**
1. Take the intersection of their UTC hours.
2. Find the **playable windows**: runs of **at least 2 consecutive shared
   hours**. A live draft on a 60+60 clock can run well past an hour.
3. The **overlap score** is the number of *distinct days* holding a playable
   window. Three windows on the same evening is one chance to play, not three.

The pairing wants a score of **≥ 2** (a hard target it relaxes only when
impossible) and prefers **≥ 3** ("several").

**The editor.** A click-and-drag grid on the League page, pre-filled with
"weeknights 7–11pm" for a first-timer. It shows the zone with a picker to
change it. A floor on how much availability counts as enough is §9 Q8.

**In a DM,** every time is written as a Discord timestamp, `<t:UNIX:F>`.
Discord renders it in each *reader's* own zone, so the bot never formats a
time itself and cannot get a zone wrong.

## 4. Pairing

**Input:** the active players, meaning entrants minus the withdrawn and anyone
skipping this week (§9 Q6). Each has a record, an availability, and past
opponents this season.

**Output:** an edge set in which every player has degree `d`, the season's
opponents per week. When `N·d` is odd, one player has `d − 1`: the "short"
seat.

**Score of an edge (a, b)**, where lower is better:

| term | weight | why |
|---|---|---|
| overlap score < 2 | +1000 | Primary: they must be able to meet. Effectively hard. |
| overlap score = 2 | +30 | Allowed, but "several" is preferred. |
| times they have already met this season | +60 per meeting | Spread the opponents. |
| difference in league wins | +10 per win | Secondary: record. Cheap enough that it never beats a real overlap difference. |

The order of those weights *is* the owner's stated priority:
**availability ≫ fresh opponent > record.** The numbers are tuning, set by
tests and not by feel.

**The search.** This is a small degree-constrained matching (N ≲ 30):
1. A seeded random start.
2. Degree-preserving 2-swaps: (a–b, c–d) → (a–c, b–d) whenever the swap
   lowers the total.
3. Many restarts; keep the best.

It is deterministic from `hash(season, week)`, so a preview and the real
publish agree, and a test can pin a result. An exact max-weight b-matching is
not worth its code at this size.

**The short seat** rotates. It goes to whoever has been short least often,
with ties broken by lowest standing, the Swiss convention for byes.

**Before publishing,** the organizer panel shows the preview together with **every
pair below the overlap target**. The organizer sees the compromise before any
player does.

## 5. League rooms and results

**The play link is stable per match:** `https://algomancy.online/?league=<matchId>`.
Opening it:
1. Needs a signed-in account that is one of the match's two players. Anyone
   else, or a signed-out visitor, gets a plain explanation instead.
2. Returns the match's **existing unfinished room** if there is one.
   Otherwise it builds a room on the spot with `createLeagueRoom`:
   - `users` pre-bound to both accounts, so `seatVerdict` refuses anyone else;
   - `names`;
   - `mode: 'draft'`, clock 60m (the draft default, BL-04's number);
   - `league: {season, matchId}`;
   - seats randomised the way the queue does it.
3. Opens a draft lobby **fixed to the `'random'` trio method.** The trio is
   drawn uniformly from the 35 possible, seeded off the room seed, and resolves
   **once both players are present**. The method row is hidden. Nothing is
   dealt before both players arrive, which avoids the P1P1 peek that
   `trio.ts:4-7` warns about.

   The other route is to pick the elements up front and create the room with
   `els`. That skips the lobby but deals at creation. It is rejected for that
   peek.
4. Creating lazily, on first open, avoids the 6-hour reservation expiry and
   survives restarts. The room is ordinary once it exists.

**When the first player opens the link,** the opponent gets a DM:
"*Rashi is waiting for you in your league match — Play*". This is the "ready
now" ping, and it is most of the coordination value for one outbox message.
It is rate-limited to once per match per 30 minutes.

**The result.** `recordFinishedGame` is already the one sink for a win, a
concession and a timeout. If `room.league` is set, it calls
`league.recordResult(matchId, {code, winnerUserId, concession, timedOut})`.
The rules:
- **The first decided game settles the match.** After that the link shows the
  result, not a new room.
- **A turn-1 walkover counts for the league** (the opponent wins), even though
  R290 keeps it out of stats. A league no-show-by-concession is still a result.
- A **rematch** from the post-game screen is an ordinary friendly.
  `createRematch` must **not** copy `league`.
- `game.finished` is finally emitted here too, carrying `users` and the league
  tag. The bot's league cog ignores it except as a "wake up" signal (§6).

**Rated?** League games are standard rules between two accounts, so they
count in profile stats with no work. Whether they also move draft Elo is §9 Q7.

**The organizer's override.** From the organizer panel, set any match to *won by A*,
*won by B*, *unplayed* or *double loss*, with a note. This covers crashes,
diverged replays, disputes, and the no-show policy's edge cases.

## 6. Notifications: the outbox

The server owns every league message. It appends a row to
`var/league.json → outbox[]`:

```ts
{ id, to: accountId, discordId, kind, data, createdAt, sentAt?, failed? }
```

The bot **pulls** `GET /api/bot/league/outbox` every 30s (a `tasks.loop` built
exactly like CardWatch's). It sends each message, then
`POST /api/bot/league/ack {ids, failed?}`. There is also a push,
`league.outbox`, which only wakes the loop early.

Neither side can lose a message across a restart. The ack makes a resend
idempotent: a row the bot sent but never acknowledged is at worst sent twice,
never zero times.

**The DMs**, in the order a player meets them:

| kind | when | says |
|---|---|---|
| `signup` | on joining | You're in; your time zone and windows; when week 1 pairings arrive. |
| `pairings` | each week's start | 3 opponents. For each: Discord mention, league record, up to 4 shared windows as `<t:…>` stamps, and a **Play** link button. Also the week's deadline. |
| `waiting` | an opponent opened the match link | "X is waiting — Play" (rate-limited). |
| `result` | a match settles | Win or loss, new record, standing. |
| `reminder` | mid-week and 24h before the deadline, only for unplayed matches | Who is left, and the windows still ahead. |
| `final` | the finalists are set | Opponent, windows over the final week, the link. Others get "the final is X vs Y". |
| `season` | the season closes | Final standings and the badge earned. |

**When a DM is refused** (DMs closed, Discord error 50007 / `Forbidden`), the
message goes to the **league channel** as a mention. The row is marked
`failed: 'dm-closed'` so the organizer panel can show who is not getting DMs.

**The league channel** is set with `/league channel` (manage_guild, the
queuewatch pattern). It receives the public posts: sign-ups open, each week's
pairings in one message, standings after each week, the final and the
champion.

**Discord commands:**
- `/league join`. It refuses without a link and points to the site if no
  availability is set.
- `/league leave`, `/league status` (my matches and links),
  `/league standings`, `/league skip` (§9 Q6).
- `/league channel`.

Administration stays on the site, where the preview table fits.

## 7. Where the code goes

**Server** (the league lives with accounts and rooms, because the server
owns both):
- `server/league.ts`: **pure** functions for overlap, pairing, standings and
  OMW%, and `nextStage(season, now)`. It takes no I/O and no `Date.now()`, so
  all of it is unit-testable.
- `server/league-store.ts`: `var/league.json` (one file for every season) with the entrants,
  weeks, matches, results and outbox. It is written atomically like
  `accounts.ts persist()`. The path goes in `statepaths.ts` and gets a
  `STORED_FILES` line.
- `server/api-league.ts`:
  - player routes `/api/league/*`: season, signup, withdraw, skip,
    availability, my matches, standings, open match;
  - admin routes `/api/admin/league/*`: create season, preview, publish,
    advance, override, close;
  - bot routes `/api/bot/league/*`: signup by Discord id, outbox, ack.
- A league tick inside the existing 1-second sweep, checked once a minute. It
  moves the season through its stages.
  - **Automatic by default.** Pairings are generated and published at the
    boundary.
  - The organizer can **preview and regenerate at any time** before the
    boundary, **hold** a season (so the boundary waits for a manual publish),
    and **advance now**.
- Account: `Account.league = { tz, grid, seasons: [{season, place:
  'champion'|'finalist'|'participant', w, l}] }`, plus a legal.ts line.
  `publicView` gets `seasons` (trophies are public); `tz`/`grid` stay private.

**UI:**
- **A League page**, linked from the home page while a season is open or
  running. It holds the season card and sign-up, the availability editor,
  "my matches this week" (Play buttons, status, windows in the viewer's own
  time via `Intl`), the standings table, and past seasons.
- **Trophy chips** in the profile header next to `badgeChipsHtml`.
- **The organizer panel**, on the League page itself for admins (the server gates it either way).
- Add `'random'` to `ui/lobby.ts`.

**Bot:** `bot/cogs/league.py` (the commands, the outbox loop, DM rendering
and the channel fallback) and `gameserver.py` methods. `paths.py` gets
nothing: the bot keeps no league state of its own, only the channel id,
beside `queue_watch.json`.

**Achievements:** "League regular" (seasons played: 1/3/6 tiers) and "League
champion" (seasons won), counted from `Account.league.seasons`.
`refreshAchievements` runs at season close.

**Every visible step gets an `UPDATES` line** (CLAUDE.md § Deploy).

## 8. Testing with one person and one test server

### 8a. Automated: runs in `npm run check`

1. `server/test/league-*.test.ts` covers the pure module:
   - **Overlap:** zone pairs across the UK and US DST weeks of Oct–Nov 2026,
     the 2-hour window rule, and distinct-day counting.
   - **Pairing properties** for every N from 2 to 14 and d from 1 to 3:
     - exact degrees and one rotating short seat;
     - no pair below the overlap target when a feasible one exists (checked
       against brute force for N ≤ 8);
     - repeats minimised, and determinism.
   - **Standings and OMW%**, with the conventional 33% floor.
   - The **stage machine** driven by an injected `now`.
2. **An e2e script,** `server/e2e/test-league.ts`, on `spawnServer()` with a
   manual league clock:
   1. Register 8 accounts (paced under the 10-per-minute sign-up brake), set
      availability, and sign up.
   2. Admin advance, and assert the pairings.
   3. Open league matches over the WebSocket: seat binding refuses a third
      account, the trio is random with no method choice, and concede settles
      the match.
   4. Advance through 4 weeks and the final, then check standings, trophies
      and achievements.
   5. Check the no-show path.
3. **`bot/test/test_league.py`,** in the house style (fakes, no pytest):
   - an outbox round-trip against a fake aiohttp game server;
   - a `FakeUser.send` that records, or raises `Forbidden` → the channel
     fallback;
   - loop gating (`build_bot()` does not start it; it stays off when
     unconfigured);
   - every command and button clicked through `stub_interaction()`;
   - the route strings asserted in the TypeScript (`test_gameserver` §5);
   - the DynamicItem count bumped in `test_slash`/`test_components`.

### 8b. By hand: Ben, one laptop, Ben's Personal Server

**The one-time setup:**
1. **A second Discord application**, "Algomancy Test", with its own token,
   invited only to Ben's Personal Server. The prod bot's token never runs on
   the laptop: one token, one bot.
2. `.env.dev` (gitignored):
   - `DISCORD_TOKEN=<test app>`
   - `ALGO_DEV_GUILD=778331995297808438`
   - `ALGO_GAME_SERVER=http://127.0.0.1:5177`
   - `ALGO_BOT_TOKEN=<any>`, `ALGO_BOT_LISTEN=127.0.0.1:8766`
   - `ALGO_VAR_DIR=var/dev/bot`
   - `ALGO_LEAGUE_DM_REDIRECT=<Ben's Discord id>`
3. `npm --prefix client run dev:league`, a new script: the dev server on
   :5177, `var/dev/`, the bot token and push URL set, and **the league clock
   in manual mode**.
4. Run the bot with `.env.dev` and create a `#league-test` channel.

**The simulation driver,** `server/e2e/league-sim.ts` (dev only; it refuses to
run against `DEPLOY_HOST`):
- `seed`: about 9 fake players with **deliberately varied zones and grids**:
  London evenings, New York evenings, LA, Sydney, a weekend-only player, and
  one whose availability overlaps with nobody (to exercise the warning). Each
  is linked to a synthetic Discord id `sim:<n>`, which the server accepts only
  when the league clock is manual.
- `advance`: the next stage now.
- `play <week> [--leave-unplayed k] [--winner random|higher|lower]`: settles
  every sim-vs-sim match **over the real WebSocket**. Two scripted clients
  join, the trio resolves, one concedes. So the real room and result path
  runs, not a shortcut.
- `ready <player>`: opens a sim player's match link, to trigger Ben's
  "waiting" DM.
- `opponent <player>`: a scripted opponent that joins Ben's match and passes
  or concedes on cue, so Ben can play a real league room alone.

**DM redirect.** With `ALGO_LEAGUE_DM_REDIRECT` set, every DM to a `sim:` id
goes to Ben instead, headed "*→ to Rashi (sim)*". One person therefore sees
every message every player would get. Real accounts, meaning Ben's own, get
their DMs normally.

**The run.** One full season in about 30 minutes:

| step | what Ben does | what should happen |
|---|---|---|
| 1 | Admin tab → new season "2026-test", manual clock. `sim seed`. | 9 sims signed up. The `#league-test` post says sign-ups are open. |
| 2 | Sign up his real account on the site: link Discord, set availability. `/league join` on the test bot also works. | His `signup` DM; the League page lists 10. |
| 3 | Admin → preview pairings. | 10 × 3; the no-overlap sim is flagged; regenerating is stable. |
| 4 | Advance to week 1. | His own `pairings` DM with three windows (in his local time) and Play buttons, plus 9 redirected copies. The channel post. |
| 5 | `sim ready <his opponent>`. | His "waiting" DM. |
| 6 | Click Play. `sim opponent` joins and concedes at turn 3. | A random trio with no method row, the result DM, the standings update. |
| 7 | A second browser origin (`127.0.0.1:5177` vs `localhost:5177`: separate localStorage, **no code**) signed in as a sim, to play a *real* game against himself. | The whole league room by hand, both seats. |
| 8 | `sim play 1 --leave-unplayed 2`, then advance. | The no-show rule applied; reminders were sent before the deadline; week 2 pairings avoid repeats. |
| 9 | Weeks 2–4 the same way, then advance to the final. | The top two by points then OMW%; the `final` DMs. |
| 10 | Settle the final and close the season. | Trophy chips on profiles, achievements unlocked, the `season` DM and channel post. |
| 11 | Close his DMs to the server and trigger a message. | The channel fallback, and "DMs closed" in the organizer panel. |
| 12 | Kill the bot mid-week, trigger messages, restart it. | Everything arrives once (the outbox). |

**On production, before inviting people:**
- Deploy with no season open. Nothing new is visible except an empty League
  link, which is hidden while no season exists.
- Create a **hidden** season (admin-only visibility) with Ben and one willing
  volunteer from the poll, and play one real match through the prod bot.
- Delete the hidden season, then open the real one.

## 9. Decisions for the owner

1. **Calendar. DECIDED 2026-09-28: a mid-October pilot** (§10 has the
   dates). Still open: the week boundary, defaulting to Monday 00:00 UTC.
   - Recommended: weeks start Monday 00:00 UTC; 4 week-rounds and then a
     final week.
   - The first season could be **November** (sign-ups from about 19 Oct). An
     October pilot starting 12 Oct is possible but tight.
2. **An unplayed match at the deadline. DECIDED 2026-09-28: (a), no result.**
   The choices were:
   - (a) no result, both 0 points *(recommended: simple, and not playing
     already costs both players)*;
   - (b) double loss;
   - (c) a player may claim the win if they showed up (opened the link inside
     a shared window) and the opponent never did.

   Whichever is chosen, the organizer can override.
3. **Odd numbers.** The short seat plays 2 that week. Does the missing match
   count as a win, as a Swiss bye does? *Recommended: no.* A league ranks on
   points, and one missing match out of 12 is small, so a free win would
   distort more than it fixes.
4. **Standings.**
   - Recommended: 3 points for a win, 0 for a loss; tiebreaks OMW% (BL-04),
     then head to head, then fewer unplayed.
   - "Matched by record" means league wins this season, not draft Elo.
5. **The final. DECIDED 2026-09-28: a single game**, the same as every
   other league match. Still open: what happens if the top two cannot meet
   in the final week? Default: the organizer decides, using the override.
6. **Flexibility for the unsure five.**
   - Late sign-up: until week 2 pairings, starting 0–0?
   - A weekly **skip** (`/league skip` before the boundary; no pairings that
     week)?

   **DECIDED 2026-09-28: yes to both.** They turn "unsure of my schedule"
   into "I can still join", and a skip prevents a no-show.
7. **Do league games move draft Elo?** *Recommended: yes.* They are
   system-made pairings between two accounts, which is why the queue is rated
   and link games are not.
8. **An availability floor.** Must a player mark at least N hours a week to
   sign up? *Recommended: 6*, or leave it as a warning only.
9. **The participation badge.** Earned by signing up, or by playing at least
   one league match? *Recommended: at least one match played.*

## 10a. Progress (updated as it lands)

**2026-09-28, branch `league`: milestone 1 built, not yet deployed.**

- Server: `league.ts` (pure), `league-store.ts`, `api-league.ts`. The player
  routes are `/api/league/*`, the organizer's `/api/league/admin/*` (admin
  accounts, 404 otherwise) and the bot's `/api/league/bot/*` (bot token, 404
  otherwise). They live under `/api/league/` because the `/api/admin/` and
  `/api/bot/` routers 404 anything they do not know. The data is one file,
  `var/league.json` (`ALGO_LEAGUE_FILE`). The tick runs in the server's sweep
  every 30s.
  - A **manual** season (`auto: false`) moves only on Advance, which is how
    the test season runs.
  - Pairing, results, the final and honours are built too. They are pure and
    tested, so they are in place ahead of their milestones.
- UI: `ui/league.ts`, the `?league` page, with the organizer panel on it.
- Bot: `cogs/league.py` pulls and acks the outbox every 30s and serves
  `/league join | leave | skip | status | standings | channel`.
  **`ALGO_LEAGUE_DM_REDIRECT` sends EVERY DM to one user** (not just `sim:`
  ids as §8b first planned), so simulated players need no Discord link at
  all. An unlinked player's row is otherwise acked `not-linked`.
- Tests:
  - server/test 342 (availability and DST), 343 (pairing, including a
    brute-force optimum check), 344 (a whole season, the outbox and a
    restart);
  - e2e/test-league.ts (gates, the link flow, the outbox, a restart);
  - bot/test/test_league.py.

  Each guard was mutation-checked.

**Not built yet:** the league match room, meaning `?leaguematch=<id>`,
`createLeagueRoom`, the `'random'` trio method and the result hook (the
milestone 2 core). Also the `waiting` ping, the mid-week `reminder`s, the
simulation driver `league-sim.ts`, and the achievements. Until the room
exists, a result can only be set by the organizer.

## 10b. PARKED 2026-09-28: getting it up for testing

Everything is on branch **`league`** in the worktree
**`.claude/worktrees/league`**, committed. It is not merged to master and not
deployed. Every command below runs from the worktree root:

```bash
cd ~/Documents/Algomancy/.claude/worktrees/league
```

This whole flow (steps 3–7, minus Discord) was dry-run on 2026-09-28. It
produced 9 sign-ups, 9 pairings DMs and both channel posts.

**What you can test tomorrow:** sign-up, availability, pairings, the DMs,
results set by the organizer, advancing weeks, the final, closing the
season, and the badges.

**What you cannot test yet:** playing a league match through a link. The
match room is milestone 2 (§10a "Not built yet"). Until then, record results
from the organizer panel's "set…" boxes.

### One-time setup (about 10 minutes)

1. **Create the test Discord app.**
   - discord.com/developers → New Application → **"Algomancy Test"**.
   - **Bot** tab: Reset Token and copy it. On the same page, turn ON
     **Message Content Intent**. bot.py asks for it, and login fails without it.
   - **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`;
     permissions Send Messages, Embed Links, Read Message History.
   - Open that URL and add the bot to **Ben's Personal Server**.
2. **Copy your own Discord id:** Settings → Advanced → Developer Mode on, then
   right-click yourself → Copy User ID.
3. **Create `league-test.env`.** Run `cp league-test.env.example
   league-test.env` and fill its three blanks:
   - `DISCORD_TOKEN`: the TEST app's token;
   - `ALGO_LEAGUE_DM_REDIRECT`: your id;
   - `ALGO_BOT_TOKEN`: any long random string.

   It is gitignored (`*.env`).

### Each test session

4. **Start the game server:** `npm --prefix client run dev:league`. This
   serves http://127.0.0.1:5177, keeps its state in the worktree's
   `var/dev/`, and reads `league-test.env`.
5. **Start the test bot** in a second terminal: `bot/run-test-bot.sh`. It
   refuses if the token is production's. The slash commands appear in Ben's
   Personal Server at once, because they are guild-synced.
6. **Make your organizer account:**
   - Open http://127.0.0.1:5177 and sign up. This is a fresh local account
     store, not production.
   - Make it an admin:
     ```bash
     curl -X POST http://127.0.0.1:5177/api/admin/grant -H 'content-type: application/json' \
       -H 'x-algo-tester: league-test-tester-token' -d '{"name":"<your username>"}'
     ```
   - Open http://127.0.0.1:5177/?league. The **New season** form is there.
     Untick "automatic" (so it moves only when you press Advance) and tick
     "hidden". Create it, then press **Advance** twice (press, confirm) to
     open sign-ups.
7. **Add the nine simulated players:**
   ```bash
   node client/server/e2e/league-seed.ts --organizer <you> --password <yours> --season <season id>
   ```
   They have deliberately different zones. SimLunch overlaps nobody, so it
   should show as a red row in the preview.
8. **Join the league yourself, the real way:**
   - On the League page, paint your availability.
   - Profile → **Link Discord** → `/link code XXXXXX` in the test server.
   - Join, either on the page or with `/league join`.
   - In a channel, run `/league channel` so public posts have somewhere to go.
9. **Walk it through.** Most rows of the §8b table apply; its steps 5–7
   need the match room.
   - Preview, then Advance into week 1. You get your own pairings DM plus
     nine "→ to SimX" copies within about 10s (`ALGO_LEAGUE_POLL=10`).
   - Set a few results with the "set…" boxes; each sends a result DM.
   - Advance through the weeks, the final and close. Check the standings,
     the champion, the season DMs and the channel posts.
   - Also try: `/league skip`, `/league status`, `/league standings`, closing
     your DMs, and stopping the bot mid-week then restarting it (nothing
     should be lost).
10. **Starting over:** stop both, delete the worktree's `var/dev/`, and start
    again from step 4.

### After testing

- **Merge and deploy:**
  - `git push origin league:master`, then fast-forward the main checkout.
  - Add the "Recent updates" line in `client/ui/updates.ts` (CLAUDE.md §
    Deploy). It is not written yet: the page only appears once a season
    exists, so date it the day the real season is created.
  - Deploy per the checklist. This is a server change, so restart
    `algomancy-game` **and** `algomancy-bot` (new cog).
- **On the box, once:** `/league channel` in the real league channel.
- **Then open the pilot on the site:** create "October 2026 pilot", automatic,
  sign-ups open Mon 5 Oct, week 1 Mon 12 Oct 00:00 UTC, 3 weeks, 3 opponents.
- **Before 12 Oct:** milestone 2, the match room (§10 item 2).

## 10. Build order: the October pilot

The pilot is a real season, just a shorter one:

| | date (2026) |
|---|---|
| Sign-ups open | Mon 5 Oct |
| Week 1 | Mon 12 Oct (sign-ups close at its start; late sign-up stays open until week 2) |
| Week 2 | Mon 19 Oct |
| Week 3 | Mon 26 Oct (the UK leaves DST on 25 Oct; the US on 1 Nov, mid-week) |
| Final | Mon 2 – Sun 8 Nov, then the season closes and badges are awarded |

It has 3 week-rounds instead of 4. `weeks` is a per-season setting anyway.

What has to exist by each date, in build order. Each milestone lands and is
tested before the next begins.

1. **By 5 Oct: sign-ups** (7 days from now).
   - `league.ts` overlap and availability, and `league-store.ts`.
   - The clock, and the admin routes to create a season and advance it.
   - The League page: season card, sign-up, the availability editor.
   - Trophies are not needed yet.
   - Bot: `/league join`, `/league skip`, and the outbox with the `signup`
     DM. The bot part can slip to 12 Oct if needed, since sign-up works on
     the site.
   - An `UPDATES` line announcing sign-ups.
2. **By 12 Oct: week 1.**
   - Pairing and the admin preview.
   - The `'random'` trio method and `createLeagueRoom`.
   - The `league` tag threaded through persistence, the result hook, and the
     e2e script.
   - "My matches" and standings on the League page.
   - The `pairings` and `result` DMs, and the channel post.
   - The simulation rig and the §8b run end to end.
   - **This is the milestone with the risk.** It touches `rooms.ts`
     persistence and replay, so the pre-deploy replay of box games applies.
     Deploy it by Thu 8 Oct to leave a weekend for the prod smoke test.
3. **By 19 Oct: week 2.**
   - The `waiting` ping and the `reminder` DMs.
   - Late sign-up closes.
   - The unplayed-match rule and the admin override have to work when week 1
     ends.
4. **By 2 Nov: the final.** Finalist selection with OMW%, and the `final` DMs.
5. **By 8 Nov: close.** `Account.league.seasons`, trophy chips, the
   achievements, and the `season` DM and post.

The order moves up whatever players touch first. Nothing a player sees on a
date depends on work scheduled later. Milestones 3–5 are wide but shallow.

**The honest risk:** milestone 2 in the week of 5–12 Oct. If it slips, the
fallback is to open sign-ups on 5 Oct regardless, then publish week 1
pairings by hand from the admin preview, with players using the site's link.
Week 1 can start a few days late without the season breaking.
