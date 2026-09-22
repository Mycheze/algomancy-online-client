/*
 * WHAT A STRANGER READS FIRST (BL-15).
 *
 * This is the only part of the client with no game in it. It is the notice, the
 * attribution, the privacy policy and the terms — and, more than any of those,
 * it is the place that tells you to go and buy the actual game.
 *
 * THREE THINGS ABOUT IT ARE NOT STYLE CHOICES.
 *
 *  1. THE UNOFFICIAL NOTICE IS NOT ON A PAGE YOU CLICK TO. It is in the
 *     footer, in the document itself, on every screen that is not the board —
 *     and the footer's top edge is pulled ABOVE the fold (the 128px in the CSS
 *     below), so `doneWhen`'s "a signed-out visitor sees it without hunting"
 *     holds without a strip across the top of every page. There WAS such a
 *     strip until 2026-09-05 (the owner: "I don't like the top bar with all
 *     the information, the footer is more than enough"); the footer carried
 *     everything it said, so it went. Do not bring it back as a banner.
 *
 *  2. THE TWO SHOP URLS ARE VERBATIM AND THE ORDER IS FIXED. The owner gave
 *     both on 2026-08-25; the pitch order he gave is physical > print-and-play >
 *     play here for free, and it is that order because the print-and-play is
 *     the fallback for someone who will not spend box money on a game they have
 *     not tried, not a cheaper equivalent. Do not substitute a store search
 *     page, a shortened link, or an affiliate wrapper. `267-legal-and-
 *     attribution.test.ts` pins both strings and the order they appear in.
 *
 *  3. THERE IS NO OFFICIAL CLIENT, and no copy here may imply one. The Steam
 *     page is a "we want to make this" that is not being worked on. Saying
 *     "unofficial" while implying there is an official one to be unofficial
 *     *of* is the exact wrong impression to leave.
 *
 * WHAT THIS MODULE OWNS, AND WHY IT IS SHAPED THIS WAY.
 *
 * `installLegal()` is the whole interface: one import, one call, no hook in
 * `renderHome()` and no branch in `handleButton()`. Everything it paints lives
 * OUTSIDE `#app`, which is the same trick `ui/anim.ts` uses — `render()` wipes
 * `#app.innerHTML` on every frame and cannot touch what is not inside it. Its
 * buttons carry `data-legal`, never `data-btn`, so `main.ts`'s global click
 * listener does not see them at all (it asks `closest('[data-btn]')` first and
 * returns when there is no game). The styles are injected from here rather than
 * added to `style.css` for the same reason: this thing should be removable, or
 * replaceable, in one file.
 *
 * THE STORAGE LIST IS DERIVED, NOT TYPED OUT. A privacy policy that lists what
 * is stored is a promise about a data structure, and a promise about a data
 * structure written in prose drifts the first time somebody adds a field. So
 * every line of the "what the server keeps" section names the exact identifiers
 * in `server/accounts.ts` and `server/statepaths.ts` it accounts for, in
 * `covers`, and the guard test parses those files and asserts the two sets are
 * EQUAL — both directions. Add a field to `Account` and the suite fails until
 * this page says what it is.
 */

// ── the two links, exactly as the owner gave them ─────────────────────

/** the boxed game. FIRST in every pitch: this is the recommendation. */
export const BUY_PHYSICAL = 'https://shop.calebgannon.com/products/algomancy-the-base-game';

/** the cheap way in, and the honest fallback — still supports the creator */
export const BUY_PNP = 'https://shop.calebgannon.com/products/algomancy-print-and-play-edition';

/** the community Discord — the invite the official site, algomancy.io, links
 *  (copied off its page 2026-09-15; it resolves to "Caleb Gannon's Discord") */
export const DISCORD_INVITE = 'https://discord.gg/eD4ubaV36h';

/** The sentence that has to be unmissable. Kept as one exported string so the
 *  footer and the About page cannot drift from each other.
 *
 *  ENDORSED, NOT AFFILIATED. The owner, 2026-09-15: "it IS endorsed by him.
 *  Just not affiliated with him at all." Caleb approves of this client; he does
 *  not publish it, run it or answer for it — and the About page still says so. */
export const UNOFFICIAL =
  'An unofficial fan project, endorsed by Caleb Gannon but not affiliated with him '
  + 'or with Algomancy.';

