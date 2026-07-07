import { useState, useEffect } from 'react'
import type { Model } from '../types'
import { fetchModels, testPrompt, getUsage } from '../api'
import { UsageChart } from '../components/Charts'

export default function PromptsPage() {
  const [models, setModels] = useState<Model[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [maxTokens, setMaxTokens] = useState(1024)
  const [temperature, setTemperature] = useState(0.7)
  const [webSearch, setWebSearch] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [usage, setUsage] = useState<any[]>([])
  const [tab, setTab] = useState<'test' | 'history'>('test')

  useEffect(() => { fetchModels().then(m => setModels(m)) }, [])
  useEffect(() => {
    if (tab === 'history') getUsage().then(u => setUsage(u))
  }, [tab])

  async function doTest() {
    if (selectedIds.length === 0 || !prompt.trim()) return
    setLoading(true)
    try {
      const data = await testPrompt(selectedIds, prompt, systemPrompt, maxTokens, temperature, webSearch)
      setResults(data.results)
    } catch { setResults([{ id: 'error', name: 'Error', error: 'Request failed' }]) }
    setLoading(false)
  }

  function toggleModel(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <div className="prompts-page">
      <div className="tabs">
        <button className={`tab ${tab === 'test' ? 'active' : ''}`} onClick={() => setTab('test')}>Test Prompt</button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>Usage History</button>
      </div>

      {tab === 'test' && (
        <div className="prompts-layout">
          <div className="prompts-form">
            <h2>Test Prompt</h2>
            <div className="form-group">
              <label>Models ({selectedIds.length} selected)</label>
              <div className="model-checkboxes">
                {models.slice(0, 30).map(m => (
                  <label key={m.id} className="checkbox-label">
                    <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={() => toggleModel(m.id)} />
                    <span className="provider-dot" style={{ background: m.color || '#666' }} />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>System Prompt</label>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={2} placeholder="Optional system prompt..." />
            </div>
            <div className="form-group">
              <label>Prompt</label>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Enter your prompt..." />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Max Tokens</label>
                <input type="number" value={maxTokens} onChange={e => setMaxTokens(+e.target.value)} min={1} max={4096} />
              </div>
              <div className="form-group">
                <label>Temperature</label>
                <input type="number" value={temperature} onChange={e => setTemperature(+e.target.value)} min={0} max={2} step={0.1} />
              </div>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={webSearch} onChange={e => setWebSearch(e.target.checked)} />
              Web Search
            </label>
            <button className="btn" onClick={doTest} disabled={loading || selectedIds.length === 0 || !prompt.trim()}>
              {loading ? 'Testing...' : 'Run Test'}
            </button>
          </div>

          <div className="prompts-results">
            <h3>Results</h3>
            {results.length === 0 && !loading && <div className="text-dim">Run a test to see results.</div>}
            {results.map(r => (
              <div key={r.id} className={`result-card ${r._empty ? 'empty' : ''} ${r.error ? 'error' : ''}`}>
                <div className="result-head">
                  <strong>{r.name}</strong>
                  <span className="text-dim">
                    {r.latency != null ? `${r.latency}ms` : ''}
                    {r.cost != null ? ` \u00B7 $${r.cost}` : ''}
                    {r.inTokens != null ? ` \u00B7 ${r.inTokens}\u2191 ${r.outTokens}\u2193` : ''}
                  </span>
                </div>
                {r.error ? (
                  <div className="result-error">{r.error}</div>
                ) : r.content ? (
                  <pre className="result-content">{r.content.slice(0, 5000)}</pre>
                ) : (
                  <div className="text-dim">No output</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="usage-page">
          <h2>Usage History</h2>
          <UsageChart usage={usage} />
          {usage.length === 0 ? <div className="text-dim" style={{ marginTop: 16 }}>No usage recorded yet.</div> : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                  <th>Latency</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {usage.slice(0, 100).map(u => (
                  <tr key={u.id}>
                    <td>{u.modelName}</td>
                    <td>{(u as any).totalTokens?.toLocaleString() ?? '-'}</td>
                    <td>${(u as any).cost?.toFixed(4) ?? '0'}</td>
                    <td>{(u as any).latencyMs ?? '-'}ms</td>
                    <td className="text-dim">{(u as any).timestamp?.slice(0, 10) ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
