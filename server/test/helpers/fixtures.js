// Loads the shared golden fixtures (server/test/fixtures/parity/*.json) — the same files the
// client's vitest suite runs its mirrors against.
import fs from "node:fs";

const load = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/parity/${name}.json`, import.meta.url), "utf8"));

export const dayTotals = load("day-totals");
export const rawHours = load("raw-hours");
export const payrollDay = load("payroll-day");

/** A case's work config: the file's defaultConfig with the case's overrides. */
export const configFor = (testCase) => ({ ...dayTotals.defaultConfig, ...(testCase.config || {}) });