// ── what is stored, keyed to the code that stores it ──────────────────

/**
 * One line of the privacy page.
 *
 * `covers` is the load-bearing half: every name in it must be a real field of
 * the interface it belongs to (or, for `STORED_FILES`, a real getter in
 * `server/statepaths.ts`). The prose is for the reader; `covers` is what the
 * guard checks, and what makes adding a field to the account store a failing
 * test rather than a silently stale promise.
 */
export interface StoredLine {
  /** exact identifiers in server/accounts.ts (or statepaths.ts) this accounts for */
  readonly covers: readonly string[];
  /** what the reader is told, in plain words */
  readonly what: string;
}

/** `interface Account` — the row that is you. */
export const STORED_ACCOUNT: readonly StoredLine[] = [
  { covers: ['username', 'key'], what: 'Your name, as you typed it, plus a lowercased copy of it — that copy is what a login matches on, and what stops two people taking the same name.' },
  { covers: ['id', 'createdAt'], what: 'A random id for the account, and the date you made it.' },
  { covers: ['salt', 'hash'], what: 'Your password, as a scrypt hash and the random salt it was hashed with. Never the password itself — see below.' },
  { covers: ['profile'], what: 'Your stat sheet: games, wins, losses, what you played, what you killed, what you lost, your streaks, and your record against each opponent. Every number of it is a sum over your saved games, so it can be recomputed and never has to be trusted on its own.' },
  { covers: ['achievements'], what: 'Which achievements you have, and the moment each one unlocked.' },
  { covers: ['friends', 'incoming', 'outgoing'], what: 'Your friends list, and any friend request you have sent or been sent.' },
  { covers: ['recorded'], what: 'The room codes already folded into your stats — bookkeeping, so a game cannot be counted twice.' },
  { covers: ['decks'], what: 'The decks you have built: their names, their card lists, their descriptions and whether you published them.' },
  { covers: ['provisional'], what: 'A flag saying this account was made by pressing play rather than by signing up — a guest. It is an ordinary account in every other way, with its own rating and history; the flag only means nobody has given it a name and a password yet. Choosing those after a game clears it, and the games you already played stay yours because it was always the same account.' },
  { covers: ['favorite'], what: 'The element you chose as your favourite on the stats tab, if you chose one — otherwise the profile shows whichever you have played most, and nothing is stored.' },
  { covers: ['badge'], what: 'A trust mark the site\'s owner can set on an account by hand — an "owner" flag, or a judge level from 1 to 3 — and when it was set. Nobody gets one by playing. It says whose bug reports and rules opinions are read first, it is shown on the profile, and it is copied onto any report the account files.' },
  { covers: ['admin'], what: 'A flag saying this account can use the site\'s admin page — the operator\'s view of accounts, bug reports, the game history and the games running right now. It is set by hand and never by playing, it is separate from the judge badge, and it is not shown anywhere on your profile. If you do not have it you cannot tell the page exists, which is deliberate. It lets the person holding it see the list of accounts and the games that have been played, which is why it is written down here rather than left as an implementation detail.' },
  { covers: ['linked'], what: 'Any other account you have deliberately linked to this one — at the moment that means a Discord account, and only if you asked for it: its user id, the handle it had when you linked it, and when. It is what lets the Discord bot show you your own rating without you typing your name. Unlink it from this page and the row is gone.' },
];

/** `interface Session` — what keeps you signed in. */
export const STORED_SESSION: readonly StoredLine[] = [
  { covers: ['token', 'userId'], what: 'A random session token and whose it is. The token also sits in your browser, and the pair of them is the whole of "you are logged in".' },
  { covers: ['createdAt', 'lastSeen'], what: 'When you signed in, and when that session was last used.' },
];

