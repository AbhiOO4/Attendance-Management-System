import { useState } from "react"
import { Link } from "react-router-dom"
import { Ban, Loader2, MoreVertical, Pencil, Trash2 } from "lucide-react"

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  dayCount,
  fmtLeaveRange,
  type EmployeeRef,
  type LeaveApplication,
} from "@/lib/leave"

const employeeOf = (leave: LeaveApplication): EmployeeRef | null =>
  leave.employee && typeof leave.employee === "object" ? leave.employee : null

// The leave ledger: one employee's history (read-only on the timesheet) or every
// application on the Leave page (showEmployee + onEdit/onCancel/onDelete, in a kebab
// menu at the end of the row). Cancelling asks first: it unlocks the days and puts them
// back the way they were before the grant. Only a cancelled application can be deleted.
export default function LeaveHistoryTable({
  leaves,
  showEmployee = false,
  onEdit,
  onCancel,
  onDelete,
  emptyText = "No leave has been granted to this employee yet.",
}: {
  leaves: LeaveApplication[]
  showEmployee?: boolean
  onEdit?: (leave: LeaveApplication) => void
  onCancel?: (leaveId: string) => Promise<void>
  onDelete?: (leaveId: string) => Promise<void>
  emptyText?: string
}) {
  const [confirming, setConfirming] = useState<LeaveApplication | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [deleting, setDeleting] = useState<LeaveApplication | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const hasActions = !!(onEdit || onCancel || onDelete)

  if (leaves.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
    )
  }

  const confirmCancel = async () => {
    if (!confirming || !onCancel) return
    try {
      setCancelling(true)
      await onCancel(confirming._id)
    } finally {
      setCancelling(false)
      setConfirming(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleting || !onDelete) return
    try {
      setDeleteBusy(true)
      await onDelete(deleting._id)
    } finally {
      setDeleteBusy(false)
      setDeleting(null)
    }
  }

  const isEmergency = confirming?.type === "emergency"
  const deletingEmployee = deleting ? employeeOf(deleting) : null
  const confirmingEmployee = confirming ? employeeOf(confirming) : null

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {showEmployee && <TableHead>Employee</TableHead>}
              <TableHead>Type</TableHead>
              <TableHead>Range</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Granted by</TableHead>
              <TableHead>Status</TableHead>
              {hasActions && (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaves.map((leave) => {
              const employee = employeeOf(leave)
              return (
                <TableRow key={leave._id}>
                  {showEmployee && (
                    <TableCell>
                      {employee ? (
                        <Link
                          to={`/employees/${employee._id}`}
                          className="font-medium hover:underline"
                        >
                          {employee.name}
                        </Link>
                      ) : (
                        "-"
                      )}
                      {employee && (
                        <div className="text-xs text-muted-foreground">
                          {employee.employeeId}
                          {employee.jobTitle ? ` · ${employee.jobTitle}` : ""}
                        </div>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap">
                    <Badge
                      variant="secondary"
                      className={
                        leave.type === "emergency"
                          ? "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-400"
                          : "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-400"
                      }
                    >
                      {leave.type === "emergency" ? "Emergency" : "Annual"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fmtLeaveRange(leave.fromDate, leave.toDate)}
                  </TableCell>
                  <TableCell className="text-right">{leave.workingDays}</TableCell>
                  <TableCell className="max-w-[240px] whitespace-normal text-muted-foreground">
                    {leave.note || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {leave.grantedBy?.name || "-"}
                    {leave.updatedBy?.name && (
                      <div className="text-xs">edited by {leave.updatedBy.name}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={
                        leave.status === "active"
                          ? "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "border-transparent bg-muted text-muted-foreground"
                      }
                    >
                      {leave.status === "active" ? "Active" : "Cancelled"}
                    </Badge>
                    {leave.status === "cancelled" && leave.cancelledBy?.name && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        by {leave.cancelledBy.name}
                      </div>
                    )}
                  </TableCell>
                  {hasActions && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label="Leave actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {onEdit && (
                            <DropdownMenuItem
                              disabled={leave.status !== "active"}
                              onSelect={() => onEdit(leave)}
                            >
                              <Pencil />
                              Edit
                            </DropdownMenuItem>
                          )}
                          {onCancel && (
                            <DropdownMenuItem
                              disabled={leave.status !== "active"}
                              onSelect={() => setConfirming(leave)}
                            >
                              <Ban />
                              Cancel leave
                            </DropdownMenuItem>
                          )}
                          {onDelete && (
                            <>
                              {(onEdit || onCancel) && <DropdownMenuSeparator />}
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={leave.status !== "cancelled"}
                                onSelect={() => setDeleting(leave)}
                              >
                                <Trash2 />
                                <div className="flex flex-col">
                                  <span>Delete</span>
                                  {leave.status !== "cancelled" && (
                                    <span className="text-xs text-muted-foreground">
                                      Cancel the leave first
                                    </span>
                                  )}
                                </div>
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
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
              Cancel {isEmergency ? "emergency" : "annual"} leave
              {confirmingEmployee ? ` for ${confirmingEmployee.name}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && (
                <>
                  {fmtLeaveRange(confirming.fromDate, confirming.toDate)} (
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

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this leave application
              {deletingEmployee ? ` for ${deletingEmployee.name}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  {fmtLeaveRange(deleting.fromDate, deleting.toDate)} (
                  {dayCount(deleting.workingDays)}). It's removed from the list permanently.
                  Attendance isn't affected: the days were already restored when the leave
                  was cancelled.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deleteBusy && <Loader2 className="animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
