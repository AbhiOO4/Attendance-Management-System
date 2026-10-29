import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeAttendanceTotals,
  sumRawHours,
  allocateProRata,
  allocateSessionNetHours,
  allocateDaySessionHours,
  recomputeRecordTotals,
  resolveBreakMinHours,
  computeAutoBreaks,
} from "../../src/utils/attendanceMath.js";
import { dayTotals, rawHours, configFor } from "../helpers/fixtures.js";
import { record, session } from "../helpers/records.js";

// Deterministic PRNG (mulberry32) so property tests are reproducible.
const prng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

describe("computeAttendanceTotals — golden cases", () => {
  for (const c of dayTotals.cases) {
    test(c.name, () => {
      const got = computeAttendanceTotals(c.rawHours, configFor(c), c.breaksTaken ?? null, {
        isHoliday: !!c.isHoliday,
        reason: c.isHoliday ? "public" : null,
      });
      assert.deepEqual(got, c.expected);
    });
  }

  test("weekly and public holidays are priced the same", () => {
    const cfg = configFor({});
    const weekly = computeAttendanceTotals(10, cfg, null, { isHoliday: true, reason: "weekly" });
    const pub = computeAttendanceTotals(10, cfg, null, { isHoliday: true, reason: "public" });
    assert.deepEqual(weekly, pub);
  });

  test("holiday info null/false is a normal day", () => {
    const cfg = configFor({});
    assert.deepEqual(
      computeAttendanceTotals(10, cfg, null, null),
      computeAttendanceTotals(10, cfg, null, { isHoliday: false, reason: null })
    );
  });

  test("OT + holiday never stack and never exceed net", () => {
    const rnd = prng(7);
    const cfg = configFor({});
    for (let i = 0; i < 2000; i++) {
      const raw = round2(rnd() * 26);
      const holiday = rnd() < 0.3;
      const t = computeAttendanceTotals(raw, cfg, rnd() < 0.2 ? Math.floor(rnd() * 3) : null, { isHoliday: holiday });
      assert.ok(t.overtimeHours === 0 || t.holidayHours === 0, `stacked at raw ${raw}`);
      assert.ok(t.overtimeHours + t.holidayHours <= t.netWorkHours + 1e-9, `exceeds net at raw ${raw}`);
      assert.ok(t.netWorkHours <= raw + 1e-9 && t.netWorkHours >= 0);
      assert.ok(t.breaksApplied <= 1);
    }
  });
});

describe("break helpers", () => {
  test("resolveBreakMinHours: configured value, else fullDayHours, else 0", () => {
    assert.equal(resolveBreakMinHours({ breakMinHours: 6, fullDayHours: 8 }), 6);
    assert.equal(resolveBreakMinHours({ breakMinHours: null, fullDayHours: 8 }), 8);
    assert.equal(resolveBreakMinHours({ breakMinHours: 0, fullDayHours: 10 }), 10);
    assert.equal(resolveBreakMinHours(null), 0);
  });
  test("computeAutoBreaks is 0 or 1, never more", () => {
    assert.equal(computeAutoBreaks(7.99, 8), 0);
    assert.equal(computeAutoBreaks(8, 8), 1);
    assert.equal(computeAutoBreaks(25, 8), 1);
    assert.equal(computeAutoBreaks(25, 0), 0);
  });
});

describe("sumRawHours — golden cases", () => {
  for (const c of rawHours.cases) {
    test(c.name, () => {
      assert.equal(sumRawHours(c.sessions), c.expected);
      // The fixture documents what the OLD rule (Σ rounded session hours) produced.
      const oldRule = round2(c.sessions.reduce((s, x) => s + (x.workedHours || 0), 0));
      assert.equal(oldRule, c.sumOfRounded);
    });
  }

  test("REGRESSION: a 3-session 8h day is a full day, not a half day", () => {
    const sessions = rawHours.cases[0].sessions;
    const cfg = configFor({});
    const fixed = computeAttendanceTotals(sumRawHours(sessions), cfg, null, null);
    assert.equal(fixed.status, "fullday");
    assert.equal(fixed.netWorkHours, 7);
    // What the old summation produced — kept here as the documented failure.
    const old = computeAttendanceTotals(7.99, cfg, null, null);
    assert.equal(old.status, "halfday");
  });

  test("accepts Date objects as well as ISO strings", () => {
    assert.equal(
      sumRawHours([{ checkIn: new Date("2026-09-01T00:00:00Z"), checkOut: new Date("2026-09-01T07:45:00Z"), workedHours: 7.75 }]),
      7.75
    );
  });

  test("never drifts from the exact minute total (random multi-session days)", () => {
    const rnd = prng(42);
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(rnd() * 5);
      let t = Date.UTC(2026, 8, 1, 2, 0);
      let minutes = 0;
      const sessions = [];
      for (let k = 0; k < n; k++) {
        const len = 5 * (1 + Math.floor(rnd() * 60));
        sessions.push({
          checkIn: new Date(t).toISOString(),
          checkOut: new Date(t + len * 60000).toISOString(),
          workedHours: Number((len / 60).toFixed(2)),
        });
        minutes += len;
        t += len * 60000;
      }
      assert.equal(sumRawHours(sessions), round2(minutes / 60));
    }
  });
});

