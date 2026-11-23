/**
 * 竞争对手画像看板自测（第 13 步）。
 * DB 副本 + 独立端口；重点验证 XM-2026-002（多包+联合体）的去重、按包金额、
 * 黄金搭档、参与深度，以及「只统计完成招标」的红线。
 * 运行：node _test/scripts/test-competitor-profile.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-profile-test.db')
const BASE = 'http://127.0.0.1:3118'
const serverRequire = createRequire(path.join(SERVER, 'app.js'))
const Database = serverRequire('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { if ((await fetch(BASE + '/api/projects')).ok) return } catch (e) {}
    await new Promise(function (r) { setTimeout(r, 150) })
  }
  throw new Error('服务启动超时')
}

async function main() {
  [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3118', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const db = new Database(TEST_DB, { readonly: true })
    const supplierId = db.prepare("SELECT id FROM competitors WHERE name='供应商单位建档测试'").get().id
    const memberId = db.prepare("SELECT id FROM competitors WHERE name='联合体单位成员001'").get().id

    console.log('\n[A] 模块一：综合实力与战术（XM-001 全包 490万 + XM-002 第1包 9万）')
    const r = await (await fetch(BASE + '/api/archives/competitor/' + supplierId + '/stats')).json()
    const d = r.data
    const g = function (k) { return d.summary.find(function (x) { return x.key === k; }) }
    check('去重中标项目数 = 2', g('projectCount').value === 2, JSON.stringify(d.summary))
    check('按包中标金额 = 499.00 万（非 512 万项目总额）', g('totalAward').value === '499.00', g('totalAward').value)
    check('平均让利/节约率有值', /^\d+\.\d$/.test(g('avgSaving').value), g('avgSaving').value)
    // 两家都只参与联合体 → 独立0 : 联合2
    check('独立 vs 联合体 = 0 : 2', g('roleStyle').value === '0 : 2', g('roleStyle').value)

    console.log('\n[B] 模块二：主战场与舒适区')
    check('项目类型分布有数据', d.echarts.type.length > 0, JSON.stringify(d.echarts.type))
    check('活跃地区 TOP5 ≤5', d.echarts.regionTop.length > 0 && d.echarts.regionTop.length <= 5, JSON.stringify(d.echarts.regionTop))
    check('金额区间四档齐全且计数正确', d.echarts.awardBucket.length === 4 && d.echarts.awardBucket[1].value === 1 && d.echarts.awardBucket[2].value === 1, JSON.stringify(d.echarts.awardBucket))

    console.log('\n[C] 模块三：关系网与人脉情报')
    check('铁杆采购单位 TOP5 = 采购单位建档测试(2)', d.rankings.buyers.length > 0 && d.rankings.buyers[0].name === '采购单位建档测试' && d.rankings.buyers[0].value === 2, JSON.stringify(d.rankings.buyers))
    check('常合作代理 TOP5 有数据', d.rankings.agencies.length > 0, JSON.stringify(d.rankings.agencies))
    check('黄金搭档 = 联合体单位成员001(成员方, 2次)',
      d.rankings.partners.length === 1 && d.rankings.partners[0].name === '联合体单位成员001' &&
      d.rankings.partners[0].role === '成员方' && d.rankings.partners[0].value === 2,
      JSON.stringify(d.rankings.partners))
    // 反向验证：成员001 的黄金搭档应是供应商(牵头方)
    const r2 = await (await fetch(BASE + '/api/archives/competitor/' + memberId + '/stats')).json()
    check('反向黄金搭档 = 供应商单位建档测试(牵头方, 2次)',
      r2.data.rankings.partners.length === 1 && r2.data.rankings.partners[0].name === '供应商单位建档测试' &&
      r2.data.rankings.partners[0].role === '牵头方',
      JSON.stringify(r2.data.rankings.partners))

    console.log('\n[D] 模块四：明细参与深度')
    const full = d.projects.find(function (p) { return p.project_no === 'XM-2026-001' })
    const split = d.projects.find(function (p) { return p.project_no === 'XM-2026-002' })
    check('XM-001 深度 = 全包', full && full.depth === '全包' && full.isSplit === false, JSON.stringify(full))
    check('XM-002 深度 = 分三包测试录入001（具体包号）', split && split.depth.indexOf('分三包测试录入001') >= 0 && split.isSplit === true, JSON.stringify(split))
    check('XM-002 按包金额 = 9.00 万', split && split.awardWan === '9.00', split && split.awardWan)

    console.log('\n[E] 红线：只统计完成招标')
    // 造一条意向公示项目，中标单位填该供应商，不应被计入
    const seed = new Database(TEST_DB)
    seed.prepare("INSERT INTO projects (project_no,project_name,budget_yuan,budget_fen,region,status,winner_names,detail,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run('FAKE-INTENT', '未完成测试', '1000', '100000000', '北京市', '意向公示', '供应商单位建档测试',
        JSON.stringify({ completed: { winner: { lead: '供应商单位建档测试', members: [''], isUnion: false } } }), '2026-01-01', '2026-01-01')
    seed.close()
    const after = await (await fetch(BASE + '/api/archives/competitor/' + supplierId + '/stats')).json()
    check('新增未完成项目后，中标数仍为 2（未被计入）', after.data.summary.find(function (x) { return x.key === 'projectCount'; }).value === 2, JSON.stringify(after.data.summary))
    db.close()
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