/** `interface RecordedGame` — the match history. */
export const STORED_GAME: readonly StoredLine[] = [
  { covers: ['code', 'playedAt', 'recordedAt'], what: 'Which room it was, when it was played, and when it went into the record.' },
  { covers: ['mode', 'els'], what: 'The format, and the three elements it was played with.' },
  { covers: ['finished', 'winner', 'turns', 'diverged', 'matchMs'], what: 'Whether it reached an ending, who won, how many turns it ran for, how long it took in real minutes, and whether the current rules can still replay it.' },
  { covers: ['rated'], what: 'Whether the matchmaking queue set this game up, which is what decides if it moved your rating. A game you started by sending somebody a room code is not rated.' },
  { covers: ['users', 'names', 'deckIds'], what: 'Who sat in each seat, the names shown at the time, and — in constructed — which of your decks you brought.' },
  { covers: ['seats'], what: "Both players' numbers for that game: damage, cards played, units lost, and the rest of what the stat sheet is a sum of." },
  { covers: ['custom'], what: 'If the game was played with custom rules (pack size, elements, simple cards only, banned cards and so on): which rules. A custom game stays in your match history and counts toward nothing.' },
  { covers: ['single'], what: 'If the game was a Single Card Duel: the card each of you played. It stays in your match history, counts toward nothing of yours, and moves those two cards on the public card ladder.' },
  { covers: ['concession'], what: 'If the game ended by concession: which seat conceded and on which turn. That decides how much the game weighs — a turn-1 concession is a walkover that counts for nothing, a turn-2 one counts at half rating weight, later ones count in full.' },
];

/**
 * Everything the server writes to disk, keyed to the getter in
 * `server/statepaths.ts` that names it. This is the section that catches the
 * things a privacy page written from `accounts.ts` alone would miss — the saved
 * games are a separate file per room, and the Report button writes a third file.
 */
export const STORED_FILES: readonly StoredLine[] = [
  { covers: ['accountsFile'], what: 'One JSON file holding every account, every session and the whole match history — the three lists above.' },
  { covers: ['gamesDir'], what: 'Every game is saved whole: the shuffle seed and the complete list of actions both players took, which is enough to replay it move for move. That is how a bug gets diagnosed and how your stats are recomputed after a rules fix. It is also, unavoidably, a full record of how you played.' },
  { covers: ['issuesFile'], what: 'Anything you send with the in-game Report button: the kind you picked (bug, interface issue, feature request, other), the severity if you gave one, your note, the room and your seat if you were in a game, how far into it you were, which page you sent it from otherwise, and — if you were signed in when you sent it — your account name and id, with any trust mark on the account, so the report can be weighed and answered. Only what you chose and typed — it does not scrape anything else.' },
  { covers: ['verdictsFile'], what: "Verdicts from the card-testing tool, which is the owner's own instrument for checking that a card does what it says. Ordinary games never write to it." },
  { covers: ['reportMarksFile'], what: 'Whether the site\'s owner has read a bug report and thought it was real or not, which report it was about, which admin account said so and when. It is a note about a REPORT, not about you, and it holds nothing you wrote — the report itself is in the file above. Nothing here is shown to anybody but an admin.' },
];

/**
 * What your BROWSER keeps, which is a different question and one people forget
 * to ask. None of it is sent anywhere except the session token, which has to be
 * or you would not stay logged in. The guard sweeps `ui/*.ts` for storage keys
 * and asserts this list covers every one it finds.
 */
export const BROWSER_KEYS: readonly StoredLine[] = [
  { covers: ['algoToken'], what: 'your session token — this is the one that goes back to the server' },
  { covers: ['algoName'], what: 'the name you type on the home screen when you are not signed in' },
  { covers: ['algoDeck', 'algoEls'], what: 'the deck and the element trio you last picked, so the home screen remembers' },
  { covers: ['algoCardQuery', 'algoCardSearches'], what: 'your last card-browser search and any searches you saved' },
  { covers: ['algoSound', 'algoMotion'], what: 'whether you turned sound and animation on or off' },
  { covers: ['algoAutopass', 'algoBluffHaste', 'algoLogVerbose', 'algoLayout'], what: 'four in-game display preferences, the last being which board you chose: classic or regions' },
  { covers: ['algoClockMs'], what: 'the clock length you last chose for a game you started' },
  { covers: ['algoCustomRules'], what: 'the custom rules you last set up for a live draft, so the panel remembers them' },
  { covers: ['algoSingleCard'], what: 'the card you last picked for a Single Card Duel' },
  { covers: ['algoLearn'], what: 'your Learn to Play game and which lessons you have read, so you can pick up where you left off' },
  { covers: ['algoQueueMode', 'algoQueueRanked'], what: 'the format and the ranked/open choice you last used in the matchmaking queue, so it comes back the way you left it' },
];

