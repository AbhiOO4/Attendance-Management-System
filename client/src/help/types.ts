// In-app user manual (Help page + per-page "?" buttons). Content is typed data, one file per
// chapter under ./topics; ./index.ts lists the chapters in reading order.
//
// Writing rules for every step (readers may have weak English):
// - one action per step, about 15 words at most, starting with the verb ("Click **Save**.")
// - always "click" (never tap/press/hit); exact button labels in **bold**
// - no technical words; explain a needed term in the glossary chapter instead
import type { LucideIcon } from "lucide-react"

export type HelpRole = "superadmin" | "admin"

export type HelpStep = {
  /** One short sentence. `**text**` is shown bold (use it for exact on-screen labels). */
  text: string
  /** Screenshot path under /help/ (client/public/help/), e.g. "timesheets/01-filters.jpg". */
  image?: string
  /** Extra "Good to know" note under the step. */
  tip?: string
  /** "Be careful" note under the step. */
  warning?: string
}

export type HelpWorkflow = {
  /** Anchor id, unique inside its topic (used as /help/<topic>#<id>). */
  id: string
  title: string
  /** "Use this when…" sentence. */
  when?: string
  steps: HelpStep[]
  /** Links to related workflows, shown under the steps. */
  seeAlso?: { topic: string; workflow?: string; label: string }[]
}

export type HelpTopic = {
  id: string
  title: string
  icon: LucideIcon
  /** Roles that can read this chapter. */
  roles: HelpRole[]
  /** One or two sentences: what this page is for. */
  summary: string
  /** Where to find the page, e.g. "Sidebar → Timesheets". */
  whereToFind?: string
  /** Picture of the whole page, shown under the summary. */
  overviewImage?: string
  workflows: HelpWorkflow[]
  /** Word list (the glossary chapter), shown after the workflows. */
  terms?: { term: string; meaning: string }[]
}
