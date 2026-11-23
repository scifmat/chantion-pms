/**
 * 代理机构四大情报模块自测（第 12 步）。
 * DB 副本 + 独立端口；副本注入 leader=true 组长评委验证人脉模块。
 * 运行：node _test/scripts/test-agency-intel.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-agency-test.db')
const BASE = 'http://127.0.0.1:3115'
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

  // 副本注入：给某代理机构的项目加固定组长评委，验证 leader=true 过滤与去重
  const seed = new Database(TEST_DB)
  // 动态选一个在 DEMO 项目里用到的代理机构（避免假设某名称一定建档）
  const targetName = seed.prepare("SELECT agency_name FROM projects WHERE project_no LIKE 'DEMO-%' AND deleted=0 GROUP BY agency_name ORDER BY COUNT(*) DESC LIMIT 1").get().agency_name
  const { normName } = serverRequire(path.join(SERVER, 'archive.js'))
  const target = seed.prepare('SELECT id,name FROM agencies WHERE name_norm=?').get(normName(targetName))
  const rows = seed.prepare('SELECT row_id,detail FROM projects WHERE agency_name=? AND deleted=0').all(targetName)
  const upd = seed.prepare('UPDATE projects SET detail=? WHERE row_id=?')
  rows.slice(0, 4).forEach(function (r, i) {
    let d = {}; try { d = JSON.parse(r.detail || '{}') } catch (e) {}
    if (!d.completed) d.completed = {}
    d.completed.judges = [{ name: '金牌组长A', leader: true, owner: false }]
    if (i < 2) d.completed.judges.push({ name: '组长B', leader: true, owner: false })
    d.completed.judges.push({ name: '普通评委X', leader: false, owner: false })
    upd.run(JSON.stringify(d), r.row_id)
  })
  seed.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3115', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const res = await fetch(BASE + '/api/archives/agency/' + target.id + '/stats')
    const data = (await res.json()).data
    const g = function (k) { return data.summary.find(function (x) { return x.key === k; }) }

    console.log('\n[A] 模块一：代理实力与规模')
    check('累计代理项目数为正整数', Number(g('projectCount').value) > 0, JSON.stringify(g('projectCount')))
    check('累计代理中标金额为万元文本', /^\d+\.\d\d$/.test(g('totalAward').value), g('totalAward').value)
    check('平均资金节约率有值', /^\d+\.\d$/.test(g('avgSaving').value), g('avgSaving').value)
    // 流标率 = terminated / projectCount，用兼容项校验一致性
    const pc = Number(g('projectCount').value), tm = Number(g('terminated').value), rate = Number(g('terminateRate').value)
    check('流标/终止率 = 终止数/总数（四舍五入1位）', Math.abs(rate - Math.round(tm * 1000 / pc) / 10) < 0.05, `rate=${rate} tm=${tm} pc=${pc}`)

    console.log('\n[B] 模块二：业务特征与偏好（ECharts 数据）')
    const ec = data.echarts
    check('核心服务采购单位 TOP5 降序且≤5', ec.buyerTop.length > 0 && ec.buyerTop.length <= 5 && ec.buyerTop[0].value >= ec.buyerTop[ec.buyerTop.length - 1].value, JSON.stringify(ec.buyerTop))
    check('采购方式偏好有数据', ec.method.length > 0, JSON.stringify(ec.method))
    check('活动地区分布有数据', ec.region.length > 0, JSON.stringify(ec.region))

    console.log('\n[C] 模块三：竞争格局与人脉情报')
    const rk = data.rankings
    const a = rk.leaderJudges.find(function (x) { return x.name === '金牌组长A' })
    const b = rk.leaderJudges.find(function (x) { return x.name === '组长B' })
    check('常驻组长评委：注入的组长A(4次)/组长B(2次)在榜，普通评委X被过滤',
      !!a && a.value === 4 && !!b && b.value === 2 &&
      !rk.leaderJudges.some(function (x) { return x.name === '普通评委X' }) &&
      rk.leaderJudges.length <= 5,
      JSON.stringify(rk.leaderJudges))
    check('常胜供应商 TOP5 非空且降序', rk.suppliers.length > 0 && rk.suppliers[0].value >= rk.suppliers[rk.suppliers.length - 1].value, JSON.stringify(rk.suppliers))
    check('供应商带企业属性字段', rk.suppliers.every(function (x) { return 'attribute' in x }))

    console.log('\n[D] 模块四：明细表')
    check('明细渲染且角色=代理方', data.projects.length > 0 && data.projects.every(function (p) { return p.role === '代理方' }))

    console.log('\n[E] 兼容性：旧接口字段仍在')
    check('projectCount/totalAward/terminated 三个旧 key 保留', g('projectCount') && g('totalAward') && g('terminated'))

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
