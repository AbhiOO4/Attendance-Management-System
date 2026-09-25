/**
 * Runtime feature switches, read from the environment on every call so flipping one in the
 * host's env (plus a restart) takes effect without a client rebuild. Clients learn the current
 * values from GET /api/config (`features`).
 */

// Shared cloud attendance draft (models/attendanceDraftRowModel.js). Off → the draft endpoints
// 404, the submit draft guard is skipped, and the Site Attendance page keeps drafts on-device.
export const isCloudDraftEnabled = () =>
  /^(1|true|yes|on)$/i.test(String(process.env.CLOUD_DRAFT_ENABLED ?? "").trim())

export const getFeatures = () => ({
  cloudDraft: isCloudDraftEnabled(),
})
