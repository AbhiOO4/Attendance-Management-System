import { Route, Routes } from "react-router-dom"

import { useAuth } from "@/context/AuthContext"

import DashBoard from "./pages/DashBoard"
import Employees from "./pages/Employees"
import Supervisor from "./pages/Supervisor"
import AddSupervisor from "./pages/AddSupervisor"
import Login from "./pages/Login"
import LandingPage from "./pages/LandingPage"
import DemoLogin from "./pages/DemoLogin"

import SitesPage from "./pages/SitesPage"
import SiteDetail from "./pages/SiteDetail"
import ManageEmployees from "./pages/ManageEmployees"

import MarkAttendance from "./pages/MarkAttendance"
import SiteAttendance from "./pages/SiteAttendance"
import EditPastAttendance from "./pages/EditPastAttendance"

import ManageJobEmployees from "./pages/ManageJobEmployees"
import MonthlyReport from "./pages/MonthlyReport"
import Configure from "./pages/Configure"
import ManageUsers from "./pages/ManageUsers"
import EmployeeDetailAttendance from "./pages/EmployeeDetailAttendance"
import InstaAddEmployees from "./pages/InstaAddEmployees"
import HiredWorkers from "./pages/HiredWorkers"

import SidebarLayout from "./components/SidebarLayout"
import ProtectedRoute from "./components/ProtectedRoute"
import PublicRoute from "./components/PublicRoute"

function App() {
  const { loading } = useAuth()

  // ONLY block while fetching auth
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    )
  }

  return (
    <Routes>
      {/* PUBLIC */}
      {/* PUBLIC */}
      <Route
        path="/"
        element={
          <PublicRoute>
            <LandingPage />
          </PublicRoute>
        }
      />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/demo-login"
        element={
          <PublicRoute>
            <DemoLogin />
          </PublicRoute>
        }
      />
      {/* PROTECTED LAYOUT */}
      <Route
        element={
          <ProtectedRoute allowedRoles={["superadmin", "admin", "supervisor"]}>
            <SidebarLayout />
          </ProtectedRoute>
        }
      >

        <Route path="dashboard"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin", "supervisor"]}>
              <DashBoard />
            </ProtectedRoute>
          }
        />

        {/* ADMIN ONLY (and Superadmin) */}
        <Route
          path="employees"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <Employees />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/:id"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <EmployeeDetailAttendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <MarkAttendance />
            </ProtectedRoute>
          }
        />

        {/* SUPERADMIN ONLY */}
        <Route
          path="reports"
          element={
            <ProtectedRoute allowedRoles={["superadmin"]}>
              <MonthlyReport />
            </ProtectedRoute>
          }
        />

        <Route
          path="supervisor"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <Supervisor />
            </ProtectedRoute>
          }
        />

        <Route
          path="supervisor/:id"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <AddSupervisor />
            </ProtectedRoute>
          }
        />

        <Route
          path="site"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <SitesPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="site/:id"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <SiteDetail />
            </ProtectedRoute>
          }
        />

        <Route
          path="site/:id/manage-employees"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <ManageEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="site/job/:jobId"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <ManageJobEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="configure"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <Configure />
            </ProtectedRoute>
          }
        />

        {/* SUPERADMIN ONLY */}
        <Route
          path="manage-users"
          element={
            <ProtectedRoute allowedRoles={["superadmin"]}>
              <ManageUsers />
            </ProtectedRoute>
          }
        />

        {/* SHARED (superadmin + admin + supervisor) */}
        <Route
          path="attendance/:id"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin", "supervisor"]}>
              <SiteAttendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/:siteId/insta-add"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin", "supervisor"]}>
              <InstaAddEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="hired-workers"
          element={
            <ProtectedRoute allowedRoles={["supervisor"]}>
              <HiredWorkers />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/edit"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin"]}>
              <EditPastAttendance />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  )
}

export default App