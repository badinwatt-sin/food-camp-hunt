/** Admin switches shared by the player home screen and API content guards. */
export type MenuSettings = {
  is_open?: boolean | null;
  hunt_open?: boolean | null;
  puzzle_open?: boolean | null;
  market_open?: boolean | null;
  checkin_open?: boolean | null;
  mg_spot_open?: boolean | null;
  mg_memory_open?: boolean | null;
  mg_mystery_open?: boolean | null;
};

export type MenuAccess = {
  quiz: boolean;
  hunt: boolean;
  photos: boolean;
  games: boolean;
  market: boolean;
  missions: boolean;
  checkin: boolean;
};

export const MENU_SETTINGS_SELECT = 'is_open, hunt_open, puzzle_open, market_open, checkin_open, mg_spot_open, mg_memory_open, mg_mystery_open';

/** Missing settings fail closed. Completing a mission does not bypass its switch. */
export function menuAccess(settings: MenuSettings | null | undefined): MenuAccess {
  const quiz = settings?.is_open === true;
  const hunt = settings?.hunt_open === true;
  const photos = settings?.puzzle_open === true;
  const games = settings?.mg_spot_open === true || settings?.mg_memory_open === true || settings?.mg_mystery_open === true;
  return {
    quiz,
    hunt,
    photos,
    games,
    market: settings?.market_open === true,
    missions: quiz || hunt || photos || games,
    checkin: settings?.checkin_open === true,
  };
}
