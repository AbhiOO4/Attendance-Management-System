import { api } from "@/lib/api"
import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { useAuth } from "@/context/AuthContext"

import EditUserModal from "@/components/EditUserModal.tsx"
import AddAdminModal from "@/components/AddAdminModal.tsx"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { 
  Search, 
  UserCheck, 
  UserX, 
  Users, 
  Edit2, 
  ShieldAlert, 
  KeyRound,
  Mail,
  User,
  Trash2
} from "lucide-react"

interface User {
  _id: string
  name: string
  employeeId?: string
  email: string
  assignedSite?: string
  role?: string
}

interface Site {
  _id: string
  siteName: string
}

function ManageUsers() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [siteMap, setSiteMap] = useState<Record<string, string>>({})
  const [search, setSearch] = useState("")
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [open, setOpen] = useState(false)
  const [addAdminOpen, setAddAdminOpen] = useState(false)
  
  // New States to handle the Single lifted Delete Dialog safely
  const [userToDelete, setUserToDelete] = useState<User | null>(null)
  const [deletePassword, setDeletePassword] = useState("")

  const handleDeleteUser = async (userId: string, deletePassword?: string) => {
    try {
      await api.delete(`/api/user/${userId}`, {
        data: { deletePassword }
      })
      fetchUsers()
      toast.success("User deleted successfully")
      setUserToDelete(null) // Reset on success
    } catch (error: any) {
      console.error(error)
      const errorMsg = error?.response?.data?.message || "Failed to delete user"
      toast.error(errorMsg)
    }
  }

  const fetchUsers = async () => {
    try {
      const res = await api.get<User[]>("/api/user")
      setUsers(res.data)
    } catch (error) {
      console.log(error)
    }
  }

  const fetchSites = async () => {
    try {
      const res = await api.get<Site[]>("/api/site")
      const sitesData = res.data
      const map: Record<string, string> = {}
      for (const site of sitesData) {
        map[site._id] = site.siteName
      }
      setSites(sitesData)
      setSiteMap(map)
    } catch (error) {
      console.log(error)
    }
  }

  useEffect(() => {
    fetchUsers()
    fetchSites()
  }, [])

  const supervisors = useMemo(() => {
    return users.filter((user) => user.role !== "admin")
  }, [users])

  const admins = useMemo(() => {
    return users.filter((user) => user.role === "admin")
  }, [users])

  const filteredSupervisors = useMemo(() => {
    const searchValue = search.toLowerCase()
    return supervisors.filter((user) => {
      return (
        user.name.toLowerCase().includes(searchValue) ||
        (user.employeeId && user.employeeId.toLowerCase().includes(searchValue)) ||
        user.email.toLowerCase().includes(searchValue)
      )
    })
  }, [supervisors, search])

  const filteredAdmins = useMemo(() => {
    const searchValue = search.toLowerCase()
    return admins.filter((user) => {
      return (
        user.name.toLowerCase().includes(searchValue) ||
        user.email.toLowerCase().includes(searchValue)
      )
    })
  }, [admins, search])

  const totalSupervisors = supervisors.length
  const assignedSupervisors = supervisors.filter((u) => u.assignedSite).length
  const unassignedSupervisors = supervisors.filter((u) => !u.assignedSite).length
  const totalAdmins = admins.length

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6">
      {/* Header Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Manage Users
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview, assignment, and access control for system supervisors and admins.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-center w-full sm:w-auto">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full bg-background border-input shadow-sm hover:border-accent focus:ring-primary"
            />
          </div>

          <Button
            onClick={() => setAddAdminOpen(true)}
            className="w-full sm:w-auto inline-flex items-center gap-1.5"
          >
            Add Admin
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-200 hover:shadow-md">
          <div className="p-3 rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Supervisors</div>
            <div className="text-2xl font-bold text-foreground mt-0.5">{totalSupervisors}</div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-200 hover:shadow-md">
          <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Admin Users</div>
            <div className="text-2xl font-bold text-foreground mt-0.5">{totalAdmins}</div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-200 hover:shadow-md">
          <div className="p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assigned (Supr)</div>
            <div className="text-2xl font-bold text-foreground mt-0.5">{assignedSupervisors}</div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-200 hover:shadow-md">
          <div className="p-3 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <UserX className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unassigned (Supr)</div>
            <div className="text-2xl font-bold text-foreground mt-0.5">{unassignedSupervisors}</div>
          </div>
        </div>
      </div>

      {/* Supervisors Table Section */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <span>Supervisors</span>
          <Badge variant="outline" className="text-xs font-normal">{filteredSupervisors.length}</Badge>
        </h2>
        <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="font-semibold text-foreground">Name</TableHead>
                <TableHead className="font-semibold text-foreground">Employee ID</TableHead>
                <TableHead className="font-semibold text-foreground">Assigned Site</TableHead>
                <TableHead className="font-semibold text-foreground">Email</TableHead>
                <TableHead className="font-semibold text-foreground">Password</TableHead>
                <TableHead className="font-semibold text-foreground text-right">Action</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredSupervisors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center p-6 text-muted-foreground">
                      <ShieldAlert className="h-8 w-8 mb-2 text-muted-foreground/60" />
                      <p className="font-medium text-foreground">No supervisors found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredSupervisors.map((user) => (
                  <TableRow key={user._id} className="transition-colors hover:bg-muted/30">
                    <TableCell className="font-medium text-foreground py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <span>{user.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-sm text-foreground">
                      {user.employeeId}
                    </TableCell>

                    <TableCell>
                      {user.assignedSite ? (
                        <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-medium px-2.5 py-0.5">
                          {siteMap[user.assignedSite] || "Assigned"}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground border-none font-medium px-2.5 py-0.5">
                          Unassigned
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-muted-foreground text-sm">
                      <div className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground/50" />
                        <span>{user.email}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1.5 text-muted-foreground/50 font-mono text-xs">
                        <KeyRound className="h-3.5 w-3.5 text-muted-foreground/30" />
                        <span>••••••••</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-right py-3.5">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedUser(user)
                            setOpen(true)
                          }}
                          className="inline-flex items-center gap-1.5 hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit
                        </Button>

                        <Button
                          size="sm"
                          variant="destructive"
                          className="inline-flex items-center gap-1.5"
                          onClick={() => setUserToDelete(user)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Admin Users Table Section */}
      <div className="space-y-3 pt-4">
        <h2 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2">
          <span>Administrators</span>
          <Badge variant="outline" className="text-xs font-normal">{filteredAdmins.length}</Badge>
        </h2>
        <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="font-semibold text-foreground">Name</TableHead>
                <TableHead className="font-semibold text-foreground">Email</TableHead>
                <TableHead className="font-semibold text-foreground">Password</TableHead>
                <TableHead className="font-semibold text-foreground text-right">Action</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filteredAdmins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center p-6 text-muted-foreground">
                      <ShieldAlert className="h-8 w-8 mb-2 text-muted-foreground/60" />
                      <p className="font-medium text-foreground">No admin users found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAdmins.map((user) => (
                  <TableRow key={user._id} className="transition-colors hover:bg-muted/30">
                    <TableCell className="font-medium text-foreground py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          <User className="h-3.5 w-3.5" />
                        </div>
                        <span>{user.name}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-muted-foreground text-sm">
                      <div className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground/50" />
                        <span>{user.email}</span>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1.5 text-muted-foreground/50 font-mono text-xs">
                        <KeyRound className="h-3.5 w-3.5 text-muted-foreground/30" />
                        <span>••••••••</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-right py-3.5">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedUser(user)
                            setOpen(true)
                          }}
                          className="inline-flex items-center gap-1.5 hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                          Edit / Reset Password
                        </Button>

                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={currentUser?._id === user._id}
                          className="inline-flex items-center gap-1.5"
                          title={currentUser?._id === user._id ? "You cannot delete your own account" : ""}
                          onClick={() => setUserToDelete(user)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Global Modals Modifiers */}
      <EditUserModal
        open={open}
        onClose={() => setOpen(false)}
        user={selectedUser}
        sites={sites}
        onSuccess={fetchUsers}
      />

      <AddAdminModal
        open={addAdminOpen}
        onClose={() => setAddAdminOpen(false)}
        onSuccess={fetchUsers}
      />

      {/* Lifted Controlled Delete Confirmation Dialog */}
      <AlertDialog open={!!userToDelete} onOpenChange={(isOpen) => !isOpen && setUserToDelete(null)}>
        <AlertDialogContent className="text-left">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the account for <strong>{userToDelete?.name}</strong>. This action requires the Main Admin Delete Password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-3">
            <Input
              type="password"
              placeholder="Enter Delete Password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="w-full bg-background"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setUserToDelete(null)
              setDeletePassword("")
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!deletePassword}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (userToDelete) {
                  handleDeleteUser(userToDelete._id, deletePassword)
                  setDeletePassword("")
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default ManageUsers