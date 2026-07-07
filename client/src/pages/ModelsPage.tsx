import { useEffect, useState } from 'react'
import type { Model } from '../types'
import { fetchModels } from '../api'
import ModelCard from '../components/ModelCard'
import ModelDetail from '../components/ModelDetail'

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([])
  const [filtered, setFiltered] = useState<Model[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [loading, setLoading] = useState(true)

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
    setCompareIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div>
      <div className="controls">
        <input
          type="text"
          placeholder="Search models..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="search-input"
        />
        <select value={providerFilter} onChange={e => setProviderFilter(e.target.value)} className="filter-select">
          <option value="">All providers</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

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
            />
          ))}
        </div>
        {selected && <ModelDetail model={selected} onClose={() => setSelectedId(null)} />}
      </div>

      {compareIds.length >= 2 && (
        <div className="compare-bar">
          <span>{compareIds.length} models selected</span>
          <a href={`/compare?ids=${compareIds.join(',')}`}>Compare</a>
        </div>
      )}
    </div>
  )
}
