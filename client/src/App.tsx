import { lazy, Suspense } from "react"
import { Route, Routes } from "react-router-dom"

import { useAuth } from "@/context/AuthContext"

// Route-level code splitting: each page loads on demand so heavy,
// page-specific dependencies (e.g. exceljs/xlsx in the report pages)
// stay out of the initial bundle.
const DashBoard = lazy(() => import("./pages/DashBoard"))
const Employees = lazy(() => import("./pages/Employees"))
const Supervisor = lazy(() => import("./pages/Supervisor"))
const AddSupervisor = lazy(() => import("./pages/AddSupervisor"))
const Login = lazy(() => import("./pages/Login"))
const LandingPage = lazy(() => import("./pages/LandingPage"))
const DemoLogin = lazy(() => import("./pages/DemoLogin"))

const SitesPage = lazy(() => import("./pages/SitesPage"))
const SiteDetail = lazy(() => import("./pages/SiteDetail"))

const MarkAttendance = lazy(() => import("./pages/MarkAttendance"))
const SiteAttendance = lazy(() => import("./pages/SiteAttendance"))
const EditPastAttendance = lazy(() => import("./pages/EditPastAttendance"))

const ManageJobEmployees = lazy(() => import("./pages/ManageJobEmployees"))
const MonthlyReport = lazy(() => import("./pages/MonthlyReport"))
const Configure = lazy(() => import("./pages/Configure"))
const ManageUsers = lazy(() => import("./pages/ManageUsers"))
const EmployeeDetailAttendance = lazy(() => import("./pages/EmployeeDetailAttendance"))
const InstaAddEmployees = lazy(() => import("./pages/InstaAddEmployees"))
const HiredWorkers = lazy(() => import("./pages/HiredWorkers"))

import SidebarLayout from "./components/SidebarLayout"
import ProtectedRoute from "./components/ProtectedRoute"
import PublicRoute from "./components/PublicRoute"

const RouteFallback = () => (
  <div className="flex h-[60vh] items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
  </div>
)

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
    <Suspense fallback={<RouteFallback />}>
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
          path="attendance/:siteId/hired-workers"
          element={
            <ProtectedRoute allowedRoles={["superadmin", "admin", "supervisor"]}>
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
    </Suspense>
  )
}

export default App