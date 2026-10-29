import { Fragment, useState } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, ArrowRight, Lightbulb, MapPin } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { HelpTopic } from "@/help/types"
import { cn } from "@/lib/utils"

/** `**label**` → bold; everything else plain text. */
export function HelpText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** A screenshot from /help/. Click to see it full size. Hides itself if the file is missing. */
function HelpImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  if (broken) return null
  const url = `/help/${src}`
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 block w-full overflow-hidden rounded-lg border bg-muted/30 text-left shadow-sm transition hover:ring-2 hover:ring-primary/30"
        aria-label={`Show bigger picture: ${alt}`}
      >
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          className="block h-auto w-full"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[95dvh] overflow-auto p-2 sm:max-w-6xl">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img src={url} alt={alt} className="block h-auto w-full rounded" />
        </DialogContent>
      </Dialog>
    </>
  )
}

function Callout({ kind, text }: { kind: "tip" | "warning"; text: string }) {
  const tip = kind === "tip"
  const Icon = tip ? Lightbulb : AlertTriangle
  return (
    <div
      className={cn(
        "mt-3 flex gap-2 rounded-lg border px-3 py-2 text-sm",
        tip
          ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
          : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">{tip ? "Good to know: " : "Be careful: "}</span>
        <HelpText text={text} />
      </p>
    </div>
  )
}

export function SuperadminBadge() {
  return (
    <Badge variant="outline" className="border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300">
      Superadmin only
    </Badge>
  )
}

/**
 * One manual chapter: summary, then each workflow as numbered step cards. Shared by the Help
 * page and the per-page "?" dialog. `compact` tightens spacing for the dialog.
 */
export function HelpTopicView({ topic, compact = false }: { topic: HelpTopic; compact?: boolean }) {
  return (
    <div className={cn("space-y-8", compact && "space-y-6")}>
      <div className="space-y-3">
        <p className="text-base leading-relaxed text-muted-foreground">
          <HelpText text={topic.summary} />
        </p>
        {topic.whereToFind && (
          <p className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Where to find it:</span>
            <span className="font-medium">
              <HelpText text={topic.whereToFind} />
            </span>
          </p>
        )}
        {topic.overviewImage && <HelpImage src={topic.overviewImage} alt={`${topic.title} page`} />}
      </div>

      {topic.workflows.map((wf) => (
        <section key={wf.id} id={wf.id} className="scroll-mt-24 space-y-4">
          <div className="space-y-1 border-l-4 border-primary pl-3">
            <h2 className={cn("font-bold tracking-tight", compact ? "text-lg" : "text-xl")}>{wf.title}</h2>
            {wf.when && (
              <p className="text-sm text-muted-foreground">
                <HelpText text={wf.when} />
              </p>
            )}
          </div>

          <ol className="space-y-4">
            {wf.steps.map((step, i) => (
              // `relative` keeps the sr-only "Step N" label inside the card — unanchored, its
              // absolute position escaped <main>'s scroll box and stretched the whole page.
              <li key={i} className="relative flex gap-3 rounded-xl border bg-card p-3 sm:gap-4 sm:p-4">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-[15px] leading-relaxed">
                    <span className="sr-only">Step {i + 1}: </span>
                    <HelpText text={step.text} />
                  </p>
                  {step.tip && <Callout kind="tip" text={step.tip} />}
                  {step.warning && <Callout kind="warning" text={step.warning} />}
                  {step.image && <HelpImage src={step.image} alt={`Step ${i + 1}: ${step.text.replace(/\*\*/g, "")}`} />}
                </div>
              </li>
            ))}
          </ol>

          {wf.seeAlso && wf.seeAlso.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">See also:</span>
              {wf.seeAlso.map((s) => (
                <Link
                  key={`${s.topic}-${s.workflow ?? ""}`}
                  to={`/help/${s.topic}${s.workflow ? `#${s.workflow}` : ""}`}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium hover:bg-muted"
                >
                  {s.label}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}

      {topic.terms && topic.terms.length > 0 && (
        <dl className="divide-y rounded-xl border bg-card">
          {topic.terms.map((t) => (
            <div key={t.term} className="grid gap-1 p-3 sm:grid-cols-[12rem_1fr] sm:gap-4 sm:p-4">
              <dt className="font-semibold">{t.term}</dt>
              <dd className="text-[15px] leading-relaxed text-muted-foreground">
                <HelpText text={t.meaning} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
