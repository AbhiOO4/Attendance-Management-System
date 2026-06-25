import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Loader2 } from "lucide-react"

export interface DefaultChange {
  field: string // human-readable label: "Day Shift Check-in", "Night Shift Check-out", etc.
  oldValue: string // "09:00"
  newValue: string // "09:30"
}

interface UpdateDefaultsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  changes: DefaultChange[]
  onConfirm: () => void // "Yes, Update Records"
  onSkip: () => void // "No, Just Save Defaults"
  loading: boolean
}

function ChangeDescription({ changes }: { changes: DefaultChange[] }) {
  if (changes.length === 1) {
    const { field, oldValue, newValue } = changes[0]
    return (
      <p className="text-sm text-muted-foreground">
        You changed <strong>{field}</strong> from{" "}
        <strong>{oldValue}</strong> to <strong>{newValue}</strong>.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">
        You changed the following defaults:
      </p>
      <ul className="list-none space-y-0.5 text-sm text-muted-foreground">
        {changes.map((change) => (
          <li key={change.field}>
            <strong>{change.field}</strong>:{" "}
            <strong>{change.oldValue}</strong> → <strong>{change.newValue}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function UpdateDefaultsDialog({
  open,
  onOpenChange,
  changes,
  onConfirm,
  onSkip,
  loading,
}: UpdateDefaultsDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(val) => {
        if (!loading) onOpenChange(val)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Update Today's Attendance Records?
          </AlertDialogTitle>

          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <ChangeDescription changes={changes} />

              <p className="text-sm text-muted-foreground">
                Would you like to update today's attendance records that
                still have the previous default values?
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel
            variant="outline"
            disabled={loading}
            onClick={(e) => {
              if (loading) {
                e.preventDefault()
                return
              }
              onSkip()
            }}
          >
            No, Just Save
          </AlertDialogCancel>

          <AlertDialogAction
            disabled={loading}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            Yes, Update Records
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
