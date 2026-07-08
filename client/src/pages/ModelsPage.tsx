import { useEffect, useState, useCallback, useRef } from 'react'
import type { Model } from '../types'
import { fetchModels, deleteModel, exportModels, fetchProviders } from '../api'
import ModelCard from '../components/ModelCard'
import ModelDetail from '../components/ModelDetail'
import ModelForm from '../components/ModelForm'
import RecommendWidget from '../components/RecommendWidget'
import SettingsModal from '../components/SettingsModal'
import { useTheme } from '../App'

const PAGE_SIZE = 50;

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [sort, setSort] = useState('-arenaElo')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState<Model | null | true>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [providers, setProviders] = useState<string[]>([])
  const fetchId = useRef(0)

  useEffect(() => { fetchProviders().then(setProviders).catch(() => {}) }, [])

  const filterKey = search + '|' + providerFilter + '|' + sort

  const doFetch = useCallback((q: string, p: string, s: string, o: number) => {
    const id = ++fetchId.current
    setLoading(true)
    fetchModels({ q: q || undefined, provider: p || undefined, sort: s, limit: PAGE_SIZE, offset: o })
      .then(({ models: m, total: t }) => {
        if (id !== fetchId.current) return
        setModels(m); setTotal(t)
      })
      .finally(() => {
        if (id === fetchId.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    setOffset(0)
    doFetch(search, providerFilter, sort, 0)
  }, [filterKey, doFetch])

  useEffect(() => {
    if (offset === 0) return
    doFetch(search, providerFilter, sort, offset)
  }, [offset]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const selected = models.find(m => m.id === selectedId)

  function toggleCompare(id: string) {
    setCompareIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this model?')) return
    try {
      await deleteModel(id)
      doFetch(search, providerFilter, sort, offset)
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

  function handleSaved() {
    doFetch(search, providerFilter, sort, offset)
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
          <select value={sort} onChange={e => setSort(e.target.value)} className="filter-select">
            <option value="-arenaElo">ELO (high first)</option>
            <option value="arenaElo">ELO (low first)</option>
            <option value="-inputPrice">Price (high first)</option>
            <option value="inputPrice">Price (low first)</option>
            <option value="-speed">Speed (fast first)</option>
            <option value="speed">Speed (slow first)</option>
            <option value="name">Name A-Z</option>
          </select>
        </div>
        <div className="toolbar-actions">
          <span className="text-dim">{total} models</span>
          <button className="btn btn-sm" onClick={() => handleExport('json')}>JSON</button>
          <button className="btn btn-sm" onClick={() => handleExport('csv')}>CSV</button>
          <button className="btn btn-sm" onClick={() => setShowSettings(true)} title="Settings">Settings</button>
          <button className="btn btn-sm" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? 'Light' : 'Dark'}</button>
          <button className="btn btn-sm" onClick={() => setShowForm(true)}>+ Add</button>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm" disabled={currentPage <= 1} onClick={() => setOffset(offset - PAGE_SIZE)}>Prev</button>
          <span className="text-dim">Page {currentPage} / {totalPages}</span>
          <button className="btn btn-sm" disabled={currentPage >= totalPages} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
        </div>
      )}

      <RecommendWidget onSelect={id => setSelectedId(id)} />

      {loading && <div className="loading">Loading models...</div>}

      <div className="main-layout">
        <div className="model-grid">
          {!loading && models.length === 0 && <div className="text-dim" style={{ padding: 40 }}>No models found.</div>}
          {models.map(m => (
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

      {totalPages > 1 && (
        <div className="pagination" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-sm" disabled={currentPage <= 1} onClick={() => setOffset(offset - PAGE_SIZE)}>Prev</button>
          <span className="text-dim">Page {currentPage} / {totalPages}</span>
          <button className="btn btn-sm" disabled={currentPage >= totalPages} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
        </div>
      )}

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
