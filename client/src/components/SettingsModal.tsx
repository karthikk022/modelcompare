import { useState, useEffect } from 'react'
import { getSettings, setSetting } from '../api'

interface Props {
  onClose: () => void
}

const PROVIDERS = [
  { id: 'openrouter', label: 'OpenRouter', keyLabel: 'OpenRouter API Key', keyPlaceholder: 'sk-or-v1-...' },
  { id: 'openai', label: 'OpenAI', keyLabel: 'OpenAI API Key', keyPlaceholder: 'sk-...' },
  { id: 'groq', label: 'Groq (free tier)', keyLabel: 'Groq API Key', keyPlaceholder: 'gsk_...' },
  { id: 'together', label: 'Together', keyLabel: 'Together API Key', keyPlaceholder: '...' },
]

export default function SettingsModal({ onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [provider, setProvider] = useState('openrouter')
  const [key, setKey] = useState('')

  useEffect(() => {
    getSettings().then(s => {
      const p = s.api_provider || 'openrouter'
      setProvider(p)
      const keySetting = p === 'openrouter' ? 'openrouter_api_key' : p + '_api_key'
      if (s[keySetting]) setKey(s[keySetting])
    }).finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setMsg('')
    try {
      await setSetting('api_provider', provider)
      const keySetting = provider === 'openrouter' ? 'openrouter_api_key' : provider + '_api_key'
      await setSetting(keySetting, key.trim())
      setMsg('Settings saved.')
    } catch { setMsg('Failed to save.') }
    setSaving(false)
  }

  async function handleClear() {
    setKey('')
    try {
      const keySetting = provider === 'openrouter' ? 'openrouter_api_key' : provider + '_api_key'
      await setSetting(keySetting, '')
      setMsg('Key cleared.')
    } catch { setMsg('Failed to clear.') }
  }

  const currentProvider = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0]

  return (
    <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal" style={{ maxWidth: 440 }}>
        <button className="modal-close" onClick={onClose} aria-label="Close settings">&times;</button>
        <h2>Settings</h2>
        {loading ? <div className="loading">Loading...</div> : (
          <>
            <div className="form-group">
              <label>API Provider</label>
              <select value={provider} onChange={e => setProvider(e.target.value)} className="filter-select" style={{ width: '100%' }}>
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{currentProvider.keyLabel}</label>
              <input
                type="password"
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder={currentProvider.keyPlaceholder}
                style={{ fontFamily: 'monospace', width: '100%', padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.85rem' }}
              />
            </div>
            {provider !== 'openrouter' && (
              <p className="text-dim" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                When using a direct provider, the model name is sent as-is. Make sure the provider serves the model you select.
              </p>
            )}
            <div className="form-row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
              <button className="btn" onClick={handleClear} style={{ background: 'var(--red)' }}>Clear</button>
            </div>
            {msg && <div className="toast" style={{ marginTop: 8 }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  )
}
