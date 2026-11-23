/**
 * 金额容错解析单测（纯 Node，不依赖浏览器 / 测试框架）。
 * 运行：node _test/scripts/test-amount-parse.mjs
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const mod = await import(pathToFileURL(path.join(ROOT, 'client/src/components/form/validation.js')).href)
const { parseAmount, cleanAmountText, toHalfWidth, setAmountUnits } = mod

let pass = 0
const failures = []

function check(input, expectedYuan, label) {
  try {
    const got = parseAmount(input)
    assert.ok(got, '解析返回 null（未能识别）')
    assert.strictEqual(got.yuan, expectedYuan, 'yuan 不符')
    pass++
  } catch (e) {
    failures.push((label || JSON.stringify(input)) + ' -> 期望 ' + expectedYuan + '，实际 ' +
      (e.actual !== undefined ? JSON.stringify(e.actual) : e.message))
  }
}
function checkNull(input, label) {
  try {
    assert.strictEqual(parseAmount(input), null, '应当无法识别')
    pass++
  } catch (e) {
    failures.push((label || JSON.stringify(input)) + ' -> 期望 null，实际 ' + e.message)
  }
}

// —— 用户给出的 5 个必过用例 ——
check('500万', '5000000', '500万')
check('1.5(亿)', '150000000', '1.5(亿)')
check('万元：100', '1000000', '万元：100')
check('RMB 1,000.5万', '10005000', 'RMB 1,000.5万')
check('５００【万元】', '5000000', '５００【万元】')

// —— 更多奇奇怪怪的格式 ——
check('500(万元)', '5000000', '500(万元)')
check('1.5[亿]', '150000000', '1.5[亿]')
check('500【万】', '5000000', '500【万】')
check('万 500', '5000000', '万 500')
check('[万）:500', '5000000', '[万）:500')
check('￥500万', '5000000', '￥500万')
check('¥500万', '5000000', '¥500万')
check('$500万', '5000000', '$500万')
check('500万人民币', '5000000', '500万人民币')
check('1,234.56 元', '1234.56', '1,234.56 元')
check('7500000', '7500000', '纯数字')
check('1.5 亿', '150000000', '数字与单位间空格')
check('．５亿', '50000000', '全角小数点+全角数字')
check('1亿元', '100000000', '1亿元')
check('3000元整', '3000', '3000元整')
check('.5万', '5000', '.5万')
check('约 2026年中标金额 500万元（含税）', '5000000', '长文本带无关数字')
check('中标金额（万元）：1,200.75', '12007500', '表头单位+千分位')
check('　５００　万　', '5000000', '全角空格隔断')

// 展示值（万元两位，BigInt 定点）
assert.strictEqual(parseAmount('RMB 1,000.5万').wan, '1000.50', 'wan 两位展示')
pass++

// 清洗中间产物可预期
assert.equal(toHalfWidth('５００，５００（万）'), '500,500(万)', '全角转半角')
pass++
assert.equal(cleanAmountText('RMB 1,000.5 万元'), '1000.5万元', '清洗结果')
pass++

// —— 无法识别的场景 ——
;['', '   ', 'abc', '万元', '￥', '—', null, undefined, '元元元'].forEach(function (v) {
  checkNull(v, String(v))
})

// —— 业务配置扩展单位（放在最后，避免污染上面的用例）——
setAmountUnits({ 千元: 1000 })
check('5千元', '5000', '自定义单位 千元')
setAmountUnits({})

// —— 交互层：input 只提示不改写，blur 才清洗 ——
const { createRequire } = await import('node:module')
const requireFromClient = createRequire(path.join(ROOT, 'client/package.json'))
const { reactive } = requireFromClient('vue')
const { useValidation } = await import(pathToFileURL(path.join(ROOT, 'client/src/components/form/useValidation.js')).href)
const form = reactive({ completed: { amount_yuan: '' } })
const validation = useValidation(form)
const fieldPath = 'completed.amount_yuan'
validation.register(fieldPath, 'amount', function () { return form.completed.amount_yuan })
const el = { value: '500万', selectionStart: 3, setSelectionRange: function () {} }

validation.validateField(fieldPath, { el: el, phase: 'input' })
assert.equal(el.value, '500万', 'input 阶段不得改写输入框')
assert.equal(form.completed.amount_yuan, '', 'input 阶段不得写回 form')
assert.match(validation.hints[fieldPath], /万元/, 'input 阶段应给出换算提示')
pass++

validation.validateField(fieldPath, { el: el, phase: 'blur' })
assert.equal(el.value, '5000000', 'blur 阶段应清洗为纯元值')
assert.equal(form.completed.amount_yuan, '5000000', 'blur 阶段应同步 form')
pass++

el.value = '￥abc'
validation.validateField(fieldPath, { el: el, phase: 'input' })
assert.equal(el.value, '￥abc', '无法识别时 input 阶段也不得改写输入框')
assert.equal(validation.hints[fieldPath].text, '金额格式无法识别', '无法识别时即时提示')
assert.equal(validation.hints[fieldPath].level, 'error', '无法识别时提示级别为 error')
pass++

validation.validateField(fieldPath, { el: el, phase: 'blur' })
assert.equal(validation.errors[fieldPath], '金额格式无法识别', 'blur 时标红阻断保存')
assert.equal(validation.blocking.value, true, '无法识别时 blocking 应生效')
pass++

console.log('金额解析单测：' + pass + ' 通过，' + failures.length + ' 失败')
if (failures.length) {
  failures.forEach(function (f) { console.error('  ✗ ' + f) })
  process.exitCode = 1
}
