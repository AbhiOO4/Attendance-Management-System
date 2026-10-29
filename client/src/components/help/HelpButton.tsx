import { useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, CircleHelp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/context/AuthContext"
import { findTopic, canReadTopic } from "@/help"
import { HelpTopicView } from "./HelpTopicView"

/**
 * Small "?" button for a page header. Opens that page's manual chapter in a dialog, so the
 * page underneath (an unsaved attendance draft, open filters) stays as it is.
 */
export default function HelpButton({ topic: topicId, className }: { topic: string; className?: string }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const topic = findTopic(topicId)
  if (!topic || !canReadTopic(topic, user?.role)) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={className}
        onClick={() => setOpen(true)}
        aria-label={`Help: ${topic.title}`}
        title="Help for this page"
      >
        <CircleHelp className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <topic.icon className="h-5 w-5" />
              {topic.title}
            </DialogTitle>
            <DialogDescription>
              <Link
                to={`/help/${topic.id}`}
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Open full guide
              </Link>
            </DialogDescription>
          </DialogHeader>
          <HelpTopicView topic={topic} compact />
        </DialogContent>
      </Dialog>
    </>
  )
}
