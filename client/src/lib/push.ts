// Web-Push subscription helpers for the PWA check-out reminders.
//
// The server stores each device's subscription (POST /api/user/push-subscription)
// and pushes reminders from cron/checkoutReminder.js; the SW push handler lives
// in public/push-sw.js. These helpers drive the browser side: feature-detect,
// ask permission, subscribe against the server's VAPID key, and tear down.
import { api } from "@/lib/api"

export type PushState = {
  /** Browser supports SW + Push + Notification (and we're in a secure context). */
  supported: boolean
  /** Notification.permission ("default" | "granted" | "denied"). */
  permission: NotificationPermission | "unsupported"
  /** Whether this device currently holds an active push subscription. */
  subscribed: boolean
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  )
}

// VAPID keys are base64url; PushManager wants a Uint8Array. Back it with an
// explicit ArrayBuffer so the type is Uint8Array<ArrayBuffer> (a valid
// BufferSource) rather than the wider Uint8Array<ArrayBufferLike>.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// navigator.serviceWorker.ready never resolves if no SW ever activates (dev mode,
// or a failed registration). Race a timeout so callers don't hang forever.
async function readyRegistration(
  timeoutMs = 3000
): Promise<ServiceWorkerRegistration | null> {
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])
  } catch {
    return null
  }
}

/** Current push state for this device (safe to call even when unsupported). */
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) {
    return { supported: false, permission: "unsupported", subscribed: false }
  }
  const reg = await readyRegistration()
  let subscribed = false
  if (reg) {
    try {
      subscribed = !!(await reg.pushManager.getSubscription())
    } catch {
      subscribed = false
    }
  }
  // Eligibility gates on permission too, so a timed-out "not subscribed" here
  // can never mis-prompt an already-granted user.
  return { supported: true, permission: Notification.permission, subscribed }
}

/**
 * Subscribe this device to push and register it with the server.
 * @returns true on success. Throws with a user-facing message on failure.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) {
    throw new Error("Notifications aren't supported on this device/browser.")
  }

  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.")
  }

  // Fetch the server's VAPID public key.
  const res = await api.get("/api/user/vapid-public-key")
  const publicKey: string | undefined = res.data?.data?.publicKey
  if (!publicKey) {
    throw new Error("Push notifications aren't configured on the server.")
  }

  const reg = await readyRegistration(5000)
  if (!reg) {
    throw new Error("Service worker isn't ready yet. Please reload and try again.")
  }

  // Reuse an existing subscription if present, else create one.
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  await api.post("/api/user/push-subscription", sub.toJSON())
  return true
}

/** Unsubscribe this device and remove it from the server. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await readyRegistration(5000)
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (!sub) return true

  const endpoint = sub.endpoint
  try {
    await sub.unsubscribe()
  } finally {
    // Best-effort server cleanup even if the browser unsubscribe failed.
    await api.delete("/api/user/push-subscription", { data: { endpoint } })
  }
  return true
}
