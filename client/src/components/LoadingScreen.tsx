import { useEffect, useMemo, useRef, useState } from "react"

/**
 * Full-screen branded loading screen shown while the app boots (auth check).
 *
 * Why it exists: the testing deployment runs on Render's free tier, where the
 * API server spins down when idle. The first visit therefore waits on a cold
 * start (often 30-60s) before `/api/user/me` resolves. A bare "Loading..." over
 * that window reads as a broken/blank page — so this gives visitors something
 * alive to look at (a cursor-reactive particle field) and quietly explains the
 * wait as it stretches on, instead of letting them bounce.
 *
 * The particle field is a lightweight canvas: dots spring back to a home grid
 * and scatter away from the pointer, with faint links between neighbours. It
 * honours `prefers-reduced-motion` (renders a static field, no animation).
 */

type Particle = {
  hx: number // home x
  hy: number // home y
  x: number
  y: number
  vx: number
  vy: number
}

// Copy that escalates with the wait, so a long cold start reads as "working"
// rather than "stuck". Timings are cumulative from mount.
const STAGES: { after: number; text: string }[] = [
  { after: 0, text: "Getting things ready…" },
  { after: 4500, text: "Waking up the server — it takes a short nap when idle." },
  { after: 11000, text: "Almost there, thanks for your patience…" },
  { after: 22000, text: "Still warming up — free-tier servers are slow risers." },
]

