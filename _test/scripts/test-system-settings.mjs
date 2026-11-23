/**
 * 第 16 步：系统配置 + 唯一本企业 + 权限 自测（DB 副本，不碰开发库）。
 * 运行：node _test/scripts/test-system-settings.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-system-test.db')
const BASE = 'http://127.0.0.1:3132'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' → ' + detail : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
let TOKEN = ''
async function api(method, p, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let data = {}; try { data = await res.json() } catch (e) {}
  return { status: res.status, data }
}
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { if ((await fetch(BASE + '/api/projects')).ok) return } catch (e) {}
    await sleep(150)
  }
  throw new Error('测试服务启动超时')
}

const cleanup = () => {
  [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
}

async function main() {
  cleanup()
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3132', HOST: '127.0.0.1' }),
    stdio: 'ignore'
  })
  try {
    await waitReady()
    const db = new Database(TEST_DB, { readonly: true })
    console.log('\n[A] 009 迁移与默认值')
    const cols = db.prepare('PRAGMA table_info(competitors)').all().map(c => c.name)
    check('competitors 含 is_self 列', cols.includes('is_self'))
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'").get()
    check('system_settings 表已建立', !!tbl)
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_competitors_self'").get()
    check('唯一本企业索引已建立', !!idx)
    const cnt = db.prepare('SELECT COUNT(*) n FROM competitors WHERE is_self=1').get().n
    check('is_self 标记数量不超过 1', cnt <= 1, 'count=' + cnt)
    db.close()

    console.log('\n[B] 接口权限')
    const anon = await api('GET', '/api/system/settings')
    check('GET /api/system/settings 公开可读', anon.status === 200 && !!anon.data.data.systemName, JSON.stringify(anon.data))
    const noToken = await api('PUT', '/api/system/settings', { systemName: 'X' })
    check('未登录 PUT 被 401 拦截', noToken.status === 401, JSON.stringify(noToken.data))
    const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })
    TOKEN = (login.data && login.data.data && login.data.data.token) || ''
    check('管理员登录成功', !!TOKEN, JSON.stringify(login.data))

    const db2 = new Database(TEST_DB, { readonly: true })
    const comps = db2.prepare('SELECT id, name FROM competitors ORDER BY id LIMIT 2').all()
    db2.close()
    check('库内有至少两家 competitor', comps.length >= 2, JSON.stringify(comps))
    const id1 = comps[0].id, id2 = comps[1].id

    console.log('\n[C] 设置保存 + 唯一约束')
    const s1 = await api('PUT', '/api/system/settings', { systemName: '测试系统A', selfCompetitorId: id1 })
    check('保存系统名称与所属企业成功', s1.status === 200 && s1.data.data.systemName === '测试系统A', JSON.stringify(s1.data))
    check('企业名称从 competitor 派生', s1.data.data.selfCompetitorName === comps[0].name, JSON.stringify(s1.data.data))
    const db3 = new Database(TEST_DB, { readonly: true })
    check('第一家已标记 is_self=1', db3.prepare('SELECT is_self FROM competitors WHERE id=?').get(id1).is_self === 1)
    db3.close()

    const s2 = await api('PUT', '/api/system/settings', { systemName: '测试系统A', selfCompetitorId: id2 })
    check('切换本企业成功', s2.status === 200 && s2.data.data.selfCompetitorId === id2, JSON.stringify(s2.data))
    const db4 = new Database(TEST_DB, { readonly: true })
    check('旧本企业已清零', db4.prepare('SELECT is_self FROM competitors WHERE id=?').get(id1).is_self === 0)
    check('全局仅一条 is_self=1', db4.prepare('SELECT COUNT(*) n FROM competitors WHERE is_self=1').get().n === 1)
    let uniqueBlocked = false
    try { db4.prepare('UPDATE competitors SET is_self=1 WHERE id=?').run(id1) } catch (e) { uniqueBlocked = true }
    check('数据库层唯一索引阻止第二条', uniqueBlocked)
    db4.close()

    const bad = await api('PUT', '/api/system/settings', { systemName: 'X', selfCompetitorId: 99999999 })
    check('不存在的所属企业返回 400', bad.status === 400, JSON.stringify(bad.data))
    const empty = await api('PUT', '/api/system/settings', { systemName: '   ', selfCompetitorId: 0 })
    check('空系统名称返回 400', empty.status === 400, JSON.stringify(empty.data))
    const after = await api('GET', '/api/system/settings')
    check('失败请求不改动已有设置', after.data.data.systemName === '测试系统A' && after.data.data.selfCompetitorId === id2, JSON.stringify(after.data.data))

    console.log('\n[D] 档案列表 / 看板统计不受影响')
    const list = await api('GET', '/api/archives?type=competitor')
    const row2 = list.data.data.find(x => x.id === id2)
    check('档案列表返回 is_self', !!row2 && row2.is_self === 1, JSON.stringify(row2 && { id: row2.id, is_self: row2.is_self }))
    const st1 = await api('GET', '/api/archives/competitor/' + id2 + '/stats')
    const before = JSON.stringify(st1.data.data.summary)
    const s3 = await api('PUT', '/api/system/settings', { systemName: '测试系统B', selfCompetitorId: 0 })
    check('可取消本企业设置', s3.status === 200 && s3.data.data.selfCompetitorId === 0, JSON.stringify(s3.data))
    const st2 = await api('GET', '/api/archives/competitor/' + id2 + '/stats')
    check('本企业标记不改动看板统计', JSON.stringify(st2.data.data.summary) === before)
    const db5 = new Database(TEST_DB, { readonly: true })
    check('取消后全部 is_self=0', db5.prepare('SELECT COUNT(*) n FROM competitors WHERE is_self=1').get().n === 0)
    const log = db5.prepare("SELECT COUNT(*) n FROM operation_logs WHERE op_type='系统设置'").get().n
    check('配置变更写入操作记录', log >= 3, 'logs=' + log)
    db5.close()

    console.log('\n[E] Logo 上传 / 恢复 / 权限')
    const noLogo = await api('GET', '/api/system/logo')
    check('未设置 Logo 时 GET 返回 404', noLogo.status === 404)
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const badLogo = await api('PUT', '/api/system/logo', { dataUrl: 'data:text/plain;base64,AAAA' })
    check('非图片 Logo 返回 400', badLogo.status === 400, JSON.stringify(badLogo.data))
    TOKEN = ''
    const logo401 = await api('PUT', '/api/system/logo', { dataUrl: png })
    check('未登录上传 Logo 返回 401', logo401.status === 401)
    TOKEN = (login.data && login.data.data && login.data.data.token) || ''
    // 模拟用户真实 logo1.png（170KB）：base64 后超过 Express 默认 100KB 限制，必须能正常上传
    const bigBuf = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200 * 1024, 7)])
    const bigLogo = 'data:image/png;base64,' + bigBuf.toString('base64')
    const up = await api('PUT', '/api/system/logo', { dataUrl: bigLogo })
    check('管理员上传大尺寸 Logo 成功（>100KB）', up.status === 200 && up.data.data.hasCustomLogo === true, JSON.stringify(up.data))
    const logoRes = await fetch(BASE + '/api/system/logo')
    check('Logo 可被公开读取', logoRes.status === 200 && String(logoRes.headers.get('content-type')).includes('image/png'))
    const afterUp = await api('GET', '/api/system/settings')
    check('设置接口返回 Logo 版本', !!afterUp.data.data.hasCustomLogo && afterUp.data.data.logoVersion !== '0', JSON.stringify(afterUp.data.data))
    const del = await api('DELETE', '/api/system/logo')
    check('恢复默认 Logo 成功', del.status === 200 && del.data.data.hasCustomLogo === false, JSON.stringify(del.data))
    check('恢复后 Logo 接口 404', (await fetch(BASE + '/api/system/logo')).status === 404)

    console.log('\n[F] 系统管理操作留痕')
    const cfg = await api('GET', '/api/config/options')
    const statusItems = (cfg.data.data.detail && cfg.data.data.detail.status) || []
    const cfgPut = await api('PUT', '/api/config/options/status', { items: statusItems })
    check('业务配置保存成功', cfgPut.status === 200, JSON.stringify(cfgPut.data && cfgPut.data.message))
    const newUser = await api('POST', '/api/users', { username: 'sys_log_test', password: 'pass123', role: 'user' })
    check('测试用户创建成功', newUser.status === 201, JSON.stringify(newUser.data))
    if (newUser.status === 201) await api('DELETE', '/api/users/' + newUser.data.data.id)
    const db6 = new Database(TEST_DB, { readonly: true })
    const logs = db6.prepare("SELECT project_no, COUNT(*) n FROM operation_logs WHERE op_type='系统设置' GROUP BY project_no").all()
    const byNo = Object.fromEntries(logs.map(x => [x.project_no, x.n]))
    check('业务配置有留痕', (byNo.system_config || 0) >= 1, JSON.stringify(byNo))
    check('用户管理有留痕', (byNo.system_user || 0) >= 2, JSON.stringify(byNo))
    check('Logo 操作有留痕', (byNo.system_logo || 0) >= 2, JSON.stringify(byNo))
    db6.close()
  } finally {
    child.kill('SIGTERM')
    await sleep(500)
    cleanup()
  }
  console.log('\n  结果：PASS = ' + pass + '  FAIL = ' + fail)
  if (fail > 0) process.exitCode = 1
}
main().catch(e => { console.error(e); process.exitCode = 1 })
