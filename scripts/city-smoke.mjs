// Smoke test for the 3D city: loads the app in headless Chrome, watches the console for
// errors, samples the renderer statistics exposed on window.__cityStats(), and saves a
// screenshot. Needs Node 22+ (built-in fetch and WebSocket) and Google Chrome.
//
//   node scripts/city-smoke.mjs [url] [seconds] [screenshot.png]
//
// The Google key's referrer restriction must allow the URL's port (see docs/rendering.md).

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:5175/'
const seconds = Number(process.argv[3] ?? 30)
const shot = process.argv[4] ?? '/tmp/city-smoke.png'
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9333 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), 'city-smoke-'))

const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', '--hide-scrollbars', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
const kill = () => { try { proc.kill('SIGKILL') } catch { /* already gone */ } }
process.on('exit', kill)

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('Chrome did not expose a page target')
}

const ws = new WebSocket(await pageTarget())
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let nextId = 1
const pending = new Map()
const errors = []
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data)
  if (msg.method === "Page.frameNavigated" || msg.method === "Page.loadEventFired") errors.push(`nav: ${msg.method} ${msg.params?.frame?.url ?? ""}`)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    errors.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 300))
  }
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value

await send('Runtime.enable')
await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__errs=[];addEventListener(\"error\",e=>__errs.push(\"error \"+String(e.error&&e.error.stack||e.message)));addEventListener(\"unhandledrejection\",e=>__errs.push(\"rejection \"+String(e.reason&&e.reason.stack||e.reason)))" })
await send('Page.enable')
await send('Page.navigate', { url })

const started = Date.now()
const samples = []
while (Date.now() - started < seconds * 1000) {
  await new Promise((r) => setTimeout(r, 2000))
  const s = await evaluate('JSON.stringify({ t: Math.round(performance.now() / 1000), ready: window.__city?.ready ?? null, hud: document.querySelector(".hud-sub")?.textContent ?? null, rootChildren: document.getElementById("root")?.childElementCount ?? null, stats: window.__cityStats ? window.__cityStats() : null })')
  if (s) samples.push(JSON.parse(s))
}

const errs = (await evaluate("JSON.stringify(window.__errs||[])")) ?? "[]"
writeFileSync("/tmp/city-smoke-errs.json", errs)
writeFileSync("/tmp/city-smoke-console.json", JSON.stringify(errors))
const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(shot, Buffer.from(data, 'base64'))

const last = samples.at(-1)
console.log(`url: ${url}`)
console.log(`screenshot: ${shot}`)
console.log('samples (t, hud, visibleTiles, calls, triangles, loadProgress):')
for (const s of samples) {
  const st = s.stats ?? {}
  console.log(`  ${String(s.t).padStart(3)}s root=${s.rootChildren} ${(s.hud ?? "").padEnd(30)} tiles=${st.visibleTiles ?? '-'} calls=${st.calls ?? '-'} tris=${st.triangles ?? '-'} progress=${st.loadProgress?.toFixed?.(3) ?? '-'}`)
}
console.log(`final: ready=${last?.ready} visibleTiles=${last?.stats?.visibleTiles} geometries=${last?.stats?.geometries} textures=${last?.stats?.textures}`)
const unique = [...new Set(errors)]
console.log(`console errors/warnings: ${errors.length} (${unique.length} unique)`)
for (const e of unique.slice(0, 60)) console.log(`  ${e.slice(0, 170)}`)
ws.close()
kill()
process.exit(unique.some((e) => e.startsWith('exception') || e.startsWith('error')) ? 1 : 0)