// ── the copy ──────────────────────────────────────────────────────────

/** the pitch, in the fixed order: box, then print-and-play, then "and this is
 *  free". Written once and used by both the footer and the About page. */
function pitchHtml(): string {
  return `
    <p>This client is for playing Algomancy with somebody far away, and for teaching
      it to a friend in an evening. It is not a substitute for owning the game.</p>
    <p><b>Buy the box.</b> Algomancy is a physical game by Caleb Gannon, and buying it
      is what funds more of it. If you enjoy it here, that is the moment to buy it.</p>
    <p><b>Or the print-and-play.</b> The whole game for very little money — and every
      copy still supports the creator.</p>
    <div class="lgbuys">
      <a class="lgbuy primary" href="${BUY_PHYSICAL}" target="_blank" rel="noopener noreferrer">
        Buy the physical game →</a>
      <a class="lgbuy" href="${BUY_PNP}" target="_blank" rel="noopener noreferrer">
        Buy the print-and-play →</a>
    </div>
    <p class="lgdim">Both links go to Caleb Gannon's own shop. No affiliate code, no cut —
      nothing reaches this project.</p>`;
}

/** turn a `StoredLine[]` into the page's definition list */
function storedList(lines: readonly StoredLine[]): string {
  // the names go in ONE grid child, not one per name — two <code> siblings and
  // a <span> in a two-column grid put the prose in column 1 of the next row
  return `<ul class="lgstore">${lines.map(l =>
    `<li><div class="lgkeys"><code>${l.covers.join('</code><code>')}</code></div>`
    + `<span>${l.what}</span></li>`).join('')}</ul>`;
}

function aboutHtml(): string {
  return `
    <h2>What this is</h2>
    <p>A fan-made, rules-enforcing client for <b>Algomancy</b>, the card game designed by
      Caleb Gannon. It was developed and directed by <b>Ben Adams</b>, who also pays for
      it, because he wanted to play with friends who live too far away and to have
      somewhere to teach the game to people who have never seen it. The code itself was
      written by <b>Claude</b>, Anthropic's AI model, working from his direction, his
      rulings and his playtesting.</p>
    <p class="lgloud">${UNOFFICIAL} Caleb has not published this, does not run it, and is not
      responsible for anything it gets wrong.</p>

    <h2>And there is no official client</h2>
    <p>Worth saying plainly, because "unofficial" implies there is an official one to be
      unofficial of. There is not. There is a Steam page saying a digital Algomancy is
      wanted; it is not currently being worked on, and nothing here is it, replaces it, or
      claims any connection to it. If an official client ever ships, buy that too.</p>

    <h2>Buy the game</h2>
    ${pitchHtml()}

    <h2>Attribution</h2>
    <p>Algomancy — the name, the rules, the card names, the card text, the artwork and
      every card scan you see in this client — is the work of <b>Caleb Gannon</b> and
      belongs to him. It is reproduced here for one reason: so you can read the card you
      are holding while you play. Nothing is sold, nothing is licensed, and nothing is
      earned from any of it.</p>
    <p>The client's own code — the rules engine, the server and this browser client — was
      written by Claude (Anthropic's AI model) and developed and directed by Ben Adams. It
      is the fan project's, and is not Caleb's work or his responsibility. Where the engine
      has had to decide something the printed rules leave open, that decision is the fan
      project's too, and it can be wrong.</p>
    <p>If the rights holder wants any of this changed, taken down, or handled differently,
      it will be — no argument.</p>

    <h2>Free, and staying free</h2>
    <p>No charge, no accounts to buy, no currency, no cosmetics, no ads, no analytics, no
      economy of any kind. It is paid for out of one person's pocket and there is no
      intention of ever making money from it. See <b>Terms</b> for that in as many words.</p>`;
}

