import { useState } from "react"
import { Loader2 } from "lucide-react"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export interface LeaveGrant {
  _id: string
  type?: "annual" | "emergency"
  fromDate: string
  toDate: string
  note?: string
  workingDays: number
  status: "active" | "cancelled"
  createdAt: string
  grantedBy?: { name?: string } | null
  cancelledBy?: { name?: string } | null
}

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`

// The grant ledger for one employee. Cancelling asks first: it unlocks the days and
// puts them back the way they were before the grant.
export default function LeaveHistoryTable({
  leaves,
  onCancel,
}: {
  leaves: LeaveGrant[]
  onCancel: (leaveId: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState<LeaveGrant | null>(null)
  const [cancelling, setCancelling] = useState(false)

  if (leaves.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        No leave has been granted to this employee yet.
      </p>
    )
  }

  const confirmCancel = async () => {
    if (!confirming) return
    try {
      setCancelling(true)
      await onCancel(confirming._id)
    } finally {
      setCancelling(false)
      setConfirming(null)
    }
  }

  const isEmergency = confirming?.type === "emergency"

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Range</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Granted by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaves.map((leave) => (
              <TableRow key={leave._id}>
                <TableCell className="whitespace-nowrap">
                  {leave.type === "emergency" ? "Emergency" : "Annual"}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {fmt(leave.fromDate)} – {fmt(leave.toDate)}
                </TableCell>
                <TableCell className="text-right">{leave.workingDays}</TableCell>
                <TableCell className="max-w-[240px] whitespace-normal text-muted-foreground">
                  {leave.note || "-"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {leave.grantedBy?.name || "-"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={
                      leave.status === "active"
                        ? "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-400"
                        : "border-transparent bg-muted text-muted-foreground"
                    }
                  >
                    {leave.status === "active" ? "Active" : "Cancelled"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {leave.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirming(leave)}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {leave.cancelledBy?.name ? `by ${leave.cancelledBy.name}` : "—"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open && !cancelling) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {isEmergency ? "emergency" : "annual"} leave?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && (
                <>
                  {fmt(confirming.fromDate)} – {fmt(confirming.toDate)} (
                  {dayCount(confirming.workingDays)}). Each day goes back to how it was
                  before the leave was granted: days that had no record become unmarked
                  again, and days that were absent go back to absent. The days can be
                  edited again
                  {isEmergency ? "." : ", and they return to the annual leave balance."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep leave</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelling}
              onClick={(e) => {
                // Stay open until the request finishes; confirmCancel closes it.
                e.preventDefault()
                confirmCancel()
              }}
            >
              {cancelling && <Loader2 className="animate-spin" />}
              Cancel leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
