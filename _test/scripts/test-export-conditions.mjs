/**
 * 条件导出一致性验证：确保导出接口的 WHERE 与高级查询接口完全一致（所见即所得）。
 * 模拟用户场景：status='终止招标' → 高级查询条数 == 导出 Excel 行数。
 * 覆盖：单条件、文本模糊、金额区间、多值 OR、14 项组合、空条件全量。
 * 运行：node _test/scripts/test-export-conditions.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-cond-test.db')
const BASE = 'http://127.0.0.1:3112'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
const ExcelJS = require('exceljs')

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

async function main() {
  [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true }); await src.backup(TEST_DB); src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3112', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const lg = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const token = (await lg.json()).data.token

    // 用户复现场景 + 多种条件组合
    const cases = [
      ['用户场景：项目状态=终止招标', { status: '终止招标' }],
      ['文本模糊：项目名称=测试', { name: '测试' }],
      ['项目编号精确', { no: 'XM-2026-001' }],
      ['多值OR：项目类型=货物类,服务类', { type: '货物类,服务类' }],
      ['金额区间：预算 500~1000 万元', { budgetMinFen: '500000000', budgetMaxFen: '1000000000' }],
      ['采购单位模糊', { buyer: '采购单位' }],
      ['日期区间：投标截止', { bidFrom: '2026-01-01', bidTo: '2026-12-31' }],
      ['14条件组合', {
        status: '完成招标', type: '货物类,服务类', region: '北京市', no: 'XM', name: '测试',
        budgetMinFen: '1', budgetMaxFen: '999999999', ceilingMinFen: '1', ceilingMaxFen: '999999999',
        buyer: '采购单位', agency: '代理', method: '公开招标', period: '30',
        bidFrom: '2026-01-01', bidTo: '2026-12-31', winner: '供应商', amountMinFen: '1', amountMaxFen: '999999999'
      }],
      ['空条件=全量', {}]
    ]

    console.log('=== 导出条件与查询条件一致性验证 ===\n')
    for (const [label, conditions] of cases) {
      // 1) 高级查询条数（页面查询结果）
      const q = new URLSearchParams()
      Object.keys(conditions).forEach(k => q.set(k, String(conditions[k])))
      const qr = await fetch(BASE + '/api/projects/advanced' + (q.toString() ? '?' + q : ''))
      const queryRows = (await qr.json()).data

      // 2) 导出接口（payload 结构与修复后前端一致：conditions 是独立键）
      const er = await fetch(BASE + '/api/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ queryType: 'advanced', conditions, fields: ['project_no', 'status'] })
      })
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(Buffer.from(await er.arrayBuffer()))
      const excelRows = wb.worksheets[0].rowCount - 1 // 减去表头

      const matched = queryRows.length === excelRows
      check(label + '：查询 ' + queryRows.length + ' 条 == 导出 ' + excelRows + ' 行', matched,
        matched ? '' : '查询=' + queryRows.length + ' 导出=' + excelRows)

      // 附带核对导出行的 project_no 集合与查询结果完全一致
      const qNos = queryRows.map(r => r.project_no).sort().join('|')
      const eNos = []
      for (let i = 2; i <= wb.worksheets[0].rowCount; i++) eNos.push(String(wb.worksheets[0].getRow(i).getCell(1).value))
      check('  └ 数据集合一致', qNos === eNos.sort().join('|'))
    }
  } finally {
    child.kill('SIGTERM')
  }
  console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
