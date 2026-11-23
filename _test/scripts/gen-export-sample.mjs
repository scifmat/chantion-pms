/**
 * 生成一份真实 Excel 自测文件（用真实库 chantion.db，全字段导出）。
 * 产物：_test/导出自测样例.xlsx —— 供人工打开核对复杂字段拼接与金额。
 * 同时读回打印关键行内容，便于无 GUI 环境核对。
 * 运行：node _test/scripts/gen-export-sample.mjs
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SERVER = path.join(ROOT, 'server')
const require = createRequire(path.join(SERVER, 'app.js'))
const { db } = (function () {
  process.env.DB_PATH = path.join(SERVER, 'data/chantion.db')
  return require(path.join(SERVER, 'db.js'))
})()
const { ADV_COLUMNS } = require(path.join(SERVER, 'queryBuilder.js'))
const F = require(path.join(SERVER, 'export/fields.js'))
const { buildWorkbook } = require(path.join(SERVER, 'export/workbook.js'))
const ExcelJS = require('exceljs')

async function main() {
  const fields = F.FIELDS
  const rows = db.prepare('SELECT ' + ADV_COLUMNS + ', detail FROM projects WHERE deleted=0 ORDER BY project_no ASC').all()
  const table = rows.map(row => {
    const d = F.rowDetail(row)
    return fields.map(f => F.cellValue(f.key, row, d))
  })
  const headers = fields.map(f => ({ key: f.key, label: f.label }))
  const wb = await buildWorkbook(headers, table, { sheetName: '导出数据' })

  const out = path.join(HERE, '..', 'data', '导出自测样例.xlsx')
  const ws = wb.getWorksheet('导出数据')
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(out)
    wb.xlsx.write(stream).then(() => stream.end(resolve)).catch(reject)
  })
  console.log('已生成：' + out + '  (' + fs.statSync(out).size + ' bytes)')
  console.log('行数：' + table.length + '  字段数：' + fields.length + '\n')

  // 读回核对关键列
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(fs.readFileSync(out))
  const ws2 = wb2.getWorksheet('导出数据')
  const idx = {}
  headers.forEach((h, i) => { idx[h.key] = i + 1 })
  function show(no, keys) {
    for (let r = 2; r <= ws2.rowCount; r++) {
      const row = ws2.getRow(r)
      if (row.getCell(idx.project_no).value === no) {
        console.log('【' + no + '】')
        keys.forEach(k => console.log('  ' + headers[idx[k] - 1].label + ' = ' + JSON.stringify(row.getCell(idx[k]).value)))
        return
      }
    }
    console.log('【' + no + '】未找到')
  }
  show('XM-2026-001', ['project_name', 'budget', 'ceiling', 'award', 'winner', 'judges'])
  console.log('')
  show('XM-2026-002', ['budget', 'award', 'winner', 'packages', 'judges', 'corrections'])
  console.log('\n样式核对：freeze=' + JSON.stringify(ws2.views) + '  filter=' + JSON.stringify(ws2.autoFilter) +
    '  bold=' + ws2.getRow(1).getCell(1).font.bold)
}
main().catch(e => { console.error(e); process.exit(1) })