function privacyHtml(): string {
  return `
    <h2>The short version</h2>
    <p class="lgloud">No email address is asked for or stored. No ads, no trackers, no
      analytics. Nothing here is sold or shared, and — with the one exception below, the
      rules judge — nothing is sent anywhere else. What is kept is what it takes to show
      your name, count your games and let you sign back in.</p>
    <p>You can play without an account at all — the home screen takes a name and nothing
      else, and a game played signed out is recorded against nobody.</p>

    <h2>Your password, and the fact that it cannot be reset</h2>
    <p>Your password is never stored and never logged. It is put through <b>scrypt</b> with
      a random per-user salt and only the result is kept, and a login compares the two in
      constant time. Somebody who took the account file could not read your password out
      of it.</p>
    <p class="lgloud"><b>There is no password reset.</b> That follows directly from there
      being no email address: nothing on this server can tell that an account is yours
      except the password itself. If you forget it, the account cannot be recovered — its
      games stay in the record, and you cannot get back into it. Make a new one under a
      new name and start again.</p>
    <p>While you <i>are</i> signed in you can change your password whenever you like, from
      your profile. That is the moment to do it.</p>

    <h2>What the server keeps about you</h2>
    <p>Your account row:</p>
    ${storedList(STORED_ACCOUNT)}
    <p>Your sign-in sessions:</p>
    ${storedList(STORED_SESSION)}
    <p>And one row per game you have played:</p>
    ${storedList(STORED_GAME)}

    <h2>What that comes to on disk</h2>
    ${storedList(STORED_FILES)}
    <p class="lgdim">The names in the boxes above are the actual fields and files in the
      source, not a summary of them — a test reads the code and fails if this page and the
      account store ever stop agreeing.</p>

    <h2>The rules judge — the one thing that leaves this server</h2>
    <p>The in-game judge box answers rules questions with a language model. The question
      you type into it — and only that: not your name, not your account, not the board —
      is sent to <b>DeepSeek</b>'s API to be answered, under their terms. Each question and
      its answer is also kept in a log on this server so bad answers can be found and fixed.
      Do not put anything personal in a rules question; and if you would rather nothing of
      yours went to a third party at all, do not use the judge — the game does not need it.</p>

    <h2>Your IP address</h2>
    <p>Held in memory for a few minutes after a <i>failed</i> login, so that guessing at
      somebody's password can be throttled. It is not written to disk, not kept after the
      window passes, and not attached to your account.</p>

    <h2>What other players can see</h2>
    <p>Your username, your stat sheet, your achievements, your match history and any deck
      you have chosen to publish. A deck you have not published is yours alone.</p>

    <h2>What your browser keeps</h2>
    <p>In this browser's local storage, and nowhere else:</p>
    ${storedList(BROWSER_KEYS)}
    <p>Only the session token is ever sent back to the server. Clearing site data logs you
      out and forgets your preferences; it does not touch your account.</p>

    <h2>Deleting it</h2>
    <p>There is no delete button yet — it is on the list, with the rest of the admin tools.
      Until it exists, deleting an account means somebody editing one JSON file by hand on
      the server, which they will do if you ask.</p>`;
}

function termsHtml(): string {
  return `
    <h2>It is free, and it makes no money</h2>
    <p class="lgloud">This client is <b>free</b>. It has <b>no economy</b> — no purchases,
      no currency, no packs, no cosmetics, no subscription, no ads. It <b>makes no
      money</b>, is funded out of the owner's own pocket, and there is no plan, intention
      or roadmap item to change that. If you are ever asked to pay for this, it is not
      this.</p>

    <h2>It is not official</h2>
    <p>${UNOFFICIAL} Algomancy and everything printed on its cards belong to Caleb Gannon;
      see <b>About &amp; attribution</b>. If you want to support the game, buy it —
      <a href="${BUY_PHYSICAL}" target="_blank" rel="noopener noreferrer">the physical
      game</a> first, or <a href="${BUY_PNP}" target="_blank" rel="noopener noreferrer">the
      print-and-play</a> if that suits you better.</p>

    <h2>It is provided as it is</h2>
    <p>A hobby project run on one machine by one person. It can be slow, it can be wrong
      about a rule, it can go down in the middle of your game, and it can lose data. There
      is no warranty, no uptime promise and no guarantee that anything you store here will
      still be here tomorrow. Nobody is liable to you for any of that.</p>
    <p>Games are saved so they can be replayed and so your stats can be recounted. That is
      also how bugs get found. If that is not something you want recorded, play signed
      out.</p>

    <h2>Behave</h2>
    <p>Do not harass people, do not try to break into other accounts, and do not attack the
      server. There is one person running this, and an account can be removed by hand if it
      comes to that.</p>

    <h2>It can change</h2>
    <p>The rules the engine enforces, the features, and this text all change as the project
      does. Continuing to play is how you accept whatever it currently says.</p>`;
}

