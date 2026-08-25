// Minimal CDP client over the Node 24 global WebSocket.
export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.sessions = new Map()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result) }
        return
      }
      for (const fn of this.listeners) fn(msg)
    })
    this.listeners = new Set()
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
    return new CDP(ws)
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`timeout ${method}`)) }, 20000)
    })
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  waitFor(method, predicate = () => true, ms = 15000) {
    return new Promise((resolve, reject) => {
      const off = this.on((msg) => { if (msg.method === method && predicate(msg.params)) { off(); resolve(msg.params) } })
      setTimeout(() => { off(); reject(new Error(`timeout waiting ${method}`)) }, ms)
    })
  }
  close() { this.ws.close() }
}
export async function fetchJSON(url) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json() } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`unreachable: ${url}`)
}
