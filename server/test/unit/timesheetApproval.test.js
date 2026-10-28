import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { buildCountableDays, countUnmarkedDays, listUnmarkedDays } from "../../src/utils/unmarkedDays.js";
import { isMonthClosed, monthBounds, timesheetBlockers, timesheetFingerprint } from "../../src/utils/timesheetApproval.js";
import { record, session, job } from "../helpers/records.js";

const utc = (s) => new Date(`${s}T00:00:00.000Z`);
const days = (from, n) => Array.from({ length: n }, (_, i) => new Date(utc(from).getTime() + i * 86400000));

// "Today" in Oman is 2026-10-05: all of September is past.
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T06:00:00Z") });
const septDays = buildCountableDays(days("2026-09-01", 30), ["friday"], []);
const employee = { isActive: true, employmentType: "permanent", createdAt: utc("2026-09-28") };

describe("listUnmarkedDays", () => {
  test("lists the days countUnmarkedDays counts", () => {
    const records = [record("2026-09-28", { sessions: [session("2026-09-28", "07:00", "15:00", job("A"))] })];
    assert.deepEqual(listUnmarkedDays(employee, records, septDays), ["2026-09-29", "2026-09-30"]);
    assert.equal(countUnmarkedDays(employee, records, septDays), 2);
  });
  test("holidays are days off except for temporaries; inactive employees have none", () => {
    const fromFri = { ...employee, createdAt: utc("2026-09-25") }; // Fri 25th
    assert.equal(listUnmarkedDays(fromFri, [], septDays).includes("2026-09-25"), false);
    assert.equal(listUnmarkedDays({ ...fromFri, employmentType: "temporary" }, [], septDays).includes("2026-09-25"), true);
    assert.deepEqual(listUnmarkedDays({ ...fromFri, isActive: false }, [], septDays), []);
  });
});

describe("timesheetBlockers", () => {
  test("missing days, open check-outs and job-less worked sessions", () => {
    const records = [
      record("2026-09-28", { sessions: [session("2026-09-28", "07:00", null, job("A"))] }),
      record("2026-09-29", { sessions: [session("2026-09-29", "07:00", "15:00")] }),
    ];
    assert.deepEqual(timesheetBlockers(employee, records, septDays), {
      missing: ["2026-09-30"],
      pending: ["2026-09-28"],
      noJob: ["2026-09-29"],
    });
  });
  test("a clean month and a leave day (no session) block nothing", () => {
    const records = [
      record("2026-09-28", { sessions: [session("2026-09-28", "07:00", "15:00", job("A"))] }),
      record("2026-09-29", { isSickLeave: true }),
      record("2026-09-30", { sessions: [session("2026-09-30", "06:00", "14:00", [job("A"), job("B")])] }),
    ];
    assert.deepEqual(timesheetBlockers(employee, records, septDays), { missing: [], pending: [], noJob: [] });
  });
});

describe("timesheetFingerprint", () => {
  const a = job("A");
  const b = job("B");
  const base = () => [
    record("2026-09-28", { sessions: [session("2026-09-28", "07:00", "11:00", a), session("2026-09-28", "12:00", "16:00", b)] }),
    record("2026-09-29", { sessions: [session("2026-09-29", "07:00", "15:00", a)] }),
  ];

  test("stable under record/session order, remarks and populated ids", () => {
    const one = base();
    const two = base().reverse();
    two[1].sessions.reverse();
    two[0].remark = "late start";
    two[1].sessions[0].jobId = { _id: two[1].sessions[0].jobId._id, jobCode: "X" };
    assert.equal(timesheetFingerprint(one), timesheetFingerprint(two));
  });
  test("changes when a time, a job or a leave flag changes", () => {
    const fp = timesheetFingerprint(base());
    const time = base();
    time[1].sessions[0].checkOut = new Date(time[1].sessions[0].checkOut.getTime() + 60000);
    const jobChange = base();
    jobChange[1].sessions[0].jobId = b;
    const leave = base();
    leave[1].isLop = true;
    const dropped = base().slice(1);
    for (const changed of [time, jobChange, leave, dropped]) {
      assert.notEqual(timesheetFingerprint(changed), fp);
    }
  });
});

describe("months", () => {
  test("monthBounds are inclusive UTC midnights", () => {
    const { from, to } = monthBounds(2026, 2);
    assert.deepEqual([from.toISOString(), to.toISOString()], ["2026-02-01T00:00:00.000Z", "2026-02-28T00:00:00.000Z"]);
  });
  test("a month is closed only after its last day", () => {
    assert.equal(isMonthClosed(2026, 9), true);
    assert.equal(isMonthClosed(2026, 10), false);
  });
});
