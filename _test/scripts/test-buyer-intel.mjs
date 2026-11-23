/**
 * 采购单位四大情报模块自测（第 11 步）。
 * DB 副本 + 独立端口；在副本上给项目注入 owner=true 评委以验证人脉情报模块。
 * 运行：node _test/scripts/test-buyer-intel.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-intel-test.db')
const BASE = 'http://127.0.0.1:3113'
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

  // 副本注入数据：给两个项目塞 owner=true 的业主评委（甲方面孔）
  const seed = new Database(TEST_DB)
  const rows = seed.prepare("SELECT row_id, detail FROM projects WHERE deleted=0 ORDER BY row_id LIMIT 2").all()
  const upd = seed.prepare('UPDATE projects SET detail=? WHERE row_id=?')
  rows.forEach(function (r, i) {
    let d = {}; try { d = JSON.parse(r.detail || '{}') } catch (e) {}
    if (!d.completed) d.completed = {}
    d.completed.judges = d.completed.judges || []
    d.completed.judges.push({ name: '业主评委甲', leader: false, owner: true })
    if (i === 0) d.completed.judges.push({ name: '业主评委乙', leader: false, owner: true })
    if (i === 1) d.completed.judges.push({ name: '业主评委甲', leader: false, owner: true })
    upd.run(JSON.stringify(d), r.row_id)
  })
  const buyerId = seed.prepare("SELECT id FROM buyers WHERE name='采购单位建档测试'").get().id
  seed.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3113', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const res = await fetch(BASE + '/api/archives/buyer/' + buyerId + '/stats')
    const data = (await res.json()).data
    console.log('\n[A] 模块一：核心商业价值总览')
    const s = data.summary
    const g = function (k) { return s.find(function (x) { return x.key === k }) }
    check('累计采购规模 = 750.00 万', g('totalBudget').value === '750.00', JSON.stringify(s))
    check('平均单项目预算 = 375.00 万', g('avgBudget').value === '375.00', g('avgBudget').value)
    check('平均资金节约率 = 46.6%', g('avgSaving').value === '46.6', g('avgSaving').value)
    check('大概率项目类型 = 货物 / 服务', g('topType').value.indexOf('货物') >= 0 && g('topType').value.indexOf('服务') >= 0, g('topType').value)

    console.log('\n[B] 模块二：采购偏好分布（ECharts 数据）')
    const ec = data.echarts
    check('预算区间四档齐全', ec.budgetBucket.length === 4 && ec.budgetBucket.map(function (x) { return x.name; }).join(',') === '100万以下,100-500万,500-1000万,1000万以上', JSON.stringify(ec.budgetBucket))
    check('预算区间计数正确（100-500万:1 / 500-1000万:1）', ec.budgetBucket[1].value === 1 && ec.budgetBucket[2].value === 1, JSON.stringify(ec.budgetBucket))
    check('采购方式分布 = 公开招标2', ec.method.some(function (x) { return x.name === '公开招标' && x.value === 2 }), JSON.stringify(ec.method))
    check('活跃月份 12 个月齐全', ec.month.length === 12, String(ec.month.length))
    check('11月发标 2 个', ec.month.find(function (x) { return x.month === 11; }).value === 2, JSON.stringify(ec.month.filter(function (x) { return x.value > 0; })))

    console.log('\n[C] 模块三：竞争格局与人脉情报')
    const rk = data.rankings
    check('常胜供应商 TOP5 非空且按次数降序', rk.suppliers.length > 0 && rk.suppliers[0].value >= rk.suppliers[rk.suppliers.length - 1].value, JSON.stringify(rk.suppliers))
    check('供应商含属性字段', rk.suppliers.every(function (x) { return 'attribute' in x }), JSON.stringify(rk.suppliers))
    check('核心代理机构 TOP3', rk.agencies.length > 0 && rk.agencies[0].name === '代理机构建档测试', JSON.stringify(rk.agencies))
    check('业主评委 TOP5 = 甲2次/乙1次（owner=true 过滤+去重）',
      rk.ownerJudges.length === 2 &&
      rk.ownerJudges[0].name === '业主评委甲' && rk.ownerJudges[0].value === 2 &&
      rk.ownerJudges[1].name === '业主评委乙' && rk.ownerJudges[1].value === 1,
      JSON.stringify(rk.ownerJudges))

    console.log('\n[D] 模块四：明细表')
    check('明细项目数 = 2', data.projects.length === 2, String(data.projects.length))
    check('明细角色 = 招标方', data.projects.every(function (p) { return p.role === '招标方' }))

    console.log('\n[E] 兼容性：其他两类看板不受影响')
    const agencyId = new Database(TEST_DB).prepare("SELECT id FROM agencies WHERE name='代理机构建档测试'").get().id
    const ag = await (await fetch(BASE + '/api/archives/agency/' + agencyId + '/stats')).json()
    check('代理机构看板正常（无 echarts 字段也可）', ag.ok && ag.data.summary.length >= 3)
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
