import { Route, Routes } from "react-router-dom"

import DashBoard from "./pages/DashBoard"
import SidebarLayout from "./components/SidebarLayout"
import Employees from "./pages/Employees"
import MarkAttendance from "./pages/MarkAttendance"
import Reports from "./pages/Reports"
import Supervisor from "./pages/Supervisor"
import Site from "./pages/Site"
import AddSupervisor from "./pages/AddSupervisor"
import Login from "./pages/Login"
import SiteAttendance from "./pages/SiteAttendance"

import ProtectedRoute from "./components/ProtectedRoute"

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
            path="/dashboard"
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
                <MarkAttendance />
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
            path="/addsupervisor/:id"
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
                <Site />
              </ProtectedRoute>
            }
          />

        </Route>

      </Routes>

    </div>
  )
}

export default App