describe("allocateProRata", () => {
  test("parts always sum EXACTLY to the total (property, 5000 cases)", () => {
    const rnd = prng(1234);
    for (let i = 0; i < 5000; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      const weights = Array.from({ length: n }, () => (rnd() < 0.1 ? 0 : round2(rnd() * 12)));
      const total = round2(rnd() * 20);
      const parts = allocateProRata(weights, total);
      assert.equal(parts.length, n);
      if (weights.every((w) => w === 0)) {
        assert.ok(parts.every((p) => p === 0));
        continue;
      }
      assert.equal(round2(parts.reduce((a, b) => a + b, 0)), total, JSON.stringify({ weights, total, parts }));
      for (const p of parts) assert.equal(p, round2(p));
    }
  });

  test("rounding residual lands on the largest weight", () => {
    assert.deepEqual(allocateProRata([1, 1, 1], 1), [0.34, 0.33, 0.33]);
    assert.deepEqual(allocateProRata([1, 2], 1), [0.33, 0.67]);
  });

  test("edge cases: empty, single, zero weights, negative weights", () => {
    assert.deepEqual(allocateProRata([], 5), []);
    assert.deepEqual(allocateProRata([3], 7.25), [7.25]);
    assert.deepEqual(allocateProRata([0, 0], 4), [0, 0]);
    assert.deepEqual(allocateProRata([-2, 2], 4), [0, 4]);
  });

  test("allocateSessionNetHours splits the day net by raw hours, summing back exactly", () => {
    const nets = allocateSessionNetHours([{ workedHours: 2.33 }, { workedHours: 2.33 }, { workedHours: 3.33 }], 7);
    assert.equal(round2(nets.reduce((a, b) => a + b, 0)), 7);
    assert.deepEqual(nets, [2.04, 2.04, 2.92]);
  });
});

describe("recomputeRecordTotals", () => {
  test("uses the exact raw sum, the record's override and its holiday state", () => {
    const record = {
      sessions: rawHours.cases[0].sessions,
      breaksTaken: null,
      isHoliday: false,
      holidayReason: null,
    };
    recomputeRecordTotals(record, configFor({}));
    assert.equal(record.status, "fullday");
    assert.equal(record.totalWorkHours, 7);
    assert.equal(record.overtimeHours, 0);
    assert.equal(record.holidayHours, 0);

    const holiday = { sessions: [{ checkIn: "2026-09-04T04:00:00Z", checkOut: "2026-09-04T15:00:00Z", workedHours: 11 }], breaksTaken: 0, isHoliday: true, holidayReason: "weekly" };
    recomputeRecordTotals(holiday, configFor({}));
    assert.deepEqual(
      { s: holiday.status, n: holiday.totalWorkHours, o: holiday.overtimeHours, h: holiday.holidayHours },
      { s: "fullday", n: 11, o: 0, h: 11 }
    );
  });
});