/** How this was made, said plainly — the owner asked for it as its own page
 *  (2026-09-05): "give the details about the agentic development model". */
function aiHtml(): string {
  return `
    <h2>The short version</h2>
    <p class="lgloud">The code in this client — the rules engine, the game server, this browser
      client and the Discord rules bot — was written by <b>Claude</b>, Anthropic's AI model,
      working as a coding agent. It was developed and directed by <b>Ben Adams</b>, a person,
      who decided what to build, ruled on every rules question, playtested it and reported
      what was wrong. No AI decides anything in a game you play here.</p>

    <h2>How it was built</h2>
    <p>This is an agentic development project. Ben describes what he wants — a feature, a
      card, a fix for something he hit while playing — and Claude, running in Anthropic's
      Claude Code, reads the rulebook, the card text and the existing code, writes the code
      and the tests for it, runs the whole test suite, and reports back. Ben reads the
      result, plays with it, and says yes, no, or "that is not how the rule works".</p>
    <p>Where the printed rules leave something open, the engine does not guess. Each of those
      questions went to Ben, and his answer is written down as a numbered ruling — nearly
      three hundred of them so far — with the test that enforces it. That register is the
      specification; the code follows it, not the other way round.</p>
    <p>The bugs come from play. Every game is saved as a complete action log, and the
      Report button in a game files a report — a bug, an interface problem or a feature
      request — against the exact position you were looking at. Most of the fixes are
      answers to one of those reports.</p>

    <h2>What that means for you</h2>
    <p>It can be wrong. A rule can be implemented the way the code read it rather than the
      way the designer meant it, and a model writing code makes mistakes a person would not,
      and vice versa. When you think the engine is wrong, it might be: use the Report button.
      If a rule is genuinely in doubt, Caleb Gannon's answer beats the engine's. Nothing here
      is an official reading of Algomancy.</p>
    <p>The card text, the rulebook and the artwork are Caleb Gannon's and were not generated.
      Card scans are shown as printed; nothing about the cards was invented or altered by a
      model.</p>

    <h2>Where AI runs while you play</h2>
    <p>In one place: the judge box. A question typed there goes to a language model (DeepSeek)
      together with passages from the rulebook and the designer's published answers, and the
      reply is that model's — a lookup aid, not a ruling. The <b>Privacy</b> page says
      exactly what is sent.</p>
    <p>Everything else — dealing, legality, combat, the clock, matchmaking, ratings — is
      ordinary deterministic code with no model in it. The same seed and the same actions
      replay the same game every time, which is how a bug report can be reproduced and how
      your stats are recomputed after a fix.</p>`;
}

/** the four pages, by the `data-legal` name that opens them */
const PAGES: Record<string, { title: string; body: () => string }> = {
  about: { title: 'About & attribution', body: aboutHtml },
  ai: { title: 'AI disclosure', body: aiHtml },
  privacy: { title: 'Privacy', body: privacyHtml },
  terms: { title: 'Terms', body: termsHtml },
};

// ── the furniture ─────────────────────────────────────────────────────

/** The footer: the notice, the pitch, the three pages. The only legal
 *  furniture there is — see the header on why there is no strip. */
export function footHtml(): string {
  return `<div class="lgfootwrap">
    <section class="lgpitch">
      <h3>Buy Algomancy. Please.</h3>
      ${pitchHtml()}
    </section>
    <section class="lgmeta">
      <p class="lgnotice">${UNOFFICIAL}</p>
      <p>Algomancy, its rules and all card art are Caleb Gannon's work, shown here so you
        can read your cards. There is no official client. This fan project makes no money:
        developed and directed by Ben Adams, coded by Claude (Anthropic's AI model).</p>
      <div class="lgpages">
        <button data-help="rules">📖 How to play</button>
        <a class="lgdiscord" href="${DISCORD_INVITE}" target="_blank" rel="noopener noreferrer">Algomancy Discord ↗</a>
        <button data-legal="about">About &amp; attribution</button>
        <button data-legal="ai">AI disclosure</button>
        <button data-legal="privacy">Privacy</button>
        <button data-legal="terms">Terms</button>
      </div>
      <p class="lgdim">Free to play, no economy, no ads, no analytics — paid for by the
        person who runs it.</p>
    </section>
  </div>`;
}

