import { useEffect, useState } from 'react'
import type { Model } from '../types'
import { fetchModels, deleteModel, exportModels } from '../api'
import ModelCard from '../components/ModelCard'
import ModelDetail from '../components/ModelDetail'
import ModelForm from '../components/ModelForm'
import RecommendWidget from '../components/RecommendWidget'
import SettingsModal from '../components/SettingsModal'
import { useTheme } from '../App'

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([])
  const [filtered, setFiltered] = useState<Model[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState<Model | null | true>(null)
  const [showSettings, setShowSettings] = useState(false)
  const { theme, toggleTheme } = useTheme()

  useEffect(() => {
    fetchModels()
      .then(m => { setModels(m); setFiltered(m) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let result = models
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(m => m.name.toLowerCase().includes(q) || m.provider?.toLowerCase().includes(q))
    }
    if (providerFilter) result = result.filter(m => m.provider === providerFilter)
    setFiltered(result)
  }, [search, providerFilter, models])

  const providers = [...new Set(models.map(m => m.provider).filter(Boolean))].sort()
  const selected = models.find(m => m.id === selectedId)

  function toggleCompare(id: string) {
    setCompareIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this model?')) return
    try {
      await deleteModel(id)
      setModels(prev => prev.filter(m => m.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch { /* ignore */ }
  }

  async function handleExport(format: 'json' | 'csv') {
    const blob = await exportModels(format)
    const url = URL.createObjectURL(new Blob([blob], { type: format === 'json' ? 'application/json' : 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `models.${format}`; a.click()
    URL.revokeObjectURL(url)
  }

  function handleSaved(m: Model) {
    if (showForm === true) {
      setModels(prev => [...prev, m])
    } else {
      setModels(prev => prev.map(x => x.id === m.id ? m : x))
    }
    setShowForm(null)
  }

  return (
    <div>
      <div className="models-toolbar">
        <div className="controls">
          <input type="text" placeholder="Search models..." value={search} onChange={e => setSearch(e.target.value)} className="search-input" />
          <select value={providerFilter} onChange={e => setProviderFilter(e.target.value)} className="filter-select">
            <option value="">All providers</option>
            {providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-sm" onClick={() => handleExport('json')}>JSON</button>
          <button className="btn btn-sm" onClick={() => handleExport('csv')}>CSV</button>
          <button className="btn btn-sm" onClick={() => setShowSettings(true)} title="Settings">Settings</button>
          <button className="btn btn-sm" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? 'Light' : 'Dark'}</button>
          <button className="btn btn-sm" onClick={() => setShowForm(true)}>+ Add</button>
        </div>
      </div>

      <RecommendWidget onSelect={id => setSelectedId(id)} />

      {loading && <div className="loading">Loading models...</div>}

      <div className="main-layout">
        <div className="model-grid">
          {filtered.map(m => (
            <ModelCard
              key={m.id}
              model={m}
              isSelected={compareIds.includes(m.id)}
              onSelect={() => setSelectedId(m.id)}
              onToggleCompare={() => toggleCompare(m.id)}
              onEdit={() => setShowForm(m)}
              onDelete={() => handleDelete(m.id)}
            />
          ))}
        </div>
        {selected && (
          <ModelDetail
            model={selected}
            onClose={() => setSelectedId(null)}
            onEdit={() => { setSelectedId(null); setShowForm(selected) }}
            onDelete={() => handleDelete(selected.id)}
          />
        )}
      </div>

      {compareIds.length >= 2 && (
        <div className="compare-bar">
          <span>{compareIds.length} models selected</span>
          <a href={`/compare?ids=${compareIds.join(',')}`}>Compare</a>
        </div>
      )}

      {showForm && <ModelForm model={showForm === true ? null : showForm} onClose={() => setShowForm(null)} onSaved={handleSaved} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