export default function LoadingScreen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointer = useRef({ x: -9999, y: -9999, active: false })
  const [stage, setStage] = useState(0)

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  )

  // Advance the status message over time.
  useEffect(() => {
    const timers = STAGES.map((s, i) =>
      s.after === 0 ? null : window.setTimeout(() => setStage(i), s.after)
    )
    return () => timers.forEach((t) => t && window.clearTimeout(t))
  }, [])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const context = canvasEl.getContext("2d")
    if (!context) return
    // Non-null aliases so control-flow narrowing survives the nested closures.
    const cv: HTMLCanvasElement = canvasEl
    const ctx: CanvasRenderingContext2D = context

    // Grayscale palette matching the theme (near-black on light, near-white on
    // dark). Read the actual document class so we track next-themes' choice.
    const isDark = document.documentElement.classList.contains("dark")
    const base = isDark ? "255,255,255" : "20,20,20"

    let particles: Particle[] = []
    let width = 0
    let height = 0
    let dpr = 1

    const SPACING = 48 // px between home positions
    const LINK_DIST = 62 // draw a link when neighbours are closer than this
    const PUSH_RADIUS = 130 // pointer influence radius
    const PUSH_RADIUS_SQ = PUSH_RADIUS * PUSH_RADIUS

    function build() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = cv.clientWidth
      height = cv.clientHeight
      cv.width = Math.floor(width * dpr)
      cv.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cols = Math.ceil(width / SPACING) + 1
      const rows = Math.ceil(height / SPACING) + 1
      // Centre the grid so edges stay balanced.
      const offsetX = (width - (cols - 1) * SPACING) / 2
      const offsetY = (height - (rows - 1) * SPACING) / 2

      particles = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const jitter = SPACING * 0.18
          const hx = offsetX + c * SPACING + (Math.random() - 0.5) * jitter
          const hy = offsetY + r * SPACING + (Math.random() - 0.5) * jitter
          particles.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0 })
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, width, height)

      // Links first (behind the dots).
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j]
          const dx = p.x - q.x
          const dy = p.y - q.y
          const dsq = dx * dx + dy * dy
          if (dsq < LINK_DIST * LINK_DIST) {
            const alpha = (1 - dsq / (LINK_DIST * LINK_DIST)) * 0.18
            ctx.strokeStyle = `rgba(${base},${alpha})`
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(q.x, q.y)
            ctx.stroke()
          }
        }
      }

      // Dots.
      for (const p of particles) {
        // Highlight dots near the pointer so the interaction feels responsive.
        let glow = 0
        if (pointer.current.active) {
          const dx = p.x - pointer.current.x
          const dy = p.y - pointer.current.y
          const dsq = dx * dx + dy * dy
          if (dsq < PUSH_RADIUS_SQ) glow = 1 - dsq / PUSH_RADIUS_SQ
        }
        const radius = 1.5 + glow * 1.8
        const alpha = 0.35 + glow * 0.5
        ctx.fillStyle = `rgba(${base},${alpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function step() {
      const px = pointer.current.x
      const py = pointer.current.y
      const active = pointer.current.active

      for (const p of particles) {
        // Pointer repulsion.
        if (active) {
          const dx = p.x - px
          const dy = p.y - py
          const dsq = dx * dx + dy * dy
          if (dsq < PUSH_RADIUS_SQ && dsq > 0.01) {
            const dist = Math.sqrt(dsq)
            const force = ((PUSH_RADIUS - dist) / PUSH_RADIUS) * 2.4
            p.vx += (dx / dist) * force
            p.vy += (dy / dist) * force
          }
        }
        // Spring back home + damping.
        p.vx += (p.hx - p.x) * 0.02
        p.vy += (p.hy - p.y) * 0.02
        p.vx *= 0.86
        p.vy *= 0.86
        p.x += p.vx
        p.y += p.vy
      }
      draw()
      raf = requestAnimationFrame(step)
    }

    let raf = 0
    build()

    if (reducedMotion) {
      draw() // static field, no loop, no interaction
    } else {
      const onMove = (e: PointerEvent) => {
        const rect = cv.getBoundingClientRect()
        pointer.current.x = e.clientX - rect.left
        pointer.current.y = e.clientY - rect.top
        pointer.current.active = true
      }
      const onLeave = () => {
        pointer.current.active = false
        pointer.current.x = -9999
        pointer.current.y = -9999
      }
      window.addEventListener("pointermove", onMove, { passive: true })
      window.addEventListener("pointerdown", onMove, { passive: true })
      window.addEventListener("pointerup", onLeave)
      window.addEventListener("pointercancel", onLeave)

      raf = requestAnimationFrame(step)

      const onResize = () => build()
      window.addEventListener("resize", onResize)

      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerdown", onMove)
        window.removeEventListener("pointerup", onLeave)
        window.removeEventListener("pointercancel", onLeave)
        window.removeEventListener("resize", onResize)
      }
    }

    const onResize = () => build()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [reducedMotion])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background text-foreground">
      {/* Interactive particle field */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        aria-hidden="true"
      />

      {/* Soft radial vignette to keep the centre content legible */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, var(--background) 0%, transparent 55%)",
          opacity: 0.7,
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border bg-card/70 shadow-sm backdrop-blur-sm">
          <img
            src="/ngdp logo.png"
            alt="NGDP"
            className="h-9 w-auto object-contain animate-pulse"
            draggable={false}
          />
        </div>

        <h1 className="font-heading text-lg font-semibold tracking-tight">
          NGDP AMS
        </h1>

        {/* Indeterminate progress shimmer */}
        <div className="mt-4 h-1 w-44 overflow-hidden rounded-full bg-muted">
          <div className="loading-bar h-full w-1/3 rounded-full bg-foreground/80" />
        </div>

        <p
          className="mt-4 h-5 max-w-xs text-sm text-muted-foreground transition-opacity duration-300"
          role="status"
          aria-live="polite"
        >
          {STAGES[stage].text}
        </p>

        {!reducedMotion && (
          <p className="mt-6 text-xs text-muted-foreground/60">
            psst — sweep your cursor across the dots while you wait
          </p>
        )}
      </div>

      <style>{`
        @keyframes loading-bar-slide {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(420%); }
        }
        .loading-bar {
          animation: loading-bar-slide 1.15s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-bar { animation: none; width: 100%; }
        }
      `}</style>
    </div>
  )
}
