/**
 * 导出字段字典与扁平化自测。
 * 重点核对 4 种复杂字段拼接格式 + 金额万元两位无后缀 + 空值转 ''。
 * 运行：node _test/scripts/test-export-fields.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const require = createRequire(path.join(ROOT, 'server/app.js'))
const F = require(path.join(ROOT, 'server/export/fields.js'))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}

console.log('=== 字段字典 ===\n')
const dict = F.dictionary()
check('分组数量 >= 4', dict.groups.length >= 4, JSON.stringify(dict.groups))
check('字段总数 >= 25', dict.fields.length >= 25, '实际 ' + dict.fields.length)
check('下发的字段不含内部 path/column', dict.fields.every(f => !('path' in f) && !('column' in f) && !('source' in f)))
check('包含分包明细字段', dict.fields.some(f => f.key === 'packages'))
check('包含评委字段', dict.fields.some(f => f.key === 'judges'))

console.log('\n=== 4 种复杂字段扁平化 ===\n')
check('联合体：牵头+成员', F.formatWinner({ lead: '牵头方A', members: ['成员方B', '成员方C'], isUnion: true }) === '牵头方A，成员方B、成员方C',
  F.formatWinner({ lead: '牵头方A', members: ['成员方B', '成员方C'], isUnion: true }))
check('联合体：非联合体只取牵头', F.formatWinner({ lead: 'A公司', members: ['X'], isUnion: false }) === 'A公司')
check('联合体：牵头空但联合体成员', F.formatWinner({ lead: '', members: ['B', 'C'], isUnion: true }) === 'B、C')
check('联合体：全空 -> 空串', F.formatWinner({ lead: '', members: [''], isUnion: false }) === '')

const pkg = [
  { name: '1包', amount_yuan: '90000', winner: { lead: 'A公司', members: ['B公司'], isUnion: true } },
  { name: '2包', amount_yuan: '100000', winner: { lead: 'C公司', members: [''], isUnion: false } }
]
const pkgOut = F.formatPackages(pkg)
check('分包：每包「包名：中标方（金额万元）」', pkgOut === '1包：A公司，B公司：金额 9.00 万元；2包：C公司：金额 10.00 万元', pkgOut)

const judges = [
  { name: '张三', leader: true, owner: false },
  { name: '李四', leader: false, owner: true },
  { name: '王五', leader: true, owner: true },
  { name: '赵六', leader: false, owner: false }
]
const judgeOut = F.formatJudges(judges)
check('评委：张三(组长), 李四(业主) 格式', judgeOut === '张三(组长), 李四(业主), 王五(组长·业主), 赵六', judgeOut)

const corr = [
  { date: '2026-11-11', content: '更正公告测试' },
  { date: '2026-11-16', content: '更正公告测试2' }
]
const corrOut = F.formatCorrections(corr)
check('更正：日期 内容，；分隔', corrOut === '2026-11-11 更正公告测试；2026-11-16 更正公告测试2', corrOut)

console.log('\n=== 金额口径 ===\n')
check('整数分 4900000 分 -> 4.90 万元', F.fenToWan(4900000) === '4.90', F.fenToWan(4900000))
check('整数分 2553230000 分 -> 2553.23 万元', F.fenToWan(2553230000) === '2553.23', F.fenToWan(2553230000))
check('金额 0 -> 空串', F.fenToWan(0) === '')
check('金额空 -> 空串', F.fenToWan('') === '')
check('元文本 90000 -> 9.00 万元', F.yuanToWan('90000') === '9.00', F.yuanToWan('90000'))
check('元文本带万元单位 -> 万元两位', F.yuanToWan('2553.23万元') === '2553.23', F.yuanToWan('2553.23万元'))
check('金额两位小数无后缀', !/万元$/.test(F.fenToWan(4900000)))

console.log('\n=== cellValue 取值（主表 + detail）===\n')
const row = { project_no: 'XM-001', budget_fen: 4900000, award_amount_fen: 0, status: '完成招标' }
const detail = F.rowDetail({ detail: JSON.stringify({
  completed: { winner: { lead: 'A', members: ['B'], isUnion: true }, packages: [], judges: [], corrections: [] },
  buyer: { phone: '027-123' }
}) })
check('主表 text 字段', F.cellValue('project_no', row, detail) === 'XM-001')
check('主表金额字段', F.cellValue('budget', row, detail) === '4.90', F.cellValue('budget', row, detail))
check('主表金额为0 -> 空串', F.cellValue('award', row, detail) === '')
check('detail 文本字段', F.cellValue('buyer_phone', row, detail) === '027-123')
check('detail 联合体字段', F.cellValue('winner', row, detail) === 'A，B', F.cellValue('winner', row, detail))
check('detail 空数组字段 -> 空串', F.cellValue('judges', row, detail) === '')
check('未知字段 -> 空串', F.cellValue('__nope__', row, detail) === '')

console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
