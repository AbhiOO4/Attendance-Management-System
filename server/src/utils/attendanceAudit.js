/**
 * Edit-log writer for Attendance records — a peer to utils/notify.js.
 *
 * Audit writes are BEST-EFFORT: a failed log line is caught and swallowed so it can never
 * stall or roll back the edit it accompanies. Transactional callers pass their open
 * mongoose `session` so the log joins the same transaction (no extra commit); non-txn
 * callers get a plain, separate write.
 *
 * Bulk/loop endpoints must resolve the actor ONCE per request (resolveActor) and collect
 * rows for a single insertMany (recordAttendanceAuditBatch) rather than writing per record.
 */
import attendanceAuditModel from "../models/attendanceAuditModel.js"
import userModel from "../models/userModel.js"
import { getTodayLocal } from "./timeLocal.js"

/** Actor sentinel for cron/system writes (no req.user). */
export const SYSTEM_ACTOR = { actorId: null, actorName: "System" }

/**
 * Resolve the acting user to { actorId, actorName } from the request. Call ONCE per
 * request and reuse across all audit rows for that request. Falls back to the System
 * actor when there is no req.user.
 */
export async function resolveActor(req) {
  const id = req?.user?.id
  if (!id) return { ...SYSTEM_ACTOR }
  try {
    const user = await userModel.findById(id).select("name")
    return { actorId: id, actorName: user?.name || "Unknown" }
  } catch (err) {
    console.error("[attendanceAudit] failed to resolve actor:", err.message)
    return { actorId: id, actorName: "Unknown" }
  }
}

/**
 * Build a plain audit row from an Attendance document (preferred — carries employee/siteId)
 * or a bare attendance id. Use for insertMany batches; also used internally by the single
 * writer.
 */
export function buildAuditRow(attendance, actor, type, summary) {
  const isDoc =
    attendance && typeof attendance === "object" && attendance._id != null
  return {
    attendance: isDoc ? attendance._id : attendance,
    employee: isDoc ? attendance.employee ?? null : null,
    siteId: isDoc ? attendance.siteId ?? null : null,
    actor: actor?.actorId ?? null,
    actorName: actor?.actorName ?? "System",
    type,
    summary,
    dateLocal: getTodayLocal(),
  }
}

/**
 * Best-effort single audit write. Pass `session` to join a transaction.
 * `actor` = the object from resolveActor (or SYSTEM_ACTOR).
 */
export async function recordAttendanceAudit({
  attendance,
  actor,
  type,
  summary,
  session = null,
}) {
  try {
    const row = buildAuditRow(attendance, actor, type, summary)
    await attendanceAuditModel.create([row], session ? { session } : {})
  } catch (err) {
    console.error("[attendanceAudit] failed to record:", err.message)
  }
}

/** Best-effort batch write for bulk paths. `rows` = buildAuditRow(...) outputs. */
export async function recordAttendanceAuditBatch(rows, session = null) {
  if (!Array.isArray(rows) || rows.length === 0) return
  try {
    await attendanceAuditModel.insertMany(rows, session ? { session } : {})
  } catch (err) {
    console.error("[attendanceAudit] failed to record batch:", err.message)
  }
}

/**
 * Build a human-readable list of what changed between the previous and new session sets
 * (plus status/sick changes) for an attendance edit — e.g. "Marked absent",
 * "New session created for Welder", "Session 2 check-out 17:00 → 18:30".
 *
 * Pure / in-memory: the caller passes jobNames/siteNames maps (resolved once) so this does
 * no DB work. Sessions are matched by _id — a new session (no matching id) reads as added,
 * a previous id missing from the new set reads as removed. Session numbers reflect the new
 * array order. Returns an array of change strings (empty when nothing detectable changed).
 */
export function summarizeAttendanceEdit({
  prevSessions = [],
  newSessions = [],
  prevStatus,
  newStatus,
  prevSick,
  newSick,
  jobNames = {},
  siteNames = {},
}) {
  const parts = []
  const t = (v) => (v ? v : "—")
  const labelFor = (s) => jobNames[String(s.jobId)] || siteNames[String(s.siteId)] || null

  if (prevStatus && newStatus && prevStatus !== newStatus) {
    parts.push(newStatus === "absent" ? "Marked absent" : `Status ${prevStatus} → ${newStatus}`)
  }
  if (prevSick !== undefined && newSick !== undefined && !!prevSick !== !!newSick) {
    parts.push(newSick ? "Marked sick leave" : "Cleared sick leave")
  }

  const prevById = new Map(prevSessions.filter((s) => s && s._id).map((s) => [String(s._id), s]))
  const newIds = new Set(newSessions.filter((s) => s && s._id).map((s) => String(s._id)))

  newSessions.forEach((s, i) => {
    const n = i + 1
    const key = s && s._id ? String(s._id) : null
    const prev = key ? prevById.get(key) : null
    if (!prev) {
      const label = labelFor(s)
      parts.push(label ? `New session created for ${label}` : `Session ${n} added`)
      return
    }
    if ((prev.rawCheckIn || null) !== (s.rawCheckIn || null)) {
      parts.push(`Session ${n} check-in ${t(prev.rawCheckIn)} → ${t(s.rawCheckIn)}`)
    }
    if ((prev.rawCheckOut || null) !== (s.rawCheckOut || null)) {
      parts.push(`Session ${n} check-out ${t(prev.rawCheckOut)} → ${t(s.rawCheckOut)}`)
    }
    if (String(prev.jobId || "") !== String(s.jobId || "")) {
      parts.push(`Session ${n} job → ${jobNames[String(s.jobId)] || "none"}`)
    }
  })

  for (const [key] of prevById) {
    if (!newIds.has(key)) parts.push("Session removed")
  }

  return parts
}

/** Join change parts into a single capped summary line (keeps the first `max`, then "+N more"). */
export function joinChangeParts(parts, max = 6) {
  if (!parts || parts.length === 0) return ""
  const head = parts.slice(0, max).join("; ")
  return parts.length > max ? `${head}; +${parts.length - max} more` : head
}

/** Format a breaksTaken value for a summary (null/undefined = auto-computed). */
export function formatBreaks(val) {
  return val === null || val === undefined ? "auto" : String(val)
}

/** Human-readable summary for a break-override change. */
export function breaksChangeSummary(oldVal, newVal) {
  return `Breaks changed ${formatBreaks(oldVal)} → ${formatBreaks(newVal)}`
}
