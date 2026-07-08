import { useState } from 'react'
import type { Model } from '../types'
import { discoverModels, addModelFromDiscovery } from '../api'
import ModelDetail from '../components/ModelDetail'

type DiscoveryModel = Model & { _source: string; likes?: number; downloads?: number; _alreadyAdded?: boolean }

export default function DiscoveryPage() {
  const [models, setModels] = useState<DiscoveryModel[]>([])
  const [source, setSource] = useState('all')
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function doDiscover() {
    setLoading(true); setMsg('')
    try {
      const data = await discoverModels(source, 50)
      setModels(data.models)
      if (data.models.length === 0) setMsg('No new models found.')
    } catch { setMsg('Discovery failed.') }
    setLoading(false)
  }

  async function doAdd(m: DiscoveryModel) {
    try {
      await addModelFromDiscovery(m)
      setMsg(`Added ${m.name}`)
      setModels(prev => prev.map(x => x.id === m.id ? { ...x, _alreadyAdded: true } : x))
    } catch { setMsg(`Failed to add ${m.name}`) }
  }

  async function doAddAll() {
    const toAdd = models.filter(m => !m._alreadyAdded)
    let count = 0
    for (const m of toAdd) {
      try { await addModelFromDiscovery(m); count++ } catch { /* skip */ }
      setModels(prev => prev.map(x => x.id === m.id ? { ...x, _alreadyAdded: true } : x))
    }
    setMsg(`Added ${count} models`)
  }

  const selected = models.find(m => m.id === selectedId) ?? null

  return (
    <div className="discovery-page">
      <div className="discovery-controls">
        <h2>Model Discovery</h2>
        <select value={source} onChange={e => setSource(e.target.value)} className="filter-select">
          <option value="all">All Sources</option>
          <option value="hf">Hugging Face</option>
          <option value="openrouter">OpenRouter</option>
        </select>
        <button className="btn" onClick={doDiscover} disabled={loading}>
          {loading ? 'Discovering...' : 'Discover'}
        </button>
      </div>

      {msg && <div className="toast">{msg}</div>}

      {models.length > 0 && (
        <div className="discovery-actions">
          <button className="btn btn-sm" onClick={doAddAll}>Add All New</button>
          <span className="text-dim">{models.filter(m => !m._alreadyAdded).length} new of {models.length}</span>
        </div>
      )}

      <div className="main-layout">
        <div className="model-grid">
          {models.map(m => (
            <div key={m.id} className={`model-card ${m._alreadyAdded ? 'already-added' : ''}`} onClick={() => setSelectedId(m.id)}>
              <div className="card-head">
                <div className="card-logo" style={{ background: m.color || '#6b7280' }}>
                  {m.logo || m.name.charAt(0)}
                </div>
                <button className="btn btn-sm" onClick={e => { e.stopPropagation(); m._alreadyAdded ? null : doAdd(m) }}>
                  {m._alreadyAdded ? 'Added' : 'Add'}
                </button>
              </div>
              <h3>{m.name}</h3>
              <div className="provider">{m.provider}</div>
              {m.tags?.length > 0 && (
                <div className="scores">
                  {m.tags.slice(0, 4).map((t: string) => <span key={t} className="score-pill">{t}</span>)}
                </div>
              )}
              <div className="card-footer">
                <span>{m.likes != null ? `\u2764 ${m.likes}` : ''}</span>
                <span>{m.arenaElo ? `${m.arenaElo} ELO` : ''}</span>
              </div>
            </div>
          ))}
        </div>
        {selected && <ModelDetail model={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}
