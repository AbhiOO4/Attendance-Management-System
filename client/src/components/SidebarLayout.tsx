import { useMemo, useState } from "react"
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { Menu } from "lucide-react"
import { api } from "@/lib/api"

import { Button } from "@/components/ui/button"
import ScrollToTop from "./ScrollToTop"
import {
  Moon,
  Sun,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  LayoutDashboard,
  Users,
  ClipboardCheck,
  BarChart3,
  UserPlus,
  Building2,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import logo from '../assets/ngdp logo.png'

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
import PushReminderToggle from "./PushReminderToggle"
import PushPermissionPrompts from "./PushPermissionPrompts"

type NavItem = {
  name: string
  path: string
  icon: LucideIcon
}

const SUPER_ADMIN_NAV_ITEMS: NavItem[] = [
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Employees", path: "/employees", icon: Users },
  { name: "Mark Attendance", path: "/attendance", icon: ClipboardCheck },
  { name: "Reports", path: "/reports", icon: BarChart3 },
  { name: "Add Supervisors", path: "/supervisor", icon: UserPlus },
  { name: "Site", path: "/site", icon: Building2 },
  { name: "Configure", path: "/configure", icon: Settings },
  { name: "Manage Users", path: "/manage-users", icon: ShieldCheck },
]

const ADMIN_NAV_ITEMS: NavItem[] = [
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Employees", path: "/employees", icon: Users },
  { name: "Mark Attendance", path: "/attendance", icon: ClipboardCheck },
  { name: "Add Supervisors", path: "/supervisor", icon: UserPlus },
  { name: "Site", path: "/site", icon: Building2 },
  { name: "Configure", path: "/configure", icon: Settings },
]

function getSupervisorNavItems(
  assignedSite: string | null
): NavItem[] {
  const items: NavItem[] = [
    { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    { name: "Employees", path: "/employees", icon: Users },
  ]

  if (assignedSite) {
    items.push({
      name: "Mark Attendance",
      path: `/attendance/${assignedSite}`,
      icon: ClipboardCheck,
    })
    items.push({
      name: "Manage Employees",
      path: `/site/${assignedSite}`,
      icon: Users,
    })
  }

  return items
}

export default function SidebarLayout() {
  const { user, loading, clearUser } = useAuth()

  const { theme, setTheme } = useTheme()

  const [open, setOpen] = useState(false)
  const [openModal, setOpenModal] = useState(false)

  // Desktop-only: collapse the sidebar to a slim rail to reclaim space.
  // Persisted so it survives navigation and reloads. Does not affect mobile.
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem("sidebarCollapsed") === "true"
  )

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem("sidebarCollapsed", String(next))
      return next
    })
  }

  // Theme switch is synchronous, but show a brief spinner so the toggle gives
  // the same tactile "working…" feedback as the reminder button.
  const [themeBusy, setThemeBusy] = useState(false)

  const handleThemeToggle = () => {
    if (themeBusy) return
    setThemeBusy(true)
    setTheme(theme === "dark" ? "light" : "dark")
    window.setTimeout(() => setThemeBusy(false), 500)
  }

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

    if (user.role === "superadmin") {
      return SUPER_ADMIN_NAV_ITEMS
    }

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
          "fixed md:static top-0 left-0 h-full w-64 border-r bg-background transform transition-transform duration-300 z-50 flex flex-col overflow-hidden",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          collapsed && "md:w-16"
        )}
      >
        {/* Collapsed rail — desktop only: brand + icon nav */}
        <div className={cn("hidden flex-1 flex-col items-center gap-4 py-4", collapsed && "md:flex")}>
          {/* Brand logo */}
          <img
            src={logo}
            alt="NGDP Logo"
            className="h-8 w-auto object-contain"
          />

          {/* Expand toggle */}
          <button
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>

          {/* Icon-only nav */}
          <nav className="mt-2 flex flex-col items-center gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                title={item.name}
                aria-label={item.name}
                className={({ isActive }) =>
                  cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-xl transition",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )
                }
              >
                <item.icon className="h-5 w-5" />
              </NavLink>
            ))}
          </nav>

          {/* Bottom actions */}
          <div className="mt-auto flex flex-col items-center gap-2">
            <PushReminderToggle collapsed />
            <button
              onClick={handleThemeToggle}
              disabled={themeBusy}
              title={theme === "dark" ? "Light Mode" : "Dark Mode"}
              aria-label="Toggle theme"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {themeBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : theme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </button>
            <button
              onClick={() => setOpenModal(true)}
              title="Logout"
              aria-label="Logout"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Full sidebar content — hidden on desktop when collapsed */}
        <div className={cn("flex flex-1 flex-col min-h-0", collapsed && "md:hidden")}>
          {/* Close (mobile) / Collapse (desktop) */}
          <div className="flex justify-end p-4">
            <button className="md:hidden" onClick={() => setOpen(false)}>✕</button>
            <button
              className="hidden md:inline-flex text-muted-foreground hover:text-foreground"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-1 px-3">
            {/* Logo */}
            <div className="flex justify-center py-6">
              <img
                src={logo}
                alt="NGDP Logo"
                className="w-auto object-contain h-16 md:h-20 transition-all duration-300"
              />
            </div>

            {/* Nav */}
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.name}
                </NavLink>
              ))}
            </nav>

            {/* Actions — kept high, right below the nav */}
            <div className="mt-4 flex flex-col gap-1 border-t pt-4">
              <PushReminderToggle />
              <button
                onClick={handleThemeToggle}
                disabled={themeBusy}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
              >
                {themeBusy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : theme === "dark" ? (
                  <Sun className="h-4 w-4 shrink-0" />
                ) : (
                  <Moon className="h-4 w-4 shrink-0" />
                )}
                {themeBusy ? "Switching…" : theme === "dark" ? "Light Mode" : "Dark Mode"}
              </button>
              <button
                onClick={() => setOpenModal(true)}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Logout
              </button>
            </div>
          </div>
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
        <PushPermissionPrompts />
        <Outlet />
      </main>
    </div>
  )
}