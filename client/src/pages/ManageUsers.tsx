import { api } from "@/lib/api"
import { useEffect, useMemo, useState } from "react"

import EditUserModal from "@/components/EditUserModal.tsx"

import { Input } from "@/components/ui/input"

import { Button } from "@/components/ui/button"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

        <h1 className="text-2xl font-bold">
          Manage Supervisors
        </h1>

        <Input
          placeholder="Search by name or employee ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-sm"
        />

      </div>

      <div className="border rounded-xl">

        <Table>

          <TableHeader>

            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Employee ID</TableHead>
              <TableHead>Assigned Site</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>

          </TableHeader>

          <TableBody>

            {filteredUsers.map((user) => (

              <TableRow key={user._id}>

                <TableCell>
                  {user.name}
                </TableCell>

                <TableCell>
                  {user.employeeId}
                </TableCell>

                <TableCell>
                  {siteMap[user.assignedSite] || "N/A"}
                </TableCell>

                <TableCell>
                  {user.email}
                </TableCell>

                <TableCell>
                  ********
                </TableCell>

                <TableCell>

                  <Button
                    size="sm"
                    onClick={() => {
                      setSelectedUser(user)
                      setOpen(true)
                    }}
                  >
                    Edit
                  </Button>

                </TableCell>

              </TableRow>

            ))}

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