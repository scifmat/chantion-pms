/**
 * 日期输入浏览器自测（真实 Chrome CDP）：主输入框手打 / 粘贴 / 日历面板。
 * 运行：node _test/scripts/test-date-ui.mjs   （需先 npm run build）
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
const TEST_DB = path.join(SERVER, 'data/chantion-date-ui-test.db')
const BASE = 'http://127.0.0.1:3104'
const CDP_PORT = 9233
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const USER_DIR = path.join(os.tmpdir(), 'chantion-date-cdp-' + Date.now())
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

let ws, seq = 0
const pending = new Map()
function cdp(method, params) {
  return new Promise(function (resolve, reject) {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params: params || {} }))
  })
}
function onMessage(evt) {
  const msg = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data))
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id)
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
    else p.resolve(msg.result)
  }
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
  await cdp('Page.enable'); await cdp('Runtime.enable')
}

// 在指定 label 的 Field 内找到 input（DateField 嵌在 .fld 里）
const FIND = label => `(function(){
  var f=Array.from(document.querySelectorAll('.fld')).find(function(x){
    var l=x.querySelector('label'); return l && l.textContent.indexOf(${JSON.stringify(label)})>=0 });
  return f ? f.querySelector('input') : null;
})()`

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true }); await src.backup(TEST_DB); src.close()
  const server = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3104', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + USER_DIR,
    '--window-size=1440,900', 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(BASE + '/api/projects')).ok) break } catch (e) {}
      await sleep(100)
    }
    await connectCDP()
    const login = await (await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json()
    const session = JSON.stringify(JSON.stringify({ token: login.data.token, user: login.data.user }))
    const listRes = await (await fetch(BASE + '/api/projects', {
      headers: { Authorization: 'Bearer ' + login.data.token }
    })).json()
    const firstId = listRes.data[0].row_id
    await cdp('Page.navigate', { url: BASE + '/' })
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate("document.readyState==='complete' && !!document.querySelector('.nav-item')")) break } catch (e) {}
      await sleep(100)
    }
    await evaluate("localStorage.setItem('chantion_auth'," + session + ")")
    await cdp('Page.reload', { ignoreCache: true })
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate("!!document.querySelector('.nav-item') && !!document.querySelector('tbody tr')")) break } catch (e) {}
      await sleep(100)
    }
    // 进入项目列表，打开第一条的编辑弹窗
    await evaluate("(function(){var n=Array.from(document.querySelectorAll('.nav-item')).find(x=>x.textContent.indexOf('项目列表')>=0);if(n)n.click()})()")
    await sleep(400)
    await evaluate("(function(){var tr=document.querySelector('tbody tr');if(!tr)return;var b=Array.from(tr.querySelectorAll('button')).find(x=>x.textContent.indexOf('编辑')>=0);if(b)b.click()})()")
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate("!!document.querySelector('.overlay') && document.querySelectorAll('.fld input').length>5")) break } catch (e) {}
      await sleep(100)
    }

    console.log('\n=== 1. 主输入框手打标准格式 + Enter ===')
    const typed = await evaluate(`(function(){var i=${FIND('投标开始时间')};if(!i)return 'NO_INPUT';i.focus();i.value='2026-11-21 09:30:00';i.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'2026-11-21 09:30:00'}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return i.value})()`)
    check('找得到投标开始时间输入框', typed !== 'NO_INPUT', String(typed))
    await sleep(400)
    const afterEnter = await evaluate(`(function(){var i=${FIND('投标开始时间')};return i?i.value:'NO_INPUT'})()`)
    check('Enter 后主输入框保留标准值', afterEnter === '2026-11-21 09:30:00', String(afterEnter))

    console.log('\n=== 1b. 手打中文日期+点分（含无空格） ===')
    for (const raw of ['2026年12月11日 09点30分', '2026年12月11日09点30分']) {
      await evaluate(`(function(){var i=${FIND('投标截止时间')};if(!i)return;i.focus();i.value=${JSON.stringify(raw)};i.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))})()`)
      await sleep(350)
      const val = await evaluate(`(function(){var i=${FIND('投标截止时间')};return i?i.value:'NO_INPUT'})()`)
      check('「' + raw + '」识别为标准时间', val === '2026-12-11 09:30:00', String(val))
    }

    console.log('\n=== 2. 粘贴中文年月日 + 失焦 ===')
    const pasted = await evaluate(`(function(){var i=${FIND('获取文件起始日期')};if(!i)return 'NO_INPUT';i.focus();var dt=new DataTransfer();dt.setData('text','2026年11月21日');i.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));setTimeout(function(){i.blur()},50);return true})()`)
    check('粘贴事件被接收', pasted === true, String(pasted))
    await sleep(500)
    const afterPaste = await evaluate(`(function(){var i=${FIND('获取文件起始日期')};return i?i.value:'NO_INPUT'})()`)
    check('粘贴中文日期失焦后变标准格式', afterPaste === '2026-11-21', String(afterPaste))

    console.log('\n=== 3. 点击输入框仍能弹出日历 ===')
    await evaluate(`(function(){var i=${FIND('意向公示起始日期')};if(i){i.focus();i.click()}})()`)
    await sleep(500)
    const panel = await evaluate("!!Array.from(document.querySelectorAll('.el-picker__popper')).find(function(p){return p.offsetParent!==null})")
    check('日历面板可弹出', panel === true)

    console.log('\n=== 4. 保存后后端拿到标准值 ===')
    await evaluate("(function(){var b=Array.from(document.querySelectorAll('.overlay button')).find(function(x){return x.textContent.trim()==='保存'});if(b)b.click()})()")
    await sleep(1200)
    const saved = await (await fetch(BASE + '/api/projects/' + firstId, {
      headers: { Authorization: 'Bearer ' + login.data.token }
    })).json()
    const d = saved.data && saved.data.detail
    check('投标开始时间已写回 detail', !!(d && d.bidding && d.bidding.bidStart === '2026-11-21 09:30:00'),
      d && d.bidding && d.bidding.bidStart)
    check('获取文件起始日期已写回 detail', !!(d && d.bidding && d.bidding.docStart === '2026-11-21'),
      d && d.bidding && d.bidding.docStart)
  } finally {
    chrome.kill(); server.kill()
  }
  console.log('\n日期输入浏览器自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
