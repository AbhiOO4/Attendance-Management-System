import { Route, Routes } from "react-router-dom"

import DashBoard from "./pages/DashBoard"
import SidebarLayout from "./components/SidebarLayout"
import Employees from "./pages/Employees"
// import MarkAttendance from "./pages/MarkAttendance"
import Reports from "./pages/Reports"
import Supervisor from "./pages/Supervisor"
import AddSupervisor from "./pages/AddSupervisor"
import Login from "./pages/Login"


import ProtectedRoute from "./components/ProtectedRoute"
import SitesPage from "./pages/SitesPage"
import SiteDetail from "./pages/SiteDetail"
import ManageSupervisors from "./pages/ManageSupervisors"
import ManageEmployees from "./pages/ManageEmployees"
import MarkAttendance from "./pages/MarkAttendance"
import MarkSiteAttendance from "./pages/MarkSiteAttendance"
import EditPastAttendance from "./pages/EditPastAttendance"
import ManageJobEmployees from "./pages/ManageJobEmployees"
import MonthlyReport from "./pages/MonthlyReport"
import Configure from "./pages/Configure"
import ManageUsers from "./pages/ManageUsers"
import EmployeeDetailAttendance from "./pages/EmployeeDetailAttendance"



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
                <MarkSiteAttendance />
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
            path="/employees/:id"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <EmployeeDetailAttendance />
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

          <Route
            path="/attendance/edit"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <EditPastAttendance/>
              </ProtectedRoute>
            }
          />

          
          

          <Route
            path="/reports"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <MonthlyReport />
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

          <Route
            path="/site/job/:jobId"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <ManageJobEmployees />
              </ProtectedRoute>
            }
          />

          <Route
            path="/configure"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <Configure />
              </ProtectedRoute>
            }
          />

          <Route
            path="/manage-users"
            element={
              <ProtectedRoute
                allowedRoles={["admin"]}
              >
                <ManageUsers />
              </ProtectedRoute>
            }
          />


        </Route>

      </Routes>

    </div>
  )
}

export default App