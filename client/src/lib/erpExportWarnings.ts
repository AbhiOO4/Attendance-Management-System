// Hours an ERPNext export could NOT put in its file, reported by the server as response
// headers (exportErpnext → X-Erpnext-*, exposed via cors in server/src/app.js). Without a
// warning these hours silently miss payroll or a Job Order's cost.

type HeaderBag = Record<string, unknown> | { get?: (name: string) => unknown }

const readHeader = (headers: HeaderBag | undefined, name: string): number => {
  if (!headers) return 0
  const bag = headers as Record<string, unknown> & { get?: (name: string) => unknown }
  const raw = typeof bag.get === "function" ? bag.get(name) : bag[name.toLowerCase()]
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

const hrs = (n: number) => `${Math.round(n * 100) / 100}h`

/** The warning to show after an ERPNext download, or null when nothing was left out. */
export function erpExportWarning(headers: HeaderBag | undefined): string | null {
  const droppedOt = readHeader(headers, "X-Erpnext-Dropped-Overtime-Hours")
  const droppedHoliday = readHeader(headers, "X-Erpnext-Dropped-Holiday-Hours")
  const skippedHours = readHeader(headers, "X-Erpnext-Skipped-Hours")
  const skippedLines = readHeader(headers, "X-Erpnext-Skipped-No-Job")

  const parts: string[] = []
  if (droppedOt > 0 || droppedHoliday > 0) {
    const what = [
      droppedOt > 0 ? `${hrs(droppedOt)} overtime` : "",
      droppedHoliday > 0 ? `${hrs(droppedHoliday)} worked-holiday` : "",
    ]
      .filter(Boolean)
      .join(" and ")
    parts.push(`${what} not exported — set the ERPNext Overtime Type under Configure → ERPNext Export.`)
  }
  if (skippedLines > 0) {
    parts.push(
      `${hrs(skippedHours)} skipped (${skippedLines} time log${skippedLines === 1 ? "" : "s"}) — no job, or a job with no Job Code.`
    )
  }
  return parts.length ? parts.join(" ") : null
}
