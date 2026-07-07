import type { Model } from '../types'

interface Props {
  model: Model
  isSelected: boolean
  onSelect: () => void
  onToggleCompare: () => void
}

function formatContext(ctx: number | null): string {
  if (!ctx) return 'N/A'
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M`
  if (ctx >= 1_000) return `${(ctx / 1_000).toFixed(0)}K`
  return String(ctx)
}

export default function ModelCard({ model, isSelected, onSelect, onToggleCompare }: Props) {
  const scoreEntries = Object.entries(model.scores || {}).slice(0, 3)
  const topBenchmarks = [['MMLU-Pro', 'MMLU'], ['GPQA Diamond', 'GPQA'], ['SWE-bench Verified', 'SWE']]
    .map(([k, label]) => {
      const v = model.benchmarks?.[k]
      return v != null ? { label, value: v } : null
    })
    .filter(Boolean) as { label: string; value: number }[]

  return (
    <div
      className={`model-card${isSelected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <div className="card-head">
        <div className="card-logo" style={{ background: model.color || '#6b7280' }}>
          {model.logo || model.name.charAt(0)}
        </div>
        <div className="card-check" onClick={e => { e.stopPropagation(); onToggleCompare() }}>
          {isSelected ? '\u2713' : ''}
        </div>
      </div>
      <h3>{model.name}</h3>
      <div className="provider">{model.provider}</div>
      <div className="scores">
        {topBenchmarks.map(b => (
          <span key={b.label} className="score-pill bm-pill">{b.label}: {b.value}%</span>
        ))}
        {!topBenchmarks.length && scoreEntries.map(([k, v]) => (
          <span key={k} className="score-pill">{k}: {v}</span>
        ))}
      </div>
      <div className="card-footer">
        <span>{model.inputPrice != null ? `$${model.inputPrice.toFixed(2)}/M` : ''}</span>
        <span>{model.speed ? `${model.speed} tok/s` : ''}</span>
        <span>{formatContext(model.contextWindow)} ctx</span>
      </div>
    </div>
  )
}
