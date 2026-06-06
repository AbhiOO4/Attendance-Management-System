import { useMemo, useState } from "react"
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Menu } from "lucide-react"
import { api } from "@/lib/api"

import { Button } from "@/components/ui/button"
import ScrollToTop from "./ScrollToTop"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import logo from '../assets/ngdp logo.avif'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

import toast from "react-hot-toast"
import { useAuth } from "@/context/AuthContext"

type NavItem = {
  name: string
  path: string
}

const ADMIN_NAV_ITEMS: NavItem[] = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Employees", path: "/employees" },
  { name: "Mark Attendance", path: "/attendance" },
  { name: "Reports", path: "/reports" },
  { name: "Add Supervisors", path: "/supervisor" },
  { name: "Site", path: "/site" },
  { name: "Configure", path: "/configure" },
  { name: "Manage Users", path: "/manage-users" },
]

function getSupervisorNavItems(
  assignedSite: string | null
): NavItem[] {
  const items: NavItem[] = [
    { name: "Dashboard", path: "/dashboard" },
  ]

  if (assignedSite) {
    items.push({
      name: "Mark Attendance",
      path: `/attendance/${assignedSite}`,
    })
  }

  return items
}

export default function SidebarLayout() {
  const { user, loading, clearUser } = useAuth()

  const { theme, setTheme } = useTheme()

  const [open, setOpen] = useState(false)
  const [openModal, setOpenModal] = useState(false)

  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await api.post("/api/user/logout")
      clearUser()
      navigate("/login")
      toast.success("Logged out successfully")
    } catch (error) {
      console.log(error)
      toast.error("Log out failed")
    }
  }

  const navItems = useMemo(() => {
    if (!user) return []

    if (user.role === "admin") {
      return ADMIN_NAV_ITEMS
    }

    if (user.role === "supervisor") {
      return getSupervisorNavItems(user.assignedSite)
    }

    return []
  }, [user])

  if (loading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="flex h-screen w-full">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 border-b bg-background flex items-center px-4 z-50">
        <button onClick={() => setOpen(true)}>
          <Menu className="w-6 h-6" />
        </button>
        <span className="ml-4 font-semibold">AMS</span>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:static top-0 left-0 h-full w-64 border-r bg-background transform transition-transform duration-300 z-50 flex flex-col",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="md:hidden flex justify-end p-4">
          <button onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="flex flex-col flex-1">
          {/* Logo */}
          <div className="flex justify-center py-6 px-4 border-b">
            <img
              src={logo}
              alt="NGDP Logo"
              className="h-16 w-auto object-contain md:h-20"
            />
          </div>


          <div className="flex-1 flex items-center justify-center">
          <nav className="flex flex-col gap-3 w-full px-4">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "px-4 py-2 rounded-xl text-sm font-medium transition",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )
                }
              >
                {item.name}
              </NavLink>
            ))}
          </nav>
        </div>
        </div>

        <div className="p-4 border-t space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() =>
              setTheme(
                theme === "dark"
                  ? "light"
                  : "dark"
              )
            }
          >
            {theme === "dark" ? (
              <>
                <Sun className="mr-2 h-4 w-4" />
                Light Mode
              </>
            ) : (
              <>
                <Moon className="mr-2 h-4 w-4" />
                Dark Mode
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => setOpenModal(true)}
          >
            Logout
          </Button>
        </div>
      </aside>

      {/* Logout Modal */}
      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Logout</DialogTitle>
            <DialogDescription>
              Are you sure you want to logout?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenModal(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleLogout()
                setOpenModal(false)
              }}
            >
              Yes, Logout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 md:hidden z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <ScrollToTop />

      <main
        id="main-scroll-container"
        className="flex-1 overflow-auto mt-14 md:mt-0"
      >
        <Outlet />
      </main>
    </div>
  )
}