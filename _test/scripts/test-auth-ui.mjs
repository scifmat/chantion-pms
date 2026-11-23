/**
 * 用户系统与权限控制 · 前端三视角浏览器自测（第 9 步）。
 * 用真实 Chrome 的 CDP（Node 22 原生 WebSocket，无需 puppeteer）渲染 dist 页面，
 * 在独立后端（副本库，端口 3102，页面与 API 同源）上验证访客/普通用户/管理员的按钮与入口可见性。
 * 运行：node _test/scripts/test-auth-ui.mjs   （需先 npm run build 生成 client/dist）
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
const TEST_DB = path.join(SERVER, 'data/chantion-auth-ui-test.db')
const BASE = 'http://127.0.0.1:3102'
const CDP_PORT = 9231
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const USER_DIR = path.join(os.tmpdir(), 'chantion-auth-cdp-' + Date.now())

const serverRequire = createRequire(path.join(SERVER, 'app.js'))
const Database = serverRequire('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

async function api(method, urlPath, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + urlPath, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data = {}; try { data = await res.json() } catch (e) { data = {} }
  return { status: res.status, data }
}

/* ---------- 极简 CDP 客户端 ---------- */
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
  const raw = typeof evt.data === 'string' ? evt.data : String(evt.data)
  const msg = JSON.parse(raw)
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
      target = list.find(function (t) { return t.type === 'page' })
      if (target) break
    } catch (e) { /* 等待 Chrome 就绪 */ }
    await sleep(200)
  }
  if (!target) throw new Error('CDP target 未就绪')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(function (resolve, reject) { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = onMessage
  await cdp('Page.enable')
  await cdp('Runtime.enable')
}
async function goto(url) {
  await cdp('Page.navigate', { url })
  for (let i = 0; i < 100; i++) {
    try {
      const ready = await evaluate("document.readyState === 'complete' && !!document.querySelector('.nav-item')")
      if (ready) { await sleep(300); return }
    } catch (e) { /* 导航中上下文切换 */ }
    await sleep(100)
  }
  throw new Error('页面加载超时: ' + url)
}
// 通过注入 localStorage 切换登录视角后刷新
async function setSession(token, user) {
  const payload = JSON.stringify(JSON.stringify({ token, user }))
  await evaluate("localStorage.setItem('chantion_auth', " + payload + ")")
  await cdp('Page.reload', { ignoreCache: true })
  for (let i = 0; i < 100; i++) {
    try {
      const ready = await evaluate("!!document.querySelector('.nav-item') && !!document.querySelector('.side-user-bar')")
      if (ready) { await sleep(400); return }
    } catch (e) { /* reload 中 */ }
    await sleep(100)
  }
}
// 读取当前可见 DOM 的按钮文本数组（只取可见元素，v-show 隐藏的不算）
const VISIBLE_BTNS = "Array.from(document.querySelectorAll('button')).filter(b=>b.offsetParent!==null).map(b=>b.textContent.trim())"
const VISIBLE_NAV = "Array.from(document.querySelectorAll('.nav-item')).filter(e=>e.offsetParent!==null).map(e=>e.textContent.trim())"

async function main() {
  [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()

  const server = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3102', HOST: '127.0.0.1' }),
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

    // 准备数据：管理员登录并建一个普通用户
    const admin = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })
    const adminToken = admin.data.data.token
    const adminUser = admin.data.data.user
    let created = await api('POST', '/api/users', { username: 'ui_tester', password: 'pass123', role: 'user' }, adminToken)
    if (created.status === 409) {
      // 副本可能已存在则直接登录
    }
    const userLogin = await api('POST', '/api/auth/login', { username: 'ui_tester', password: 'pass123' })
    const userToken = userLogin.data.data.token
    const userObj = userLogin.data.data.user

    console.log('\n[A] 访客视角')
    await goto(BASE + '/')
    const gSide = await evaluate("document.querySelector('.side-user-bar').textContent")
    const gBtns = await evaluate(VISIBLE_BTNS)
    const gNav = await evaluate(VISIBLE_NAV)
    check('底部显示「登录」按钮', gSide.includes('登录'), gSide)
    check('底部显示「访客」标签', gSide.includes('访客'), gSide)
    check('无「新增项目」按钮', !gBtns.some(function (b) { return b.indexOf('新增项目') >= 0 }), JSON.stringify(gBtns))
    check('列表无「编辑」按钮', !gBtns.includes('编辑'), JSON.stringify(gBtns))
    check('列表无「删除」按钮', !gBtns.includes('删除'), JSON.stringify(gBtns))
    check('列表保留「查看」按钮', gBtns.includes('查看'), JSON.stringify(gBtns))
    check('侧栏隐藏「操作记录」', !gNav.includes('操作记录'), JSON.stringify(gNav))
    check('侧栏隐藏「业务配置」', !gNav.includes('业务配置'), JSON.stringify(gNav))
    check('访客隐藏「系统管理」', !gNav.includes('系统管理'), JSON.stringify(gNav))
    // 高级查询保留「查询」按钮
    await evaluate("(function(){var b=Array.from(document.querySelectorAll('button')).find(x=>x.offsetParent!==null&&x.textContent.indexOf('高级查询')>=0);if(b)b.click();})()")
    await sleep(500)
    const gAdvBtns = await evaluate(VISIBLE_BTNS)
    check('高级查询保留「查询」按钮', gAdvBtns.includes('查询'), JSON.stringify(gAdvBtns))

    console.log('\n[B] 普通用户视角')
    await setSession(userToken, userObj)
    const uSide = await evaluate("document.querySelector('.side-user-bar').textContent")
    const uBtns = await evaluate(VISIBLE_BTNS)
    const uNav = await evaluate(VISIBLE_NAV)
    check('底部显示用户名 ui_tester', uSide.includes('ui_tester'), uSide)
    check('底部显示「普通用户」标签', uSide.includes('普通用户'), uSide)
    check('有「新增项目」按钮', uBtns.some(function (b) { return b.indexOf('新增项目') >= 0 }), JSON.stringify(uBtns))
    check('有「编辑」按钮', uBtns.includes('编辑'), JSON.stringify(uBtns))
    check('有「删除」按钮', uBtns.includes('删除'), JSON.stringify(uBtns))
    check('侧栏显示「操作记录」', uNav.includes('操作记录'), JSON.stringify(uNav))
    check('侧栏隐藏「业务配置」', !uNav.includes('业务配置'), JSON.stringify(uNav))
    check('普通用户隐藏「系统管理」', !uNav.includes('系统管理'), JSON.stringify(uNav))
    await evaluate("document.querySelector('.su-logged').click()")
    await sleep(400)
    const uMenu = await evaluate("Array.from(document.querySelectorAll('.el-dropdown-menu__item')).filter(e=>e.offsetParent!==null).map(e=>e.textContent.trim())")
    check('下拉有「修改密码」', uMenu.some(function (x) { return x.indexOf('修改密码') >= 0 }), JSON.stringify(uMenu))
    check('下拉无「用户管理」', !uMenu.some(function (x) { return x.indexOf('用户管理') >= 0 }), JSON.stringify(uMenu))
    check('下拉有「退出登录」', uMenu.some(function (x) { return x.indexOf('退出登录') >= 0 }), JSON.stringify(uMenu))

    console.log('\n[C] 管理员视角')
    await setSession(adminToken, adminUser)
    const aSide = await evaluate("document.querySelector('.side-user-bar').textContent")
    const aNav = await evaluate(VISIBLE_NAV)
    check('底部显示「管理员」标签', aSide.includes('管理员'), aSide)
    check('侧栏显示「操作记录」', aNav.includes('操作记录'), JSON.stringify(aNav))
    check('侧栏显示「系统管理」', aNav.includes('系统管理'), JSON.stringify(aNav))
    check('侧栏已无「业务配置」', !aNav.includes('业务配置'), JSON.stringify(aNav))
    await evaluate("document.querySelector('.su-logged').click()")
    await sleep(400)
    const aMenu = await evaluate("Array.from(document.querySelectorAll('.el-dropdown-menu__item')).filter(e=>e.offsetParent!==null).map(e=>e.textContent.trim())")
    check('管理员下拉已无「用户管理」', !aMenu.some(function (x) { return x.indexOf('用户管理') >= 0 }), JSON.stringify(aMenu))
    // 用户管理已聚合到「系统管理 → 用户管理」Tab
    await evaluate("(function(){var n=Array.from(document.querySelectorAll('.nav-item')).find(x=>x.textContent.trim()==='系统管理');if(n)n.click()})()")
    await sleep(700)
    await evaluate("(function(){var t=Array.from(document.querySelectorAll('.el-tabs__item')).find(x=>x.textContent.trim()==='用户管理');if(t)t.click()})()")
    await sleep(700)
    const umVisible = await evaluate("!!document.querySelector('.user-manage-panel') && document.querySelector('.user-manage-panel').offsetParent!==null")
    const umText = await evaluate("document.querySelector('.user-manage-panel') ? document.querySelector('.user-manage-panel').textContent : ''")
    check('用户管理面板打开', umVisible, String(umVisible))
    check('面板含「新增用户」按钮', umText.includes('新增用户'), umText.slice(0, 200))
    check('面板列表含 ui_tester', umText.includes('ui_tester'), umText.slice(0, 300))

    console.log('\n[D] 刷新保持登录态')
    await cdp('Page.reload', { ignoreCache: true })
    await sleep(900)
    const rSide = await evaluate("document.querySelector('.side-user-bar').textContent")
    check('刷新后仍显示管理员', rSide.includes('admin') && rSide.includes('管理员'), rSide)

    console.log('\n[E] 真实登录交互与 401 唤起登录框')
    // 清态回到访客，点「登录」按钮
    await evaluate("localStorage.removeItem('chantion_auth')")
    await cdp('Page.reload', { ignoreCache: true })
    await sleep(900)
    await evaluate("(function(){var b=Array.from(document.querySelectorAll('.su-login-btn')).find(x=>x.offsetParent!==null);if(b)b.click();})()")
    await sleep(500)
    const loginOpen = await evaluate("!!document.querySelector('.auth-form')")
    check('点击登录弹出登录框', loginOpen, String(loginOpen))
    // 填入管理员账号密码（用原生 input 事件触发 v-model）
    await evaluate(`(function(){
      var ins=document.querySelectorAll('.el-overlay input');
      var set=function(el,v){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
      if(ins[0])set(ins[0],'admin');
      if(ins[1])set(ins[1],'admin123');
    })()`)
    await sleep(200)
    // 点登录框底部「登录」按钮
    await evaluate("(function(){var bs=Array.from(document.querySelectorAll('.el-overlay .btn.primary'));var b=bs.find(x=>x.offsetParent!==null&&x.textContent.trim()==='登录');if(b)b.click();})()")
    await sleep(900)
    const afterLogin = await evaluate("document.querySelector('.side-user-bar').textContent")
    check('登录成功后侧栏显示管理员', afterLogin.includes('admin') && afterLogin.includes('管理员'), afterLogin)
    const loginClosed = await evaluate("!document.querySelector('.el-overlay') || document.querySelector('.el-overlay').offsetParent===null")
    check('登录成功后弹窗关闭', loginClosed, String(loginClosed))

  } finally {
    try { if (ws) ws.close() } catch (e) {}
    server.kill('SIGTERM')
    try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) {}
    chrome.kill('SIGKILL')
    await sleep(600)
    ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) { try { fs.unlinkSync(f) } catch (e) {} })
    try { fs.rmSync(USER_DIR, { recursive: true, force: true }) } catch (e) {}
  }

  console.log('\n========================================')
  console.log('  PASS: ' + pass + '   FAIL: ' + fail)
  console.log('========================================')
  if (fail > 0) process.exitCode = 1
}

main().catch(function (e) { console.error('UI 测试执行异常:', e); process.exitCode = 1 })
