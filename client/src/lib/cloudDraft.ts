// Shared cloud draft for the Site Attendance page — API calls and the pure row helpers.
//
// The server stores only rows a supervisor has touched ("overrides", each with a `rev`); every
// device derives the untouched rows itself from the roster + site defaults. A device's view of a
// row is therefore: its derived default, overlaid by the remote override, overlaid by its own
// unsynced edits (the outbox, kept in localStorage so they survive a reload or a killed PWA).
// See server/src/models/attendanceDraftRowModel.js and controllers/draftController.js.
import { api } from "@/lib/api"
import { deriveOffsets, hoursFromOffset } from "@/lib/dateUtils"
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/draftStorage"

export type DraftSessionFields = {
  checkIn: string
  checkOut: string
  isNightShift: boolean
  manuallyCleared: boolean
  checkInAutoInit: boolean
}

// The part of a draft row a supervisor edits — exactly what the cloud draft stores.
export type EditableFields = {
  sessions: DraftSessionFields[]
  breaksTaken: number | null
  isSickLeave: boolean
}

export type RemoteRow = EditableFields & {
  employee: string
  rev: number
  updatedBy: string | null
  updatedByName: string | null
  updatedAt: string
}

export type RemoteLock = { lockedByName: string | null; lockedAt: string | null }

type RowLike = {
  sessions: Array<{
    checkIn?: string | null
    checkOut?: string | null
    isNightShift?: boolean
    manuallyCleared?: boolean
    checkInAutoInit?: boolean
  }>
  breaksTaken?: number | null
  isSickLeave?: boolean
}

export const editableOf = (row: RowLike): EditableFields => ({
  sessions: row.sessions.map((s) => ({
    checkIn: s.checkIn || "",
    checkOut: s.checkOut || "",
    isNightShift: !!s.isNightShift,
    manuallyCleared: !!s.manuallyCleared,
    checkInAutoInit: !!s.checkInAutoInit,
  })),
  breaksTaken: row.breaksTaken ?? null,
  isSickLeave: !!row.isSickLeave,
})

export const serializeEditable = (fields: EditableFields) => JSON.stringify(fields)

const hoursOf = (checkIn: string, checkOut: string) => {
  const { checkInNextDay, checkOutNextDay } = deriveOffsets(checkIn, checkOut)
  return hoursFromOffset(checkIn, checkOut, checkInNextDay, checkOutNextDay)
}

/** A copy of `row` carrying `fields` (session identity — site, job — is kept from the row). */
export function applyEditable<
  T extends { sessions: object[]; breaksTaken?: number | null; isSickLeave?: boolean }
>(row: T, fields: EditableFields): T {
  const sessions = fields.sessions.map((f, i) => ({
    ...(row.sessions[i] ?? row.sessions[0]),
    ...f,
    workedHours: f.checkIn && f.checkOut ? hoursOf(f.checkIn, f.checkOut) : 0,
  }))
  return {
    ...row,
    breaksTaken: fields.breaksTaken,
    isSickLeave: fields.isSickLeave,
    sessions: sessions as T["sessions"],
  }
}

const UNITS = ["sessions", "breaksTaken", "isSickLeave"] as const

/**
 * Three-way merge of one row, per unit (the session list, the break override, the sick flag).
 * A unit only one side changed from `base` takes that side; a unit both sides changed to
 * different values is a conflict and takes `theirs` (the version already on the server).
 */
export function mergeEditable(
  base: EditableFields,
  mine: EditableFields,
  theirs: EditableFields
): { merged: EditableFields; conflict: boolean } {
  const merged = { ...theirs }
  let conflict = false
  for (const unit of UNITS) {
    const b = JSON.stringify(base[unit])
    const m = JSON.stringify(mine[unit])
    const t = JSON.stringify(theirs[unit])
    if (m === b || m === t) continue // only they changed it (or both the same way)
    if (t === b) {
      ;(merged as Record<string, unknown>)[unit] = mine[unit] // only I changed it
    } else {
      conflict = true
    }
  }
  return { merged, conflict }
}

/** "08:00–17:00" style summary of a row's first session, for conflict messages. */
export const describeFields = (fields: EditableFields) => {
  const s = fields.sessions[0]
  if (!s || (!s.checkIn && !s.checkOut)) return "absent"
  return `${s.checkIn || "?"}–${s.checkOut || "…"}`
}

// ---------------------------------------------------------------- API

export async function fetchDraft(siteId: string, date: string) {
  const res = await api.get<{ data: { rows: RemoteRow[]; lock: RemoteLock | null } }>("/api/attendance/draft", {
    params: { siteId, date },
  })
  return res.data.data
}

export type SaveDraftResult = {
  saved: { employee: string; rev: number; updatedAt: string; updatedByName: string | null }[]
  conflicts: { employee: string; current: RemoteRow | null }[]
}

export async function saveDraftRows(
  siteId: string,
  date: string,
  rows: Array<EditableFields & { employee: string; baseRev: number }>
) {
  const res = await api.put<{ data: SaveDraftResult }>("/api/attendance/draft/rows", { siteId, date, rows })
  return res.data.data
}

// ---------------------------------------------------------------- outbox (localStorage)

// Unsynced edits, keyed by employee: the edited fields, the version they were edited from
// (`base`, for a three-way merge if the server moved on meanwhile) and that version's rev.
export type Outbox = Record<string, { fields: EditableFields; base: EditableFields; baseRev: number }>

const outboxKey = (siteId: string, date: string) => `attendance_outbox_${siteId}_${date}`

/** null when this device has never used the cloud draft for this site/day. */
export function readOutbox(siteId: string, date: string): Outbox | null {
  const raw = safeGetItem(outboxKey(siteId, date))
  if (raw === null) return null
  try {
    return JSON.parse(raw) as Outbox
  } catch {
    return {}
  }
}

export const writeOutbox = (siteId: string, date: string, outbox: Outbox) =>
  safeSetItem(outboxKey(siteId, date), JSON.stringify(outbox))

export const removeOutbox = (siteId: string, date: string) => safeRemoveItem(outboxKey(siteId, date))
