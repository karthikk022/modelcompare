import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Model } from '../types'
import { compareModels } from '../api'

const COMPARE_FIELDS = [
  { key: 'parameters', label: 'Parameters' },
  { key: 'contextWindow', label: 'Context' },
  { key: 'outputLimit', label: 'Output Limit' },
  { key: 'inputPrice', label: 'Input Price' },
  { key: 'outputPrice', label: 'Output Price' },
  { key: 'speed', label: 'Speed' },
  { key: 'arenaElo', label: 'Arena ELO' },
  { key: 'architecture', label: 'Architecture' },
] as const

const BENCH_ORDER = ['mmlu-pro', 'gpqa diamond', 'swe-bench verified', 'aime', 'livecodebench', 'math-500', 'gsm8k', 'bbh', 'hellaswag', 'simpleqa', 'bfcl'] as const

function val(m: Model, key: string): any {
  if (key === 'inputPrice') return m.inputPrice != null ? `$${m.inputPrice.toFixed(2)}/M` : '-'
  if (key === 'outputPrice') return m.outputPrice != null ? `$${m.outputPrice.toFixed(2)}/M` : '-'
  if (key === 'contextWindow') return m.contextWindow?.toLocaleString() ?? '-'
  if (key === 'speed') return m.speed != null ? `${m.speed} tok/s` : '-'
  if (key === 'arenaElo') return m.arenaElo ?? '-'
  return (m as any)[key] ?? '-'
}

export default function ComparePage() {
  const [searchParams] = useSearchParams()
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const ids = (searchParams.get('ids') || '').split(',').filter(Boolean)

  useEffect(() => {
    if (ids.length < 2) { setLoading(false); return }
    compareModels(ids).then(m => setModels(m)).finally(() => setLoading(false))
  }, [ids.join(',')])

  if (ids.length < 2) return <div className="empty-state">Select at least 2 models to compare.</div>
  if (loading) return <div className="loading">Loading comparison...</div>
  if (models.length === 0) return <div className="empty-state">No models found.</div>

  const allBenchKeys = [...new Set(models.flatMap(m => Object.keys(m.benchmarks || {})))]
  const benchKeys: string[] = BENCH_ORDER.filter(k => allBenchKeys.some(b => b.toLowerCase().includes(k.toLowerCase())))
  if (benchKeys.length === 0) benchKeys.push(...allBenchKeys)

  return (
    <div className="compare-page">
      <h2>Compare Models</h2>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>Property</th>
              {models.map(m => <th key={m.id}>{m.name}<br /><span className="provider">{m.provider}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {COMPARE_FIELDS.map(({ key, label }) => (
              <tr key={key}>
                <td className="prop-label">{label}</td>
                {models.map(m => <td key={m.id}>{val(m, key)}</td>)}
              </tr>
            ))}
            {benchKeys.length > 0 && (
              <tr className="section-row"><td colSpan={models.length + 1}>Benchmarks</td></tr>
            )}
            {benchKeys.map(bk => (
              <tr key={bk}>
                <td className="prop-label">{bk}</td>
                {models.map(m => {
                  const entry = Object.entries(m.benchmarks || {}).find(([k]) => k.toLowerCase().includes(bk.toLowerCase()))
                  const v = entry ? entry[1] : null
                  return <td key={m.id}>{v != null ? `${v}%` : '-'}</td>
                })}
              </tr>
            ))}
            <tr className="section-row"><td colSpan={models.length + 1}>Scores</td></tr>
            {models.length > 0 && Object.keys(models[0].scores || {}).map(sk => (
              <tr key={sk}>
                <td className="prop-label">{sk}</td>
                {models.map(m => <td key={m.id}>{(m.scores as any)?.[sk] ?? '-'}</td>)}
              </tr>
            ))}
            {models.some(m => m.tags?.length) && (
              <tr>
                <td className="prop-label">Tags</td>
                {models.map(m => <td key={m.id}>{(m.tags || []).join(', ') || '-'}</td>)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
