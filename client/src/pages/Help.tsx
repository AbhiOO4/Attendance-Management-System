import { useEffect, useMemo, useState } from "react"
import { Link, Navigate, useLocation, useParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, BookOpen, Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { HelpText, HelpTopicView, SuperadminBadge } from "@/components/help/HelpTopicView"
import { useAuth } from "@/context/AuthContext"
import { HELP_GROUPS, canReadTopic, findTopic } from "@/help"
import type { HelpTopic } from "@/help/types"

const isSuperadminOnly = (t: HelpTopic) => t.roles.length === 1 && t.roles[0] === "superadmin"

type SearchHit = { topic: HelpTopic; workflowId?: string; title: string; snippet: string }

function searchTopics(topics: HelpTopic[], query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const matches = (s: string) => {
    const hay = s.toLowerCase()
    return words.every((w) => hay.includes(w))
  }
  const hits: SearchHit[] = []
  for (const topic of topics) {
    if (matches(`${topic.title} ${topic.summary}`)) {
      hits.push({ topic, title: topic.title, snippet: topic.summary })
    }
    for (const wf of topic.workflows) {
      const text = [wf.title, wf.when ?? "", ...wf.steps.flatMap((s) => [s.text, s.tip ?? "", s.warning ?? ""])].join(" ")
      if (matches(text)) {
        hits.push({ topic, workflowId: wf.id, title: wf.title, snippet: wf.when ?? wf.steps[0]?.text ?? "" })
      }
    }
    for (const term of topic.terms ?? []) {
      if (matches(`${term.term} ${term.meaning}`)) {
        hits.push({ topic, title: term.term, snippet: term.meaning })
      }
    }
  }
  return hits.slice(0, 40)
}

function HelpHome({ topics }: { topics: HelpTopic[] }) {
  const [query, setQuery] = useState("")
  const hits = useMemo(() => searchTopics(topics, query), [topics, query])
  const visible = new Set(topics.map((t) => t.id))

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <BookOpen className="h-7 w-7" />
          Help
        </h1>
        <p className="text-base text-muted-foreground">
          Step-by-step guides for every page. Pick a topic, or type what you want to do.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help, for example: approve timesheet"
          className="h-12 pl-10 text-base"
          aria-label="Search help"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {query.trim() ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {hits.length === 0 ? "Nothing found. Try fewer words." : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
          </p>
          <ul className="divide-y rounded-xl border bg-card">
            {hits.map((h, i) => (
              <li key={`${h.topic.id}-${h.workflowId ?? ""}-${i}`}>
                <Link
                  to={`/help/${h.topic.id}${h.workflowId ? `#${h.workflowId}` : ""}`}
                  className="block space-y-0.5 p-3 hover:bg-muted/50 sm:p-4"
                >
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{h.topic.title}</p>
                  <p className="font-semibold">{h.title}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    <HelpText text={h.snippet} />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        HELP_GROUPS.map((group) => {
          const groupTopics = group.topics.filter((t) => visible.has(t.id))
          if (groupTopics.length === 0) return null
          return (
            <section key={group.title} className="space-y-3">
              <h2 className="text-lg font-semibold">{group.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupTopics.map((t) => (
                  <Link
                    key={t.id}
                    to={`/help/${t.id}`}
                    className="group flex flex-col gap-2 rounded-xl border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                        <t.icon className="h-5 w-5" />
                      </span>
                      <span className="font-semibold">{t.title}</span>
                    </div>
                    <p className="line-clamp-3 text-sm text-muted-foreground">
                      <HelpText text={t.summary} />
                    </p>
                    <div className="mt-auto flex items-center justify-between pt-1">
                      {isSuperadminOnly(t) ? <SuperadminBadge /> : <span />}
                      <span className="text-xs text-muted-foreground">
                        {t.workflows.length > 0 ? `${t.workflows.length} guide${t.workflows.length === 1 ? "" : "s"}` : ""}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

function HelpTopicPage({ topic, topics }: { topic: HelpTopic; topics: HelpTopic[] }) {
  const { hash } = useLocation()

  // Jump to /help/<topic>#<workflow> once the chapter has rendered.
  useEffect(() => {
    if (!hash) return
    const id = window.setTimeout(() => {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" })
    }, 50)
    return () => window.clearTimeout(id)
  }, [hash, topic.id])

  const index = topics.findIndex((t) => t.id === topic.id)
  const prev = index > 0 ? topics[index - 1] : undefined
  const next = index >= 0 && index < topics.length - 1 ? topics[index + 1] : undefined

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-4 py-6 sm:px-6">
      <div className="min-w-0 flex-1 space-y-6">
        <Link to="/help" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          All help topics
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
            <topic.icon className="h-6 w-6" />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">{topic.title}</h1>
          {isSuperadminOnly(topic) && <SuperadminBadge />}
        </div>

        <HelpTopicView topic={topic} />

        <nav className="grid gap-3 border-t pt-6 sm:grid-cols-2" aria-label="Other topics">
          {prev ? (
            <Link to={`/help/${prev.id}`} className="rounded-xl border p-4 hover:bg-muted/50">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowLeft className="h-3 w-3" /> Previous
              </span>
              <span className="font-semibold">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link to={`/help/${next.id}`} className="rounded-xl border p-4 text-right hover:bg-muted/50">
              <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                Next <ArrowRight className="h-3 w-3" />
              </span>
              <span className="font-semibold">{next.title}</span>
            </Link>
          )}
        </nav>
      </div>

      {topic.workflows.length > 1 && (
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-6 space-y-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
            <ul className="space-y-1 text-sm">
              {topic.workflows.map((wf) => (
                <li key={wf.id}>
                  <a href={`#${wf.id}`} className="block rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                    {wf.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  )
}

/** In-app user manual: /help (topic list + search) and /help/:topicId (one chapter). */
export default function Help() {
  const { topicId } = useParams()
  const { user } = useAuth()
  const topics = useMemo(
    () => HELP_GROUPS.flatMap((g) => g.topics).filter((t) => canReadTopic(t, user?.role)),
    [user?.role],
  )

  if (!topicId) return <HelpHome topics={topics} />
  const topic = findTopic(topicId)
  if (!topic || !canReadTopic(topic, user?.role)) return <Navigate to="/help" replace />
  return <HelpTopicPage topic={topic} topics={topics} />
}
