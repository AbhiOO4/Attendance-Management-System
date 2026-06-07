import { api } from "@/lib/api"
import { useEffect, useMemo, useState } from "react"

import EditUserModal from "@/components/EditUserModal.tsx"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  User
} from "lucide-react"

interface User {
  _id: string
  name: string
  employeeId: string
  email: string
  assignedSite: string
}

interface Site {
  _id: string
  siteName: string
}

function ManageUsers() {
  const [users, setUsers] = useState<User[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [siteMap, setSiteMap] = useState<Record<string, string>>({})
  const [search, setSearch] = useState("")
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [open, setOpen] = useState(false)

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

  const filteredUsers = useMemo(() => {
    const searchValue = search.toLowerCase()
    return users.filter((user) => {
      return (
        user.name.toLowerCase().includes(searchValue) ||
        user.employeeId.toLowerCase().includes(searchValue)
      )
    })
  }, [users, search])

  // Statistics calculation
  const totalSupervisors = users.length
  const assignedSupervisors = users.filter((u) => u.assignedSite).length
  const unassignedSupervisors = users.filter((u) => !u.assignedSite).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6">
      {/* Header Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Manage Supervisors
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview, assignment, and access control for system supervisors.
          </p>
        </div>

        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-full bg-background border-input shadow-sm hover:border-accent focus:ring-primary"
          />
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-200 hover:shadow-md">
          <div className="p-3 rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Supervisors</div>
            <div className="text-2xl font-bold text-foreground mt-0.5">{totalSupervisors}</div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-200 hover:shadow-md">
          <div className="p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assigned to Sites</div>
            <div className="text-2xl font-bold text-foreground mt-0.5">{assignedSupervisors}</div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center gap-4 transition-all duration-200 hover:shadow-md">
          <div className="p-3 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <UserX className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unassigned</div>
            <div className="text-2xl font-bold text-foreground mt-0.5">{unassignedSupervisors}</div>
          </div>
        </div>
      </div>

      {/* Table Section */}
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
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center p-6 text-muted-foreground">
                    <ShieldAlert className="h-8 w-8 mb-2 text-muted-foreground/60" />
                    <p className="font-medium text-foreground">No supervisors found</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Try adjusting your search criteria</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
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
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <EditUserModal
        open={open}
        onClose={() => setOpen(false)}
        user={selectedUser}
        sites={sites}
        onSuccess={fetchUsers}
      />
    </div>
  )
}

export default ManageUsers