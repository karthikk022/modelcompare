import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import ModelsPage from './pages/ModelsPage'
import ComparePage from './pages/ComparePage'
import DiscoveryPage from './pages/DiscoveryPage'
import PromptsPage from './pages/PromptsPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Navbar />
        <Routes>
          <Route path="/" element={<ModelsPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/discover" element={<DiscoveryPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
