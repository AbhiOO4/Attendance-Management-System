import mongoose from "mongoose"

/**
 * One supervisor-edited row of a site's UNSUBMITTED attendance sheet for a day — the shared
 * cloud draft that lets several supervisors mark the same site from different devices.
 *
 * Only rows someone has touched are stored (overrides). Every device derives the untouched rows
 * itself from the roster + site defaults, so an employee added to the site simply appears, and
 * one who left is simply not rendered. Times are the draft's raw "HH:mm" strings, exactly as the
 * Site Attendance page holds them; nothing here is attendance data until the sheet is submitted
 * (siteFirstSubmitAttendance deletes the site/day's rows in the same transaction).
 *
 * `rev` is the row's optimistic-concurrency version: a write names the rev it was based on and
 * loses (conflict) if someone else wrote first; a submit names the rev of every row it carries.
 */
const draftSessionSchema = new mongoose.Schema(
  {
    checkIn: { type: String, default: "" },
    checkOut: { type: String, default: "" },
    isNightShift: { type: Boolean, default: false },
    manuallyCleared: { type: Boolean, default: false },
    checkInAutoInit: { type: Boolean, default: false },
  },
  { _id: false }
)

const attendanceDraftRowSchema = new mongoose.Schema(
  {
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: "Site", required: true },
    // Business day, UTC midnight — same convention as Attendance.date / AttendanceLock.date.
    date: { type: Date, required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    sessions: { type: [draftSessionSchema], default: [] },
    breaksTaken: { type: Number, default: null },
    isSickLeave: { type: Boolean, default: false },
    rev: { type: Number, required: true, default: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Denormalised for the "edited by X" hints on other devices.
    updatedByName: { type: String, default: null },
  },
  { timestamps: true }
)

attendanceDraftRowSchema.index({ siteId: 1, date: 1, employee: 1 }, { unique: true })
// Drafts that were never submitted (abandoned day, site deactivated) clean themselves up.
attendanceDraftRowSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 })

export default mongoose.model("AttendanceDraftRow", attendanceDraftRowSchema)
