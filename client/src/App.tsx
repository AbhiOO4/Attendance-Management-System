import {Route, Routes} from 'react-router-dom'
import HomePage from './pages/HomePage'
import DashBoard from './pages/DashBoard'

function App() {
  return (
    <div>
      <Routes>
        <Route path='/' element={<HomePage/>}></Route>
        <Route path='/Dashboard' element={<DashBoard/>}></Route>
      </Routes>
    </div>
  )
}

export default App
