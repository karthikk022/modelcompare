import { useState } from 'react'
import type { Model } from '../types'
import { createModel, updateModel } from '../api'

interface Props {
  model?: Model | null
  onClose: () => void
  onSaved: (m: Model) => void
}

export default function ModelForm({ model, onClose, onSaved }: Props) {
  const isEdit = !!model
  const [form, setForm] = useState({
    name: model?.name || '',
    provider: model?.provider || '',
    family: model?.family || '',
    description: model?.description || '',
    architecture: model?.architecture || 'Transformer',
    parameters: model?.parameters || '',
    contextWindow: model?.contextWindow?.toString() || '',
    outputLimit: model?.outputLimit?.toString() || '',
    inputPrice: model?.inputPrice?.toString() || '',
    outputPrice: model?.outputPrice?.toString() || '',
    speed: model?.speed?.toString() || '',
    arenaElo: model?.arenaElo?.toString() || '',
    strengths: model?.strengths || '',
    weaknesses: model?.weaknesses || '',
    tags: (model?.tags || []).join(', '),
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set(field: string, val: string) {
    setForm(prev => ({ ...prev, [field]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      const payload: any = {
        name: form.name,
        provider: form.provider,
        family: form.family,
        description: form.description,
        architecture: form.architecture,
        parameters: form.parameters || null,
        strengths: form.strengths,
        weaknesses: form.weaknesses,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      }
      const num = (v: string) => v ? parseFloat(v) : null
      payload.contextWindow = num(form.contextWindow)
      payload.outputLimit = num(form.outputLimit)
      payload.inputPrice = num(form.inputPrice)
      payload.outputPrice = num(form.outputPrice)
      payload.speed = num(form.speed)
      payload.arenaElo = num(form.arenaElo)

      const saved = isEdit
        ? await updateModel(model!.id, payload)
        : await createModel(payload)
      onSaved(saved)
    } catch (e: any) { setErr(e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2>{isEdit ? 'Edit Model' : 'Add New Model'}</h2>
        {err && <div className="toast" style={{ background: 'var(--red)' }}>{err}</div>}
        <form onSubmit={handleSubmit} className="model-form">
          <div className="form-row">
            <div className="form-group">
              <label>Name *</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Provider</label>
              <input type="text" value={form.provider} onChange={e => set('provider', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Family</label>
              <input type="text" value={form.family} onChange={e => set('family', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Architecture</label>
              <input type="text" value={form.architecture} onChange={e => set('architecture', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} />
          </div>
          <div className="form-row">
            <div className="form-group"><label>Parameters</label><input type="text" value={form.parameters} onChange={e => set('parameters', e.target.value)} placeholder="e.g. 70B" /></div>
            <div className="form-group"><label>Context Window</label><input type="number" value={form.contextWindow} onChange={e => set('contextWindow', e.target.value)} /></div>
            <div className="form-group"><label>Output Limit</label><input type="number" value={form.outputLimit} onChange={e => set('outputLimit', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Input Price ($/M)</label><input type="number" step={0.01} value={form.inputPrice} onChange={e => set('inputPrice', e.target.value)} /></div>
            <div className="form-group"><label>Output Price ($/M)</label><input type="number" step={0.01} value={form.outputPrice} onChange={e => set('outputPrice', e.target.value)} /></div>
            <div className="form-group"><label>Speed (tok/s)</label><input type="number" value={form.speed} onChange={e => set('speed', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Arena ELO</label><input type="number" value={form.arenaElo} onChange={e => set('arenaElo', e.target.value)} /></div>
          </div>
          <div className="form-group"><label>Tags (comma separated)</label><input type="text" value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="flagship, reasoning, coding" /></div>
          <div className="form-group"><label>Strengths</label><textarea value={form.strengths} onChange={e => set('strengths', e.target.value)} rows={2} /></div>
          <div className="form-group"><label>Weaknesses</label><textarea value={form.weaknesses} onChange={e => set('weaknesses', e.target.value)} rows={2} /></div>
          <button className="btn" disabled={saving || !form.name.trim()}>
            {saving ? 'Saving...' : isEdit ? 'Update Model' : 'Create Model'}
          </button>
        </form>
      </div>
    </div>
  )
}
