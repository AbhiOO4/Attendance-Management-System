/**
 * Determines if any session in the array is a night shift.
 * Checks both the isNightShift flag and auto-detects cross-midnight.
 */
export function detectCrossedMidnight(sessions, timezoneOffset = null) {
  let fallbackOffset = -330;
  if (process.env.APP_TIMEZONE_OFFSET !== undefined && process.env.APP_TIMEZONE_OFFSET !== "") {
    const parsedFallback = parseInt(process.env.APP_TIMEZONE_OFFSET, 10);
    if (!isNaN(parsedFallback)) {
      fallbackOffset = parsedFallback;
    }
  }

  // Parse timezone offset
  let offsetVal = fallbackOffset;
  if (timezoneOffset !== null && timezoneOffset !== undefined) {
    const parsed = parseInt(timezoneOffset, 10);
    if (!isNaN(parsed)) {
      offsetVal = parsed;
    }
  }

  const getLocalInfo = (dateObj) => {
    const localTime = new Date(dateObj.getTime() - offsetVal * 60 * 1000);
    return {
      date: localTime.getUTCDate(),
      hours: localTime.getUTCHours(),
      minutes: localTime.getUTCMinutes(),
    };
  };

  return sessions.some((s) => {
    // Explicit night shift flag
    if (s.isNightShift) return true;

    if (!s.checkIn || !s.checkOut) return false;
    // Auto-detect from Date objects
    let inTime, outTime;
    if (typeof s.checkIn === "string" && s.checkIn.length === 5) {
      inTime = s.checkIn;
      outTime = s.checkOut;
    } else {
      const inDate = new Date(s.checkIn);
      const outDate = new Date(s.checkOut);

      const localIn = getLocalInfo(inDate);
      const localOut = getLocalInfo(outDate);

      // If checkOut is on a different date than checkIn, it crossed midnight
      if (localOut.date !== localIn.date) return true;

      inTime = `${String(localIn.hours).padStart(2, "0")}:${String(localIn.minutes).padStart(2, "0")}`;
      outTime = `${String(localOut.hours).padStart(2, "0")}:${String(localOut.minutes).padStart(2, "0")}`;
    }
    const [inH] = inTime.split(":").map(Number);
    const [outH] = outTime.split(":").map(Number);
    const inMinutes = inH * 60 + (parseInt(inTime.split(":")[1]) || 0);
    const outMinutes = outH * 60 + (parseInt(outTime.split(":")[1]) || 0);
    return outMinutes < inMinutes;
  });
}
