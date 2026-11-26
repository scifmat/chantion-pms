/**
 * 本企业战力卡 UI 浏览器自测（CDP）：
 *  - 10 个指标按 2 列网格排布，文案齐全
 *  - 卡片高度与左侧红黑榜对齐
 *  - 页面运行无 JS 异常 / console.error
 * 运行：node _test/scripts/test-self-card-ui.mjs（需先 npm run build）
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
const TEST_DB = path.join(SERVER, 'data/chantion-self-card-test.db')
const BASE = 'http://127.0.0.1:3126'
const CDP_PORT = 9236
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const USER_DIR = path.join(os.tmpdir(), 'chantion-self-card-cdp-' + Date.now())
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
const errors = []
function onMessage(evt) {
  const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
  const msg = JSON.parse(raw)
  if (msg.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(msg.params.exceptionDetails || {}))
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(JSON.stringify(msg.params.args || []))
  }
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

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()

  const server = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3126', HOST: '127.0.0.1' }),
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
    await cdp('Page.navigate', { url: BASE + '/' })
    for (let i = 0; i < 100; i++) {
      if (await evaluate("document.readyState === 'complete' && !!document.querySelector('.side-user-bar')")) break
      await sleep(100)
    }
    const payload = JSON.stringify(JSON.stringify({ token: login.data.data.token, user: login.data.data.user }))
    await evaluate("localStorage.setItem('chantion_auth', " + payload + ')')
    await cdp('Page.reload', { ignoreCache: true })
    await sleep(1000)
    await evaluate(`(function(){
      var el = Array.from(document.querySelectorAll('.nav-item')).find(function(n){ return n.textContent.includes('数据看板') && n.offsetParent !== null });
      if (el) el.click();
    })()`)
    for (let i = 0; i < 100; i++) {
      if (await evaluate("!!document.querySelector('.self-card .self-metrics')")) break
      await sleep(100)
    }
    await sleep(400)
    errors.length = 0 // 忽略导航期间的常规资源/上下文噪声，只统计渲染后的错误

    console.log('\n[A] 指标网格')
    const metricCount = await evaluate("document.querySelectorAll('.self-card .self-metric').length")
    check('10 个指标齐全', metricCount === 10, String(metricCount))
    const labels = await evaluate("Array.from(document.querySelectorAll('.self-card .self-metric span')).map(function(e){return e.textContent.trim()})")
    const expected = ['全局排名', '中标项目', '平均中标额', '总让利金额', '最高让利额',
      '市占率', '中标总额', '最高中标额', '让利率', '最低让利额']
    check('标签文案与列优先顺序正确', JSON.stringify(labels) === JSON.stringify(expected), JSON.stringify(labels))
    const cols = await evaluate("getComputedStyle(document.querySelector('.self-metrics')).gridTemplateColumns")
    check('两列网格', String(cols).trim().split(/\s+/).length === 2, String(cols))
    check('左右列各 5 项', await evaluate(`(function(){
      var cs = document.querySelectorAll('.self-metric-col');
      return cs.length === 2 && cs[0].querySelectorAll('.self-metric').length === 5 && cs[1].querySelectorAll('.self-metric').length === 5;
    })()`))

    console.log('\n[A2] 键值同行与对齐')
    const align = await evaluate(`(function(){
      var cols = Array.from(document.querySelectorAll('.self-metric-col'));
      return cols.map(function(col){
        var items = Array.from(col.querySelectorAll('.self-metric'));
        var spans = items.map(function(it){ return it.querySelector('span').getBoundingClientRect(); });
        var bs = items.map(function(it){ return it.querySelector('b').getBoundingClientRect(); });
        var spanX = spans.map(function(r){ return r.left; });
        var bX = bs.map(function(r){ return r.left; });
        var sameLine = items.every(function(it){
          var a = it.querySelector('span').getBoundingClientRect();
          var b = it.querySelector('b').getBoundingClientRect();
          return Math.abs(a.top - b.top) <= 6;
        });
        return {
          labelAligned: Math.max.apply(null, spanX) - Math.min.apply(null, spanX) <= 1,
          valueAligned: Math.max.apply(null, bX) - Math.min.apply(null, bX) <= 1,
          sameLine: sameLine,
          gap: Math.round(bs[0].left - spans[0].right)
        };
      });
    })()`)
    check('每列键名左对齐', align.every(function (c) { return c.labelAligned; }), JSON.stringify(align))
    check('每列数值左对齐', align.every(function (c) { return c.valueAligned; }), JSON.stringify(align))
    check('键名与数值同行', align.every(function (c) { return c.sameLine; }), JSON.stringify(align))
    check('键值间距 8~12px', align.every(function (c) { return c.gap >= 8 && c.gap <= 12; }), JSON.stringify(align))
    const rowGap = await evaluate("getComputedStyle(document.querySelector('.self-metric-col')).rowGap")
    check('行间距 12~16px', parseFloat(rowGap) >= 12 && parseFloat(rowGap) <= 16, String(rowGap))
    const valueFont = await evaluate("parseFloat(getComputedStyle(document.querySelector('.self-metric b')).fontSize)")
    check('宽屏指标数值字号 ≥16px', valueFont >= 16, String(valueFont))
    check('指标数值未被截断', await evaluate(`Array.from(document.querySelectorAll('.self-metric b')).every(function(b){
      return b.scrollWidth <= b.clientWidth + 1;
    })`))

    console.log('\n[A3] Top1 差距横幅')
    const banner = await evaluate(`(function(){
      var box = document.querySelector('.self-gap');
      if (!box) return null;
      var label = box.querySelector('span').getBoundingClientRect();
      var value = box.querySelector('b').getBoundingClientRect();
      var s = getComputedStyle(box);
      return { direction: s.flexDirection, stacked: value.top >= label.bottom - 2,
               valueFont: parseFloat(getComputedStyle(box.querySelector('b')).fontSize) };
    })()`)
    check('标签与金额上下两行', !!banner && banner.direction === 'column' && banner.stacked, JSON.stringify(banner))
    check('差距金额字号 ≥22px', !!banner && banner.valueFont >= 22, JSON.stringify(banner))

    console.log('\n[B] 与左侧榜单对齐')
    const heights = await evaluate(`(function(){
      var grid = document.querySelector('.competition-grid');
      var cards = grid ? grid.children : [];
      return Array.from(cards).map(function(e){ return Math.round(e.getBoundingClientRect().height); });
    })()`)
    check('两卡高度一致', heights.length === 2 && Math.abs(heights[0] - heights[1]) <= 1, JSON.stringify(heights))

    await evaluate("document.querySelector('.self-card').scrollIntoView({ block: 'center' })")
    await sleep(300)
    const shotDir = path.join(ROOT, '_test/screenshots/dashboard')
    fs.mkdirSync(shotDir, { recursive: true })
    const shot = await cdp('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(shotDir, 'self-card-upgrade.png'), Buffer.from(shot.data, 'base64'))

    console.log('\n[C] 控制台')
    check('无 JS 异常 / console.error', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) {}
    server.kill()
  }
  console.log('\n战力卡 UI 自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
