import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildTimesheetCsv } from "../../src/utils/erpnextExport.js";
import { parseCsv } from "../../src/utils/exportReconcile.js";
import { record, session, employee, job } from "../helpers/records.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const OFFSET_MIN = -240; // setup-env.js

/** Parse "YYYY-MM-DD HH:mm:ss" (app-local) into a UTC ms instant. */
const localToMs = (s) => Date.parse(`${s.replace(" ", "T")}Z`) + OFFSET_MIN * 60000;

const build = (records, opts = {}) => {
  const { csv, meta } = buildTimesheetCsv(records, { companyName: "ACME", activityType: "Construction", ...opts });
  return { rows: parseCsv(csv), meta };
};
const lineOf = (r) => ({
  emp: r.Employee,
  job: r["Job Order (Time Sheets)"],
  activity: r["Activity Type (Time Sheets)"],
  from: r["From Time (Time Sheets)"],
  hrs: Number(r["Hrs (Time Sheets)"]),
});

/** Every employee's logs as [start, end) intervals — ERPNext rejects overlaps across Timesheets. */
function assertNoOverlap(rows) {
  const byEmp = new Map();
  let current = null;
  for (const r of rows) {
    if (r.Employee) current = r.Employee;
    const start = localToMs(r["From Time (Time Sheets)"]);
    const end = start + Math.round(Number(r["Hrs (Time Sheets)"]) * 3600) * 1000;
    const list = byEmp.get(current) || [];
    list.push([start, end, r["From Time (Time Sheets)"]]);
    byEmp.set(current, list);
  }
  for (const [emp, list] of byEmp) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i][0] >= list[i - 1][1], `${emp}: ${list[i][2]} starts before the previous log ends`);
    }
  }
}

const A = job("JOB-A");
const B = job("JOB-B");
const C = job("JOB-C");

describe("one session", () => {
  const E = employee("EMP-1");
  // 07:00–18:00 = 11 raw → 10 net → 2 OT
  const r = record("2026-09-01", { employee: E, sessions: [session("2026-09-01", "07:00", "18:00", A)] });

  test("with an OT activity: regular line then the OT tail, contiguous", () => {
    const { rows } = build([r], { overtimeActivityType: "Construction OT" });
    assert.deepEqual(rows.map(lineOf), [
      { emp: "EMP-1", job: "JOB-A", activity: "Construction", from: "2026-09-01 07:00:00", hrs: 8 },
      { emp: "", job: "JOB-A", activity: "Construction OT", from: "2026-09-01 15:00:00", hrs: 2 },
    ]);
    // Parent fields only on the block's first row.
    assert.equal(rows[0].Company, "ACME");
    assert.equal(rows[0]["Job Order"], "JOB-A");
    assert.equal(rows[1].Company, "");
    assert.equal(rows[1]["Job Order"], "");
  });

  test("without an OT activity (unallocated): one net line", () => {
    const { rows } = build([r]);
    assert.deepEqual(rows.map(lineOf), [{ emp: "EMP-1", job: "JOB-A", activity: "Construction", from: "2026-09-01 07:00:00", hrs: 10 }]);
  });

  test("an allocated activity type always splits OT onto its '- Overtime' twin", () => {
    const allocated = { ...r, employee: { ...E, activityType: { name: "Mason" } } };
    const { rows, meta } = build([allocated]);
    assert.deepEqual(rows.map((x) => [x["Activity Type (Time Sheets)"], Number(x["Hrs (Time Sheets)"])]), [
      ["Mason", 8],
      ["Mason - Overtime", 2],
    ]);
    assert.equal(meta.unallocated, 0);
  });
});

describe("a worked holiday is all premium time", () => {
  test("every hour lands on the OT activity", () => {
    const r = record("2026-09-04", { employee: employee("EMP-2"), isHoliday: true, sessions: [session("2026-09-04", "07:00", "13:00", A)] });
    const { rows } = build([r], { overtimeActivityType: "Construction OT" });
    assert.deepEqual(rows.map(lineOf).map((l) => [l.activity, l.hrs]), [["Construction OT", 6]]);
  });
});

describe("multi-site day", () => {
  // 3 sessions, exactly 8h raw → net 7 (one break), split pro-rata across 2 jobs.
  const E = employee("EMP-3");
  const r = record("2026-09-02", {
    employee: E,
    sessions: [
      session("2026-09-02", "06:00", "08:20", A),
      session("2026-09-02", "08:20", "10:40", B),
      session("2026-09-02", "10:40", "14:00", A),
    ],
  });

  test("the record is a FULL day (rounding regression)", () => {
    assert.equal(r.status, "fullday");
    assert.equal(r.totalWorkHours, 7);
  });

  test("lines sum exactly to the day net, grouped by job order", () => {
    const { rows } = build([r]);
    assert.equal(round2(rows.reduce((s, x) => s + Number(x["Hrs (Time Sheets)"]), 0)), 7);
    // JOB-A block (earliest) first, then JOB-B.
    assert.deepEqual(rows.map((x) => x["Job Order (Time Sheets)"]), ["JOB-A", "JOB-A", "JOB-B"]);
    assert.deepEqual(rows.map((x) => x.Employee), ["EMP-3", "", "EMP-3"]);
    assertNoOverlap(rows);
  });
});

