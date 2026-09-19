// Man-hours attribution helpers.
//
// Breaks are unpaid and deducted from a record's TOTAL worked hours (day level),
// not from any single session — see attendanceMath.computeAttendanceTotals, where
// netWorkHours = rawHours - totalBreakHours is stored as Attendance.totalWorkHours.
//
// When a record has multiple sessions (an employee splitting a day across sites /
// jobs), the day's unpaid break must be shared across those sessions to report
// per-site / per-job man-hours net of breaks. We do this PRO-RATA by each
// session's share of the day's raw worked hours — the same allocation basis that
// jobReport uses for overtime/holiday. A session's net hours are therefore:
//
//     sessionNet = session.workedHours * recordNetFactor(record)
//
// Summing that over every session in a record yields exactly record.totalWorkHours,
// so per-site / per-job totals reconcile back to the record's net.

/**
 * Pro-rata factor that converts a session's gross workedHours into its
 * break-deducted (net) share of the record's total.
 *
 * @param {{ sessions?: Array<{ workedHours?: number }>, totalWorkHours?: number }} record
 * @returns {number} multiplier in [0, 1] (1 when no break was deducted)
 */
export const recordNetFactor = (record) => {
  const rawTotal = (record?.sessions || []).reduce(
    (sum, s) => sum + (s.workedHours || 0),
    0
  );

  // No raw hours → nothing to attribute.
  if (!(rawTotal > 0)) return 0;

  const net = record.totalWorkHours;

  // totalWorkHours defaults to 0, so a record with real worked hours but a 0 net
  // is one whose net was never computed (legacy / pre-field doc). Fall back to
  // gross rather than silently zeroing its hours. A short day (< full day, no
  // break earned) legitimately has net === raw and lands here as factor 1 too.
  if (!(net > 0)) return 1;

  return net / rawTotal;
};
