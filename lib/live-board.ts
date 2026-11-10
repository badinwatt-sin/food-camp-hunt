/** Competition membership uses the assigned group code, never an editable name. */
export function liveTeamNumber(groupCode: string | null | undefined): number | null {
  const index = ['D', 'C', 'A', 'O'].indexOf(groupCode ?? '');
  return index < 0 ? null : index + 1;
}

export function isLiveTeam(groupCode: string | null | undefined): boolean {
  return liveTeamNumber(groupCode) !== null;
}

export function liveTeams<T extends { lineGroupCode: string | null; balance: number }>(teams: T[]): T[] {
  return teams.filter((team) => isLiveTeam(team.lineGroupCode)).sort((a, b) =>
    b.balance - a.balance || liveTeamNumber(a.lineGroupCode)! - liveTeamNumber(b.lineGroupCode)!);
}

/** Zero balances have no medal; equal scores share the same current place. */
export function liveRank(balance: number, teams: { balance: number }[]): number | null {
  return balance > 0 ? 1 + teams.filter((team) => team.balance > balance).length : null;
}
