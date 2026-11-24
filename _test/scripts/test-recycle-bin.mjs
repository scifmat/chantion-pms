/**
 * 回收站与删除机制自测（011）：
 *  档案建档 -> 删除 -> 回收站 -> 恢复 -> 列表重现
 *  项目新建 -> 删除 -> 回收站恢复 -> 详情可打开 -> 彻底删除
 *  被引用档案删除拦截 -> 无引用档案删除 -> 彻底删除
 *  本企业竞争对手彻底删除拦截
 *  4 类回收站操作日志与权限
 * 运行：node _test/scripts/test-recycle-bin.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-recycle-test.db')
const BASE = 'http://127.0.0.1:3121'
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
  return { status: res.status, data: json }
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
function insertArchive(table, name) {
  const db = new Database(TEST_DB)
  const now = '2026-01-01 00:00:00'
  const info = db.prepare('INSERT INTO ' + table +
    ' (name,name_norm,attribute,phone,email,address,source_project_no,created_at,updated_at,deleted,deleted_at,original_name)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,0,?,?)')
    .run(name, name, '', '', '', '', 'TEST-RECYCLE', now, now, '', '')
  db.close()
  return Number(info.lastInsertRowid)
}

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3121', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const admin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const adminToken = admin.data.data.token
    check('管理员登录', !!adminToken, JSON.stringify(admin.data))

    console.log('\n[A] 档案：建档 -> 删除 -> 回收站 -> 恢复')
    const buyerName = '回收站测试采购单位-' + Date.now()
    const buyerId = insertArchive('buyers', buyerName)
    let active = (await api('/api/archives?type=buyer')).data.data
    check('建档后列表可见', active.some(r => r.id === buyerId && r.name === buyerName))
    const del = await api('/api/archives/buyer/' + buyerId, { method: 'DELETE', headers: auth(adminToken) })
    check('无引用档案删除成功（移入回收站）', del.status === 200 && del.data.data.recycled === true, JSON.stringify(del.data))
    active = (await api('/api/archives?type=buyer')).data.data
    check('删除后正常列表不可见', !active.some(r => r.id === buyerId))
    let recycled = (await api('/api/recycle?type=buyer&q=' + encodeURIComponent(buyerName), { headers: auth(adminToken) })).data.data
    check('回收站可见该档案', recycled.some(r => r.id === buyerId && r.name === buyerName), JSON.stringify(recycled))
    const rest = await api('/api/recycle/buyer/' + buyerId + '/restore', { method: 'POST', headers: auth(adminToken) })
    check('档案恢复成功', rest.status === 200, JSON.stringify(rest.data))
    active = (await api('/api/archives?type=buyer')).data.data
    check('恢复后列表重新出现', active.some(r => r.id === buyerId && r.name === buyerName))

    console.log('\n[B] 引用拦截与彻底删除')
    const referenced = (await api('/api/archives?type=buyer')).data.data.find(r => r.refCount > 0)
    check('找到被引用档案', !!referenced, referenced && referenced.name)
    const blocked = await api('/api/archives/buyer/' + referenced.id, { method: 'DELETE', headers: auth(adminToken) })
    check('被引用档案删除被拦截', blocked.status === 409, JSON.stringify(blocked.data))

    const del2 = await api('/api/archives/buyer/' + buyerId, { method: 'DELETE', headers: auth(adminToken) })
    check('再次移入回收站', del2.status === 200, JSON.stringify(del2.data))
    const purge = await api('/api/recycle/buyer/' + buyerId, { method: 'DELETE', headers: auth(adminToken) })
    check('档案彻底删除成功', purge.status === 200 && purge.data.data.purged === true, JSON.stringify(purge.data))
    const tdb = new Database(TEST_DB, { readonly: true })
    check('档案物理行已不存在', !tdb.prepare('SELECT id FROM buyers WHERE id=?').get(buyerId))
    tdb.close()

    console.log('\n[C] 本企业保护')
    const competitorName = '回收站本企业测试-' + Date.now()
    const compId = insertArchive('competitors', competitorName)
    const cdb = new Database(TEST_DB)
    cdb.prepare("UPDATE system_settings SET value = ? WHERE key = 'self_competitor_id'").run(String(compId))
    cdb.close()
    await api('/api/archives/competitor/' + compId, { method: 'DELETE', headers: auth(adminToken) })
    const selfBlocked = await api('/api/recycle/competitor/' + compId, { method: 'DELETE', headers: auth(adminToken) })
    check('本企业档案彻底删除被拦截', selfBlocked.status === 409 && /本企业/.test(selfBlocked.data.message), JSON.stringify(selfBlocked.data))
    const cdb2 = new Database(TEST_DB)
    cdb2.prepare("UPDATE system_settings SET value = '' WHERE key = 'self_competitor_id'").run()
    cdb2.close()
    const compPurge = await api('/api/recycle/competitor/' + compId, { method: 'DELETE', headers: auth(adminToken) })
    check('取消本企业后可彻底删除', compPurge.status === 200, JSON.stringify(compPurge.data))

    console.log('\n[D] 项目：新建 -> 删除 -> 恢复 -> 详情 -> 彻底删除')
    const base = (await api('/api/projects/1')).data.data
    const detail = JSON.parse(JSON.stringify(base.detail))
    const no = 'RECYCLE-' + Date.now()
    const name = '回收站测试项目-' + Date.now()
    detail.public.project_no = no
    detail.public.project_name = name
    const created = await api('/api/projects', {
      method: 'POST', headers: auth(adminToken), body: JSON.stringify({ detail: detail })
    })
    check('新建项目成功', created.status === 201, JSON.stringify(created.data && created.data.message))
    const pid = created.data.data.row_id
    const delP = await api('/api/projects/' + pid, {
      method: 'DELETE', headers: auth(adminToken), body: JSON.stringify({ version: created.data.data.version })
    })
    check('项目移入回收站', delP.status === 200, JSON.stringify(delP.data))
    let pRecycle = (await api('/api/recycle?type=project&q=' + encodeURIComponent(name), { headers: auth(adminToken) })).data.data
    check('回收站可见该项目', pRecycle.some(r => r.id === pid && r.no === no), JSON.stringify(pRecycle))
    const pRestore = await api('/api/recycle/project/' + pid + '/restore', { method: 'POST', headers: auth(adminToken) })
    check('项目恢复成功', pRestore.status === 200, JSON.stringify(pRestore.data))
    const detailAfter = await api('/api/projects/' + pid, { headers: auth(adminToken) })
    check('恢复后详情可正常打开', detailAfter.status === 200 && detailAfter.data.data.detail.public.project_no === no,
      detailAfter.data && detailAfter.data.message)
    const winners = (await api('/api/global/stats', { headers: auth(adminToken) })).data.data
    check('全局看板缓存刷新后可用', !!winners, JSON.stringify(winners && winners.updated_at))

    const delP2 = await api('/api/projects/' + pid, {
      method: 'DELETE', headers: auth(adminToken), body: JSON.stringify({ version: pRestore.data && created.data.data.version + 2 })
    })
    if (delP2.status !== 200) {
      const fresh = (await api('/api/projects/' + pid, { headers: auth(adminToken) })).data.data
      const delP3 = await api('/api/projects/' + pid, {
        method: 'DELETE', headers: auth(adminToken), body: JSON.stringify({ version: fresh.version })
      })
      check('项目再次移入回收站', delP3.status === 200, JSON.stringify(delP3.data))
    } else {
      check('项目再次移入回收站', true)
    }
    const pPurge = await api('/api/recycle/project/' + pid, { method: 'DELETE', headers: auth(adminToken) })
    check('项目彻底删除成功', pPurge.status === 200, JSON.stringify(pPurge.data))
    const pdb = new Database(TEST_DB, { readonly: true })
    check('项目物理行已不存在', !pdb.prepare('SELECT row_id FROM projects WHERE row_id=?').get(pid))
    check('project_winners 映射已清理', !pdb.prepare('SELECT project_no FROM project_winners WHERE project_no=?').get(no))
    pdb.close()

    console.log('\n[E] 操作记录与权限')
    const logs = (await api('/api/operation-logs', { headers: auth(adminToken) })).data.data
    const types = ['恢复档案', '彻底删除档案', '恢复项目', '彻底删除项目']
    types.forEach(function (t) {
      check('生成操作记录：' + t, logs.some(l => l.op_type === t), JSON.stringify(logs.filter(l => l.op_type === t).map(l => l.summary)))
    })

    const username = 'recycle_user_' + Date.now()
    const createdUser = await api('/api/users', {
      method: 'POST', headers: auth(adminToken),
      body: JSON.stringify({ username: username, password: 'pass123', role: 'user' })
    })
    check('创建普通用户', createdUser.status === 201, JSON.stringify(createdUser.data))
    const userLogin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: username, password: 'pass123' })
    })
    const userToken = userLogin.data.data.token
    const forbidden = await api('/api/recycle/project/999999', { method: 'DELETE', headers: auth(userToken) })
    check('普通用户彻底删除被拒绝', forbidden.status === 403, String(forbidden.status))
  } finally {
    child.kill()
  }
  console.log('\n回收站自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
