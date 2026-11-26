/**
 * 档案编辑弹窗「百度快捷搜索」浏览器自测（CDP）：
 *  - 三类档案编辑弹窗都有搜索图标
 *  - 点击图标时按当前名称拼接 https://www.baidu.com/s?wd=<encoded>
 *  - 名称为空时提示“请先输入单位名称”
 * 运行：node _test/scripts/test-archive-search-ui.mjs（需先 npm run build）
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
const TEST_DB = path.join(SERVER, 'data/chantion-search-ui-test.db')
const BASE = 'http://127.0.0.1:3124'
const CDP_PORT = 9234
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const USER_DIR = path.join(os.tmpdir(), 'chantion-search-cdp-' + Date.now())
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
  if (!msg.id) return
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
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
      if (await evaluate("document.readyState === 'complete' && !!document.querySelector('.nav-item')")) {
        await sleep(300)
        return
      }
    } catch (e) {}
    await sleep(100)
  }
  throw new Error('页面加载超时: ' + url)
}
async function setSession(token, user) {
  const payload = JSON.stringify(JSON.stringify({ token, user }))
  await evaluate("localStorage.setItem('chantion_auth', " + payload + ')')
  await cdp('Page.reload', { ignoreCache: true })
  await sleep(1200)
}
async function openArchive(label) {
  await evaluate(`(function(){
    var el = Array.from(document.querySelectorAll('.nav-item')).find(function(n){ return n.textContent.includes(${JSON.stringify(label)}) && n.offsetParent !== null });
    if (el) el.click();
  })()`)
  await sleep(500)
  await evaluate(`(function(){
    var btn = Array.from(document.querySelectorAll('.archive-table tbody button')).find(function(b){ return b.textContent.trim() === '编辑' && b.offsetParent !== null });
    if (btn) btn.click();
  })()`)
  for (let i = 0; i < 40; i++) {
    if (await evaluate("!!document.querySelector('.el-dialog .name-input-wrap input')")) return
    await sleep(100)
  }
  throw new Error(label + ' 编辑弹窗未打开')
}
async function setInput(value) {
  await evaluate(`(function(){
    var input = document.querySelector('.el-dialog .name-input-wrap input');
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(100)
}
async function closeDialog() {
  await evaluate(`(function(){
    var btn = document.querySelector('.el-dialog__headerbtn');
    if (btn) btn.click();
  })()`)
  await sleep(400)
}

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()

  const server = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3124', HOST: '127.0.0.1' }),
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
    const login = await api('/api/auth/login', {
      method: 'POST', body: { username: 'admin', password: 'admin123' }
    })
    await goto(BASE + '/')
    await setSession(login.data.data.token, login.data.data.user)

    console.log('\n[A] 三类档案编辑弹窗都有搜索图标')
    const tabs = ['采购单位', '代理机构', '竞争对手']
    for (const label of tabs) {
      await openArchive(label)
      check(label + ' 有百度搜索图标', await evaluate("!!document.querySelector('.el-dialog .name-search-btn')"))
      check(label + ' 提示文案正确',
        await evaluate("document.querySelector('.el-dialog .name-search-btn').getAttribute('aria-label') === '去百度搜索该单位'"))
      await closeDialog()
    }

    console.log('\n[B] 点击图标拼接搜索链接')
    await openArchive('采购单位')
    const name = '鹤峰县交通运输局'
    await setInput(name)
    await evaluate("window.__baiduOpenArgs = null; window.open = function(){ window.__baiduOpenArgs = Array.prototype.slice.call(arguments); return null; }")
    await evaluate("document.querySelector('.el-dialog .name-search-btn').click()")
    const args = await evaluate('window.__baiduOpenArgs')
    const expected = 'https://www.baidu.com/s?wd=' + encodeURIComponent(name)
    check('window.open 新标签页打开', !!args && args[1] === '_blank', JSON.stringify(args))
    check('链接携带关键字并正确编码', !!args && args[0] === expected, JSON.stringify(args && args[0]))
    await closeDialog()

    console.log('\n[C] 空名称提示')
    await openArchive('代理机构')
    await setInput('')
    await evaluate("document.querySelector('.el-dialog .name-search-btn').click()")
    await sleep(400)
    const toast = await evaluate("document.body.innerText")
    check('空名称提示“请先输入单位名称”', toast.includes('请先输入单位名称'))
  } finally {
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) {}
    server.kill()
  }
  console.log('\n档案快捷搜索浏览器自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
