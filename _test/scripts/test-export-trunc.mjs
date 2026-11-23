/**
 * 导出截断（防 OOM）验证：构造 >5000 行，验证 LIMIT 5001 截断逻辑与响应头。
 * 运行：node _test/scripts/test-export-trunc.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-trunc2-test.db')
const BASE = 'http://127.0.0.1:3109'
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
  const db = new Database(TEST_DB)
  db.transaction(function () {
    const ins = db.prepare("INSERT INTO projects (project_no,project_name,budget_yuan,budget_fen,ceiling_yuan,ceiling_fen,region,status,award_amount_yuan,award_amount_fen,award_time,detail,created_at,updated_at,version,deleted) VALUES (?,?,'0',0,'0',0,'','意向公示','0',0,'','{}','2026-01-01 00:00:00','2026-01-01 00:00:00',1,0)")
    for (let i = 0; i < 5002; i++) ins.run('TRUNC-' + String(i).padStart(5, '0'), '截断测试' + i)
  })()
  const total = db.prepare('SELECT COUNT(*) c FROM projects WHERE deleted=0').get().c
  db.close()
  console.log('测试数据总数：' + total + '\n')

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3109', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const lg = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const token = (await lg.json()).data.token
    const res = await fetch(BASE + '/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ queryType: 'advanced', conditions: {}, fields: ['project_no', 'project_name'] })
    })
    check('导出 200', res.status === 200)
    check('X-Export-Truncated=1', res.headers.get('x-export-truncated') === '1', res.headers.get('x-export-truncated'))
    check('X-Export-Matched=总数', Number(res.headers.get('x-export-matched')) === total, res.headers.get('x-export-matched'))
    check('X-Export-Rows=5000', res.headers.get('x-export-rows') === '5000', res.headers.get('x-export-rows'))
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()))
    check('Excel 行数 = 5001（表头+5000）', wb.worksheets[0].rowCount === 5001, String(wb.worksheets[0].rowCount))
  } finally {
    child.kill('SIGTERM')
  }
  console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
