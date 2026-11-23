/**
 * 参与项目数据看板自测（第 10 步）。
 * DB 副本 + 独立后端（127.0.0.1:3106），重点验证 XM-2026-002（多包+联合体）的去重与按包金额。
 * 运行：node _test/scripts/test-stats.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-stats-test.db')
const BASE = 'http://127.0.0.1:3106'
const serverRequire = createRequire(path.join(SERVER, 'app.js'))
const Database = serverRequire('better-sqlite3')
const { ensureSeedProject } = await import('./ensure-seed.mjs')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}
async function api(urlPath) {
  const res = await fetch(BASE + urlPath)
  let data = {}; try { data = await res.json() } catch (e) { data = {} }
  return { status: res.status, data }
}
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { if ((await fetch(BASE + '/api/projects')).ok) return } catch (e) {}
    await new Promise(function (r) { setTimeout(r, 150) })
  }
  throw new Error('测试服务启动超时')
}

async function main() {
  [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()
  ensureSeedProject(Database, TEST_DB)   // 副本里恢复可能被软删的 XM-2026-002（不动真实库）

  const ids = new Database(TEST_DB)
  const buyerId = ids.prepare("SELECT id FROM buyers WHERE name='采购单位建档测试'").get().id
  const agencyId = ids.prepare("SELECT id FROM agencies WHERE name='代理机构建档测试'").get().id
  const supplierId = ids.prepare("SELECT id FROM competitors WHERE name='供应商单位建档测试'").get().id
  const memberId = ids.prepare("SELECT id FROM competitors WHERE name='联合体单位成员001'").get().id
  const pkg2Id = ids.prepare("SELECT id FROM competitors WHERE name='分三包测试录入第二包中标单位'").get().id
  ids.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3106', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()

    console.log('\n[A] 采购单位看板：采购单位建档测试（XM-001 + XM-002）')
    const buyer = await api('/api/archives/buyer/' + buyerId + '/stats')
    check('接口 200', buyer.status === 200, JSON.stringify(buyer.data).slice(0, 200))
    const bSum = buyer.data.data.summary
    const g = function (k) { return bSum.find(function (x) { return x.key === k }) }
    check('总招标项目数 = 2', g('projectCount').value === 2, JSON.stringify(bSum))
    check('总预算 = 750.00 万元', g('totalBudget').value === '750.00', g('totalBudget').value)
    check('总中标 = 512.00 万元（490+22）', g('totalAward').value === '512.00', g('totalAward').value)
    check('平均节约率 = 46.6%', g('avgSaving').value === '46.6', g('avgSaving').value)
    check('明细去重 = 2 条', buyer.data.data.projects.length === 2)

    console.log('\n[B] 代理机构看板：代理机构建档测试')
    const agency = await api('/api/archives/agency/' + agencyId + '/stats')
    check('接口 200', agency.status === 200)
    const ag = agency.data.data.summary
    const ag2 = function (k) { return ag.find(function (x) { return x.key === k }) }
    check('总代理项目数 = 2', ag2('projectCount').value === 2, JSON.stringify(ag))
    check('总中标 = 512.00 万元', ag2('totalAward').value === '512.00', ag2('totalAward').value)
    check('终止/流标 = 0', ag2('terminated').value === 0)

    console.log('\n[C] 竞争对手看板核心：XM-2026-002 多包 + 联合体')
    // 供应商单位建档测试：XM-001 牵头全额 490 万 + XM-002 仅第1包牵头 9 万 = 499 万，去重 2 项
    const sup = await api('/api/archives/competitor/' + supplierId + '/stats')
    check('接口 200', sup.status === 200)
    const ss = sup.data.data.summary
    const sg = function (k) { return ss.find(function (x) { return x.key === k }) }
    check('去重累计中标项目数 = 2', sg('projectCount').value === 2, JSON.stringify(ss))
    check('按包累计中标金额 = 499.00 万（490+9，非 490+22）', sg('totalAward').value === '499.00', sg('totalAward').value)
    check('牵头/成员次数 = 2 : 0', sg('leadRatio').value === '2 : 0', sg('leadRatio').value)
    const sup002 = sup.data.data.projects.find(function (p) { return p.project_no === 'XM-2026-002' })
    check('XM-002 参与中标额 = 9.00 万（仅第1包）', sup002 && sup002.awardWan === '9.00', JSON.stringify(sup002))
    check('XM-002 角色 = 牵头方', sup002 && sup002.role === '牵头方', sup002 && sup002.role)

    // 联合体单位成员001：XM-001 成员 490 万 + XM-002 第1包成员 9 万 = 499 万，去重 2 项
    const mem = await api('/api/archives/competitor/' + memberId + '/stats')
    const ms = mem.data.data.summary
    const mg = function (k) { return ms.find(function (x) { return x.key === k }) }
    check('成员方去重项目数 = 2', mg('projectCount').value === 2, JSON.stringify(ms))
    check('成员方按包金额 = 499.00 万', mg('totalAward').value === '499.00', mg('totalAward').value)
    check('牵头/成员次数 = 0 : 2', mg('leadRatio').value === '0 : 2', mg('leadRatio').value)
    const mem002 = mem.data.data.projects.find(function (p) { return p.project_no === 'XM-2026-002' })
    check('XM-002 角色 = 联合体成员', mem002 && mem002.role === '联合体成员', mem002 && mem002.role)

    // 第二包中标单位：只在 XM-002 第2包牵头 9 万，去重 1 项
    const p2 = await api('/api/archives/competitor/' + pkg2Id + '/stats')
    const p2s = p2.data.data.summary
    const p2g = function (k) { return p2s.find(function (x) { return x.key === k }) }
    check('第2包单位去重项目数 = 1', p2g('projectCount').value === 1, JSON.stringify(p2s))
    check('第2包单位按包金额 = 9.00 万', p2g('totalAward').value === '9.00', p2g('totalAward').value)

    console.log('\n[D] 分布图表与去重一致性')
    check('竞争对手类型分布存在', sup.data.data.charts.some(function (c) { return c.key === 'type' && c.items.length > 0 }))
    check('竞争对手地区分布存在', sup.data.data.charts.some(function (c) { return c.key === 'region' && c.items.length > 0 }))
    check('牵头/成员比例 = 100% 牵头', (function () {
      const c = sup.data.data.charts.find(function (x) { return x.key === 'role' })
      return c && c.items[0].pct === 100
    })())

    console.log('\n[E] 权限与边界')
    check('看板 GET 无需登录（访客可读）', buyer.status === 200)
    check('无效类型返回 400', (await api('/api/archives/bad/' + buyerId + '/stats')).status === 400)
    check('不存在的档案返回 404', (await api('/api/archives/buyer/99999/stats')).status === 404)

  } finally {
    child.kill('SIGTERM')
    await new Promise(function (r) { child.once('exit', r); setTimeout(r, 2000) })
    ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) { try { fs.unlinkSync(f) } catch (e) {} })
  }
  console.log('\n========================================')
  console.log('  PASS: ' + pass + '   FAIL: ' + fail)
  console.log('========================================')
  if (fail > 0) process.exitCode = 1
}
main().catch(function (e) { console.error('测试异常:', e); process.exitCode = 1 })
