import { reactive, computed } from 'vue'
import * as V from './validation.js'

const REQUIRED = [
  ['public.status', '项目状态'], ['public.region', '监管地区'], ['public.project_no', '项目编号'],
  ['public.project_name', '项目名称'], ['buyer.name', '单位名称'], ['agency.name', '机构名称']
]

function getPath(o, p) {
  return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o)
}
function setPath(o, p, v) {
  const ks = p.split('.')
  let t = o   // 必须 let：下面要逐层下移；原先写成 const 会在值变化时抛 TypeError
  for (let i = 0; i < ks.length - 1; i++) {
    if (t[ks[i]] == null) t[ks[i]] = {}
    t = t[ks[i]]
  }
  t[ks[ks.length - 1]] = v
}

/**
 * 统一校验中枢：reactive errors（错误 + 阻断）、reactive hints（金额换算提示）。
 * 所有输入事件由 Field.vue 用 @input.capture 委托进来；只跑「当前字段」的规则，
 * 不做全表扫描；查重用 AbortController + 序号比对，避免过期响应与并发脏提示。
 */
export function useValidation(form, options = {}) {
  const errors = reactive({})
  const hints = reactive({})
  const registry = new Map()   // path -> { rule, get }
  const timers = new Map()
  let abortCtrl = null
  let checkSeq = 0
  const excludeId = options.excludeId || 0

  const blocking = computed(function () {
    return Object.keys(errors).some(function (k) { return !!errors[k] })
  })

  // 值不变就不写 reactive，减少输入过程中的重渲染调度
  function setError(path, msg) { if (msg) { if (errors[path] !== msg) errors[path] = msg } else delete errors[path] }
  // hint 支持 { text, level: 'error' }：输入阶段即可标红，又不进 errors（不会触发整表重渲染/吞字）
  function sameHint(a, b) {
    if (a === b) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    return a.text === b.text && a.level === b.level
  }
  function setHint(path, msg) {
    if (!msg) { delete hints[path]; return }
    if (!sameHint(hints[path], msg)) hints[path] = msg
  }
  function register(path, rule, get) { registry.set(path, { rule: rule, get: get }) }
  function unregister(path) {
    registry.delete(path); setError(path, ''); setHint(path, '')
  }
  function debounce(path, fn, ms) {
    if (timers.has(path)) clearTimeout(timers.get(path))
    timers.set(path, setTimeout(fn, ms))
  }
  function clear() {
    Object.keys(errors).forEach(function (k) { delete errors[k] })
    Object.keys(hints).forEach(function (k) { delete hints[k] })
    timers.forEach(function (t) { clearTimeout(t) })
    timers.clear()
    if (abortCtrl) abortCtrl.abort()
  }

  // 编号即时查重：编辑模式传 excludeId 排除自身
  async function checkNo(value) {
    const no = String(value == null ? '' : value).trim()
    if (!no) { setError('public.project_no', ''); return }
    checkSeq += 1
    const mySeq = checkSeq
    if (abortCtrl) abortCtrl.abort()
    abortCtrl = new AbortController()
    try {
      const url = '/api/projects/check-no?no=' + encodeURIComponent(no) + '&excludeId=' + encodeURIComponent(String(excludeId))
      const res = await fetch(url, { signal: abortCtrl.signal })
      const data = await res.json()
      if (mySeq !== checkSeq) return
      setError('public.project_no', data.data && data.data.exists ? '项目编号已存在' : '')
    } catch (e) {
      if (e.name !== 'AbortError') setError('public.project_no', '编号查重暂不可用')
    }
  }

  /**
   * 单字段校验（由 Field 在捕获阶段调用）。返回当前值。
   *
   * 关键修复：金额字段在「输入阶段」绝对不改写 el.value。第 4 步的统一空格过滤会在
   * 捕获阶段重写 DOM 值并 setSelectionRange，造成吞字 / 光标乱跳；金额现在只在
   * blur / submit（用户已失焦或提交）时才清洗规范化为纯数字「元」。
   * 即时换算只写下方提示（hints），不碰输入框本身。
   */
  function validateField(path, ctx) {
    const item = registry.get(path)
    const rule = item ? item.rule : 'short'
    const el = ctx.el
    const phase = ctx.phase || 'input'
    const isTyping = phase === 'input' || phase === 'change'
    const isAmount = rule === 'amount'
    const isDate = rule === 'date' || rule === 'datetime'
    const original = el ? el.value : String(ctx.value == null ? '' : ctx.value)
    const isMultiSelect = !!(el && el.tagName === 'SELECT' && el.multiple)

    // 1) 空格过滤：金额、日期/时间、多选下拉一律跳过。
    // 日期时间中间的空格是格式本身（2026-11-13 09:30:00），绝不能被短文本规则误删；
    // 输入阶段也不改写 DOM 值，避免重演吞字。
    let v
    if (isAmount || isDate || isMultiSelect) {
      v = isMultiSelect ? String(item && item.get() == null ? '' : item.get()) : original
    } else {
      const isLong = (rule === 'multiline' || rule === 'address')
      const trimEnds = phase === 'blur' || phase === 'submit'
      const next = V.stripSpaces(original, isLong ? 'multiline' : 'short', trimEnds && isLong)
      if (el && next !== el.value) {
        const start = el.selectionStart == null ? next.length : el.selectionStart
        const caret = V.stripSpaces(el.value.slice(0, start), isLong ? 'multiline' : 'short', false).length
        el.value = next
        try { el.setSelectionRange(caret, caret) } catch (e) { /* 部分 input 类型不支持选区 */ }
      }
      v = el ? el.value : next
    }

    // 2) 必填（仅 blur / submit 阶段，输入中不闪红）
    const req = REQUIRED.find(function (x) { return x[0] === path; })
    if (req && !isTyping) setError(path, String(v).trim() ? '' : '必填')

    // 3) 按规则分派
    if (rule === 'projectNo') {
      if (!String(v).trim()) { if (phase === 'submit') setError(path, '必填'); else setError(path, '') }
      else debounce(path, function () { checkNo(v); }, 250)
    } else if (isDate) {
      const normalized = V.normalizeDateText(v, rule === 'datetime')
      if (v && normalized === null) {
        // 输入过程中不闪红；失焦 / 提交时才标红并阻断保存
        if (!isTyping) setError(path, '日期格式不正确（可用 2026-11-13、2026年11月13日、2026/11/13 9:30）')
      } else if (!isTyping) {
        setError(path, '')
        // blur / 保存：只把标准值写回 form，由 v-model 驱动 el-date-picker 显示；
        // 绝不直接改 el.value / selectionStart，避免打断输入或干扰组件内部状态。
        if (normalized && String(getPath(form, path) == null ? '' : getPath(form, path)) !== normalized) {
          setPath(form, path, normalized)
        }
      }
    } else if (rule === 'url') {
      setError(path, V.urlOk(v) ? '' : '网址格式不正确（需 http/https，不支持短链）')
    } else if (isAmount) {
      const a = V.parseAmount(v)
      // 输入阶段只写 hints（由 Field 的 sync watchEffect 纯 DOM 副作用消费）。
      // 无法识别时用 level:'error' 的 hint 即时标红，但绝不写 errors：
      // blocking computed 会让 ProjectForm 重渲染，同样会回退 el.value。
      if (!String(v).trim()) {
        setHint(path, '')
        if (!isTyping) setError(path, '')
      } else if (!a) {
        setHint(path, { text: '金额格式无法识别', level: 'error' })
        if (!isTyping) setError(path, '金额格式无法识别')
      } else {
        // 换算结果只写在输入框下方，绝不改写输入框本身的值
        setHint(path, '≈ ' + a.wan + ' 万元 · 换算为 ' + a.yuan + ' 元')
        if (!isTyping) {
          setError(path, '')
          // blur / 保存：清洗成纯数字「元」，同步 DOM 与 form（已失焦，不会打断打字）
          if (el && a.yuan !== el.value) el.value = a.yuan
          if (String(getPath(form, path) == null ? '' : getPath(form, path)) !== a.yuan) setPath(form, path, a.yuan)
          v = a.yuan
        }
      }
    }
    return v
  }

  // 结构型规则：分包包名重复 + 联合体牵头/成员
  function validateStructural() {
    const c = form.completed || {}
    Object.keys(errors).forEach(function (k) {
      if (k.indexOf('completed.packages.') === 0 || k === 'completed.winner.lead') delete errors[k]
    })
    if (c.isSplit) {
      const dup = V.packageDuplicateErrors(c.packages)
      Object.keys(dup).forEach(function (k) { setError(k, dup[k]) })
      ;(c.packages || []).forEach(function (p, i) {
        const msg = V.validateWinner(p && p.winner)
        if (msg) setError('completed.packages.' + i + '.winner.lead', msg)
      })
    } else {
      const msg = V.validateWinner(c.winner)
      if (msg) setError('completed.winner.lead', msg)
    }
  }

  // 时间段先后：3 对，错误只挂在「结束」字段
  function validateTimeOrder() {
    const pairs = [
      ['intention.startDate', 'intention.endDate'],
      ['bidding.docStart', 'bidding.docEnd'],
      ['bidding.bidStart', 'bidding.bidEnd']
    ]
    pairs.forEach(function (pair) {
      const a = String(getPath(form, pair[0]) == null ? '' : getPath(form, pair[0])).trim()
      const b = String(getPath(form, pair[1]) == null ? '' : getPath(form, pair[1])).trim()
      setError(pair[1], V.isEarlierEnd(a, b) ? '结束时间不能早于开始时间' : '')
    })
  }

  // 网址总扫（提交前兜底，覆盖动态更正组）
  function validateUrls() {
    V.collectUrlPaths(form).forEach(function (pair) {
      if (!V.urlOk(pair[1])) setError(pair[0], '网址格式不正确（需 http/https，不支持短链）')
    })
  }

  /** 提交前整表校验：逐字段 + 必填 + 结构 + 时间段 + 网址；标准化结果写回 form。 */
  function validateAll() {
    registry.forEach(function (item, path) {
      const raw = item.get()
      if (Array.isArray(raw)) return   // 多选数组由 v-model 自行维护，不能被字符串覆盖
      const before = String(raw == null ? '' : raw)
      const el = { value: before, selectionStart: null, setSelectionRange: function () {} }
      validateField(path, { el: el, phase: 'submit' })
      if (el.value !== before) setPath(form, path, el.value)
    })
    REQUIRED.forEach(function (r) {
      if (!String(getPath(form, r[0]) == null ? '' : getPath(form, r[0])).trim()) setError(r[0], '必填')
    })
    validateStructural()
    validateTimeOrder()
    validateUrls()
    return !blocking.value
  }

  function setServerErrors(fields, message) {
    if (fields && fields.length) fields.forEach(function (p) { setError(p, '必填') })
    return message
  }

  return {
    errors, hints, blocking,
    register, unregister, validateField, validateAll, validateStructural, validateTimeOrder,
    checkNo, setServerErrors, clear
  }
}