describe("allocateDaySessionHours (overtime window)", () => {
  const D = "2026-09-01";
  const split = (r) =>
    allocateDaySessionHours(r.sessions, {
      netHours: r.totalWorkHours,
      overtimeHours: r.overtimeHours,
      holidayHours: r.holidayHours,
    });
  const strip = (parts) => parts.map(({ regular, premium }) => [regular, premium]);

  test("07:00–17:00: 10 raw − 1 break = 9 net → 8 regular + 1 OT", () => {
    const r = record(D, { sessions: [session(D, "07:00", "17:00")] });
    assert.deepEqual(split(r), [{ net: 9, regular: 8, premium: 1 }]);
  });

  test("OT lands only on the session in the window (16:00–17:00); break pro-rata over regular", () => {
    const r = record(D, { sessions: [session(D, "07:00", "15:00"), session(D, "15:00", "17:00")] });
    assert.deepEqual(strip(split(r)), [
      [7.11, 0],
      [0.89, 1],
    ]);
  });

  test("input order is kept (sessions given latest first)", () => {
    const r = record(D, { sessions: [session(D, "15:00", "17:00"), session(D, "07:00", "15:00")] });
    assert.deepEqual(strip(split(r)), [
      [0.89, 1],
      [7.11, 0],
    ]);
  });

  test("a window straddling two sessions splits by overlap; regular never goes negative", () => {
    const r = record(D, { sessions: [session(D, "07:00", "16:30"), session(D, "16:30", "17:00")] });
    const parts = split(r);
    assert.deepEqual(parts.map((p) => p.premium), [0.5, 0.5]);
    assert.deepEqual(parts.map((p) => p.regular), [8, 0]);
  });

  test("gaps between sessions are skipped when walking the window back", () => {
    // 07–12 + 13–18 = 10 raw → 9 net → 1 OT, all on the last hour (17–18).
    const r = record(D, { sessions: [session(D, "07:00", "12:00"), session(D, "13:00", "18:00")] });
    assert.deepEqual(split(r).map((p) => p.premium), [0, 1]);
    // 06–16 + 17–18 = 11 raw → 10 net → 2 OT: 17–18, then back over the gap to 15–16.
    const r2 = record(D, { sessions: [session(D, "06:00", "16:00"), session(D, "17:00", "18:00")] });
    assert.equal(r2.overtimeHours, 2);
    assert.deepEqual(split(r2).map((p) => p.premium), [1, 1]);
  });

  test("no break (override 0): the window is still the last OT hours", () => {
    const r = record(D, { breaksTaken: 0, sessions: [session(D, "07:00", "14:00"), session(D, "14:00", "17:00")] });
    assert.equal(r.overtimeHours, 2);
    assert.deepEqual(strip(split(r)), [
      [7, 0],
      [1, 2],
    ]);
  });

  test("night shift across midnight: the window is the morning tail", () => {
    const r = record(D, { sessions: [session(D, "18:00", "23:00"), session(D, "23:00", "04:00")] });
    // 10 raw → 9 net → 1 OT on 03:00–04:00 (next day).
    assert.deepEqual(split(r).map((p) => p.premium), [0, 1]);
  });

  test("a worked holiday is all premium, split by raw length", () => {
    const r = record(D, { isHoliday: true, sessions: [session(D, "07:00", "11:00"), session(D, "11:00", "13:00")] });
    const parts = split(r);
    assert.ok(parts.every((p) => p.regular === 0 && p.premium === p.net));
    assert.equal(round2(parts.reduce((s, p) => s + p.premium, 0)), r.holidayHours);
  });

  test("no OT: the day net split pro-rata by EXACT session length", () => {
    // 2h20 / 2h40 / 3h → 8 raw → 7 net. Weighted by exact minutes, not the 2dp workedHours.
    const sessions = [session(D, "07:00", "09:20"), session(D, "09:20", "12:00"), session(D, "12:00", "15:00")];
    const r = record(D, { sessions });
    assert.equal(r.overtimeHours, 0);
    assert.deepEqual(split(r).map((p) => p.net), allocateProRata([140, 160, 180], r.totalWorkHours));
    assert.ok(split(r).every((p) => p.premium === 0 && p.regular === p.net));
  });

  test("property: Σnet = day net, Σpremium = OT + holiday, regular ≥ 0", () => {
    const rnd = prng(4242);
    const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    for (let k = 0; k < 500; k++) {
      const n = 1 + Math.floor(rnd() * 4);
      let t = 5 * 60 + Math.floor(rnd() * 36) * 5;
      const sessions = [];
      for (let j = 0; j < n; j++) {
        const len = 30 + Math.floor(rnd() * 84) * 5;
        sessions.push(session(D, hhmm(t), hhmm(t + len)));
        t += len + (rnd() < 0.5 ? 0 : 5 * Math.floor(rnd() * 12));
      }
      const r = record(D, { sessions, isHoliday: rnd() < 0.15, breaksTaken: rnd() < 0.1 ? 0 : null });
      const parts = split(r);
      const sum = (f) => round2(parts.reduce((s, p) => s + p[f], 0));
      assert.equal(sum("net"), r.totalWorkHours);
      assert.equal(sum("premium"), round2(r.overtimeHours + r.holidayHours));
      for (const p of parts) {
        assert.ok(p.regular >= 0 && p.premium >= 0, JSON.stringify(parts));
        assert.equal(round2(p.regular + p.premium), p.net);
      }
    }
  });
});
