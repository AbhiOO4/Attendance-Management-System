import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { buildCountableDays, countUnmarkedDays, unmarkedAsAbsent } from "../../src/utils/unmarkedDays.js";
import { recordNetFactor } from "../../src/utils/manHours.js";
import {
  combineFromOffset,
  deriveOffsets,
  hoursFromOffset,
  minutesFromOffset,
  resolveDayOffsets,
  deriveRawOffsetFields,
  toLocalDateString,
  toLocalTimeString,
} from "../../src/utils/timeLocal.js";
import { classifyRoundingFixes } from "../../src/seed/recalcRawRounding.js";
import { record, session, WORK_CONFIG } from "../helpers/records.js";

const utc = (s) => new Date(`${s}T00:00:00.000Z`);
const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(utc(from).getTime() + i * 86400000));

describe("unmarked days (no record before today)", () => {
  // "Today" in Oman is 2026-09-11 (07:00 local).
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-11T03:00:00Z") });
  const countable = buildCountableDays(days("2026-09-01", 30), ["friday"], [{ date: utc("2026-09-09") }]);

  test("only days strictly before today count; holidays are flagged", () => {
    assert.equal(countable.length, 10); // 1st–10th
    const flagged = countable.filter((d) => d.isHoliday).map((d) => d.key);
    assert.deepEqual(flagged, ["2026-09-04", "2026-09-09"]); // Friday + public holiday
  });

  test("permanent: holidays are days off; recorded days don't count", () => {
    const emp = { isActive: true, employmentType: "permanent", createdAt: utc("2026-08-01") };
    const records = [{ date: utc("2026-09-01") }, { date: utc("2026-09-02") }];
    assert.equal(countUnmarkedDays(emp, records, countable), 6); // 10 − 2 holidays − 2 recorded
  });

  test("temporary workers have no days off", () => {
    const emp = { isActive: true, employmentType: "temporary", createdAt: utc("2026-08-01") };
    assert.equal(countUnmarkedDays(emp, [], countable), 10);
  });

  test("counted from the day the employee was added; inactive → 0", () => {
    assert.equal(countUnmarkedDays({ isActive: true, createdAt: new Date("2026-09-07T10:00:00Z") }, [], countable), 3); // 7, 8, 10
    assert.equal(countUnmarkedDays({ isActive: false, createdAt: utc("2026-08-01") }, [], countable), 0);
  });

  test("countUnmarkedAsAbsent defaults ON", () => {
    assert.equal(unmarkedAsAbsent({}), true);
    assert.equal(unmarkedAsAbsent(null), true);
    assert.equal(unmarkedAsAbsent({ countUnmarkedAsAbsent: false }), false);
  });
  mock.timers.reset();
});

describe("recordNetFactor (site man-hours)", () => {
  test("net / raw so per-session shares sum to the stored net", () => {
    const r = { sessions: [{ workedHours: 4 }, { workedHours: 6 }], totalWorkHours: 9 };
    const f = recordNetFactor(r);
    assert.equal(4 * f + 6 * f, 9);
  });
  test("a STORED 0 net gives 0 (same as the job report and the timesheet)", () => {
    assert.equal(recordNetFactor({ sessions: [{ workedHours: 0.5 }], totalWorkHours: 0 }), 0);
  });
  test("a net that was never computed falls back to gross", () => {
    assert.equal(recordNetFactor({ sessions: [{ workedHours: 3 }] }), 1);
    const hydrated = { sessions: [{ workedHours: 3 }], totalWorkHours: 0, $isDefault: (p) => p === "totalWorkHours" };
    assert.equal(recordNetFactor(hydrated), 1);
  });
  test("no raw hours → 0", () => {
    assert.equal(recordNetFactor({ sessions: [], totalWorkHours: 5 }), 0);
  });
});

