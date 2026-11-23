/**
 * 防复发回归：字段字典声明的 main 字段必须都被导出 SELECT 覆盖（award_time 曾漏列导致空列）。
 * 用一个数据完整的项目，验证每个 main 字段「主表有值 → 导出非空」，并做字典↔列集静态对齐检查。
 * 运行：node _test/scripts/test-export-columns.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-cols-test.db')
const BASE = 'http://127.0.0.1:3119'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
const ExcelJS = require('exceljs')
const F = require(path.join(SERVER, 'export/fields.js'))
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}

async function main() {
  // --- 静态对齐：字典里每个 main 字段的 column 都在派生列集里 ---
  console.log('=== 字典 ↔ 导出列集静态对齐 ===')
  const cols = F.selectColumns(true)
  const mainFields = F.FIELDS.filter(f => f.source === 'main')
  mainFields.forEach(f => check('列集含 ' + f.key + ' (' + f.column + ')', cols.split(',').map(s => s.trim()).includes(f.column)))
  check('列集带 detail', /detail/.test(cols))

  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true }); await src.backup(TEST_DB); src.close()
  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3119', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    const t0 = Date.now()
    while (Date.now() - t0 < 15000) { try { if ((await fetch(BASE + '/api/projects')).ok) break } catch (e) {} await sleep(150) }
    const lg = await (await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })).json()
    const token = lg.data.token

    // --- 动态：用户复现场景 award_time ---
    console.log('\n=== 用户场景：湖北/武汉 完成招标 7 条，中标时间非空 ===')
    const cond = { status: '完成招标', region: '湖北省-武汉市' }
    const er = await fetch(BASE + '/api/export/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ queryType: 'home', conditions: cond, fields: ['project_no', 'award_time'] })
    })
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await er.arrayBuffer()))
    const ws = wb.worksheets[0]
    check('导出 7 行', ws.rowCount - 1 === 7, String(ws.rowCount - 1))
    let empty = 0
    const exported = {}
    for (let i = 2; i <= ws.rowCount; i++) {
      const v = ws.getRow(i).getCell(2).value
      if (!v) empty++
      exported[ws.getRow(i).getCell(1).value] = v
    }
    check('中标时间列 0 空值', empty === 0, '空 ' + empty + ' 行')

    // 与首页主表逐条比对
    const db = new Database(TEST_DB, { readonly: true })
    const rows = db.prepare("SELECT project_no, award_time FROM projects WHERE status='完成招标' AND region LIKE '%湖北省%' AND region LIKE '%武汉市%' AND deleted=0").all()
    db.close()
    check('导出中标时间 == 主表 award_time（逐条）',
      rows.every(r => exported[r.project_no] === r.award_time),
      JSON.stringify(rows.slice(0, 2).map(r => [r.project_no, r.award_time, exported[r.project_no]])))

    // --- 动态：项目 XM-2026-001 所有 main 字段（主表有值的）导出非空 ---
    console.log('\n=== 完整项目所有 main 字段导出 ===')
    const fields = mainFields.map(f => f.key)
    const er2 = await fetch(BASE + '/api/export/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ queryType: 'advanced', conditions: { no: 'XM-2026-001' }, fields })
    })
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(Buffer.from(await er2.arrayBuffer()))
    const ws2 = wb2.worksheets[0]
    const rowVals = {}
    mainFields.forEach((f, i) => { rowVals[f.key] = ws2.getRow(2).getCell(i + 1).value })
    mainFields.forEach(f => {
      // 该字段格式是 text 且主表原始值非空时，导出必须非空
      const raw = f.format === 'moneyFen' ? null : null // 统一用「导出非空」判定完整项目
      check('字段 ' + f.key + ' 导出非空', rowVals[f.key] !== '' && rowVals[f.key] != null,
        '值=' + JSON.stringify(rowVals[f.key]))
    })
  } finally {
    child.kill('SIGTERM')
    ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  }
  console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