describe("back-to-back sessions (REGRESSION: overlapping time logs)", () => {
  test("a session whose rounded Hrs exceed its real length never runs into the next one", () => {
    // 07:00–09:55 is 2h55m but stores 2.92h (2h55m12s); no break on a 4h day.
    const r = record("2026-09-08", {
      employee: employee("EMP-5"),
      sessions: [session("2026-09-08", "07:00", "09:55", A), session("2026-09-08", "09:55", "11:00", B)],
    });
    assert.equal(r.totalWorkHours, 4);
    const { rows } = build([r]);
    assert.deepEqual(rows.map(lineOf).map((l) => [l.job, l.from, l.hrs]), [
      ["JOB-A", "2026-09-08 07:00:00", 2.92],
      // Starts where the previous log ENDS (12s after the real switch), not at 09:55:00.
      ["JOB-B", "2026-09-08 09:55:12", 1.08],
    ]);
    assertNoOverlap(rows);
  });

  test("the cursor carries across records and across job blocks", () => {
    const E = employee("EMP-6");
    const records = [
      record("2026-09-09", { employee: E, sessions: [session("2026-09-09", "20:00", "22:55", A), session("2026-09-09", "22:55", "02:00", B)] }),
      record("2026-09-10", { employee: E, sessions: [session("2026-09-10", "06:00", "09:00", A)] }),
    ];
    const { rows } = build(records.reverse());
    assertNoOverlap(rows);
    assert.equal(round2(rows.reduce((s, x) => s + Number(x["Hrs (Time Sheets)"]), 0)), round2(records.reduce((s, x) => s + x.totalWorkHours, 0)));
  });
});

describe("driver split", () => {
  test("N equal slices laid back to back from the check-in, one per job", () => {
    // 06:00–17:00 = 11 raw → 10 net → 2 OT, split over 3 jobs.
    const r = record("2026-09-03", { employee: employee("DRV-1"), sessions: [session("2026-09-03", "06:00", "17:00", [A, B, C])] });
    const { rows } = build([r], { overtimeActivityType: "Construction OT" });
    const lines = rows.map(lineOf);
    const perJob = (code) => round2(lines.filter((l) => l.job === code).reduce((s, l) => s + l.hrs, 0));
    assert.deepEqual([perJob("JOB-A"), perJob("JOB-B"), perJob("JOB-C")], [3.34, 3.33, 3.33]);
    const ot = round2(lines.filter((l) => l.activity === "Construction OT").reduce((s, l) => s + l.hrs, 0));
    assert.equal(ot, 2);
    assert.equal(lines.find((l) => l.job === "JOB-A").from, "2026-09-03 06:00:00");
    assertNoOverlap(rows);
  });
});

describe("hours that cannot bill to a Job Order", () => {
  test("jobless sessions and jobs without a code are skipped — and their hours reported", () => {
    const noCode = job(null);
    const E = employee("EMP-4");
    const records = [
      record("2026-09-05", { employee: E, sessions: [session("2026-09-05", "07:00", "12:00")] }), // no job: 5h
      record("2026-09-06", { employee: E, sessions: [session("2026-09-06", "07:00", "11:00", noCode)] }), // no code: 4h
      record("2026-09-07", { employee: E, sessions: [session("2026-09-07", "07:00", "16:00", [A, noCode])] }), // split: 8 net → 4 + 4
    ];
    const { rows, meta } = build(records);
    assert.equal(meta.skippedNoJob, 3);
    assert.equal(meta.skippedHours, 13);
    assert.deepEqual(rows.map(lineOf).map((l) => [l.job, l.hrs]), [["JOB-A", 4]]);
  });
});

describe("conservation over a random month (property)", () => {
  // Deterministic PRNG so failures reproduce.
  let seed = 99;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const jobs = [A, B, C, job("JOB-D")];

  const records = [];
  for (let e = 0; e < 6; e++) {
    const emp = employee(`EMP-P${e}`, e % 3 === 0 ? { activityType: { name: "Band " + e } } : {});
    for (let d = 1; d <= 30; d++) {
      const date = `2026-09-${String(d).padStart(2, "0")}`;
      if (rnd() < 0.15) continue;
      const n = 1 + Math.floor(rnd() * 3);
      let t = 5 * 60 + Math.floor(rnd() * 24) * 5; // start 05:00–07:00
      const sessions = [];
      for (let k = 0; k < n; k++) {
        const len = 60 + Math.floor(rnd() * 72) * 5; // 1h–7h
        const pick = rnd() < 0.15 ? [jobs[0], jobs[1], jobs[2]] : [jobs[Math.floor(rnd() * jobs.length)]];
        sessions.push(session(date, hhmm(t), hhmm(t + len), pick));
        t += len + (rnd() < 0.5 ? 0 : 15);
      }
      records.push(record(date, { employee: emp, sessions, isHoliday: d % 7 === 4, breaksTaken: rnd() < 0.1 ? 0 : null }));
    }
  }

  test("Σ lines = Σ day net; Σ OT lines = Σ (OT + holiday); no overlaps", () => {
    const { rows, meta } = build(records, { overtimeActivityType: "Construction OT" });
    const total = round2(rows.reduce((s, r) => s + Number(r["Hrs (Time Sheets)"]), 0));
    const ot = round2(
      rows
        .filter((r) => /Overtime$| OT$/.test(r["Activity Type (Time Sheets)"]))
        .reduce((s, r) => s + Number(r["Hrs (Time Sheets)"]), 0)
    );
    const net = round2(records.reduce((s, r) => s + r.totalWorkHours, 0));
    const premium = round2(records.reduce((s, r) => s + r.overtimeHours + r.holidayHours, 0));
    assert.equal(meta.skippedNoJob, 0);
    assert.equal(total, net);
    assert.equal(ot, premium);
    assertNoOverlap(rows);
  });
});
