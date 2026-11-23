/**
 * 操作记录权限与下拉全集测试：管理员/普通用户/访客三视角。
 * 验证：删除项目固定出现、系统设置末位、普通用户看不到系统记录（含直接调接口绕过前端）。
 * 运行：node _test/scripts/test-oplog-permission.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-oplogperm-test.db')
const BASE = 'http://127.0.0.1:3127'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}
async function api(p, opt, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(BASE + p, Object.assign({ headers }, opt))
  let data = {}
  try { data = await res.json() } catch (e) {}
  return { status: res.status, data }
}
async function login(u, p) {
  return (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })).data
}

async function main() {
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true }); await src.backup(TEST_DB); src.close()
  const db = new Database(TEST_DB)
  // 确保有普通用户
  const u = db.prepare("SELECT id FROM users WHERE username='perm_user'").get()
  if (!u) {
    const bcrypt = require('bcryptjs')
    db.prepare("INSERT INTO users (username,password_hash,role,pwd_version,created_at,updated_at) VALUES (?,?,?,0,?,?)")
      .run('perm_user', bcrypt.hashSync('pass123', 10), 'user', '2026-01-01 00:00:00', '2026-01-01 00:00:00')
  }
  db.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3127', HOST: '127.0.0.1' }), stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    const t0 = Date.now()
    while (Date.now() - t0 < 15000) { try { if ((await fetch(BASE + '/api/projects')).ok) break } catch (e) {} await sleep(150) }
    const adminToken = (await login('admin', 'admin123')).data.token
    const userToken = (await login('perm_user', 'pass123')).data.token

    console.log('=== 管理员视角 ===')
    const aTypes = await api('/api/operation-logs/types', {}, adminToken)
    check('管理员下拉含删除项目', aTypes.data.data.includes('删除项目'), JSON.stringify(aTypes.data.data))
    check('系统设置在末位', aTypes.data.data[aTypes.data.data.length - 1] === '系统设置', JSON.stringify(aTypes.data.data))
    const aAll = await api('/api/operation-logs', {}, adminToken)
    const aSys = aAll.data.data.filter(r => r.op_type === '系统设置').length
    check('管理员能看到系统设置记录', aSys > 0, String(aSys))
    const aFilter = await api('/api/operation-logs?type=' + encodeURIComponent('系统设置'), {}, adminToken)
    check('管理员可筛系统设置', aFilter.data.data.length === aSys, String(aFilter.data.data.length) + ' / ' + aSys)

    console.log('\n=== 普通用户视角 ===')
    const uTypes = await api('/api/operation-logs/types', {}, userToken)
    check('普通用户下拉无系统设置', !uTypes.data.data.includes('系统设置'), JSON.stringify(uTypes.data.data))
    check('普通用户下拉含删除项目', uTypes.data.data.includes('删除项目'), JSON.stringify(uTypes.data.data))
    const uAll = await api('/api/operation-logs', {}, userToken)
    const uSys = uAll.data.data.filter(r => r.op_type === '系统设置').length
    check('普通用户看不到系统设置记录', uSys === 0, String(uSys))
    check('普通用户仍能看到项目记录', uAll.data.data.length > 0 && uAll.data.data.every(r => r.op_type !== '系统设置'),
      String(uAll.data.data.length))
    // 绕过前端：直接按系统设置筛选也应为空
    const uFilter = await api('/api/operation-logs?type=' + encodeURIComponent('系统设置'), {}, userToken)
    check('普通用户直接筛系统设置为空', uFilter.data.data.length === 0, String(uFilter.data.data.length))

    console.log('\n=== 访客视角（无 Token）===')
    const gTypes = await api('/api/operation-logs/types')
    check('访客下拉无系统设置', !gTypes.data.data.includes('系统设置'), JSON.stringify(gTypes.data.data))
    const gAll = await api('/api/operation-logs')
    check('访客看不到系统设置记录', gAll.data.data.every(r => r.op_type !== '系统设置'))

    console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
  } finally {
    child.kill('SIGTERM')
    ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  }
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
