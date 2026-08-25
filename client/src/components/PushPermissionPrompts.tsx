import { useEffect, useState } from "react"
import { BellRing, X, Share } from "lucide-react"
import toast from "react-hot-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { isPushSupported, getPushState, subscribeToPush } from "@/lib/push"

/**
 * Proactive "enable reminders" prompts so users actually discover check-out
 * reminders instead of the option sitting unnoticed in the sidebar.
 *
 * The native permission popup can't be forced open — browsers require a user
 * gesture and auto-deny an unprompted request. So this is the standard soft-ask:
 * an in-app modal (once, then a persistent fallback banner) whose "Enable"
 * button is the gesture that fires the real prompt via subscribeToPush().
 *
 * Shown only when eligible: push supported, permission still "default" (never
 * asked), and not already subscribed. Never shown once granted or hard-denied.
 * On iOS Safari before the PWA is installed, push APIs are absent — there we
 * instead nudge "Add to Home Screen", since that's the actual blocker.
 */
const STORE_KEY = "pushReminderPromptV1"
const MODAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // re-ask a week after "Not now"
const SESSION_HIDE_KEY = "pushPromptHiddenThisSession"

function getModalDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)?.modalDismissedAt
    return typeof v === "number" ? v : null
  } catch {
    return null
  }
}
function setModalDismissedAt(ts: number) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ modalDismissedAt: ts }))
  } catch {
    /* ignore storage errors (private mode etc.) */
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}
function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    // iOS Safari exposes navigator.standalone for home-screen PWAs.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export default function PushPermissionPrompts() {
  const [checked, setChecked] = useState(false)
  const [eligible, setEligible] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [iosHint, setIosHint] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      // Not supported here. If it's an uninstalled iOS device, nudge install.
      if (!isPushSupported()) {
        if (
          active &&
          isIOS() &&
          !isStandalone() &&
          sessionStorage.getItem(SESSION_HIDE_KEY) !== "ios"
        ) {
          setIosHint(true)
        }
        if (active) setChecked(true)
        return
      }

      const state = await getPushState()
      if (!active) return

      const isEligible =
        state.supported && state.permission === "default" && !state.subscribed
      setEligible(isEligible)
      setChecked(true)
      if (!isEligible) return

      const dismissedAt = getModalDismissedAt()
      const modalCoolingDown =
        dismissedAt !== null && Date.now() - dismissedAt < MODAL_COOLDOWN_MS

      if (!modalCoolingDown) {
        setShowModal(true)
      } else if (sessionStorage.getItem(SESSION_HIDE_KEY) !== "banner") {
        setShowBanner(true)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const enable = async () => {
    if (busy) return
    setBusy(true)
    try {
      await subscribeToPush()
      toast.success("Check-out reminders enabled")
      setShowModal(false)
      setShowBanner(false)
      setEligible(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't enable reminders"
      toast.error(msg)
      // Permission is likely denied now (or the user cancelled) — stop prompting.
      setShowModal(false)
      setShowBanner(false)
    } finally {
      setBusy(false)
    }
  }

  // "Not now" on the modal: remember it, and fall back to the banner this session.
  const dismissModal = () => {
    setModalDismissedAt(Date.now())
    setShowModal(false)
    if (eligible && sessionStorage.getItem(SESSION_HIDE_KEY) !== "banner") {
      setShowBanner(true)
    }
  }

  const hideBanner = () => {
    try {
      sessionStorage.setItem(SESSION_HIDE_KEY, "banner")
    } catch {
      /* ignore */
    }
    setShowBanner(false)
  }

  const hideIosHint = () => {
    try {
      sessionStorage.setItem(SESSION_HIDE_KEY, "ios")
    } catch {
      /* ignore */
    }
    setIosHint(false)
  }

  if (!checked) return null

  return (
    <>
      {(showBanner || iosHint) && (
        <div className="px-4 pt-4 md:px-6 md:pt-6">
          {iosHint && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <Share className="h-5 w-5 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="font-medium">Install the app to get reminders</p>
                <p className="text-muted-foreground">
                  Tap the Share button, then "Add to Home Screen", and open it from there.
                </p>
              </div>
              <button
                onClick={hideIosHint}
                aria-label="Dismiss"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {showBanner && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <BellRing className="h-5 w-5 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="font-medium">Turn on check-out reminders</p>
                <p className="text-muted-foreground">
                  Get a push when employees are left without a check-out.
                </p>
              </div>
              <Button size="sm" onClick={enable} disabled={busy}>
                Enable
              </Button>
              <button
                onClick={hideBanner}
                aria-label="Dismiss"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={showModal}
        onOpenChange={(o) => {
          if (!o) dismissModal()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              Get check-out reminders?
            </DialogTitle>
            <DialogDescription>
              We'll send a push notification when employees are left without a
              check-out for the day, so nothing slips through. You can turn this
              off anytime from the sidebar.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={dismissModal} disabled={busy}>
              Not now
            </Button>
            <Button onClick={enable} disabled={busy}>
              Enable reminders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
