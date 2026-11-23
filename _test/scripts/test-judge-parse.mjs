/**
 * 评委智能识别单测（纯 Node，不依赖浏览器 / 测试框架）。
 * 运行：node _test/scripts/test-judge-parse.mjs
 * 覆盖：规范 7.5 原有场景 + 2026-11-23 调研中列出的全部缺口。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const mod = await import(pathToFileURL(path.join(ROOT, 'client/src/components/form/validation.js')).href)
const { parseJudges } = mod

let pass = 0
const failures = []

// expected: [[name, leader, owner], ...]
function check(text, expected, expectedUnknown = []) {
  try {
    const r = parseJudges(text)
    assert.deepStrictEqual(r.list.map(function (j) { return [j.name, !!j.leader, !!j.owner] }), expected, '姓名/属性不符')
    assert.deepStrictEqual(r.unknown, expectedUnknown, '无法识别片段不符')
    pass++
  } catch (e) {
    failures.push(JSON.stringify(text) + ' → ' + e.message.replace(/\s+/g, ' ').slice(0, 180))
  }
}

/* ---------- 一、原有能力回归 ---------- */
check('张三（包1组长、包2、包3）、赵四（采购人代表，包1）、王五（组长、采购人代表）',
  [['张三', true, false], ['赵四', false, true], ['王五', true, true]])
check('林玲(包1)、陈军(包1)、殷星亮(包1组长)',
  [['林玲', false, false], ['陈军', false, false], ['殷星亮', true, false]])
check('张三【包1组长】、李四[业主]', [['张三', true, false], ['李四', false, true]])
check('张三（包1组长）；李四（业主）；王五', [['张三', true, false], ['李四', false, true], ['王五', false, false]])
check('张三（包一组长、包二）', [['张三', true, false]])
check('张三（包1组长）(业主)', [['张三', true, true]])
check('张三（包1组长', [['张三', true, false]])
check('（包1组长）张三', [['张三', true, false]])
check('“张三”（组长）', [['张三', true, false]])
check('张三，李四；王五、赵六', [['张三', false, false], ['李四', false, false], ['王五', false, false], ['赵六', false, false]])
check('张三\n李四\n王五', [['张三', false, false], ['李四', false, false], ['王五', false, false]])
check('张三、无法识别##、李四', [['张三', false, false], ['李四', false, false]], ['无法识别##'])
check('包1张三、包2李四', [['张三', false, false], ['李四', false, false]])
check('张三（包1组长）、、李四', [['张三', true, false], ['李四', false, false]])
check('王小明（采购人代表）、李晓红（采购人代表）', [['王小明', false, true], ['李晓红', false, true]])

/* ---------- 二、断句与姓名提取缺口 ---------- */
check('张三 李四 王五', [['张三', false, false], ['李四', false, false], ['王五', false, false]])
check('张三　李四', [['张三', false, false], ['李四', false, false]])
check('张三/李四', [['张三', false, false], ['李四', false, false]])
check('1.张三 2.李四', [['张三', false, false], ['李四', false, false]])
check('张三（包1组长）和李四（包3）', [['张三', true, false], ['李四', false, false]])
check('评委：张三、李四', [['张三', false, false], ['李四', false, false]])
check('评标专家张三、评标专家李四', [['张三', false, false], ['李四', false, false]])
check('阿依古丽买买提（包1组长）', [['阿依古丽买买提', true, false]])
check('约翰·史密斯（业主）', [['约翰·史密斯', false, true]])
check('张三、张三（业主）', [['张三', false, true]], [], '同批重复姓名合并、属性取或')

/* ---------- 三、业主同义词与组长边界 ---------- */
check('甲方代表张三', [['张三', false, true]])
check('招标人代表李四', [['李四', false, true]])
check('采购人（业主）代表王五', [['王五', false, true]])
check('采购方代表钱七、甲方代表孙八', [['钱七', false, true], ['孙八', false, true]])
check('张三(副组长)', [['张三', false, false]], [], '副组长不算组长')
check('张三(组长助理)', [['张三', false, false]], [], '组长助理不算组长')

/* ---------- 四、无法识别片段收口 ---------- */
check('张', [], ['张'])
check('John Smith（组长）', [], ['John Smith(组长)'])
check('ＡＢＣ张三', [], ['ABC张三'])
check('张三、John Smith、李四', [['张三', false, false], ['李四', false, false]], ['John Smith'])
check('', [])
check(null, [])
check('123', [], [], '纯数字静默忽略')

/* ---------- 五、服务端轻量复核 ---------- */
const requireFromServer = createRequire(path.join(ROOT, 'server/app.js'))
const { mergeDetail } = requireFromServer('./detail.js')
const detail = mergeDetail({ completed: { judges: [
  { name: ' 张三 ', leader: true }, { name: '张三', owner: true }, { name: '李四\u0001' }
] } })
assert.deepStrictEqual(detail.completed.judges, [
  { name: '张三', leader: true, owner: true },
  { name: '李四', leader: false, owner: false }
])
pass++

/* ---------- 六、交互时机防回退（源码断言） ---------- */
const judgeSrc = fs.readFileSync(path.join(ROOT, 'client/src/components/form/JudgeInput.vue'), 'utf8')
assert.match(judgeSrc, /@blur="onBlurInput"/, '必须监听失焦识别')
assert.match(judgeSrc, /@enter="flushNow"/, '必须支持 Enter 识别')
assert.doesNotMatch(judgeSrc, /watch\(text|setTimeout\(flush/, '打字过程中不得自动识别并清空输入框')
assert.match(judgeSrc, /r\.unknown\.length \? r\.unknown\.join/, '无法识别原文应保留在输入框')
pass++

console.log('评委识别单测：' + pass + ' 通过，' + failures.length + ' 失败')
if (failures.length) {
  failures.forEach(function (f) { console.error('  ✗ ' + f) })
  process.exitCode = 1
}
