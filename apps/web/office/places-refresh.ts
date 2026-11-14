/**
 * An agent that has just handed a task on is shown beside its colleague's desk for a little while, and goes back by itself with
 * nothing else changing (S6-13d2). So while anyone is on a handoff the office asks the server again every few seconds.
 */
export function handoffRefreshMs(places: { place: string }[]): number | null {
  return places.some((p) => p.place === 'handoff') ? 10_000 : null;
}
