/**
 * buildAdvancedWhere 抽取回归自测。
 * 用「旧内联构造逻辑」的逐字副本 vs 新 queryBuilder.buildAdvancedWhere，
 * 对 14 组条件（含全空、组合、边界）比对生成的 SQL 与参数，确保零遗漏、零漂移。
 * 运行：node _test/scripts/test-querybuilder.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const require = createRequire(path.join(ROOT, 'server/app.js'))
const { buildAdvancedWhere } = require(path.join(ROOT, 'server/queryBuilder.js'))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}

// ---- 旧实现逐字副本（抽取前的 routes/projects.js 逻辑）----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function oldBuild(q) {
  const where = ['deleted = 0']
  const args = []
  function addLike(col, value) {
    const s = String(value == null ? '' : value).trim()
    if (!s) return
    where.push(col + ' LIKE ?'); args.push('%' + s + '%')
  }
  function addMulti(col, value) {
    const keys = String(value == null ? '' : value).split(/[,，]/).map(function (s) { return s.trim() }).filter(Boolean)
    if (!keys.length) return
    where.push('(' + keys.map(function () { return col + ' LIKE ?' }).join(' OR ') + ')')
    keys.forEach(function (k) { args.push('%' + k + '%') })
  }
  function fenParam(value) {
    const s = String(value == null ? '' : value).trim()
    if (!/^\d+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) ? n : null
  }
  function addAmountRange(col, min, max) {
    const lo = fenParam(min), hi = fenParam(max)
    if (lo === null && hi === null) return
    where.push(col + ' > 0')
    if (lo !== null) { where.push(col + ' >= ?'); args.push(lo) }
    if (hi !== null) { where.push(col + ' <= ?'); args.push(hi) }
  }
  addLike('status', q.status)
  addMulti('project_types', q.type)
  addLike('region', q.region)
  addLike('project_no', q.no)
  addLike('project_name', q.name)
  addAmountRange('budget_fen', q.budgetMinFen, q.budgetMaxFen)
  addAmountRange('ceiling_fen', q.ceilingMinFen, q.ceilingMaxFen)
  addLike('buyer_name', q.buyer)
  addLike('agency_name', q.agency)
  addLike('method', q.method)
  addLike('period_days', q.period)
  if (q.bidFrom && DATE_RE.test(String(q.bidFrom).trim())) { where.push('bid_end >= ?'); args.push(String(q.bidFrom).trim()) }
  if (q.bidTo && DATE_RE.test(String(q.bidTo).trim())) { where.push('bid_end <= ?'); args.push(String(q.bidTo).trim()) }
  addMulti('winner_names', q.winner)
  addAmountRange('award_amount_fen', q.amountMinFen, q.amountMaxFen)
  return { where, args }
}
// ---------------------------------------------------------------

const cases = [
  ['全空条件', {}],
  ['1 项目状态', { status: '完成招标' }],
  ['2 项目类型(单值)', { type: '货物类' }],
  ['2 项目类型(多值逗号)', { type: '货物类,服务类' }],
  ['2 项目类型(中文逗号+空格)', { type: '货物类， 服务类' }],
  ['3 监管地区', { region: '北京市-东城区' }],
  ['4 项目编号', { no: 'XM-2026-001' }],
  ['5 项目名称', { name: '测试' }],
  ['6 预算区间(min+max)', { budgetMinFen: '1000000', budgetMaxFen: '5000000' }],
  ['6 预算区间(仅min)', { budgetMinFen: '1000000' }],
  ['6 预算区间(仅max)', { budgetMaxFen: '5000000' }],
  ['6 预算区间(非法值忽略)', { budgetMinFen: 'abc', budgetMaxFen: '-1' }],
  ['7 最高限价区间', { ceilingMinFen: '1000000', ceilingMaxFen: '9000000' }],
  ['8 采购单位', { buyer: '采购单位建档测试' }],
  ['9 代理机构', { agency: '代理机构建档测试' }],
  ['10 采购方式', { method: '公开招标' }],
  ['11 合同履行期限', { period: '30' }],
  ['12 投标截止(from+to)', { bidFrom: '2026-01-01', bidTo: '2026-12-31' }],
  ['12 投标截止(非法日期忽略)', { bidFrom: '2026/01/01', bidTo: 'bad' }],
  ['13 中标单位(多值)', { winner: '供应商单位建档测试,联合体单位成员001' }],
  ['14 中标金额区间', { amountMinFen: '1000000', amountMaxFen: '8000000' }],
  ['全部 14 项组合', {
    status: '完成招标', type: '货物类,服务类', region: '北京市', no: 'XM-001', name: '测试',
    budgetMinFen: '1', budgetMaxFen: '999999999', ceilingMinFen: '2', ceilingMaxFen: '888888888',
    buyer: '采购单位', agency: '代理机构', method: '公开招标', period: '30',
    bidFrom: '2026-01-01', bidTo: '2026-12-31', winner: 'A,B', amountMinFen: '3', amountMaxFen: '777777777'
  }],
  ['安全整数边界(超大忽略)', { budgetMinFen: '99999999999999999999' }],
  ['白空格与空串忽略', { status: '   ', no: '', type: '  ' }]
]

console.log('=== buildAdvancedWhere 抽取回归（旧内联 vs 新构造器）===\n')
cases.forEach(function (c) {
  const o = oldBuild(c[1])
  const n = buildAdvancedWhere(c[1])
  const same = JSON.stringify(o) === JSON.stringify(n)
  check(c[0] + ' → where/args 完全一致', same,
    same ? '' : '\n   old=' + JSON.stringify(o) + '\n   new=' + JSON.stringify(n))
})
check('构造器永远含 deleted = 0', buildAdvancedWhere({}).where[0] === 'deleted = 0')
check('构造器为纯函数(不修改入参)', (function () {
  const q = { status: '完成招标' }; const snapshot = JSON.stringify(q)
  buildAdvancedWhere(q); return JSON.stringify(q) === snapshot
})())

console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
