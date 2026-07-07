import { useState } from 'react'
import { recommendForTask } from '../api'
import type { Model } from '../types'

const QUICK_TASKS = ['coding', 'reasoning', 'multimodal', 'budget', 'fast', 'math', 'agentic', 'writing']

export default function RecommendWidget({ onSelect }: { onSelect: (id: string) => void }) {
  const [task, setTask] = useState('')
  const [results, setResults] = useState<Model[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function doRecommend(t?: string) {
    const q = t || task
    if (!q.trim()) return
    setLoading(true); setErr(''); setResults([])
    try {
      const data = await recommendForTask(q.trim())
      setResults(data.models || [])
    } catch { setErr('Recommendation failed.') }
    setLoading(false)
  }

  function quickRec(task: string) {
    setTask(task)
    doRecommend(task)
  }

  return (
    <div className="recommender">
      <h3>Task Recommendation</h3>
      <div className="recommender-row">
        <input
          type="text"
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && doRecommend()}
          placeholder='e.g. "coding", "reasoning", "multimodal"'
        />
        <button className="btn" onClick={() => doRecommend()} disabled={loading}>
          {loading ? '...' : 'Recommend'}
        </button>
      </div>
      <div className="quick-tags">
        {QUICK_TASKS.map(t => (
          <span key={t} className="rec-tag" onClick={() => quickRec(t)}>{t}</span>
        ))}
      </div>
      {err && <div className="text-dim" style={{ marginTop: 8 }}>{err}</div>}
      {results.length > 0 && (
        <div className="rec-results">
          {results.slice(0, 6).map((m, i) => (
            <div key={m.id} className="rec-item" onClick={() => onSelect(m.id)}>
              <span className="rec-rank">#{i + 1}</span>
              <div>
                <strong>{m.name}</strong>
                <span className="text-dim" style={{ fontSize: '0.75rem' }}> {m.provider}</span>
              </div>
              <span className="rec-score">{(m as any).score != null ? `${(m as any).score}%` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
