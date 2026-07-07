import { useState, useEffect } from 'react'
import { getSettings, setSetting } from '../api'

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getSettings().then(s => {
      if (s.openrouter_api_key) setKey(s.openrouter_api_key)
    }).finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setMsg('')
    try {
      await setSetting('openrouter_api_key', key.trim())
      setMsg('API key saved.')
    } catch { setMsg('Failed to save.') }
    setSaving(false)
  }

  async function handleClear() {
    setKey('')
    try {
      await setSetting('openrouter_api_key', '')
      setMsg('API key cleared.')
    } catch { setMsg('Failed to clear.') }
  }

  return (
    <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2>Settings</h2>
        {loading ? <div className="loading">Loading...</div> : (
          <>
            <div className="form-group">
              <label>OpenRouter API Key</label>
              <input
                type="text"
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder="sk-or-v1-..."
                style={{ fontFamily: 'monospace', width: '100%', padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.85rem' }}
              />
            </div>
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
