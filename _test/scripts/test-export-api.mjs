/**
 * 导出接口集成自测：DB 副本 + 独立后端（127.0.0.1:3107）。
 * 验证：字段字典下发、未登录 401、登录后导出 xlsx、复杂字段拼接、金额两位、Excel 样式、截断。
 * 运行：node _test/scripts/test-export-api.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-export-test.db')
const BASE = 'http://127.0.0.1:3107'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
const ExcelJS = require('exceljs')
const { ensureSeedProject } = await import('./ensure-seed.mjs')

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
  throw new Error('测试服务启动超时')
}
async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const data = await res.json()
  return { status: res.status, data }
}

async function main() {
  [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB); src.close()
  ensureSeedProject(Database, TEST_DB)   // 副本里恢复可能被软删的 XM-2026-002（不动真实库）

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3107', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let errBuf = ''
  child.stderr.on('data', d => { errBuf += d.toString() })

  try {
    await waitReady()

    console.log('\n[A] 字段字典下发')
    const fr = await fetch(BASE + '/api/export/fields')
    const fd = await fr.json()
    check('字典接口 200', fr.status === 200)
    check('字典含分组', Array.isArray(fd.data.groups) && fd.data.groups.length >= 4)
    check('字典字段 >= 25', fd.data.fields.length >= 25, '实际 ' + fd.data.fields.length)

    console.log('\n[B] 权限：未登录禁止导出')
    const anon = await fetch(BASE + '/api/export/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryType: 'advanced', conditions: {}, fields: ['project_no'] })
    })
    check('未登录 POST 返回 401', anon.status === 401, 'status=' + anon.status)

    const lg = await login('admin', 'admin123')
    check('管理员登录成功', lg.status === 200 && lg.data.ok, JSON.stringify(lg.data).slice(0, 120))
    const token = lg.data.data && lg.data.data.token
    check('拿到 Token', !!token)

    console.log('\n[C] 导出 xlsx：全字段 + 14 条件查询')
    const fields = ['project_no', 'project_name', 'status', 'budget', 'ceiling', 'award',
      'buyer_name', 'agency_name', 'method', 'winner', 'packages', 'judges', 'corrections', 'bid_end']
    const er = await fetch(BASE + '/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ queryType: 'advanced', conditions: {}, fields, filename: '高级查询导出' })
    })
    check('导出返回 200', er.status === 200, 'status=' + er.status + ' body=' + (await er.clone().text()).slice(0, 100))
    check('Content-Type 为 xlsx', /spreadsheetml/.test(er.headers.get('content-type') || ''))
    check('X-Export-Truncated=0', er.headers.get('x-export-truncated') === '0')
    const matched = Number(er.headers.get('x-export-matched'))
    check('匹配行数 > 0', matched > 0, 'matched=' + matched)
    const buf = Buffer.from(await er.arrayBuffer())
    check('xlsx 文件有内容', buf.length > 3000, 'bytes=' + buf.length)

    // 读回 xlsx 核对内容与样式
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('导出数据')
    check('工作表存在', !!ws)
    check('行数 = 表头 + 数据', ws.rowCount === matched + 1, 'rowCount=' + ws.rowCount + ' matched=' + matched)
    check('冻结首行 ySplit=1', ws.views && ws.views[0] && ws.views[0].state === 'frozen' && ws.views[0].ySplit === 1,
      JSON.stringify(ws.views))
    check('自动筛选存在', /A1/.test(JSON.stringify(ws.autoFilter)), JSON.stringify(ws.autoFilter))
    const h = ws.getRow(1)
    check('表头加粗', h.getCell(1).font && h.getCell(1).font.bold === true)
    check('表头=项目编号', h.getCell(1).value === '项目编号', String(h.getCell(1).value))

    // 找到 XM-2026-001（联合体+评委）与 XM-2026-002（分包+更正）两行核对
    function rowOf(no) {
      for (let i = 2; i <= ws.rowCount; i++) {
        const r = ws.getRow(i)
        if (r.getCell(1).value === no) return r
      }
      return null
    }
    const r1 = rowOf('XM-2026-001')
    check('找到 XM-2026-001', !!r1)
    if (r1) {
      const winner = r1.getCell(10).value  // winner 联合体
      const judges = r1.getCell(12).value  // judges 评委
      check('联合体格式：牵头方，成员方', /供应商单位建档测试，联合体单位成员001/.test(String(winner)), String(winner))
      check('评委格式：姓名(组长)', /王五\(组长\)/.test(String(judges)), String(judges))
      const budget = r1.getCell(4).value  // budget 项目预算
      check('预算为数字类型(金额可计算)', typeof budget === 'number', typeof budget + ':' + budget)
      const budgetCell = r1.getCell(4)
      check('预算两位小数显示格式(numFmt=0.00)', budgetCell.numFmt === '0.00', String(budgetCell.numFmt))
    }
    const r2 = rowOf('XM-2026-002')
    check('找到 XM-2026-002', !!r2)
    if (r2) {
      const packages = String(r2.getCell(11).value) // packages 分包明细
      const corrections = String(r2.getCell(13).value) // corrections 更正公告
      check('分包格式：包名：中标方：金额 万元', /包/.test(packages) && /金额 .* 万元/.test(packages), packages.slice(0, 160))
      check('更正格式：日期 内容', /2026-11-11 更正公告测试/.test(corrections), corrections.slice(0, 160))
    }

    console.log('\n[D] 字段子集 + 条件过滤（14 条件之一：status）')
    const er2 = await fetch(BASE + '/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ queryType: 'advanced', conditions: { status: '完成招标' }, fields: ['project_no', 'status', 'award'] })
    })
    check('条件导出 200', er2.status === 200)
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(Buffer.from(await er2.arrayBuffer()))
    const ws2 = wb2.worksheets[0]
    check('子集导出 3 列', ws2.getRow(1).cellCount === 3, 'cellCount=' + ws2.getRow(1).cellCount)
    let allDone = true
    for (let i = 2; i <= ws2.rowCount; i++) if (ws2.getRow(i).getCell(2).value !== '完成招标') allDone = false
    check('status 条件生效(全为完成招标)', allDone)

    console.log('\n[E] 非法参数防护')
    const bad = await fetch(BASE + '/api/export/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ queryType: 'advanced', fields: [] })
    })
    check('空字段返回 400', bad.status === 400, 'status=' + bad.status)
    const badType = await fetch(BASE + '/api/export/excel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ queryType: 'hacker', fields: ['project_no'] })
    })
    check('非法 queryType 返回 400', badType.status === 400)

    if (errBuf) console.log('\n[服务端 stderr 片段]\n' + errBuf.slice(-600))
  } finally {
    child.kill('SIGTERM')
  }
  console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
