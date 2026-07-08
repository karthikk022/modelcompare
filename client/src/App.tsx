import { lazy, Suspense, createContext, useContext, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import ErrorBoundary from './components/ErrorBoundary'
import './App.css'

const ModelsPage = lazy(() => import('./pages/ModelsPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))
const DiscoveryPage = lazy(() => import('./pages/DiscoveryPage'))
const PromptsPage = lazy(() => import('./pages/PromptsPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))

type Theme = 'dark' | 'light'
const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: 'dark', toggleTheme: () => {} })
export const useTheme = () => useContext(ThemeContext)

function PageLoader() {
  return <div className="loading">Loading...</div>
}

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
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<ErrorBoundary><ModelsPage /></ErrorBoundary>} />
              <Route path="/compare" element={<ErrorBoundary><ComparePage /></ErrorBoundary>} />
              <Route path="/discover" element={<ErrorBoundary><DiscoveryPage /></ErrorBoundary>} />
              <Route path="/prompts" element={<ErrorBoundary><PromptsPage /></ErrorBoundary>} />
              <Route path="/chat" element={<ErrorBoundary><ChatPage /></ErrorBoundary>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
    </ThemeContext.Provider>
  )
}

export default App
