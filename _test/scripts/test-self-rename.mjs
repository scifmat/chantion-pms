/**
 * 本企业改名自测：
 *  竞争对手改名后，project_winners 与全局缓存同步刷新，「本企业战力卡」保持有效。
 * 运行：node _test/scripts/test-self-rename.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-self-rename-test.db')
const BASE = 'http://127.0.0.1:3123'
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

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3123', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const admin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const token = admin.data.data.token
    check('管理员登录', !!token, JSON.stringify(admin.data))

    const settings = (await api('/api/system/settings')).data.data
    const selfId = Number(settings.selfCompetitorId)
    check('已设置本企业', selfId > 0, JSON.stringify(settings))
    const competitors = (await api('/api/archives?type=competitor')).data.data
    const selfRow = competitors.find(function (r) { return r.id === selfId })
    check('本企业档案存在', !!selfRow, JSON.stringify(selfRow))
    if (!selfRow) return

    const before = (await api('/api/global/stats', { headers: auth(token) })).data.data
    check('改名前战力卡有效', !!before.self.configured && before.self.projectCount > 0,
      JSON.stringify(before.self))

    const newName = selfRow.name + '-改名' + Date.now()
    const put = await api('/api/archives/competitor/' + selfId, {
      method: 'PUT', headers: auth(token),
      body: JSON.stringify({
        name: newName,
        attribute: selfRow.attribute || '',
        phone: selfRow.phone || '',
        email: selfRow.email || '',
        address: selfRow.address || ''
      })
    })
    check('本企业改名成功', put.status === 200 && put.data.data.renamed === true, JSON.stringify(put.data))

    const after = (await api('/api/global/stats', { headers: auth(token) })).data.data
    check('改名后战力卡仍有效（缓存已刷新）', !!after.self.configured && after.self.name === newName,
      JSON.stringify(after.self))
    check('改名后仍有中标项目', after.self.projectCount > 0, JSON.stringify(after.self))

    const db = new Database(TEST_DB, { readonly: true })
    const rows = db.prepare('SELECT winner_name, winner_norm FROM project_winners WHERE winner_norm = ?').all(newName)
    db.close()
    check('project_winners 已同步新名称', rows.length > 0, JSON.stringify(rows.slice(0, 3)))

    const settingsAfter = (await api('/api/system/settings')).data.data
    check('本企业 ID 未变化', Number(settingsAfter.selfCompetitorId) === selfId, JSON.stringify(settingsAfter))
  } finally {
    child.kill()
  }
  console.log('\n本企业改名自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
