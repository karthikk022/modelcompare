import { useState, useEffect, useRef } from 'react'
import type { Model } from '../types'
import { fetchModels } from '../api'

interface TurnResponse {
  content?: string
  error?: string
  finishReason?: string
  latency?: number
  inTokens?: number
  outTokens?: number
  cost?: number
  _streaming?: boolean
  _empty?: boolean
}

interface Turn {
  userMessage: string
  responses: Record<string, TurnResponse>
}

interface Conversation {
  id: string
  title: string
  modelId: string
  turns: Turn[]
  timestamp: number
  systemPrompt: string
  maxTokens: number
  temperature: number
  webSearch: boolean
}

function genId() { return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }
function listConvs(): Conversation[] { try { return JSON.parse(localStorage.getItem('conv_history') || '[]') } catch { return [] } }
function saveConvs(convs: Conversation[]) { localStorage.setItem('conv_history', JSON.stringify(convs)) }
export default function ChatPage() {
  const [models, setModels] = useState<Model[]>([])
  const [modelId, setModelId] = useState('')
  const [conv, setConv] = useState<Conversation>({ id: '', title: '', modelId: '', turns: [], timestamp: 0, systemPrompt: '', maxTokens: 1024, temperature: 0.7, webSearch: false })
  const [input, setInput] = useState('')
  const [showSys, setShowSys] = useState(false)
  const [sending, setSending] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [editIndex, setEditIndex] = useState(-1)
  const [editText, setEditText] = useState('')
  const resultEndRef = useRef<HTMLDivElement>(null)
  const convRef = useRef(conv)
  convRef.current = conv

  useEffect(() => { fetchModels().then(m => { setModels(m); if (!modelId && m.length) setModelId(m[0].id) }) }, [])

  const model = models.find(m => m.id === modelId)

  function updateConv(updates: Partial<Conversation>) {
    setConv(prev => ({ ...prev, ...updates }))
  }

  function setSetting(key: string, val: any) {
    updateConv({ [key]: val })
  }

  function startNew() {
    setConv({ id: '', title: '', modelId, turns: [], timestamp: 0, systemPrompt: '', maxTokens: 1024, temperature: 0.7, webSearch: false })
    setInput('')
    setHistoryOpen(false)
  }

  function loadConv(id: string) {
    const all = listConvs()
    const c = all.find(x => x.id === id)
    if (c) { setConv(c); setModelId(c.modelId || modelId); setHistoryOpen(false) }
  }

  function saveConv() {
    const c = convRef.current
    if (c.turns.length === 0) return
    const all = listConvs()
    const title = c.title || c.turns[0]?.userMessage.slice(0, 50) || 'Untitled'
    const entry = { ...c, title, timestamp: Date.now() }
    const idx = all.findIndex(x => x.id === entry.id)
    if (idx >= 0) all[idx] = entry; else all.push(entry)
    saveConvs(all)
  }

  function deleteConv(id: string) {
    saveConvs(listConvs().filter(x => x.id !== id))
  }

  async function sendMessage() {
    const msg = input.trim()
    if (!msg || !modelId || sending) return
    setSending(true)
    const turn: Turn = { userMessage: msg, responses: {} }
    turn.responses[modelId] = { _streaming: true, content: '' }
    const newConv = {
      ...conv,
      id: conv.id || genId(),
      modelId,
      turns: [...conv.turns, turn],
      timestamp: Date.now(),
      title: conv.title || msg.slice(0, 50),
    }
    setConv(newConv)
    setInput('')
    setEditIndex(-1)

    const msgs: { role: string; content: string }[] = []
    if (newConv.systemPrompt) msgs.push({ role: 'system', content: newConv.systemPrompt })
    for (const t of newConv.turns) {
      msgs.push({ role: 'user', content: t.userMessage })
      const r = t.responses[modelId]
      if (r && r.content && !r._streaming) msgs.push({ role: 'assistant', content: r.content })
    }

    try {
      const res = await fetch('/api/test-prompt-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          models: [modelId],
          messages: msgs,
          maxTokens: newConv.maxTokens,
          temperature: newConv.temperature,
          webSearch: newConv.webSearch,
        }),
      })
      if (!res.ok) throw new Error('Request failed')
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            setConv(prev => {
              const turns = [...prev.turns]
              const last = turns[turns.length - 1]
              if (!last) return prev
              const resp = last.responses[modelId]
              if (!resp) return prev
              if (event.type === 'chunk') resp.content = (resp.content || '') + (event.content || '')
              else if (event.type === 'done') {
                resp.content = event.content || ''
                resp.finishReason = event.finishReason
                resp.latency = event.latency
                resp.inTokens = event.inTokens
                resp.outTokens = event.outTokens
                resp.cost = event.cost
                resp._streaming = false
              } else if (event.type === 'error') {
                resp.error = event.message
                resp._streaming = false
              }
              return { ...prev, turns }
            })
          } catch {}
        }
      }
    } catch (e: any) {
      setConv(prev => {
        const turns = [...prev.turns]
        const last = turns[turns.length - 1]
        if (last) last.responses[modelId] = { error: e.message }
        return { ...prev, turns }
      })
    }
    setSending(false)
    saveConv()
  }

  function startEdit(ti: number) {
    setEditIndex(ti)
    setEditText(conv.turns[ti]?.userMessage || '')
  }

  function cancelEdit() { setEditIndex(-1) }

  function saveEdit(ti: number) {
    if (!editText.trim()) return
    if (conv.turns.length > 0) saveConv()
    const newConv = {
      ...conv,
      id: genId(),
      title: (conv.title || 'Conversation') + ' (edited)',
      turns: conv.turns.slice(0, ti + 1).map((t, i) => i === ti ? { ...t, userMessage: editText } : t),
      timestamp: Date.now(),
    }
    delete newConv.turns[ti].responses[modelId]
    setConv(newConv)
    setEditIndex(-1)
  }

  function retryLast() {
    if (conv.turns.length === 0) return
    const msgs: { role: string; content: string }[] = []
    if (conv.systemPrompt) msgs.push({ role: 'system', content: conv.systemPrompt })
    for (const t of conv.turns) {
      msgs.push({ role: 'user', content: t.userMessage })
      const r = t.responses[modelId]
      if (r && r.content) msgs.push({ role: 'assistant', content: r.content })
    }
    setSending(true)
    setConv(prev => {
      const turns = [...prev.turns]
      turns[turns.length - 1].responses[modelId] = { _streaming: true, content: '' }
      return { ...prev, turns }
    })

    ;(async () => {
      try {
        const res = await fetch('/api/test-prompt', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ models: [modelId], messages: msgs, maxTokens: conv.maxTokens, temperature: conv.temperature, webSearch: conv.webSearch }),
        })
        const d = await res.json()
        if (d.results?.[0]) {
          setConv(prev => {
            const turns = [...prev.turns]
            turns[turns.length - 1].responses[modelId] = { ...d.results[0], _streaming: false }
            return { ...prev, turns }
          })
          saveConv()
        }
      } catch (e: any) {
        setConv(prev => {
          const turns = [...prev.turns]
          turns[turns.length - 1].responses[modelId] = { error: e.message, _streaming: false }
          return { ...prev, turns }
        })
      }
      setSending(false)
    })()
  }

  function exportText() {
    const lines: string[] = []
    for (const t of conv.turns) {
      lines.push('You: ' + t.userMessage)
      const r = t.responses[modelId]
      if (r?.content) lines.push((model?.name || 'AI') + ': ' + r.content)
      if (r?.error) lines.push('Error: ' + r.error)
    }
    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'conversation.txt'; a.click()
  }

  function exportJson() {
    const data = { model: model?.name || modelId, turns: conv.turns.map(t => ({ user: t.userMessage, response: t.responses[modelId] || {} })) }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'conversation.json'; a.click()
  }

  const filteredHistory = listConvs().filter(c => {
    if (!historySearch) return true
    const q = historySearch.toLowerCase()
    return (c.title || '').toLowerCase().includes(q) ||
      c.turns.some(t => t.userMessage.toLowerCase().includes(q))
  }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h2>Chat</h2>
        <select value={modelId} onChange={e => setModelId(e.target.value)} className="filter-select">
          {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <div className="chat-header-actions">
          <button className="btn btn-sm" onClick={() => { setHistoryOpen(!historyOpen); setHistorySearch('') }}>
            History ({listConvs().length})
          </button>
          <button className="btn btn-sm" onClick={startNew}>New</button>
          {conv.turns.length > 0 && (
            <>
              <button className="btn btn-sm" onClick={exportText}>Text</button>
              <button className="btn btn-sm" onClick={exportJson}>JSON</button>
            </>
          )}
          <label className="chat-sys-toggle" onClick={() => setShowSys(!showSys)}>
            {showSys ? '- System' : '+ System'}
          </label>
        </div>
      </div>

      {showSys && (
        <div className="chat-sys-row">
          <div className="form-row" style={{ flex: 1 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>System Prompt</label>
              <textarea value={conv.systemPrompt} onChange={e => setSetting('systemPrompt', e.target.value)} rows={2} placeholder="Optional system prompt..." />
            </div>
            <div className="form-group" style={{ maxWidth: 100 }}>
              <label>Tokens</label>
              <input type="number" value={conv.maxTokens} onChange={e => setSetting('maxTokens', +e.target.value)} min={1} max={4096} />
            </div>
            <div className="form-group" style={{ maxWidth: 80 }}>
              <label>Temp</label>
              <input type="number" value={conv.temperature} onChange={e => setSetting('temperature', +e.target.value)} min={0} max={2} step={0.1} />
            </div>
            <div className="form-group" style={{ maxWidth: 100, alignSelf: 'flex-end' }}>
              <label className="checkbox-label"><input type="checkbox" checked={conv.webSearch} onChange={e => setSetting('webSearch', e.target.checked)} /> Web</label>
            </div>
          </div>
        </div>
      )}

      <div className="chat-body">
        <div className="chat-conversation">
          {conv.turns.length === 0 ? (
            <div className="empty-state">Select a model and start a conversation.</div>
          ) : (
            conv.turns.map((turn, ti) => {
              const resp = turn.responses[modelId]
              const isStreaming = resp?._streaming
              const isEditing = editIndex === ti

              return (
                <div key={ti} className="chat-turn">
                  <div className="turn-header">
                    <span className="turn-label">Turn {ti + 1} &middot; You</span>
                    <span className="turn-model" style={{ color: model?.color || '#6b7280' }}>{model?.name}</span>
                  </div>
                  {isEditing ? (
                    <div className="turn-edit">
                      <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3} />
                      <div className="turn-edit-actions">
                        <button className="btn btn-sm" onClick={() => saveEdit(ti)}>Save & Branch</button>
                        <button className="btn btn-sm" style={{ background: 'var(--surface2)', color: 'var(--text)' }} onClick={cancelEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="turn-user">{turn.userMessage}</div>
                  )}
                  {ti < conv.turns.length - 1 && !isEditing && (
                    <span className="turn-edit-btn" onClick={() => startEdit(ti)} title="Edit">&#9998;</span>
                  )}
                  <div className="turn-response">
                    {resp?.error ? (
                      <div className="result-error">{resp.error}</div>
                    ) : (
                      <pre className={`resp-content ${isStreaming ? 'streaming' : ''} ${resp?._empty ? 'empty' : ''}`}>
                        {resp?.content || (isStreaming ? '\u00A0' : resp?._empty ? '(empty response)' : '')}
                        {isStreaming && <span className="cursor-blink" />}
                      </pre>
                    )}
                    {resp?.latency != null && !isStreaming && (
                      <div className="resp-meta">
                        {resp.latency}ms &middot; {resp.inTokens || 0} in / {resp.outTokens || 0} out
                        {resp.cost != null ? ` \u00B7 $${resp.cost}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
          <div ref={resultEndRef} />
        </div>

        <div className="chat-input-area">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={sending}
          />
          <div className="chat-input-actions">
            {conv.turns.length > 0 && (
              <button className="btn btn-sm" style={{ background: 'var(--surface2)', color: 'var(--text)' }} onClick={retryLast} disabled={sending}>
                Retry Last
              </button>
            )}
            <button className="btn" onClick={sendMessage} disabled={sending || !input.trim() || !modelId}>
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {historyOpen && (
        <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) setHistoryOpen(false) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <button className="modal-close" onClick={() => setHistoryOpen(false)}>&times;</button>
            <h2>Conversation History</h2>
            <input
              type="text" placeholder="Search..." value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
              className="search-input" style={{ width: '100%', marginBottom: 8 }}
            />
            {filteredHistory.length === 0 ? (
              <div className="text-dim" style={{ textAlign: 'center', padding: 20 }}>{historySearch ? 'No matches' : 'No saved conversations'}</div>
            ) : (
              filteredHistory.map(c => {
                const m = models.find(x => x.id === c.modelId)
                return (
                  <div key={c.id} className={`history-item ${c.id === conv.id ? 'active' : ''}`} onClick={() => loadConv(c.id)}>
                    <div className="history-item-info">
                      <div className="history-item-title">{c.title || 'Untitled'}</div>
                      <div className="history-item-meta">{m?.name || 'Unknown'} &middot; {c.turns?.length || 0} turns &middot; {c.timestamp ? new Date(c.timestamp).toLocaleDateString() : ''}</div>
                    </div>
                    <button className="btn-sm ghost" onClick={e => { e.stopPropagation(); deleteConv(c.id); }}>X</button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
