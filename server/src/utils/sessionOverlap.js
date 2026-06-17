/**
 * In-memory dry-run overlap detection for attendance sessions.
 *
 * Sessions without a checkIn are ignored. A session that has a checkIn but no
 * checkOut is treated as an instant at checkIn. Returns true if any two
 * sessions overlap in time.
 *
 * Used by the auto check-in / check-out crons to validate a proposed time
 * before persisting it, mirroring the overlap checks done on manual submits.
 */
export function hasSessionOverlap(sessions) {
  const intervals = sessions
    .filter((s) => s.checkIn)
    .map((s) => {
      const start = new Date(s.checkIn).getTime();
      const end = s.checkOut ? new Date(s.checkOut).getTime() : start;
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < intervals.length - 1; i++) {
    const a = intervals[i];
    const b = intervals[i + 1];
    if (a.start < b.end && a.end > b.start) {
      return true;
    }
  }

  return false;
}
