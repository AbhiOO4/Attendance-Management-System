import { Route, Routes, Navigate } from "react-router-dom"

import { useAuth } from "@/context/AuthContext"

import DashBoard from "./pages/DashBoard"
import Employees from "./pages/Employees"
import Supervisor from "./pages/Supervisor"
import AddSupervisor from "./pages/AddSupervisor"
import Login from "./pages/Login"

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
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      {/* PROTECTED LAYOUT */}
      <Route
        path="/"
        element={
          <ProtectedRoute allowedRoles={["admin", "supervisor"]}>
            <SidebarLayout />
          </ProtectedRoute>
        }
      >
        {/* DASHBOARD */}

        <Route
          index
          element={<Navigate to="/dashboard" replace />}
        />

        <Route path="dashboard"
          element={
            <ProtectedRoute allowedRoles={["admin", "supervisor"]}>
              <DashBoard />
            </ProtectedRoute>
          }
        />

        {/* ADMIN ONLY */}
        <Route
          path="employees"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <Employees />
            </ProtectedRoute>
          }
        />

        <Route
          path="employees/:id"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <EmployeeDetailAttendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <MarkAttendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="reports"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <MonthlyReport />
            </ProtectedRoute>
          }
        />

        <Route
          path="supervisor"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <Supervisor />
            </ProtectedRoute>
          }
        />

        <Route
          path="supervisor/:id"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <AddSupervisor />
            </ProtectedRoute>
          }
        />

        <Route
          path="site"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <SitesPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="site/:id"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <SiteDetail />
            </ProtectedRoute>
          }
        />

        <Route
          path="site/:id/manage-employees"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <ManageEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="site/job/:jobId"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <ManageJobEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="configure"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <Configure />
            </ProtectedRoute>
          }
        />

        <Route
          path="manage-users"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <ManageUsers />
            </ProtectedRoute>
          }
        />

        {/* SHARED (admin + supervisor) */}
        <Route
          path="attendance/:id"
          element={
            <ProtectedRoute allowedRoles={["admin", "supervisor"]}>
              <SiteAttendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/:siteId/insta-add"
          element={
            <ProtectedRoute allowedRoles={["admin", "supervisor"]}>
              <InstaAddEmployees />
            </ProtectedRoute>
          }
        />

        <Route
          path="attendance/edit"
          element={
            <ProtectedRoute allowedRoles={["admin"]}>
              <EditPastAttendance />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  )
}

export default App