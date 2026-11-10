/** Live is the competition screen; other teams remain available in Admin. */
export function liveTeamNumber(name: string): number | null {
  const match = /^DCAO([1-4])$/.exec(name.trim().replace(/\s+/g, '').toUpperCase());
  return match ? Number(match[1]) : null;
}

export function isLiveTeam(name: string): boolean {
  return liveTeamNumber(name) !== null;
}

export function liveTeams<T extends { name: string; balance: number }>(teams: T[]): T[] {
  return teams.filter((team) => isLiveTeam(team.name)).sort((a, b) =>
    b.balance - a.balance || liveTeamNumber(a.name)! - liveTeamNumber(b.name)!);
}

/** Zero balances have no medal; equal scores share the same current place. */
export function liveRank(balance: number, teams: { balance: number }[]): number | null {
  return balance > 0 ? 1 + teams.filter((team) => team.balance > balance).length : null;
}
