import type { BacklogTicket } from '../tickets.ts';

export default {
  id: 'BL-07',
  slug: 'multiplayer',
  title: 'Multiplayer — more than two seats, FFA and teams',
  area: 'engine',
  size: 'XL',
  track: 'feature',
  said: 'Multiplayer',
  means:
    'Games with more than two players: free-for-all and teams, which is what Algomancy '
    + 'actually is at a table. The engine currently assumes two seats in load-bearing '
    + 'places — the region model, initiative, and the 1v1 counterattack rule all encode '
    + 'it. This is the largest engine item on the list.',
  doneWhen: [
    'A game can be created with 3+ seats, FFA or teams',
    'Regions/adjacency are correct for the table size — each pair of neighbours has its shared space',
    'Attack declaration and the counterattack work with more than one possible defender',
    'Initiative and turn order are correct for N players',
    'The fuzzer runs clean at 3 and 4 seats (6+ is a later look — owner, 2026-08-25)',
    'Per-seat redaction is still leak-free with more than one opponent',
    'FFA has NO counterattack, and the client does not offer one',
    'FFA attacks are declared simultaneously and revealed at once — the commit-reveal the deployment phase already does at 1v1',
    'Priority passes CLOCKWISE from the player nearest the initiative player, not back and forth',
    'Two players attacking the same player produces ONE battle in that region with all three participating',
    '2v2 resolves battles region by region: NIT regions first, then IT regions, each clockwise from the IT player',
  ],
  decided: [
    'Both FFA and teams are wanted.',
    'Build 3 and 4 seats first. Owner, 2026-08-25: "Start with 3 and 4. If it all works we can look into doing larger tables." — 6+ is explicitly a later look, so the fuzzer criterion for THIS entry stops at 4. BL-08 (pacing) still talks about 6, because that is the size where the pacing problem bites.',
    'Teams means 2v2. Owner, 2026-08-25: "Team drafting is just 2v2 and has special rules." — note he answered about team DRAFTING. The manual lists team setups as "2v2 or 3v3, can be played either as split teams (multiple regions) or joint players sharing a single region", but 3v3 is six seats, which the same day\'s answer defers. So: 2v2 now, arbitrary splits not now, and the "special rules" of team draft belong to BL-05\'s neighbourhood rather than here (manual: each team brings one 30-card-per-player constructed deck with up to 2 copies of a card, and live-drafts from it during the game).',
    'THE MULTIPLAYER COMBAT RULES ARE PRINTED, AND THEY ARE DETAILED. Owner, 2026-08-25, asked whether the 1v1 counterattack generalises: "It\'s all in the manual and fairly detailed." Checked — data/rules/Algomancy-Manual.txt, the "_ MULTIPLAYER" spread. It does not generalise; it depends on the format. Every line below this one is quoted from that spread, so nobody has to go hunting for it — but go and read it anyway before designing any of this.',
    'FFA HAS NO COUNTERATTACK. Manual: "The FFA battle structure is simpler than the teams/1v1 structure since there is no attack/counter-attack", and again in a note: "There are no counterattacks in FFA, which gives this format a different feel to teams/1v1." After a simultaneous attack declaration, each region runs: attacker sets units into Formation → priority window → defender sets blocking formation → priority window → Combat Step, all units in formation dealing damage simultaneously → one last after-combat priority window before Regroup.',
    'FFA ATTACKS ARE COMMIT-REVEAL. Manual, "INTENT CARDS": "In FFA, players declare their attacks simultaneously by placing intent cards face down in front of each of their units and other cards such as spell tokens with their intended action. Once all players have finished this, all of the cards are flipped up and the chosen attacks take place instantly!" Units may be grouped behind one intent card. This is the same shape as the simultaneous hidden deployment the engine already implements (deployDone[]/deploySnapshot).',
    'TEAMS KEEP THE 1v1 FLOW, ACROSS SEVERAL REGIONS AT ONCE. Manual, "TEAM BATTLE STRUCTURE": "The battle structure in team games is identical to that of 1v1, meaning it has the same attack-counter attack flow to it. The only difference is that now, attacks and blocks take place across multiple regions, so there are multiple separated priority windows to resolve between each step." In 2v2 there are two NIT and two IT regions; IT declare their attacks all at once into multiple regions, priority resolves in each NIT region clockwise from the IT player, NIT declare blocks AND counterattacks all at once into multiple regions, then each region resolves its own priority/damage/after-damage windows — NIT regions finish first, then IT regions, each in clockwise order from the IT player.',
    'PRIORITY GOES ROUND, NOT BACK AND FORTH. Manual, "MULTIPLAYER PRIORITY": "The stack functions identically in 3 player situations as it does in 1v1, but priority is passed in a circle instead of back and forth. The player closest to the initiative player in a clockwise direction gains priority first and priority is passed from that player clockwise during each priority window."',
    'THREE PLAYERS IN ONE REGION IS A REAL CASE, not an edge case. Manual: when two players attack the same player, all three take part in that battle together in one region; the defender defends against both incoming formations and all three players may interact with each other and their units there. The manual warns that symmetric effects get extremely powerful in that situation.',
    'FFA IS SIMULTANEOUS OUTSIDE BATTLE. Manual, "SIMULTANEOUS TURNS": every phase other than battle can be completed by all players at once — resources in planning, units in deployment — with a clockwise-from-initiative fallback for players who are learning or playing competitively. That fallback is worth building as an option, not just the fast path.',
    'Team initiative is per TEAM. Manual: whichever team holds the initiative token has the initiative, and teams act together — in deployment a team deploys in any order it likes before passing to the other team.',
  ],
  asks: [],
  deps: [],
  touches: [
    'client/engine/src/engine.ts',
    'client/engine/src/types.ts',
    'client/engine/src/apply.ts',
    'client/server/view.ts',
    'client/server/rooms.ts',
    'client/ui/main.ts',
  ],
  notes:
    'doc 06 M5 already lists "FFA intents (commit-reveal); teams" as beyond-v1 work — and '
    + 'the manual confirms that framing exactly: FFA really is intent cards flipped at '
    + 'once. READ THE MANUAL BEFORE DESIGNING ANY OF THIS: data/rules/Algomancy-Manual.txt, the '
    + 'pages headed "_ MULTIPLAYER" (grep for "FREE FOR ALL" and "TEAM BATTLE STRUCTURE"). '
    + 'It answers the region/priority/counterattack questions this entry used to be '
    + 'blocked on, and the answers are in `decided` above verbatim. '
    + 'Related but separate: BL-08, keeping a big table fast.',
} satisfies BacklogTicket;