const CSS = `
/* .homepage is min-height:100dvh so it can centre itself in the window. The
   128px taken off it is deliberate and is the only thing here that changes a
   layout somebody else designed: it leaves the top of the footer showing under
   the fold, so the unofficial notice and the "buy the game" pitch are
   something you SEE and choose not to read, rather than something you have to
   go looking for. The home cards still centre themselves in what is left. */
#legalfoot:not([hidden]) ~ .homepage, #app:has(+ #legalfoot:not([hidden])) .homepage {
  min-height: calc(100dvh - 128px); }
/* …and the same floor under EVERY off-board page (owner, 2026-09-05: on the
   friends tab "there's very little text on screen, so the footer is WAY too
   high up"). The page's root is whatever the screen module painted first. */
#app:not(.board):has(+ #legalfoot:not([hidden])) > :first-child {
  min-height: calc(100dvh - 128px); box-sizing: border-box; }

#legalfoot { border-top: 1px solid var(--line); background: #0d1014; }
/* 1400px, not 1180: the deck builder and the card browser are 1400/1500 wide
   and the footer's edges used to sit visibly inside theirs */
#legalfoot .lgfootwrap { max-width: 1400px; margin: 0 auto; padding: 26px 22px 34px;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 26px; }
#legalfoot h3 { margin: 0 0 8px; color: var(--accent); font-size: 16px; }
#legalfoot p { margin: 0 0 9px; color: var(--dim); line-height: 1.55; font-size: 12px; }
#legalfoot .lgnotice { color: var(--text); font-weight: 700; }
#legalfoot .lgpages { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
/* the Discord link sits among the buttons, so it is dressed as one */
#legalfoot .lgdiscord { display: inline-block; padding: 5px 12px; border: 1px solid var(--line);
  border-radius: 5px; background: var(--panel2); color: var(--text); text-decoration: none; }
#legalfoot .lgdiscord:hover { border-color: var(--accent); }

.lgbuys { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
.lgbuy { display: inline-block; padding: 9px 14px; border: 1px solid var(--line);
  border-radius: 7px; color: var(--text); text-decoration: none; font-weight: 700; font-size: 13px; }
.lgbuy:hover { border-color: var(--accent); }
.lgbuy.primary { border-color: var(--accent); color: var(--accent); }
.lgdim { color: var(--dim); font-size: 11.5px; }

/* THE PANEL SCROLLS, NOT THE OVERLAY. The tab row has to stay reachable on a
   page this long, and 'position: sticky' inside a padded scroll container puts
   it at the padding edge rather than the top — the row above it stays visible
   and scrolls out over the header. Making the body the scroller is the version
   with no browser disagreement in it, and it keeps the scrim clickable. */
#legalover { position: fixed; inset: 0; z-index: 90; background: rgba(6,8,11,.78);
  display: flex; align-items: flex-start; justify-content: center; overflow: hidden; padding: 4vh 16px; }
#legalover .lgpanel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  max-width: 760px; width: 100%; max-height: 92vh; display: flex; flex-direction: column; min-height: 0; }
#legalover .lghead { flex: none; background: var(--panel); border-bottom: 1px solid var(--line);
  border-radius: 12px 12px 0 0; padding: 12px 22px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
#legalover .lghead .lgtabs { display: flex; gap: 6px; flex-wrap: wrap; }
#legalover .lghead button[data-legal].on { border-color: var(--accent); color: var(--accent); }
#legalover .lgclose { margin-left: auto; }
#legalover .lgbody { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 22px 26px; }
#legalover h2 { font-size: 15px; color: var(--accent); margin: 22px 0 8px;
  letter-spacing: .04em; text-transform: uppercase; }
#legalover h2:first-child { margin-top: 14px; }
#legalover p { margin: 0 0 10px; line-height: 1.62; color: var(--text); font-size: 13px; }
#legalover a { color: var(--accent); }
#legalover .lgloud { background: var(--panel2); border-left: 3px solid var(--accent);
  border-radius: 0 6px 6px 0; padding: 10px 13px; }
#legalover .lgstore { list-style: none; margin: 0 0 14px; padding: 0;
  display: flex; flex-direction: column; gap: 7px; }
#legalover .lgstore li { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 12px;
  background: var(--panel2); border: 1px solid var(--line); border-radius: 7px; padding: 8px 11px; }
#legalover .lgkeys { display: flex; flex-wrap: wrap; gap: 4px 8px; align-content: flex-start; }
#legalover .lgstore code { color: var(--accent); font-size: 11.5px; word-break: break-all; }
#legalover .lgstore span { color: var(--dim); font-size: 12.5px; line-height: 1.5; }
@media (max-width: 620px) {
  #legalover .lgstore li { grid-template-columns: 1fr; gap: 3px; }
}
`;

