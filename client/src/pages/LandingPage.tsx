import { Link } from "react-router-dom"
import { ArrowRight, Download, Check, Smartphone, Monitor, Compass, Share, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import toast from "react-hot-toast"
import { useEffect, useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

type OS = "ios" | "android" | "desktop"

// Inline highlight for a key term inside an instruction step.
const Hl = ({ children }: { children: ReactNode }) => (
  <span className="font-semibold text-foreground">{children}</span>
)

// Inline highlight that pairs an icon with a label (kept on one line).
const IconWord = ({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 font-semibold text-foreground align-middle">
    <Icon className="h-3.5 w-3.5" />
    {children}
  </span>
)

const osTabs: { id: OS; label: string; icon: LucideIcon }[] = [
  { id: "ios", label: "iPhone", icon: Smartphone },
  { id: "android", label: "Android", icon: Smartphone },
  { id: "desktop", label: "Desktop", icon: Monitor },
]

const installSteps: Record<OS, ReactNode[]> = {
  ios: [
    <>Open the app in <Hl>Safari</Hl>.</>,
    <>Tap the <IconWord icon={Share}>Share</IconWord> button in the toolbar.</>,
    <>Scroll down and choose <Hl>Add to Home Screen</Hl>.</>,
    <>Tap <Hl>Add</Hl> in the top-right to finish.</>,
  ],
  android: [
    <>Open the app in <Hl>Chrome</Hl>.</>,
    <>Tap the <Hl>⋮ menu</Hl> in the top-right.</>,
    <>Choose <Hl>Install app</Hl> or <Hl>Add to Home Screen</Hl>.</>,
  ],
  desktop: [
    <>Open the app in <Hl>Chrome</Hl> or <Hl>Edge</Hl>.</>,
    <>Click the <IconWord icon={Compass}>Install</IconWord> icon in the address bar.</>,
    <>Click <Hl>Install</Hl> to confirm.</>,
  ],
}

export default function LandingPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isIOSDevice, setIsIOSDevice] = useState(false)
  const [isStandaloneMode, setIsStandaloneMode] = useState(false)
  const [selectedOS, setSelectedOS] = useState<"ios" | "android" | "desktop">("desktop")
  const [showInstallDialog, setShowInstallDialog] = useState(false)

  useEffect(() => {
    // Detect if running in standalone mode
    const checkStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                           (window.navigator as any).standalone
    setIsStandaloneMode(!!checkStandalone)

    // Detect iOS and mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    const checkIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

    setIsIOSDevice(checkIOS)
    if (checkIOS) {
      setSelectedOS("ios")
    } else if (isMobile) {
      setSelectedOS("android")
    } else {
      setSelectedOS("desktop")
    }

    // Listen to beforeinstallprompt event (Android / Desktop Chrome / Edge)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall)

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall)
    }
  }, [])

  const handleDownload = async () => {
    if (isStandaloneMode) {
      toast("NGDP AMS is already installed and running!", { icon: "📱" })
      return
    }

    if (isIOSDevice) {
      setSelectedOS("ios")
      setShowInstallDialog(true)
      return
    }

    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        toast.success("Thank you for installing NGDP AMS!")
        setDeferredPrompt(null)
      } else {
        toast.error("Installation cancelled.")
      }
    } else {
      setShowInstallDialog(true)
    }
  }

  const features = [
    "Real-time attendance across job sites",
    "Automated payroll & overtime calculation",
    "Per-site supervisor roles and oversight",
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      {/* Header */}
      <header className="w-full border-b">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img
              src="/ngdp logo.png"
              alt="NGDP Logo"
              className="h-7 w-auto object-contain"
            />
            <span className="text-sm font-semibold tracking-tight">NGDP AMS</span>
          </div>
          <Link to="/login">
            <Button variant="ghost" size="sm" className="cursor-pointer">
              Sign In
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Attendance &amp; Payroll, simplified
          </h1>
          <p className="text-muted-foreground">
            Track attendance across sites, manage supervisors, and automate
            payroll — all in one place.
          </p>

          <div className="flex flex-col gap-3 pt-2">
            <Link to="/login" className="w-full">
              <Button size="lg" className="w-full cursor-pointer gap-2">
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              onClick={handleDownload}
              className="w-full cursor-pointer gap-2"
            >
              <Download className="h-4 w-4" />
              Download App (V1.2.0)
            </Button>
          </div>
        </div>

        {/* Minimal feature list */}
        <ul className="mt-12 w-full max-w-sm space-y-3">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </main>

      {/* Footer */}
      <footer className="border-t py-6">
        <p className="px-4 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} NGDP. All rights reserved.
        </p>
      </footer>

      {/* PWA Install Instructions Dialog */}
      <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-[440px]">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Download className="h-5 w-5 shrink-0 text-primary" />
              Install the App
            </DialogTitle>
            <DialogDescription>
              Add NGDP AMS to your home screen for fast, full-screen access — no app store needed.
            </DialogDescription>
          </DialogHeader>

          {/* OS Selector Tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-xl border bg-muted/30 p-1">
            {osTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedOS(id)}
                className={`flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  selectedOS === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Steps for the selected platform */}
          <ol className="space-y-3">
            {installSteps[selectedOS].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {step}
                </span>
              </li>
            ))}
          </ol>

          <Button onClick={() => setShowInstallDialog(false)} className="w-full cursor-pointer">
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
