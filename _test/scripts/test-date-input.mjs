/**
 * 日期/时间输入兼容单测：验证 normalizeDateText 的识别覆盖面，以及 DateField 的可输入约束。
 * 运行：node _test/scripts/test-date-input.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const mod = await import(pathToFileURL(path.join(ROOT, 'client/src/components/form/validation.js')).href)
const { normalizeDateText } = mod

let pass = 0
const failures = []
function check(raw, withTime, expected) {
  try {
    assert.strictEqual(normalizeDateText(raw, withTime), expected)
    pass++
  } catch (e) {
    failures.push(JSON.stringify(raw) + ' (withTime=' + withTime + ') → 期望 ' +
      JSON.stringify(expected) + '，实际 ' + JSON.stringify(e.actual))
  }
}

// 标准格式 / 手打 / 粘贴
check('2026-11-21 09:30:00', true, '2026-11-21 09:30:00')
check('2026-11-21 09:30:00', false, '2026-11-21')
check('2026-11-21', true, '2026-11-21 00:00:00')
check('2026-11-21', false, '2026-11-21')
check('2026/11/21 9:30', true, '2026-11-21 09:30:00')
check('2026.11.21', true, '2026-11-21 00:00:00')
check('2026-11-21T09:30:00Z', true, '2026-11-21 09:30:00')
check('2026-11-21 09:30:00.123', true, '2026-11-21 09:30:00')
check('2026-11-21 9:30:0', true, '2026-11-21 09:30:00')

// 中文年月日 / 时分秒 / 上下午
check('2026年11月21日', true, '2026-11-21 00:00:00')
check('2026年11月21日 9时30分', true, '2026-11-21 09:30:00')
check('2026年11月21日 9时3分5秒', true, '2026-11-21 09:03:05')
check('2026年12月11日 09点30分', true, '2026-12-11 09:30:00')
check('2026年12月11日09点30分', true, '2026-12-11 09:30:00')
check('2026-12-11 09点30分', true, '2026-12-11 09:30:00')
check('2026-12-1109点30分', true, '2026-12-11 09:30:00')
check('2026年12月11日 09点30分00秒', true, '2026-12-11 09:30:00')
check('2026年12月11日9点3分', true, '2026-12-11 09:03:00')
check('2026-11-21 下午3点30分', true, '2026-11-21 15:30:00')
check('2026-11-21 下午3:30', true, '2026-11-21 15:30:00')
check('2026-11-21 下午12:30', true, '2026-11-21 12:30:00')
check('2026-11-21 上午9:30', true, '2026-11-21 09:30:00')

// 全角 / 前后缀 / 区间粘贴
check('２０２６年１１月２１日 ０９：３０', true, '2026-11-21 09:30:00')
check('２０２６／１１／２１', false, '2026-11-21')
check('投标开始时间：2026-11-21 09:30', true, '2026-11-21 09:30:00')
check('2026-11-21 至 2026-11-22', false, '2026-11-21')
check('  2026-11-21  09:30  ', true, '2026-11-21 09:30:00')

// 非法值
check('2026-13-01', false, null)
check('2026-02-30 09:30', true, null)
check('abc', true, null)
check('', true, '')
check(null, false, '')

// DateField 的可输入约束（防止回退成只读或丢掉 Enter / 失焦归一化）
const src = fs.readFileSync(path.join(ROOT, 'client/src/components/form/DateField.vue'), 'utf8')
assert.match(src, /:editable="true"/, '必须显式开启 editable')
assert.doesNotMatch(src, /:readonly="true"|readonly\s*=/, '不得给 el-date-picker 加 readonly')
assert.match(src, /@keydown\.capture="onKeydown"/, '必须接管 Enter')
assert.match(src, /@blur\.capture="onBlur"/, '必须接管失焦')
assert.match(src, /@paste\.capture="onPaste"/, '必须接管粘贴')
assert.match(src, /pickerKey\.value \+= 1/, '非标准输入提交后应重建 picker 清掉内部原始文本')
pass++

console.log('日期输入单测：' + pass + ' 通过，' + failures.length + ' 失败')
if (failures.length) {
  failures.forEach(function (f) { console.error('  ✗ ' + f) })
  process.exitCode = 1
}
