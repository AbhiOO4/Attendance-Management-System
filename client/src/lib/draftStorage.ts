// Guarded localStorage access for the Site Attendance draft cache.
//
// localStorage can throw (quota exceeded, storage disabled in a private window). An unguarded
// setItem inside the debounced draft write used to throw from a timer and silently stop
// persisting the draft for the rest of the session.
import toast from "react-hot-toast"

let quotaWarned = false

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (err) {
    console.log(err)
    if (!quotaWarned) {
      quotaWarned = true
      toast.error(
        "This device couldn't store the draft (storage full or blocked). Save attendance before closing the app.",
        { duration: 8000 }
      )
    }
    return false
  }
}

export function safeRemoveItem(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* storage unavailable — nothing to remove */
  }
}

export const draftStorageKey = (siteId: string, date: string) => `attendance_draft_${siteId}_${date}`

// Draft caches and cloud-draft outboxes (lib/cloudDraft.ts) — both keyed by site + day.
const DRAFT_KEY_RE = /^attendance_(?:draft|outbox)_.+_(\d{4}-\d{2}-\d{2})$/

/**
 * Drop cached drafts / outboxes for every day except `today`, across all sites. The page always opens on
 * the current business day, so an older draft can never be rehydrated again — it's dead weight
 * that only accumulates (abandoned drafts, a second supervisor beaten to Save) until the
 * storage quota is hit.
 */
export function pruneStaleDraftKeys(today: string) {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const match = key ? DRAFT_KEY_RE.exec(key) : null
      if (key && match && match[1] !== today) stale.push(key)
    }
    stale.forEach((key) => localStorage.removeItem(key))
  } catch {
    /* storage unavailable */
  }
}