// ── installation ──────────────────────────────────────────────────────

/** the one element that has to exist before any of this means anything */
const appEl = (): HTMLElement | null => document.getElementById('app');

/** In a game the board owns the whole window and a footer under it is noise.
 *  `renderHome()` removes `.board`; `render()` adds it. */
const onBoard = (): boolean => appEl()?.classList.contains('board') ?? false;

let installed = false;

/**
 * Put the footer (which carries the notice) and the three pages on the page. Idempotent, safe
 * to call before or after the first render, and a no-op in any document with no
 * `#app` (the mockup and layout-editor rigs).
 */
export function installLegal(): void {
  if (installed) return;
  const app = appEl();
  if (!app) return;
  // ⚠ `#app` is NOT sufficient proof of a real document, and this bailed too
  // late for exactly the reason CT-180 records: `engine/test/ui-driver.ts`
  // hands back a stub element for ANY id it is asked for, so `appEl()` is
  // truthy in the headless harness while `document.head` is undefined — and
  // `132-token-separation` died on `document.head.appendChild` the moment
  // main.ts started calling this. Same shape as CT-161: a bail that does not
  // cover everything the next line dereferences is not a bail.
  //
  // So the test is what we are ABOUT to use, not a proxy for it. Nothing here
  // is load-bearing for the game — a document that cannot host the layer
  // simply does not get it.
  if (!document.head || typeof document.head.appendChild !== 'function') return;
  if (!app.parentNode) return;
  installed = true;

  const style = document.createElement('style');
  style.id = 'legal-css';
  style.textContent = CSS;
  document.head.appendChild(style);

  const foot = document.createElement('footer');
  foot.id = 'legalfoot';
  foot.innerHTML = footHtml();
  app.parentNode?.insertBefore(foot, app.nextSibling);

  /** the open page, or null. The overlay is created and destroyed rather than
   *  hidden, so nothing of it is in the DOM while the board is being played. */
  let open: string | null = null;

  const closeOver = (): void => {
    document.getElementById('legalover')?.remove();
    open = null;
  };

  const openPage = (name: string): void => {
    const page = PAGES[name];
    if (!page) return;
    closeOver();
    open = name;
    const over = document.createElement('div');
    over.id = 'legalover';
    over.setAttribute('role', 'dialog');
    over.setAttribute('aria-label', page.title);
    over.innerHTML = `<div class="lgpanel">
      <div class="lghead">
        <div class="lgtabs">${Object.entries(PAGES).map(([k, p]) =>
          `<button data-legal="${k}"${k === name ? ' class="on"' : ''}>${p.title}</button>`).join('')}</div>
        <button class="lgclose" data-legal="close">Close</button>
      </div>
      <div class="lgbody">${page.body()}</div>
    </div>`;
    document.body.appendChild(over);
  };

  // Our own listener, in capture, on our own elements only — main.ts's global
  // handler looks for `[data-btn]` and these are `[data-legal]`, so the two
  // never see each other's clicks. stopPropagation is belt and braces.
  document.addEventListener('click', e => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-legal]') as HTMLElement | null;
    if (!t) {
      // clicking the scrim, but not the panel, closes
      if (open && (e.target as HTMLElement | null)?.id === 'legalover') closeOver();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const name = t.dataset['legal']!;
    if (name === 'close') closeOver(); else openPage(name);
  }, { capture: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); closeOver(); }
  }, { capture: true });

  // `#app`'s class is the only signal for "a game is on screen", and it is set
  // by a render this module never hears about — hence the observer rather than
  // a call from main.ts. One attribute, one element: it costs nothing.
  const sync = (): void => {
    const hide = onBoard();
    foot.hidden = hide;
    if (hide && open) closeOver();
  };
  new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['class'] });
  sync();
}
