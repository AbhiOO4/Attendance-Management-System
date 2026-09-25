// Shared cloud draft for the Site Attendance page (see models/attendanceDraftRowModel.js).
//
// GET  /api/attendance/draft?siteId&date   → every stored row + whether the day is already locked
// PUT  /api/attendance/draft/rows          → save edited rows, each guarded by the rev it was based on
//
// Both 404 while the CLOUD_DRAFT_ENABLED switch is off, so clients fall back to on-device drafts.
import mongoose from "mongoose"
import AttendanceDraftRow from "../models/attendanceDraftRowModel.js"
import AttendanceLock from "../models/lockModel.js"
import userModel from "../models/userModel.js"
import { isCloudDraftEnabled } from "../utils/features.js"

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_ROWS_PER_WRITE = 500
const MAX_SESSIONS = 3

const disabled = (res) =>
  res.status(404).json({ success: false, code: "CLOUD_DRAFT_DISABLED", message: "Shared drafts are turned off" })

// "YYYY-MM-DD" → UTC-midnight Date, or null.
const dayOf = (dateStr) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr ?? ""))) return null
  const d = new Date(dateStr)
  return Number.isNaN(d.getTime()) ? null : d
}

const serializeRow = (row) => ({
  employee: String(row.employee),
  sessions: (row.sessions || []).map((s) => ({
    checkIn: s.checkIn || "",
    checkOut: s.checkOut || "",
    isNightShift: !!s.isNightShift,
    manuallyCleared: !!s.manuallyCleared,
    checkInAutoInit: !!s.checkInAutoInit,
  })),
  breaksTaken: row.breaksTaken ?? null,
  isSickLeave: !!row.isSickLeave,
  rev: row.rev,
  updatedBy: row.updatedBy ? String(row.updatedBy) : null,
  updatedByName: row.updatedByName ?? null,
  updatedAt: row.updatedAt,
})

// The day's lock, if any — once submitted, the draft is over for everyone.
const findLock = async (siteId, date) => {
  const lock = await AttendanceLock.findOne({ siteId, date }).populate("lockedBy", "name").lean()
  return lock ? { lockedByName: lock.lockedBy?.name ?? null, lockedAt: lock.lockedAt ?? null } : null
}

// Normalised editable fields of one incoming row, or an error message.
const parseRow = (row) => {
  if (!row || !mongoose.isValidObjectId(row.employee)) return { error: "Each row needs a valid employee" }
  if (!Array.isArray(row.sessions) || row.sessions.length < 1 || row.sessions.length > MAX_SESSIONS) {
    return { error: "Each row needs 1–3 sessions" }
  }
  const sessions = []
  for (const s of row.sessions) {
    const checkIn = s?.checkIn ?? ""
    const checkOut = s?.checkOut ?? ""
    if ((checkIn && !TIME_RE.test(checkIn)) || (checkOut && !TIME_RE.test(checkOut))) {
      return { error: "Times must be HH:mm" }
    }
    sessions.push({
      checkIn,
      checkOut,
      isNightShift: !!s.isNightShift,
      manuallyCleared: !!s.manuallyCleared,
      checkInAutoInit: !!s.checkInAutoInit,
    })
  }
  const breaksTaken = row.breaksTaken ?? null
  if (breaksTaken !== null && !(Number.isInteger(breaksTaken) && breaksTaken >= 0 && breaksTaken <= 20)) {
    return { error: "breaksTaken must be empty or a whole number 0–20" }
  }
  const baseRev = Number(row.baseRev) || 0
  return {
    employee: String(row.employee),
    baseRev,
    fields: { sessions, breaksTaken, isSickLeave: !!row.isSickLeave },
  }
}

export const getDraft = async (req, res) => {
  if (!isCloudDraftEnabled()) return disabled(res)
  try {
    const { siteId, date } = req.query
    const day = dayOf(date)
    if (!mongoose.isValidObjectId(siteId) || !day) {
      return res.status(400).json({ success: false, message: "siteId and date (YYYY-MM-DD) are required" })
    }

    const [rows, lock] = await Promise.all([
      AttendanceDraftRow.find({ siteId, date: day }).lean(),
      findLock(siteId, day),
    ])

    return res.status(200).json({ success: true, data: { rows: rows.map(serializeRow), lock } })
  } catch (error) {
    console.error("getDraft error:", error)
    return res.status(500).json({ success: false, message: "Failed to load the shared draft" })
  }
}

export const saveDraftRows = async (req, res) => {
  if (!isCloudDraftEnabled()) return disabled(res)
  try {
    const { siteId, date, rows } = req.body
    const day = dayOf(date)
    if (!mongoose.isValidObjectId(siteId) || !day || !Array.isArray(rows)) {
      return res.status(400).json({ success: false, message: "siteId, date (YYYY-MM-DD) and rows are required" })
    }
    if (rows.length > MAX_ROWS_PER_WRITE) {
      return res.status(400).json({ success: false, message: "Too many rows in one save" })
    }

    const parsed = []
    for (const row of rows) {
      const p = parseRow(row)
      if (p.error) return res.status(400).json({ success: false, message: p.error })
      parsed.push(p)
    }

    // A submitted day accepts no more draft edits — tell the client so it shows the saved sheet.
    const lock = await findLock(siteId, day)
    if (lock) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_SUBMITTED",
        message: "Attendance for this site was already submitted",
        ...lock,
      })
    }

    const user = await userModel.findById(req.user.id).select("name").lean()
    const updatedByName = user?.name ?? null

    const saved = []
    const conflicts = []
    for (const p of parsed) {
      const set = { ...p.fields, updatedBy: req.user.id, updatedByName }
      let doc = null
      if (p.baseRev === 0) {
        // First edit of this row: create it. Losing a create race (another device created it
        // a moment earlier) is an ordinary conflict.
        try {
          doc = await AttendanceDraftRow.create({ siteId, date: day, employee: p.employee, ...set, rev: 1 })
        } catch (err) {
          if (err?.code !== 11000) throw err
        }
      } else {
        doc = await AttendanceDraftRow.findOneAndUpdate(
          { siteId, date: day, employee: p.employee, rev: p.baseRev },
          { $set: set, $inc: { rev: 1 } },
          { new: true }
        )
      }

      if (doc) {
        saved.push({ employee: p.employee, rev: doc.rev, updatedAt: doc.updatedAt, updatedByName })
      } else {
        const current = await AttendanceDraftRow.findOne({ siteId, date: day, employee: p.employee }).lean()
        conflicts.push({ employee: p.employee, current: current ? serializeRow(current) : null })
      }
    }

    return res.status(200).json({ success: true, data: { saved, conflicts } })
  } catch (error) {
    console.error("saveDraftRows error:", error)
    return res.status(500).json({ success: false, message: "Failed to save the shared draft" })
  }
}
