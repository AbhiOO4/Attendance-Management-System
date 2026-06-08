import { Link } from "react-router-dom"
import { ArrowRight, Download, Clock, CreditCard, Users, CheckCircle, Smartphone, Monitor, Compass, Share } from "lucide-react"
import { Button } from "@/components/ui/button"
import toast from "react-hot-toast"
import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

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

  return (
    <div className="min-h-screen bg-linear-to-b from-background via-muted/30 to-background font-sans text-foreground overflow-x-hidden">
      {/* Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img
              src="/ngdp logo.png"
              alt="NGDP Logo"
              className="h-10 w-auto object-contain"
            />
            <span className="font-heading text-lg font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              NGDP AMS
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#about" className="hover:text-foreground transition-colors">About</a>
            <a href="#stats" className="hover:text-foreground transition-colors">Analytics</a>
          </nav>

          <div className="flex items-center gap-4">
            <Link to="/login">
              <Button variant="outline" className="hidden sm:inline-flex cursor-pointer">
                Sign In
              </Button>
            </Link>
            <Link to="/login">
              <Button className="flex items-center gap-1.5 cursor-pointer">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-16 sm:pt-24 sm:pb-20 lg:pt-32 lg:pb-28">
        {/* Glow effects */}
        <div className="absolute inset-0 -z-10 flex items-center justify-center overflow-hidden">
          <div className="w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl opacity-60 animate-pulse" />
          <div className="w-[300px] h-[300px] bg-primary/10 rounded-full blur-2xl opacity-40 ml-40 mt-20" />
        </div>

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="mx-auto max-w-4xl space-y-6">
            

            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-tight">
              Attendance Management &<br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary/80 to-primary/60">
                Payroll Automation
              </span>
            </h1>

            <p className="mx-auto max-w-2xl text-lg sm:text-xl text-muted-foreground font-normal leading-relaxed">
              Track attendance effortlessly, manage shifts, assign supervisors, and automate complex payroll workflows in real-time. Designed to scale with your organization.
            </p>

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/login" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto gap-2 px-8 py-6 text-base font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all duration-300 cursor-pointer">
                  Go to Dashboard
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                onClick={handleDownload}
                className="w-full sm:w-auto gap-2 px-8 py-6 text-base font-semibold border-muted-foreground/30 hover:bg-muted/50 transition-all duration-300 cursor-pointer"
              >
                <Download className="h-5 w-5" />
                Download App (V1.2.0)
              </Button>
            </div>
          </div>

          {/* App Preview Card */}
          <div className="mt-16 sm:mt-20 lg:mt-24 mx-auto max-w-5xl px-4 animate-fade-in-up">
            <div className="rounded-2xl border bg-card text-card-foreground shadow-2xl overflow-hidden p-1.5 sm:p-2.5 bg-gradient-to-tr from-muted/50 to-background/50">
              <div className="rounded-xl border bg-background overflow-hidden shadow-inner aspect-video flex flex-col items-center justify-center p-8 text-center relative group">
                {/* Simulated dashboard placeholder with premium design */}
                <div className="absolute inset-0 bg-linear-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
                <div className="space-y-4 max-w-md">
                  <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <CheckCircle className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-heading text-xl font-bold">Secure Dashboard Panel</h3>
                  <p className="text-sm text-muted-foreground">
                    Supervisors and administrators can log in to instantly configure shift rates, track staff clock-ins, and export complete monthly sheets.
                  </p>
                  <div className="pt-2">
                    <Link to="/login">
                      <Button variant="secondary" size="sm" className="gap-1.5 cursor-pointer">
                        Access Live System
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 sm:py-24 border-t bg-muted/10">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center space-y-4 mb-16">
            <h2 className="font-heading text-3xl sm:text-4xl font-bold tracking-tight">
              Powerful Tools For Modern Operations
            </h2>
            <p className="text-muted-foreground">
              Say goodbye to manual spreadsheets. Our automated system ensures accuracy and transparency.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="group rounded-2xl border bg-card p-6 sm:p-8 hover:-translate-y-1 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-heading text-xl font-bold mb-3">Real-Time Attendance</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Log attendance at different job sites. Supervisors can instant-add or update records instantly with zero latency.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group rounded-2xl border bg-card p-6 sm:p-8 hover:-translate-y-1 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-heading text-xl font-bold mb-3">Payroll Automation</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Compute wages automatically based on hourly and daily rates set for each employee. Standardized formats ensure error-free calculations.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group rounded-2xl border bg-card p-6 sm:p-8 hover:-translate-y-1 hover:shadow-xl transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-heading text-xl font-bold mb-3">Supervisor Roles</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Assign supervisors to specific site locations, allowing decentralized check-ins while retaining full administrative oversight.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats/Trust Section */}
      <section id="stats" className="py-20 sm:py-24 border-t">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center">
            <div className="space-y-2">
              <div className="font-heading text-4xl sm:text-5xl font-extrabold text-primary">100%</div>
              <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Automated Processing</div>
            </div>
            <div className="space-y-2">
              <div className="font-heading text-4xl sm:text-5xl font-extrabold text-primary">0%</div>
              <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Manual Discrepancies</div>
            </div>
            <div className="space-y-2">
              <div className="font-heading text-4xl sm:text-5xl font-extrabold text-primary">24/7</div>
              <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Cloud Access & Backup</div>
            </div>
            <div className="space-y-2">
              <div className="font-heading text-4xl sm:text-5xl font-extrabold text-primary">10x</div>
              <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Faster Month-End Reports</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <img
              src="/ngdp logo.png"
              alt="NGDP Logo"
              className="h-8 w-auto object-contain opacity-85"
            />
            <span className="font-semibold text-foreground">NGDP AMS</span>
          </div>
          <div>
            &copy; {new Date().getFullYear()} NGDP Systems. All rights reserved.
          </div>
          <div className="flex gap-4">
            <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
          </div>
        </div>
      </footer>

      {/* PWA Install Instructions Dialog */}
      <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl font-bold flex items-center gap-2">
              <Download className="h-6 w-6 text-primary animate-bounce" />
              Install NGDP AMS App
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-1">
              Add the NGDP Attendance & Payroll system to your home screen or desktop for fast, offline access.
            </DialogDescription>
          </DialogHeader>

          {/* OS Selector Tabs */}
          <div className="flex gap-2 p-1 border rounded-xl bg-muted/30 my-4">
            <button
              onClick={() => setSelectedOS("ios")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                selectedOS === "ios" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Smartphone className="h-4 w-4" />
              iPhone / iPad
            </button>
            <button
              onClick={() => setSelectedOS("android")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                selectedOS === "android" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Smartphone className="h-4 w-4" />
              Android
            </button>
            <button
              onClick={() => setSelectedOS("desktop")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                selectedOS === "desktop" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Monitor className="h-4 w-4" />
              Desktop / PC
            </button>
          </div>

          {/* OS Instructions */}
          <div className="space-y-4 py-2 text-sm">
            {selectedOS === "ios" && (
              <div className="space-y-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</div>
                  <p className="text-muted-foreground">
                    Open the web app in <strong className="text-foreground">Safari browser</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</div>
                  <p className="text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    Tap the <strong className="text-foreground flex items-center gap-1"><Share className="h-4 w-4" /> Share</strong> icon at the bottom of the screen.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</div>
                  <p className="text-muted-foreground">
                    Scroll down and select <strong className="text-foreground">Add to Home Screen</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">4</div>
                  <p className="text-muted-foreground">
                    Tap <strong className="text-foreground">Add</strong> in the top-right corner to finish.
                  </p>
                </div>
              </div>
            )}

            {selectedOS === "android" && (
              <div className="space-y-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</div>
                  <p className="text-muted-foreground">
                    Open the web app in <strong className="text-foreground">Google Chrome</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</div>
                  <p className="text-muted-foreground">
                    Tap the <strong className="text-foreground">three dots menu</strong> (⋮) in the top-right.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</div>
                  <p className="text-muted-foreground">
                    Select <strong className="text-foreground">Install app</strong> or <strong className="text-foreground">Add to Home Screen</strong>.
                  </p>
                </div>
              </div>
            )}

            {selectedOS === "desktop" && (
              <div className="space-y-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">1</div>
                  <p className="text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    Look at the address bar in <strong className="text-foreground">Chrome / Edge</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">2</div>
                  <p className="text-muted-foreground flex items-center gap-1.5">
                    Click the <strong className="text-foreground flex items-center gap-1"><Compass className="h-4 w-4 animate-spin-slow" /> Install Icon</strong> (monitor with down arrow) on the far right of the address bar.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">3</div>
                  <p className="text-muted-foreground">
                    Click <strong className="text-foreground">Install</strong> in the pop-up confirmation dialog.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={() => setShowInstallDialog(false)} className="w-full sm:w-auto cursor-pointer">
              Got It
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
