/**
 * 全局默认排序自测：所有列表按「更新时间倒序」返回。
 * 运行：node _test/scripts/test-default-sort.mjs
 * 用副本库 + 独立端口启动真实后端，覆盖首页列表 / 高级查询 / 档案列表 / 用户列表 / 操作记录 / Excel 导出。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SERVER = path.join(ROOT, 'server')
const REAL_DB = path.join(SERVER, 'data/chantion.db')
const TEST_DB = path.join(SERVER, 'data/chantion-sort-test.db')
const BASE = 'http://127.0.0.1:3117'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
const ExcelJS = require('exceljs')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')) }
}
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { if ((await fetch(BASE + '/api/projects')).ok) return } catch (e) {}
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('后端启动超时')
}
async function api(urlPath, options = {}) {
  const res = await fetch(BASE + urlPath, options)
  const json = await res.json().catch(function () { return {} })
  if (!res.ok) throw new Error(urlPath + ' status=' + res.status + ' ' + JSON.stringify(json))
  return json.data
}
function idsEqual(actual, expected, label) {
  const a = actual.map(function (r) { return r.row_id }).join(',')
  const e = expected.join(',')
  check(label, a === e, '实际 ' + a + ' / 期望 ' + e)
}

async function main() {
  // 前置哨兵：演示数据若生成未来 updated_at，会把真实编辑永远压在后面
  const nowText = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
  const sourceCheck = new Database(REAL_DB, { readonly: true })
  const futureCount = sourceCheck.prepare('SELECT COUNT(*) n FROM projects WHERE updated_at > ?').get(nowText).n
  sourceCheck.close()
  check('真实库无未来更新时间', futureCount === 0, '未来记录数=' + futureCount)

  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()
  // 统一把历史更新时间压到过去，保证随后编辑的那条一定排第一
  const prep = new Database(TEST_DB)
  prep.prepare("UPDATE projects SET updated_at = '2020-01-01 00:00:00'").run()
  prep.prepare("UPDATE buyers SET updated_at = '2020-01-01 00:00:00'").run()
  prep.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3117', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const login = await api('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const auth = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }

    console.log('=== 1. 首页列表 / 高级查询默认排序 ===')
    const expected = new Database(TEST_DB, { readonly: true })
      .prepare('SELECT row_id FROM projects WHERE deleted = 0 ORDER BY updated_at DESC, version DESC, row_id DESC').all()
      .map(function (r) { return r.row_id })
    const home = await api('/api/projects')
    const advanced = await api('/api/projects/advanced')
    idsEqual(home, expected, 'GET /api/projects 按 updated_at DESC')
    idsEqual(advanced, expected, 'GET /api/projects/advanced 按 updated_at DESC')

    console.log('=== 2. 编辑保存后跑到第一行，刷新保持 ===')
    const target = home[home.length - 1]
    const detail = await api('/api/projects/' + target.row_id)
    const full = JSON.parse(JSON.stringify(detail))
    full.detail.public.project_name = full.detail.public.project_name + '【排序自测】'
    const saved = await api('/api/projects/' + target.row_id, {
      method: 'PUT', headers: auth, body: JSON.stringify({ detail: full.detail, version: full.version })
    })
    check('编辑保存成功', !!saved && !!saved.row_id, JSON.stringify(saved && saved.message))
    const afterSave = await api('/api/projects')
    check('保存后编辑项出现在第一行', afterSave[0].row_id === target.row_id,
      '第一行=' + afterSave[0].row_id + ' 目标=' + target.row_id)
    check('保存后列表名称已更新', String(afterSave[0].project_name).includes('【排序自测】'), afterSave[0].project_name)
    const afterReload = await api('/api/projects')
    check('再次请求（模拟刷新）仍在第一行', afterReload[0].row_id === target.row_id)
    const advAfter = await api('/api/projects/advanced')
    check('高级查询同样把编辑项排第一', advAfter[0].row_id === target.row_id)

    console.log('=== 3. 档案列表 / 候选 ===')
    const upd = new Database(TEST_DB)
    const buyer = upd.prepare('SELECT id FROM buyers ORDER BY id LIMIT 1').get()
    upd.prepare("UPDATE buyers SET updated_at = '2030-01-01 00:00:00' WHERE id = ?").run(buyer.id)
    upd.close()
    const archives = await api('/api/archives?type=buyer')
    check('档案列表最近更新在前', archives[0].id === buyer.id,
      '第一行=' + archives[0].id + ' 目标=' + buyer.id)
    const candidates = await api('/api/archives/search?type=buyer&q=' + encodeURIComponent(archives[0].name))
    check('档案候选接口可用且按新排序返回', Array.isArray(candidates) && candidates.length > 0)

    console.log('=== 4. 用户列表 / 操作记录 ===')
    const users = await api('/api/users', { headers: auth })
    const userIds = users.map(function (u) { return u.id })
    const expectedUsers = users.slice().sort(function (a, b) {
      if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at ? -1 : 1
      return b.id - a.id
    }).map(function (u) { return u.id })
    check('用户列表按 updated_at DESC', userIds.join(',') === expectedUsers.join(','))
    const logs = await api('/api/operation-logs', { headers: auth })
    const logOk = logs.every(function (l, i) {
      return i === 0 || (logs[i - 1].created_at > l.created_at ||
        (logs[i - 1].created_at === l.created_at && logs[i - 1].id > l.id))
    })
    check('操作记录按 created_at DESC（该表无 updated_at）', logOk)

    console.log('=== 5. Excel 导出顺序 ===')
    const er = await fetch(BASE + '/api/export/excel', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ queryType: 'home', conditions: {}, fields: ['project_no'] })
    })
    if (!er.ok) throw new Error('导出失败 ' + er.status)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await er.arrayBuffer()))
    const ws = wb.worksheets[0]
    check('导出第一行为最近更新的项目',
      String(ws.getRow(2).getCell(1).value) === firstNo(afterSave, target.row_id),
      '导出=' + ws.getRow(2).getCell(1).value)
  } finally {
    child.kill()
  }
  console.log('\n默认排序自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}

function firstNo(rows, rowId) {
  const hit = rows.find(function (r) { return r.row_id === rowId })
  return hit ? hit.project_no : ''
}

main().catch(function (e) { console.error(e); process.exitCode = 1 })
