import { describe, expect, test } from "vitest"
import { erpExportWarning } from "@/lib/erpExportWarnings"

// axios lower-cases response header names; AxiosHeaders also offers get().
const plain = (h: Record<string, string>) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))

describe("erpExportWarning", () => {
  test("nothing left out → no warning", () => {
    expect(erpExportWarning(plain({ "X-Erpnext-Skipped-No-Job": "0", "X-Erpnext-Skipped-Hours": "0" }))).toBeNull()
    expect(erpExportWarning(undefined)).toBeNull()
  })

  test("dropped overtime and worked-holiday hours", () => {
    expect(
      erpExportWarning(plain({ "X-Erpnext-Dropped-Overtime-Hours": "12.5", "X-Erpnext-Dropped-Holiday-Hours": "8" }))
    ).toBe("12.5h overtime and 8h worked-holiday not exported — set the ERPNext Overtime Type under Configure → ERPNext Export.")
  })

  test("skipped time logs (no job / no job code)", () => {
    expect(erpExportWarning(plain({ "X-Erpnext-Skipped-No-Job": "3", "X-Erpnext-Skipped-Hours": "21.75" }))).toBe(
      "21.75h skipped (3 time logs) — no job, or a job with no Job Code."
    )
  })

  test("reads AxiosHeaders-style get()", () => {
    const headers = { get: (name: string) => (name === "X-Erpnext-Skipped-No-Job" ? "1" : name === "X-Erpnext-Skipped-Hours" ? "4" : undefined) }
    expect(erpExportWarning(headers)).toBe("4h skipped (1 time log) — no job, or a job with no Job Code.")
  })
})
