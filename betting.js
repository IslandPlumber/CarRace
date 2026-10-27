/** Fixed free-coin returns, including stake. Each ticket locks these terms. */
export const BET_TYPES = Object.freeze({
  win: Object.freeze({ label: "Win", places: 1, units: 400, condition: "Finish 1st" }),
  place: Object.freeze({ label: "Place", places: 2, units: 200, condition: "Finish 1st or 2nd" }),
  show: Object.freeze({ label: "Show", places: 3, units: 150, condition: "Finish 1st, 2nd or 3rd" }),
});
export const ticketReturn = (stake, units) => Math.floor(stake * units / 100);
export const returnLabel = (units) => `${units / 100}×`;
export function roundBets(round) {
  return round?.bets ?? (round?.bet ? [{ kind: "win", returnUnits: 400, ...round.bet }] : []);
}
export function betStatus(bets) {
  if (!bets.length) return "none";
  if (bets.some((b) => b.payout === null)) return "pending";
  return bets.some((b) => b.payout > 0) ? "won" : "lost";
}
