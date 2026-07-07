import { createContext, useContext, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import ModelsPage from './pages/ModelsPage'
import ComparePage from './pages/ComparePage'
import DiscoveryPage from './pages/DiscoveryPage'
import PromptsPage from './pages/PromptsPage'
import './App.css'

type Theme = 'dark' | 'light'
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: 'dark', toggleTheme: () => {} })
export const useTheme = () => useContext(ThemeContext)

function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
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
    </ThemeContext.Provider>
  )
}

export default App
