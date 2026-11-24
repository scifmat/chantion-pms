/**
 * 操作记录扩展自测（阶段 B/C）：
 *  - 档案编辑 / 删除 -> 档案维护
 *  - 用户自主改密   -> 账号安全（仅管理员可见）
 *  - Excel 导出     -> 数据导出（仅管理员可见）
 *  - 下拉类型与权限过滤联动
 * 运行：node _test/scripts/test-operation-log-expansion.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-oplog-expansion-test.db')
const BASE = 'http://127.0.0.1:3120'

const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function api(urlPath, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {})
  const res = await fetch(BASE + urlPath, { method: options.method || 'GET', headers, body: options.body })
  let json = {}
  try { json = await res.json() } catch (e) {}
  return { status: res.status, data: json, headers: res.headers }
}
function auth(token) { return { Authorization: 'Bearer ' + token } }
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { if ((await api('/api/projects')).status === 200) return } catch (e) {}
    await sleep(150)
  }
  throw new Error('后端启动超时')
}

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3120', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const adminLogin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const adminToken = adminLogin.data.data.token
    check('管理员登录', !!adminToken, JSON.stringify(adminLogin.data))

    console.log('\n[A] 操作类型下拉')
    const adminTypes = (await api('/api/operation-logs/types', { headers: auth(adminToken) })).data.data
    check('管理员下拉含档案维护', adminTypes.includes('档案维护'), JSON.stringify(adminTypes))
    check('管理员下拉含账号安全/数据导出',
      adminTypes.includes('账号安全') && adminTypes.includes('数据导出'), JSON.stringify(adminTypes))

    console.log('\n[B] 档案编辑与删除 -> 档案维护')
    const buyers = (await api('/api/archives?type=buyer')).data.data
    const target = buyers.find(b => b.name === '采购单位建档测试') || buyers[0]
    const newName = '采购单位操作记录测试-' + Date.now()
    const put = await api('/api/archives/buyer/' + target.id, {
      method: 'PUT', headers: auth(adminToken), body: JSON.stringify({ name: newName })
    })
    check('档案改名成功', put.status === 200, JSON.stringify(put.data))
    const editLogs = (await api('/api/operation-logs?type=' + encodeURIComponent('档案维护') + '&no=archive_buyer', { headers: auth(adminToken) })).data.data
    check('生成档案维护日志（改名）',
      editLogs.some(l => l.summary.includes('档案改名') && l.summary.includes(target.name) && l.summary.includes(newName)),
      JSON.stringify(editLogs.map(l => l.summary)))

    const tdb = new Database(TEST_DB)
    tdb.prepare('INSERT INTO buyers (name,name_norm,phone,email,address,source_project_no,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('零引用删除测试单位', '零引用删除测试单位', '', '', '', 'TEST-OPLOG', '2026-01-01 00:00:00', '2026-01-01 00:00:00')
    const zeroId = tdb.prepare('SELECT id FROM buyers WHERE name_norm=?').get('零引用删除测试单位').id
    tdb.close()
    const del = await api('/api/archives/buyer/' + zeroId, { method: 'DELETE', headers: auth(adminToken) })
    check('零引用档案删除成功', del.status === 200 && del.data.data.deleted === true, JSON.stringify(del.data))
    const delLogs = (await api('/api/operation-logs?type=' + encodeURIComponent('档案维护') + '&no=archive_buyer', { headers: auth(adminToken) })).data.data
    check('生成档案维护日志（删除）', delLogs.some(l => l.summary.includes('移入回收站') && l.summary.includes('零引用删除测试单位')),
      JSON.stringify(delLogs.map(l => l.summary)))

    console.log('\n[C] 数据导出 -> 数据导出')
    const exp = await api('/api/export/excel', {
      method: 'POST', headers: auth(adminToken),
      body: JSON.stringify({ queryType: 'advanced', fields: ['project_no'], conditions: {} })
    })
    check('导出接口返回 200', exp.status === 200, String(exp.status))
    const exportRows = exp.headers.get('x-export-rows')
    const expLogs = (await api('/api/operation-logs?type=' + encodeURIComponent('数据导出'), { headers: auth(adminToken) })).data.data
    check('生成数据导出日志',
      expLogs.some(l => l.summary.includes('高级查询') && l.summary.includes('1 个字段') && l.summary.includes(exportRows + ' 行')),
      JSON.stringify(expLogs.map(l => l.summary)) + ' rows=' + exportRows)

    console.log('\n[D] 用户自主改密 -> 账号安全')
    const username = 'oplog_user_' + Date.now()
    const created = await api('/api/users', {
      method: 'POST', headers: auth(adminToken),
      body: JSON.stringify({ username: username, password: 'pass123', role: 'user' })
    })
    check('创建普通用户', created.status === 201, JSON.stringify(created.data))
    const userLogin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: username, password: 'pass123' })
    })
    const userToken = userLogin.data.data.token
    check('普通用户登录', !!userToken, JSON.stringify(userLogin.data))
    const changed = await api('/api/auth/change-password', {
      method: 'POST', headers: auth(userToken),
      body: JSON.stringify({ oldPassword: 'pass123', newPassword: 'pass456' })
    })
    check('用户修改本人密码成功', changed.status === 200, JSON.stringify(changed.data))
    const secLogs = (await api('/api/operation-logs?type=' + encodeURIComponent('账号安全'), { headers: auth(adminToken) })).data.data
    check('生成账号安全日志', secLogs.some(l => l.summary === '用户修改本人密码' && l.operator === username),
      JSON.stringify(secLogs.map(l => l.summary + '@' + l.operator)))

    console.log('\n[E] 权限过滤与下拉')
    const userAll = (await api('/api/operation-logs', { headers: auth(userToken) })).data.data
    check('普通用户看不到账号安全', !userAll.some(l => l.op_type === '账号安全'))
    check('普通用户看不到数据导出', !userAll.some(l => l.op_type === '数据导出'))
    check('普通用户仍能看到系统设置之外记录', userAll.some(l => l.op_type === '档案维护'))
    const userTypes = (await api('/api/operation-logs/types', { headers: auth(userToken) })).data.data
    check('普通用户下拉含档案维护', userTypes.includes('档案维护'), JSON.stringify(userTypes))
    check('普通用户下拉不含隐藏类型',
      !userTypes.includes('账号安全') && !userTypes.includes('数据导出') && !userTypes.includes('系统设置'),
      JSON.stringify(userTypes))

    const relogin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: username, password: 'pass456' })
    })
    check('改密后新密码可登录', relogin.status === 200, JSON.stringify(relogin.data))
  } finally {
    child.kill()
  }
  console.log('\n操作记录扩展自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
