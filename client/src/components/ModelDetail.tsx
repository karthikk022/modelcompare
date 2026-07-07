import type { Model } from '../types'

interface Props {
  model: Model
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export default function ModelDetail({ model, onClose, onEdit, onDelete }: Props) {
  const benchEntries = Object.entries(model.benchmarks || {})
  const topFeatures = (model.features || []).slice(0, 8)
  const bestFor = (model.bestFor || []).slice(0, 6)

  return (
    <div className="detail-panel">
      <button className="detail-close" onClick={onClose}>&times;</button>
      <div className="detail-head">
        <div className="detail-logo" style={{ background: model.color || '#6b7280', width: 48, height: 48, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>
          {model.logo || model.name.charAt(0)}
        </div>
        <div>
          <h2>{model.name}</h2>
          <p className="provider">{model.provider} &middot; {model.family || 'Unknown family'}</p>
        </div>
        {(onEdit || onDelete) && (
          <div className="detail-actions" style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {onEdit && <button className="btn-sm" onClick={onEdit}>Edit</button>}
            {onDelete && <button className="btn-sm" style={{ background: 'var(--red)' }} onClick={onDelete}>Del</button>}
          </div>
        )}
      </div>

      {model.description && <p className="detail-desc">{model.description}</p>}

      <div className="detail-section">
        <h4>Specifications</h4>
        <div className="detail-specs">
          {model.parameters && <div><strong>Parameters:</strong> {model.parameters}</div>}
          {model.architecture && <div><strong>Architecture:</strong> {model.architecture}</div>}
          {model.contextWindow != null && <div><strong>Context:</strong> {model.contextWindow.toLocaleString()}</div>}
          {model.outputLimit != null && <div><strong>Output:</strong> {model.outputLimit.toLocaleString()}</div>}
          {model.inputPrice != null && <div><strong>Input:</strong> ${model.inputPrice.toFixed(2)}/M tokens</div>}
          {model.outputPrice != null && <div><strong>Output:</strong> ${model.outputPrice.toFixed(2)}/M tokens</div>}
          {model.speed != null && <div><strong>Speed:</strong> {model.speed} tok/s</div>}
          {model.arenaElo != null && <div><strong>Chatbot Arena:</strong> {model.arenaElo} ELO</div>}
        </div>
      </div>

      {benchEntries.length > 0 && (
        <div className="detail-section">
          <h4>Benchmarks</h4>
          <div className="detail-benchmarks">
            {benchEntries.map(([key, val]) => (
              <div key={key} className="bench-row">
                <span>{key}</span>
                <div className="bench-bar-track">
                  <div className="bench-bar-fill" style={{ width: `${Math.min(val, 100)}%` }} />
                </div>
                <span className="bench-val">{val}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topFeatures.length > 0 && (
        <div className="detail-section">
          <h4>Features</h4>
          <div className="tag-list">
            {topFeatures.map(f => <span key={f} className="tag">{f}</span>)}
          </div>
        </div>
      )}

      {bestFor.length > 0 && (
        <div className="detail-section">
          <h4>Best For</h4>
          <ul>
            {bestFor.map(b => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      {model.strengths && <div className="detail-section"><h4>Strengths</h4><p>{model.strengths}</p></div>}
      {model.weaknesses && <div className="detail-section"><h4>Weaknesses</h4><p>{model.weaknesses}</p></div>}

      <div className="detail-section detail-meta">
        {model.tags?.length > 0 && <div><strong>Tags:</strong> {model.tags.join(', ')}</div>}
        {model.pipeline && <div><strong>Pipeline:</strong> {model.pipeline}</div>}
        {model.releaseDate && <div><strong>Released:</strong> {model.releaseDate}</div>}
      </div>
    </div>
  )
}