describe("timeLocal (APP_TIMEZONE_OFFSET = -240, Oman)", () => {
  test("combineFromOffset places local wall time on the business day / next day", () => {
    assert.equal(combineFromOffset("2026-09-01", "07:00").toISOString(), "2026-09-01T03:00:00.000Z");
    assert.equal(combineFromOffset("2026-09-01", "02:00", true).toISOString(), "2026-09-01T22:00:00.000Z");
    assert.equal(combineFromOffset("2026-09-01", ""), null);
  });
  test("deriveOffsets rolls a check-out earlier than the check-in", () => {
    assert.deepEqual(deriveOffsets("19:00", "03:00"), { checkInNextDay: false, checkOutNextDay: true });
    assert.deepEqual(deriveOffsets("07:00", "17:00"), { checkInNextDay: false, checkOutNextDay: false });
    assert.deepEqual(deriveOffsets("01:00", "08:00", true), { checkInNextDay: true, checkOutNextDay: true });
  });
  test("resolveDayOffsets carries a midnight crossing to the next session", () => {
    assert.deepEqual(
      resolveDayOffsets("2026-09-01", [
        { rawCheckIn: "19:00", rawCheckOut: "01:00" },
        { rawCheckIn: "01:00", rawCheckOut: "08:00" },
      ]),
      [
        { checkInNextDay: false, checkOutNextDay: true },
        { checkInNextDay: true, checkOutNextDay: true },
      ]
    );
  });
  test("minutes/hours from offsets", () => {
    assert.equal(minutesFromOffset("19:00", "03:00", false, true), 480);
    assert.equal(hoursFromOffset("07:00", "09:55"), 2.92);
    assert.equal(hoursFromOffset("09:00", "08:00"), 0);
  });
  test("local date/time strings and the save hook's raw fields", () => {
    const out = combineFromOffset("2026-09-01", "02:00", true);
    assert.equal(toLocalDateString(out), "2026-09-02");
    assert.equal(toLocalTimeString(out), "02:00");
    assert.deepEqual(deriveRawOffsetFields(utc("2026-09-01"), combineFromOffset("2026-09-01", "19:00"), out), {
      rawCheckIn: "19:00",
      rawCheckOut: "02:00",
      checkInNextDay: false,
      checkOutNextDay: true,
    });
  });
});

describe("recalcRawRounding.classifyRoundingFixes", () => {
  const threeSessions = (d) => [session(d, "06:00", "08:20"), session(d, "08:20", "10:40"), session(d, "10:40", "14:00")];
  // A record priced by the OLD rule (Σ rounded hours = 7.99 → half day).
  const oldPriced = (d, extra = {}) => ({ ...record(d, { sessions: threeSessions(d) }), status: "halfday", totalWorkHours: 7.99, ...extra });

  test("lists exactly the records the fix changes, with before/after", () => {
    const { fixes, otherDrift } = classifyRoundingFixes([oldPriced("2026-09-01")], WORK_CONFIG);
    assert.equal(otherDrift.length, 0);
    assert.equal(fixes.length, 1);
    assert.deepEqual(fixes[0].before, { status: "halfday", totalWorkHours: 7.99, overtimeHours: 0, holidayHours: 0 });
    assert.deepEqual(fixes[0].after, { status: "fullday", totalWorkHours: 7, overtimeHours: 0, holidayHours: 0 });
  });

  test("leaves alone records the bug never touched", () => {
    const fine = record("2026-09-02", { sessions: [session("2026-09-02", "07:00", "16:00")] });
    assert.deepEqual(classifyRoundingFixes([fine], WORK_CONFIG), { fixes: [], otherDrift: [] });
  });

  test("a record that ALSO drifted for another reason is reported, never rewritten", () => {
    const edited = oldPriced("2026-09-03", { totalWorkHours: 6.5 });
    const { fixes, otherDrift } = classifyRoundingFixes([edited], WORK_CONFIG);
    assert.equal(fixes.length, 0);
    assert.equal(otherDrift.length, 1);
  });
});
