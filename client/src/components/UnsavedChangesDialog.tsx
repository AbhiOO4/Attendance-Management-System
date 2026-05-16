// components/UnsavedChangesDialog.tsx

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

interface UnsavedChangesDialogProps {
  open: boolean
  onStay: () => void
  onLeave: () => void
}

export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Unsaved Changes
          </AlertDialogTitle>

          <AlertDialogDescription>
            You have unsaved attendance changes.
            If you leave this page, your changes
            will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>
            Stay
          </AlertDialogCancel>

          <AlertDialogAction onClick={onLeave}>
            Leave Page
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}