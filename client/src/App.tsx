import { Route, Routes } from "react-router-dom"

import DashBoard from "./pages/DashBoard"
import SidebarLayout from "./components/SidebarLayout"
import Employees from "./pages/Employees"
// import MarkAttendance from "./pages/MarkAttendance"
import Reports from "./pages/Reports"
import Supervisor from "./pages/Supervisor"
import AddSupervisor from "./pages/AddSupervisor"
import Login from "./pages/Login"
import SiteAttendance from "./pages/SiteAttendance"

import ProtectedRoute from "./components/ProtectedRoute"
import SitesPage from "./pages/SitesPage"
import SiteDetail from "./pages/SiteDetail"
import ManageSupervisors from "./pages/ManageSupervisors"
import ManageEmployees from "./pages/ManageEmployees"
import MarkAttendancePage from "./pages/MarkAttendancePage"
import MarkAttendance from "./pages/MarkAttendance"
import MarkSiteAttendance from "./pages/MarkSiteAttendance"

function App() {

  return (
    <div>

      <Routes>

        {/* PUBLIC ROUTE */}

        <Route
          path="/login"
          element={<Login />}
        />

        {/* PROTECTED ROUTES */}

        <Route
          path="/"
          element={<SidebarLayout />}
        >

          {/* ADMIN + SUPERVISOR */}

          <Route
            path="/"
            element={
              <ProtectedRoute
                allowedRoles={["admin", "supervisor"]}
              >
                <DashBoard />
              </ProtectedRoute>
            }
          />

          {/* SUPERVISOR ONLY */}

          <Route
            path="/siteattendance"
            element={
              <ProtectedRoute
                allowedRoles={["supervisor"]}
              >
                <SiteAttendance />
              </ProtectedRoute>
            }
          />

          {/* ADMIN ONLY */}

          <Route
            path="/employees"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <Employees />
              </ProtectedRoute>
            }
          />

          <Route
            path="/attendance"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <MarkAttendance/>
              </ProtectedRoute>
            }
          />

          <Route
            path="/attendance/:id"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <MarkSiteAttendance/>
              </ProtectedRoute>
            }
          />

          {/* temp route */}
          <Route
            path="/attendancepage/:id"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <MarkAttendancePage/>
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <Reports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/supervisor"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <Supervisor />
              </ProtectedRoute>
            }
          />

          <Route
            path="/supervisor/:id"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <AddSupervisor />
              </ProtectedRoute>
            }
          />

          <Route
            path="/site"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <SitesPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/site/:id"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <SiteDetail />
              </ProtectedRoute>
            }
          />

          <Route
            path="/site/:id/manage-supervisors"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <ManageSupervisors />
              </ProtectedRoute>
            }
          />

          <Route
            path="/site/:id/manage-employees"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <ManageEmployees />
              </ProtectedRoute>
            }
          />

        </Route>

      </Routes>

    </div>
  )
}

export default App