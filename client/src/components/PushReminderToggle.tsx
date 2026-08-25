import { useEffect, useState } from "react"
import { Bell, BellOff, BellRing } from "lucide-react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"
import {
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push"

/**
 * Opt-in toggle for PWA check-out reminders. Subscribes/unsubscribes this device
 * via lib/push.ts. Renders nothing when the browser can't do Web Push (e.g. iOS
 * Safari before the PWA is installed to the home screen), so the sidebar stays
 * clean where the feature isn't available.
 */
export default function PushReminderToggle({
  collapsed = false,
}: {
  collapsed?: boolean
}) {
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getPushState().then((s) => {
      if (!active) return
      setSupported(s.supported)
      setSubscribed(s.subscribed)
      setPermission(s.permission)
    })
    return () => {
      active = false
    }
  }, [])

  if (!supported) return null

  const denied = permission === "denied"

  const handleClick = async () => {
    if (busy) return
    if (denied) {
      toast.error("Notifications are blocked. Enable them in your browser settings.")
      return
    }
    setBusy(true)
    try {
      if (subscribed) {
        await unsubscribeFromPush()
        setSubscribed(false)
        toast.success("Check-out reminders turned off")
      } else {
        await subscribeToPush()
        setSubscribed(true)
        setPermission("granted")
        toast.success("Check-out reminders enabled")
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't update reminders"
      toast.error(msg)
      if (typeof Notification !== "undefined") setPermission(Notification.permission)
    } finally {
      setBusy(false)
    }
  }

  const Icon = denied ? BellOff : subscribed ? BellRing : Bell
  const label = denied
    ? "Reminders blocked"
    : subscribed
      ? "Reminders on"
      : "Enable reminders"
  const title = denied
    ? "Notifications are blocked in your browser settings"
    : subscribed
      ? "Turn off check-out reminders on this device"
      : "Get a push reminder for unclosed check-outs"

  if (collapsed) {
    return (
      <button
        onClick={handleClick}
        disabled={busy}
        title={title}
        aria-label={label}
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-xl transition disabled:opacity-50",
          subscribed
            ? "text-primary hover:bg-muted"
            : "text-muted-foreground hover:bg-muted"
        )}
      >
        <Icon className="h-5 w-5" />
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title={title}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50",
        subscribed
          ? "text-foreground hover:bg-muted/60"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", subscribed && "text-primary")} />
      {label}
    </button>
  )
}
