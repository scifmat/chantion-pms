/**
 * 第 17 步：系统级全局数据看板自测（DB 副本，不碰开发库）。
 * 覆盖 010 映射表同步、SQL 聚合口径、本企业战力卡、缓存失效、权限。
 * 运行：node _test/scripts/test-global-dashboard.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-global-test.db')
const BASE = 'http://127.0.0.1:3134'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' → ' + detail : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
let TOKEN = ''
async function api(method, p, body, noToken) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN && !noToken) headers.Authorization = 'Bearer ' + TOKEN
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
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3134', HOST: '127.0.0.1' }), stdio: 'ignore'
  })
  try {
    await waitReady()
    console.log('\n[A] 010 映射表与回填')
    const db = new Database(TEST_DB, { readonly: true })
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_winners'").get()
    check('project_winners 表已建立', !!tbl)
    const rows = db.prepare('SELECT COUNT(*) n FROM project_winners').get().n
    check('历史映射已回填', rows > 0, 'rows=' + rows)
    db.close()

    console.log('\n[B] 权限与聚合口径')
    const guest = await api('GET', '/api/global/stats', undefined, true)
    check('访客访问被 401 拦截', guest.status === 401, JSON.stringify(guest.data))
    const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' }, true)
    TOKEN = (login.data && login.data.data && login.data.data.token) || ''
    check('管理员登录成功', !!TOKEN)
    const r = await api('GET', '/api/global/stats')
    check('管理员读取成功', r.status === 200, JSON.stringify(r.data && r.data.message))
    const d = r.data.data
    const db2 = new Database(TEST_DB, { readonly: true })
    const manual = db2.prepare("SELECT COUNT(*) n, COALESCE(SUM(budget_fen),0) b FROM projects WHERE deleted=0 AND status IN ('完成招标','终止招标')").get()
    db2.close()
    check('有效项目数=SQL 口径', d.summary[0].value === manual.n, d.summary[0].value + ' vs ' + manual.n)
    check('总预算=SQL 口径', d.summary[1].value === Math.round(manual.b / 1000000 * 100) / 100)
    check('KPI 四项齐全', d.summary.length === 4)
    check('趋势为 12 个月', d.trend.length === 12)
    check('月份连续', d.trend.every(function (x, i) { return i === 0 || (Number(x.month.slice(5)) === Number(d.trend[i - 1].month.slice(5)) % 12 + 1) }))
    check('类型分布非空', d.types.length >= 3, JSON.stringify(d.types))
    check('Top10 按金额降序', d.competitors.length === 10 && d.competitors.every(function (x, i) { return i === 0 || d.competitors[i - 1].awardWan >= x.awardWan }))
    check('Top10 名称去重', new Set(d.competitors.map(x => x.name)).size === 10)
    check('Top10 名次连续', d.competitors.every(function (x, i) { return x.rank === i + 1 }))
    check('采购大户 / 代理 / 地图非空', d.buyers.length > 0 && d.agencies.length > 0 && d.geo.length > 0)

    console.log('\n[C] 本企业战力卡')
    check('本企业已配置时返回战力卡', d.self.configured === true, JSON.stringify(d.self))
    check('本企业未进前十时提示', d.self.inTop10 === false && d.self.rank > 10, JSON.stringify(d.self))
    check('与 Top1 差距计算正确', d.self.gapWan > 0 && !!d.self.gapTo, JSON.stringify(d.self))
    const metricKeys = ['maxAwardWan', 'minAwardWan', 'avgAwardWan', 'totalDiscountWan', 'discountRate', 'maxDiscountWan', 'minDiscountWan']
    check('财务与竞争指标齐全且非负', metricKeys.every(function (k) {
      return typeof d.self[k] === 'number' && d.self[k] >= 0;
    }), JSON.stringify(d.self))
    check('最高中标额 ≥ 最低中标额', d.self.maxAwardWan >= d.self.minAwardWan, JSON.stringify(d.self))
    check('平均中标额落在极值区间',
      d.self.avgAwardWan >= d.self.minAwardWan && d.self.avgAwardWan <= d.self.maxAwardWan, JSON.stringify(d.self))
    check('让利极值合理且比率在 0~100',
      d.self.maxDiscountWan >= d.self.minDiscountWan && d.self.discountRate >= 0 && d.self.discountRate <= 100,
      JSON.stringify(d.self))
    const originalSettings = (await api('GET', '/api/system/settings')).data.data
    const noSelfSettings = await api('PUT', '/api/system/settings', { systemName: originalSettings.systemName, selfCompetitorId: 0 })
    check('临时取消本企业成功', noSelfSettings.status === 200)
    const r2 = await api('GET', '/api/global/stats')
    check('未设置本企业时友好返回 configured=false', r2.data.data.self.configured === false, JSON.stringify(r2.data.data.self))
    await api('PUT', '/api/system/settings', { systemName: originalSettings.systemName, selfCompetitorId: originalSettings.selfCompetitorId })
    check('本企业设置已还原', (await api('GET', '/api/global/stats')).data.data.self.configured === true)

    console.log('\n[D] 映射表与项目写事务同步')
    const no = 'GLOBAL-TEST-' + Date.now()
    const detail = {
      public: { status: '完成招标', region: '湖北省-武汉市', project_no: no, project_name: '全局映射测试', budget_yuan: '1000000' },
      buyer: { name: '全局测试甲方' },
      agency: { name: '全局测试代理' },
      completed: {
        type: '货物类', amount_yuan: '900000', winDate: '2026-11-19',
        winner: { lead: '映射测试中标单位A', members: [], isUnion: false }, url: ''
      },
      operationLog: []
    }
    const created = await api('POST', '/api/projects', { detail })
    check('测试项目创建成功', created.status === 201, JSON.stringify(created.data))
    const pid = created.status === 201 ? created.data.data.row_id : 0
    let ver = created.status === 201 ? created.data.data.version : 0
    const db3 = new Database(TEST_DB, { readonly: true })
    check('创建后映射行已写入', db3.prepare('SELECT COUNT(*) n FROM project_winners WHERE project_no=?').get(no).n === 1)
    db3.close()
    detail.completed.winner.lead = '映射测试中标单位B'
    const updated = await api('PUT', '/api/projects/' + pid, { version: ver, detail })
    check('测试项目编辑成功', updated.status === 200, JSON.stringify(updated.data))
    ver = updated.status === 200 ? updated.data.data.version : ver
    const db4 = new Database(TEST_DB, { readonly: true })
    const names = db4.prepare('SELECT winner_name FROM project_winners WHERE project_no=?').all(no).map(x => x.winner_name)
    check('编辑后旧映射被清除、新映射生效', names.length === 1 && names[0] === '映射测试中标单位B', JSON.stringify(names))
    db4.close()
    const deleted = await api('DELETE', '/api/projects/' + pid, { version: ver })
    check('测试项目软删除成功', deleted.status === 200, JSON.stringify(deleted.data))
    const db5 = new Database(TEST_DB, { readonly: true })
    check('软删除后映射行被清理', db5.prepare('SELECT COUNT(*) n FROM project_winners WHERE project_no=?').get(no).n === 0)
    db5.close()

    console.log('\n[E] 缓存与失效')
    const a1 = await api('GET', '/api/global/stats')
    const a2 = await api('GET', '/api/global/stats')
    check('5 分钟内命中缓存（更新时间不变）', a1.data.data.updatedAt === a2.data.data.updatedAt)
    await sleep(1100)
    const sys = await api('GET', '/api/system/settings')
    await api('PUT', '/api/system/settings', { systemName: sys.data.data.systemName + ' ', selfCompetitorId: sys.data.data.selfCompetitorId })
    const a3 = await api('GET', '/api/global/stats')
    check('系统设置变更后缓存失效', a3.data.data.updatedAt !== a1.data.data.updatedAt, a1.data.data.updatedAt + ' -> ' + a3.data.data.updatedAt)
  } finally {
    child.kill('SIGTERM')
    await sleep(500)
    cleanup()
  }
  console.log('\n  结果：PASS = ' + pass + '  FAIL = ' + fail)
  if (fail > 0) process.exitCode = 1
}
main().catch(e => { console.error(e); process.exitCode = 1 })
