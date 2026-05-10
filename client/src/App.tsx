import {Route, Routes} from 'react-router-dom'
import DashBoard from './pages/DashBoard'
import SidebarLayout from './components/SidebarLayout'
import Employees from './pages/Employees'
import MarkAttendance from './pages/MarkAttendance'
import Reports from './pages/Reports'
import Supervisor from './pages/Supervisor'
import Site from './pages/Site'
import AddSupervisor from './pages/AddSupervisor'

function App() {
  return (
    <div>
      <Routes>
        <Route path="/" element={<SidebarLayout />}>
          <Route path='/' element={<DashBoard />}></Route>
          <Route path='/employees' element={<Employees />}></Route>
          <Route path='/attendance' element={<MarkAttendance />}></Route>
          <Route path='/reports' element={<Reports />}></Route>
          <Route path='/supervisor' element={<Supervisor />}></Route>
          <Route path='/addsupervisor/:id' element={<AddSupervisor />}></Route>
          <Route path='/site' element={<Site />}></Route>
        </Route>
      </Routes>
    </div>
  )
}

export default App
