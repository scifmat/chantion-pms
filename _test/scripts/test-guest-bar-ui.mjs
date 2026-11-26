/**
 * 侧边栏访客态 UI 浏览器自测（CDP）：
 *  - 无独立蓝色登录按钮，整卡文字/引导符合新设计
 *  - 点击整卡弹出登录框
 *  - 访客态与已登录态用户栏高度/边距/边框一致
 * 运行：node _test/scripts/test-guest-bar-ui.mjs（需先 npm run build）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SERVER = path.join(ROOT, 'server')
const REAL_DB = path.join(SERVER, 'data/chantion.db')
const TEST_DB = path.join(SERVER, 'data/chantion-guest-ui-test.db')
const BASE = 'http://127.0.0.1:3125'
const CDP_PORT = 9235
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const USER_DIR = path.join(os.tmpdir(), 'chantion-guest-cdp-' + Date.now())
const serverRequire = createRequire(path.join(SERVER, 'app.js'))
const Database = serverRequire('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function api(urlPath, options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (options.token) headers.Authorization = 'Bearer ' + options.token
  const res = await fetch(BASE + urlPath, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  let data = {}
  try { data = await res.json() } catch (e) {}
  return { status: res.status, data }
}
let ws, seq = 0
const pending = new Map()
function onMessage(evt) {
  const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
  const msg = JSON.parse(raw)
  if (!msg.id || !pending.has(msg.id)) return
  const p = pending.get(msg.id); pending.delete(msg.id)
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
  else p.resolve(msg.result)
}
function cdp(method, params = {}) {
  return new Promise(function (resolve, reject) {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(expression))
  return r.result && r.result.value
}
async function connectCDP() {
  let target
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()
      target = list.find(t => t.type === 'page')
      if (target) break
    } catch (e) {}
    await sleep(200)
  }
  if (!target) throw new Error('CDP target 未就绪')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = onMessage
  await cdp('Page.enable')
  await cdp('Runtime.enable')
}
async function goto(url) {
  await cdp('Page.navigate', { url })
  for (let i = 0; i < 100; i++) {
    try {
      if (await evaluate("document.readyState === 'complete' && !!document.querySelector('.side-user-bar')")) {
        await sleep(300); return
      }
    } catch (e) {}
    await sleep(100)
  }
  throw new Error('页面加载超时')
}
async function metrics() {
  return evaluate(`(function(){
    var el = document.querySelector('.side-user-bar');
    if (!el) return null;
    var r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return { height: Math.round(r.height * 100) / 100, width: Math.round(r.width * 100) / 100,
             paddingTop: s.paddingTop, paddingBottom: s.paddingBottom,
             marginTop: s.marginTop, borderTop: s.borderTopWidth, radius: s.borderRadius };
  })()`)
}

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()

  const server = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3125', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + USER_DIR,
    '--window-size=1440,900', 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await api('/api/projects')).status === 200) break } catch (e) {}
      await sleep(100)
    }
    await connectCDP()
    await goto(BASE + '/')
    await evaluate("localStorage.removeItem('chantion_auth')")
    await cdp('Page.reload', { ignoreCache: true })
    await sleep(1000)

    console.log('\n[A] 访客态结构与点击')
    check('无独立登录按钮', await evaluate("!document.querySelector('.su-login-btn')"))
    check('整卡带角色与引导', await evaluate(`(function(){
      var el = document.querySelector('.guest-card');
      return !!el && el.textContent.includes('未登录') && el.textContent.includes('去登录');
    })()`))
    check('整卡可聚焦', await evaluate("document.querySelector('.guest-card').getAttribute('tabindex') === '0'"))
    const shotDir = path.join(ROOT, '_test/screenshots/ui-verify')
    fs.mkdirSync(shotDir, { recursive: true })
    const shot = await cdp('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(shotDir, 'guest-bar.png'), Buffer.from(shot.data, 'base64'))
    await evaluate("document.querySelector('.guest-card').click()")
    await sleep(400)
    check('点击整卡弹出登录框', await evaluate(`Array.from(document.querySelectorAll('.el-dialog__title')).some(function(e){ return e.textContent.includes('登录'); })`))
    await evaluate("var b=document.querySelector('.el-dialog__headerbtn'); if(b) b.click()")
    await sleep(400)

    const guest = await metrics()
    console.log('  访客指标：' + JSON.stringify(guest))

    console.log('\n[B] 与已登录态布局一致')
    const login = await api('/api/auth/login', {
      method: 'POST', body: { username: 'admin', password: 'admin123' }
    })
    const payload = JSON.stringify(JSON.stringify({ token: login.data.data.token, user: login.data.data.user }))
    await evaluate("localStorage.setItem('chantion_auth', " + payload + ')')
    await cdp('Page.reload', { ignoreCache: true })
    await sleep(1000)
    const logged = await metrics()
    console.log('  登录指标：' + JSON.stringify(logged))
    check('高度一致', !!guest && !!logged && Math.abs(guest.height - logged.height) < 0.5,
      JSON.stringify([guest && guest.height, logged && logged.height]))
    check('宽度一致', !!guest && !!logged && Math.abs(guest.width - logged.width) < 0.5,
      JSON.stringify([guest && guest.width, logged && logged.width]))
    check('padding / 边框 / 圆角一致', !!guest && !!logged &&
      guest.paddingTop === logged.paddingTop && guest.paddingBottom === logged.paddingBottom &&
      guest.marginTop === logged.marginTop && guest.borderTop === logged.borderTop && guest.radius === logged.radius,
      JSON.stringify({ guest, logged }))
  } finally {
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) {}
    server.kill()
  }
  console.log('\n访客栏 UI 自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
