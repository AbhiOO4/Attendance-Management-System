import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import { api } from "@/lib/api";

import { Button } from "@/components/ui/button";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import toast from "react-hot-toast";

const navItems = [
  { name: "Dashboard", path: "/" },
  { name: "Employees", path: "/employees" },
  { name: "Mark Attendance", path: "/attendance" },
  { name: "Reports", path: "/reports" },
  { name: "Add Supervisors", path: "/supervisor" },
  { name: "Site", path: "/site" },
];

export default function SidebarLayout() {
  const [open, setOpen] = useState(false);
  const [openModal, setOpenModal] = useState(false);

  const navigate = useNavigate()

  // define later
  const handleLogout = async () => {
    try{
      await api.post('/api/user/logout')
      navigate('/login')
      toast.success("Logged out successfully")
    }catch(error){
      console.log(error)
      toast.error("Log out failed")
    }
  };

  return (
    <div className="flex h-screen w-full">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 border-b bg-background flex items-center px-4 z-50">
        <button onClick={() => setOpen(true)}>
          <Menu className="w-6 h-6" />
        </button>

        <span className="ml-4 font-semibold">App</span>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:static top-0 left-0 h-full w-64 border-r bg-background transform transition-transform duration-300 z-50 flex flex-col",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Close on mobile */}
        <div className="md:hidden flex justify-end p-4">
          <button onClick={() => setOpen(false)}>✕</button>
        </div>

        {/* Nav Links */}
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

        {/* Logout Button */}
        <div className="p-4 border-t">
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
            <Button
              variant="outline"
              onClick={() => setOpenModal(false)}
            >
              Cancel
            </Button>

            <Button
              variant="destructive"
              onClick={() => {
                handleLogout();
                setOpenModal(false);
              }}
            >
              Yes, Logout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 md:hidden z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto mt-14 md:mt-0">
        <Outlet />
      </main>
    </div>
  );
}