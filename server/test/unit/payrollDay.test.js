import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyPayrollDay, hasOpenSession } from "../../src/utils/payrollDay.js";
import { payrollDay } from "../helpers/fixtures.js";

describe("classifyPayrollDay — golden cases", () => {
  for (const c of payrollDay.cases) {
    test(c.name, () => assert.deepEqual(classifyPayrollDay(c.record), c.expected));
  }
});

describe("hasOpenSession", () => {
  test("checked in, no check-out", () => {
    assert.equal(hasOpenSession({ sessions: [{ checkIn: new Date(), checkOut: null }] }), true);
  });
  test("closed or empty sessions", () => {
    assert.equal(hasOpenSession({ sessions: [{ checkIn: new Date(), checkOut: new Date() }, { checkIn: null, checkOut: null }] }), false);
    assert.equal(hasOpenSession({}), false);
  });
  test("a pending day classifies as a plain (no-reason) absence", () => {
    const record = { status: "absent", sessions: [{ checkIn: new Date(), checkOut: null }] };
    assert.deepEqual(classifyPayrollDay(record), { kind: "absent", reason: "none" });
    assert.equal(hasOpenSession(record), true);
  });
});
