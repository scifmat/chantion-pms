/**
 * 首页导出自测：
 *  A) buildHomeWhere 抽取零遗漏（旧内联逻辑逐字对比 where/args）
 *  B) 字段字典 defaultKeys（home=7 核心字段、advanced=空即全选）
 *  C) 用户场景：首页 status='正在招标' → GET /api/projects 条数 == 导出 Excel 行数 + 数据集合
 *  D) 多组首页条件（名称/地区/日期/组合/空条件）一致性
 *  E) 金额口径：导出单元格=万元两位，与页面 moneyCell 同口径
 * 运行：node _test/scripts/test-home-export.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-home-test.db')
const BASE = 'http://127.0.0.1:3113'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
const ExcelJS = require('exceljs')
const { buildHomeWhere } = require(path.join(SERVER, 'queryBuilder.js'))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { if ((await fetch(BASE + '/api/projects')).ok) return } catch (e) {}
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('启动超时')
}

// ---- A) 旧内联首页构造逻辑逐字副本 ----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function oldHome(q) {
  const where = ['deleted = 0'], args = []
  const like = v => '%' + String(v).trim() + '%'
  if (q.status && String(q.status).trim()) { where.push('status LIKE ?'); args.push(like(q.status)) }
  if (q.name && String(q.name).trim()) { where.push('project_name LIKE ?'); args.push(like(q.name)) }
  if (q.region && String(q.region).trim()) { where.push('region LIKE ?'); args.push(like(q.region)) }
  if (q.timeStart && DATE_RE.test(String(q.timeStart).trim())) { where.push('award_time >= ?'); args.push(String(q.timeStart).trim()) }
  if (q.timeEnd && DATE_RE.test(String(q.timeEnd).trim())) { where.push('award_time <= ?'); args.push(String(q.timeEnd).trim()) }
  return { where, args }
}
// ---------------------------------------

async function exportXlsx(token, conditions, fields) {
  const er = await fetch(BASE + '/api/export/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ queryType: 'home', conditions, fields })
  })
  if (!er.ok) throw new Error('导出失败 status=' + er.status)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(await er.arrayBuffer()))
  return wb.worksheets[0]
}

async function main() {
  console.log('=== A) buildHomeWhere 抽取零遗漏 ===')
  const cases = [
    ['全空', {}],
    ['状态', { status: '正在招标' }],
    ['名称', { name: '测试' }],
    ['地区', { region: '北京市' }],
    ['日期起止', { timeStart: '2026-01-01', timeEnd: '2026-12-31' }],
    ['非法日期忽略', { timeStart: '2026/01/01', timeEnd: 'bad' }],
    ['白空格忽略', { status: '  ', name: '' }],
    ['全部5项组合', { status: '完成招标', name: '测试', region: '北京市', timeStart: '2026-01-01', timeEnd: '2026-12-31' }]
  ]
  cases.forEach(([label, q]) => {
    const o = oldHome(q), n = buildHomeWhere(q)
    check(label + ' 逐字一致', JSON.stringify(o) === JSON.stringify(n),
      JSON.stringify(o) === JSON.stringify(n) ? '' : '\n old=' + JSON.stringify(o) + '\n new=' + JSON.stringify(n))
  })

  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true }); await src.backup(TEST_DB); src.close()
  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3113', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const lg = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const token = (await lg.json()).data.token

    console.log('\n=== B) 字段字典默认勾选 ===')
    for (const qt of ['home', 'advanced']) {
      const r = await fetch(BASE + '/api/export/fields?queryType=' + qt)
      const d = (await r.json()).data
      if (qt === 'home') {
        check('home 默认勾选 7 个字段', d.defaultKeys.length === 7, JSON.stringify(d.defaultKeys))
        check('home 默认含项目状态/名称/地区/预算/中标金额/中标时间/编号',
          ['project_no', 'status', 'project_name', 'region', 'budget', 'award', 'award_time'].every(k => d.defaultKeys.includes(k)),
          JSON.stringify(d.defaultKeys))
        check('home 默认键都在字段字典中', d.defaultKeys.every(k => d.fields.some(f => f.key === k)))
      } else {
        check('advanced 默认空数组（前端全选）', Array.isArray(d.defaultKeys) && d.defaultKeys.length === 0)
      }
    }

    console.log('\n=== C/D) 首页查询与导出行数/集合一致 ===')
    const scenarios = [
      ['用户场景：项目状态=正在招标', { status: '正在招标' }],
      ['项目名称=测试', { name: '测试' }],
      ['监管地区=北京市', { region: '北京市' }],
      ['中标时间区间', { timeStart: '2026-01-01', timeEnd: '2026-12-31' }],
      ['组合：状态+名称', { status: '完成招标', name: '测试' }],
      ['空条件=全量', {}]
    ]
    for (const [label, cond] of scenarios) {
      const q = new URLSearchParams()
      Object.keys(cond).forEach(k => q.set(k, String(cond[k])))
      const qr = await fetch(BASE + '/api/projects' + (q.toString() ? '?' + q : ''))
      const list = (await qr.json()).data
      const ws = await exportXlsx(token, cond, ['project_no', 'project_name', 'status', 'budget', 'award', 'award_time', 'region'])
      const excelRows = ws.rowCount - 1
      check(label + '：查询 ' + list.length + ' == 导出 ' + excelRows, list.length === excelRows,
        list.length === excelRows ? '' : '查询=' + list.length + ' 导出=' + excelRows)
      const qNos = list.map(r => r.project_no).sort().join('|')
      const eNos = []
      for (let i = 2; i <= ws.rowCount; i++) eNos.push(String(ws.getRow(i).getCell(1).value))
      check('  └ 数据集合一致', qNos === eNos.sort().join('|'))
    }

    console.log('\n=== E) 金额口径（万元两位，与页面同源）===')
    const wsAmt = await exportXlsx(token, { no: 'XM-2026-001' }, ['project_no', 'budget', 'award', 'created_at', 'updated_at'])
    const budgetCell = wsAmt.getRow(2).getCell(2)
    check('预算为数字类型', typeof budgetCell.value === 'number', typeof budgetCell.value + ':' + budgetCell.value)
    check('预算显示格式 0.00', budgetCell.numFmt === '0.00', String(budgetCell.numFmt))
    check('created_at 列有真实值（EXPORT_COLUMNS 补齐）', !!wsAmt.getRow(2).getCell(4).value,
      String(wsAmt.getRow(2).getCell(4).value))
    check('updated_at 列有真实值', !!wsAmt.getRow(2).getCell(5).value,
      String(wsAmt.getRow(2).getCell(5).value))
    const listOne = (await (await fetch(BASE + '/api/projects?no=XM-2026-001')).json()).data[0]
    check('导出预算(万元) == 页面 moneyCell 口径', Number(budgetCell.value) === Number((listOne.budget_fen / 1000000).toFixed(2)),
      'excel=' + budgetCell.value + ' 页面=' + (listOne.budget_fen / 1000000).toFixed(2))

    console.log('\n=== 权限回归 ===')
    const anon = await fetch(BASE + '/api/export/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryType: 'home', conditions: {}, fields: ['project_no'] })
    })
    check('未登录导出 home 返回 401', anon.status === 401)
  } finally {
    child.kill('SIGTERM')
  }
  console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
