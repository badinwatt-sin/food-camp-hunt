/**
 * "Clear everything" plans for the admin danger zone (used while rehearsing / testing).
 * Each plan deletes tables in an order that respects the foreign keys, so a run can simply be repeated if it is interrupted.
 */
export type BulkStep = { table: string; eq?: [string, string] };
export type BulkPlan = { steps: BulkStep[]; resetPlayers?: boolean; switchesOff?: boolean; resetLine?: boolean };
export type BulkTarget = 'minigames' | 'missions' | 'items' | 'teams' | 'questions' | 'spots' | 'playdata';

export const BULK_CONFIRM = 'ลบทั้งหมด';

export const BULK_PLANS: Record<BulkTarget, BulkPlan> = {
  // every solo mini-game attempt and the tokens they gave (the wallet goes back down by that amount)
  minigames: { steps: [{ table: 'token_ledger', eq: ['kind', 'minigame'] }, { table: 'minigame_attempts' }] },
  // photo missions and every photo the teams sent (tokens already earned stay in the ledger)
  missions: { steps: [{ table: 'photo_submissions' }, { table: 'photo_missions' }] },
  // market items, their redemption history and the token spending (tokens spent on redemptions are given back)
  items: { steps: [{ table: 'token_ledger', eq: ['kind', 'redemption'] }, { table: 'redemptions' }, { table: 'market_items' }] },
  // quiz questions and the players' answers
  questions: { steps: [{ table: 'answers' }, { table: 'questions' }] },
  // treasure-hunt spots and every scan / claim
  spots: { steps: [{ table: 'hunt_scans' }, { table: 'hunt_claims' }, { table: 'hunt_spots' }] },
  // all teams WITH their players, squads, tokens and history: start from nothing
  teams: {
    resetLine: true,
    switchesOff: true,
    steps: [
      { table: 'photo_submissions' }, { table: 'hunt_scans' }, { table: 'hunt_claims' }, { table: 'puzzle_attempts' }, { table: 'puzzle_solves' },
      { table: 'minigame_attempts' }, { table: 'token_ledger' }, { table: 'redemptions' }, { table: 'answers' }, { table: 'participants' }, { table: 'squads' }, { table: 'teams' },
    ],
  },
  // wipe the results of a test run but keep everything that was set up (teams, players + IDs, questions, items, missions, spots)
  playdata: {
    resetLine: true,
    steps: [
      { table: 'answers' }, { table: 'hunt_scans' }, { table: 'hunt_claims' }, { table: 'photo_submissions' }, { table: 'puzzle_attempts' }, { table: 'puzzle_solves' }, { table: 'minigame_attempts' },
      { table: 'token_ledger' }, { table: 'redemptions' }, { table: 'audit_log' },
    ],
    resetPlayers: true,   // also clears event-day check-ins
    switchesOff: true,
  },
};
