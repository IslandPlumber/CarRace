import {roundBets} from './betting.js';
/** Shared accounting view for saved club bets. */
export function roundFromRoom(room, user) {
  const r = room.race;
  const finish = r.results?.find((e) => e.userId === user.id);
  const bets = roundBets(r);
  return {
    id: r.id, roomCode: room.code, number: r.number, phase: r.phase, starts: r.starts,
    ownCar: r.entrants.find((e) => e.userId === user.id)?.car ?? null,
    place: finish?.place ?? null, prize: finish?.prize ?? 0, points: finish?.points ?? 0,
    winner: r.results?.[0]?.car ?? null,
    bets,
    powerSpent:r.powerSpent??0,
    bet: r.bet ? { ...r.bet, net: r.bet.payout === null ? null : r.bet.payout - r.bet.stake,
      status: r.bet.payout === null ? "pending" : r.bet.payout > 0 ? "won" : "lost" } : null,
    netCoins: (finish?.prize ?? 0) + bets.reduce((n, b) => n + (b.payout ?? 0) - b.stake, 0)-(r.powerSpent??0),
  };
}
