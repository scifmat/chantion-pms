/**
 * 看板年份筛选自测（第 14 步）。
 * DB 副本 + 独立端口；副本注入 2024/2025 年份项目，验证年份选项动态生成与指标隔离。
 * 运行：node _test/scripts/test-year-filter.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-year-test.db')
const BASE = 'http://127.0.0.1:3121'
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

  // 副本注入：1 条 2024 + 2 条 2025 完成招标项目，归属"采购单位建档测试"
  const seed = new Database(TEST_DB)
  const buyer = "采购单位建档测试"
  const ins = seed.prepare(`INSERT INTO projects
    (project_no,project_name,budget_yuan,budget_fen,award_amount_yuan,award_amount_fen,status,region,buyer_name,agency_name,method,winner_names,project_types,detail,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const mk = function (no, year, wan, supplier) {
    // wan 为万元：1 万元 = 1,000,000 分
    const fen = wan * 1000000
    const awardFen = Math.round(fen * 0.9)
    const detail = { public: { project_no: no, project_name: no, status: '完成招标', region: '湖北省-武汉市', budget_yuan: String(wan * 10000) }, buyer: { name: buyer, phone: '', email: '', address: '' }, agency: { name: '代理机构建档测试', phone: '', email: '', address: '' },
      completed: { type: '货物类', amount_yuan: String(awardFen / 100), winDate: year + '-06-01',
        winner: { lead: supplier, members: [''], isUnion: false }, isSplit: false, packages: [], judges: [] } }
    ins.run(no, no + '-测试', String(wan * 10000), fen, String(awardFen / 100), awardFen,
      '完成招标', '湖北省-武汉市', buyer, '代理机构建档测试', '公开招标', supplier, '货物类', JSON.stringify(detail),
      year + '-05-01 10:00:00', year + '-05-01 10:00:00')
  }
  mk('YEAR-2024-001', 2024, 100, '供应商单位建档测试')
  mk('YEAR-2025-001', 2025, 200, '供应商单位建档测试')
  mk('YEAR-2025-002', 2025, 300, '联合体单位成员001')
  const buyerId = seed.prepare('SELECT id FROM buyers WHERE name=?').get(buyer).id
  seed.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3121', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const get = async function (year) {
      const q = year ? '?year=' + year : ''
      return (await (await fetch(BASE + '/api/archives/buyer/' + buyerId + '/stats' + q)).json()).data
    }
    const all = await get('')
    console.log('\n[A] 可用年份动态生成')
    check('years 含 2024/2025/2026 且降序', JSON.stringify(all.years) === '[2026,2025,2024]', JSON.stringify(all.years))
    check('全部年份时 year=null', all.year === null, String(all.year))

    console.log('\n[B] 年份筛选后指标独立')
    const y2024 = await get(2024)
    const y2025 = await get(2025)
    const y2026 = await get(2026)
    const sum = function (d) { return d.summary.find(function (x) { return x.key === 'totalBudget'; }).value }
    check('2024 累计预算 = 100.00 万（仅1条）', sum(y2024) === '100.00', sum(y2024))
    check('2025 累计预算 = 500.00 万（200+300）', sum(y2025) === '500.00', sum(y2025))
    check('2026 累计预算 = 750.00 万（原数据）', sum(y2026) === '750.00', sum(y2026))
    check('全部年份 = 1350.00 万（100+500+750）', sum(all) === '1350.00', sum(all))
    check('返回 year 回显正确', y2024.year === 2024 && y2025.year === 2025, `${y2024.year}/${y2025.year}`)

    console.log('\n[C] 金额区间与月度也随年份过滤')
    check('2024 金额区间 100-500万=1（100万整归入该档）', y2024.echarts.budgetBucket[1].value === 1, JSON.stringify(y2024.echarts.budgetBucket))
    check('2025 金额区间 100-500万=2', y2025.echarts.budgetBucket[1].value === 2, JSON.stringify(y2025.echarts.budgetBucket))
    check('2024 月度仅 5月=1', y2024.echarts.month.find(function (m) { return m.month === 5; }).value === 1, JSON.stringify(y2024.echarts.month.filter(function (m) { return m.value > 0; })))

    console.log('\n[D] 榜单也随年份过滤')
    check('2024 供应商榜仅 1 家', y2024.rankings.suppliers.length === 1 && y2024.rankings.suppliers[0].value === 1, JSON.stringify(y2024.rankings.suppliers))
    check('2025 核心代理 TOP5 上限生效', y2025.rankings.agencies.length <= 5, JSON.stringify(y2025.rankings.agencies))

    console.log('\n[E] 代理机构地区 TOP5 数据')
    const agencyId = new Database(TEST_DB).prepare("SELECT id FROM agencies WHERE name='代理机构建档测试'").get().id
    const ag = (await (await fetch(BASE + '/api/archives/agency/' + agencyId + '/stats')).json()).data
    check('echarts.regionTop 存在且 ≤5', Array.isArray(ag.echarts.regionTop) && ag.echarts.regionTop.length <= 5 && ag.echarts.regionTop.length > 0, JSON.stringify(ag.echarts.regionTop))

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
