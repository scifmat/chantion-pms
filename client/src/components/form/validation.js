// 第 4 步统一校验规则集：纯函数，无 Vue 依赖，前端即时反馈与服务端二次校验共用同一口径。

export const STATUSES = ['意向公示', '正在招标', '终止招标', '完成招标']
// 监管地区已改由全国三级行政区划数据驱动（utils/regions.js + public/data/regions.json），
// 不再使用演示用的 5 个模拟省市常量。
export const METHODS = ['公开招标', '邀请招标', '竞争性谈判', '竞争性磋商', '询价采购', '单一来源']
export const TYPES = ['货物类', '工程类', '服务类']
export const DOC_WAYS = ['线上', '线下']
export const CORRECTION_ITEMS = ['采购公告', '采购文件', '采购结果', '其它更正']

const SHORT_HOSTS = /^(bit\.ly|t\.cn|dwz\.cn|sina\.lt|is\.gd|tinyurl\.com|goo\.gl|tiny\.cc|url\.cn|suo\.im|m\.rw\.com)/i
// 日期：分隔符 - / . 均兼容；日期与时间之间允许任意空格 / T；时间支持 H:M[:S]
const DATE_RE = /^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[\sT]+(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*(\d{1,2}))?)?\s*$/
// 金额单位 -> 换算到「元」的倍率。内置元/万元/亿元，业务配置页可停用或扩展（第 7 步）。
let AMOUNT_UNITS = { '元': 1, '万元': 10000, '亿元': 100000000 }
let AMOUNT_PATTERN = '亿元|万元|元'
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function rebuildAmountPattern() {
  AMOUNT_PATTERN = Object.keys(AMOUNT_UNITS)
    .sort(function (a, b) { return b.length - a.length })   // 长单位优先，避免「万元」被「元」抢先匹配
    .map(escapeRe).join('|')
}
export function setAmountUnits(map) {
  const next = { '元': 1, '万元': 10000, '亿元': 100000000 }   // 内置保底，防止配置把单位清空
  if (map && typeof map === 'object') {
    Object.keys(map).forEach(function (k) {
      const name = String(k).trim()
      const f = Number(map[k])
      if (name && Number.isSafeInteger(f) && f > 0) next[name] = f
    })
  }
  AMOUNT_UNITS = next
  rebuildAmountPattern()
}
export function getAmountUnits() { return Object.assign({}, AMOUNT_UNITS) }
const URL_RE = /^(https?):\/\/([^\/\s]+)(\/\S*)?$/i

function p2(n) { return String(n).padStart(2, '0') }

/* ---------- 空格过滤（防坑 K-9 / 11.1） ---------- */

// 返回过滤后的值；trimEnds 为 true 时去掉首尾空格（blur 阶段才做，避免打断打字）
export function stripSpaces(value, rule, trimEnds = false) {
  let s = String(value == null ? '' : value)
  if (rule === 'multiline' || rule === 'address') {
    s = s.replace(/[ \t]+/g, ' ')
    if (trimEnds) s = s.trim()
    return s
  }
  return s.replace(/\s+/g, '')
}

/* ---------- 日期 / 日期时间（防坑 K-5） ---------- */

/**
 * 日期/时间粘贴兼容（第 7 轮紧急修复）：
 *  - 中文年月日 2026年11月13日 / 2026 年 11 月 13 日
 *  - 分隔符 - / .，如 2026/11/13、2026.11.13
 *  - 任意数量空格（含全角 \u3000）、T 分隔，中文时分秒 9时3分
 *  - 不标准时分秒 9:3 -> 09:03:00；纯日期字段只保留 YYYY-MM-DD
 * 统一输出 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss；无法识别返回 null。
 */
export function normalizeDateText(value, withTime) {
  let s = String(value == null ? '' : value)
    .replace(/\u3000/g, ' ')                       // 全角空格统一成半角
    .trim()
  if (!s) return ''
  s = s.replace(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g, '$1-$2-$3')
  s = s.replace(/(\d{1,2})\s*时/g, '$1:')
       .replace(/(\d{1,2})\s*分/g, '$1:')
       .replace(/(\d{1,2})\s*秒/g, '$1')
       .replace(/：/g, ':')
       .replace(/:\s*$/, '')                        // 9时3分 -> 9:3: -> 9:3
  const m = DATE_RE.exec(s)
  if (!m) return null
  const mo = Number(m[2]), day = Number(m[3])
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
  const date = m[1] + '-' + p2(mo) + '-' + p2(day)
  if (!withTime) return date
  const hh = Number(m[4] || 0), mm = Number(m[5] || 0), ss = Number(m[6] || 0)
  if (hh > 23 || mm > 59 || ss > 59) return null
  return date + ' ' + p2(hh) + ':' + p2(mm) + ':' + p2(ss)
}

export function isEarlierEnd(start, end) {
  const a = String(start == null ? '' : start).trim()
  const b = String(end == null ? '' : end).trim()
  if (!a || !b) return false
  return b < a   // 固定 YYYY-MM-DD / YYYY-MM-DD HH:mm:ss，字典序即时间序
}

/* ---------- 网址（11.5-6） ---------- */

export function urlOk(value) {
  const s = String(value == null ? '' : value).trim()
  if (!s) return true
  const m = URL_RE.exec(s)
  if (!m) return false
  const host = m[2].toLowerCase().replace(/^www\./, '')
  if (!/^https?$/i.test(m[1])) return false
  if (!host.includes('.')) return false
  if (SHORT_HOSTS.test(host)) return false
  return true
}

/* ---------- 金额识别与换算（10.1 / 10.2 / 防坑 K-1） ---------- */

// 十进制字符串 × 任意正整数倍率：BigInt 定点运算，绝不经过浮点，小数位如实保留。
// 这样业务配置里新增任意倍率的单位（如 千元=1000）也能精确换算。
function scaleDecimal(s, factor) {
  const parts = s.split('.')
  const dec = parts[1] || ''
  const scale = 10n ** BigInt(dec.length)
  const n = BigInt(parts[0]) * scale + BigInt(dec || '0')
  const prod = n * BigInt(factor)
  const intPart = prod / scale
  const rem = prod % scale
  if (rem === 0n) return intPart.toString()
  return intPart.toString() + '.' + rem.toString().padStart(dec.length, '0').replace(/0+$/, '')
}

// 「元」文本 -> 万元两位展示（BigInt 精确四舍五入，不用浮点）
function wanText(yuan) {
  const p = yuan.split('.')
  let f = BigInt(p[0]) * 100n + BigInt(((p[1] || '') + '00').slice(0, 2))
  if ((p[1] || '').length >= 3 && Number(p[1][2]) >= 5) f += 1n
  const cents = (f + 5000n) / 10000n   // 0.01 万元 = 10000 分
  return (cents / 100n).toString() + '.' + (cents % 100n).toString().padStart(2, '0')
}

// 带单位金额 -> { yuan: 精确「元」文本, wan: 万元两位, unit }；纯数字默认「元」。
// 单位与倍率来自业务配置（setAmountUnits），与服务端 money.js 同口径。
export function parseAmount(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/,/g, '')
  if (!s) return null
  const m = new RegExp('^(\\d+(?:\\.\\d+)?)\\s*(' + AMOUNT_PATTERN + ')?$').exec(s)
  if (!m) return null
  const unit = m[2] || '元'
  const yuan = scaleDecimal(m[1], AMOUNT_UNITS[unit] || 1)
  return { yuan: yuan, wan: wanText(yuan), unit: unit }
}

/* ---------- 评委智能识别（7.5 / 11.4） ---------- */

function splitTopLevel(text) {
  const out = []
  let buf = '', depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '（' || ch === '(') { depth++; buf += ch; continue }
    if (ch === '）' || ch === ')') { depth = depth > 0 ? depth - 1 : 0; buf += ch; continue }
    if (depth === 0 && '、,，;；\n'.indexOf(ch) >= 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue }
    buf += ch
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function cleanFragment(s) {
  return s.replace(/包[0-9一二三四五六七八九十百]+/g, '')
    .replace(/组长|采购人代表|业主|采购人/g, '')
    .replace(/[\s（）()、,，;；·:：0-9]/g, '')
}

export function parseJudges(text) {
  const list = [], unknown = []
  splitTopLevel(String(text == null ? '' : text)).forEach(function (part) {
    let inner = ''
    const rest = part.replace(/[（(]([^）)]*)[）)]/g, function (mm, body) { inner += (inner ? '、' : '') + body; return ' '; })
    const nameMatch = /[\u4e00-\u9fa5]{2,4}/.exec(cleanFragment(rest))
    const all = inner + '、' + rest
    const leader = /组长/.test(all)
    const owner = /采购人代表|业主/.test(all)
    // 含明显垃圾字符（字母 / # / @ 等）的片段一律判为无法识别，避免「无法识别##」被当成姓名
    const hasJunk = /[A-Za-z#@$%^&*?<>|\\/]/.test(part)
    if (nameMatch && !hasJunk) list.push({ name: nameMatch[0], leader: leader, owner: owner })
    else if (cleanFragment(part).length >= 2 || hasJunk) unknown.push(part)
  })
  return { list: list, unknown: unknown }
}

/* ---------- 状态互斥判空（2.3（3）） ---------- */

// 只判断传入模块自身，绝不牵连意向公示 / 正在招标 / 公共信息
export function hasStageData(obj) {
  if (!obj || typeof obj !== 'object') return false
  return Object.keys(obj).some(function (k) {
    if (k === 'isSplit' || k === 'isUnion') return false
    const v = obj[k]
    if (Array.isArray(v)) return v.some(function (x) { return typeof x === 'string' ? !!x.trim() : hasStageData(x) })
    if (v && typeof v === 'object') return hasStageData(v)
    return String(v == null ? '' : v).trim() !== ''
  })
}

export function emptyWinner() { return { lead: '', members: [''], isUnion: false } }
export function emptyCompleted() {
  return {
    type: '', amount_yuan: '', winDate: '', winner: emptyWinner(),
    isSplit: false, packages: [], judges: [], url: ''
  }
}
export function emptyTerminated() { return { reason: '', note: '', url: '' } }

/* ---------- 分包 / 联合体（10.3 / 10.4） ---------- */

export function normPkg(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase().replace(/[\uff01-\uff5e]/g, function (ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  })
}

export function packageDuplicateErrors(packages) {
  const errors = {}
  const arr = Array.isArray(packages) ? packages : []
  const names = arr.map(function (p) { return normPkg(p && p.name) }).filter(Boolean)
  arr.forEach(function (p, i) {
    if (p && p.name && names.filter(function (n) { return n === normPkg(p.name); }).length > 1) {
      errors['completed.packages.' + i + '.name'] = '包号/包名重复'
    }
  })
  return errors
}

export function validateWinner(w) {
  if (!w || !w.isUnion) return ''
  const lead = String(w.lead == null ? '' : w.lead).trim()
  const members = (Array.isArray(w.members) ? w.members : []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean)
  if (!lead) return '请输入牵头单位'
  if (!members.length) return '成员单位至少 1 家'
  if (members.length > 10) return '成员单位最多 10 家'
  if (new Set(members).size !== members.length) return '成员单位重复'
  if (members.indexOf(lead) >= 0) return '牵头单位与成员单位重复'
  return ''
}

// 收集 detail 内所有网址字段，供服务端二次校验与前端提交前统一扫描
export function collectUrlPaths(d) {
  const paths = [
    ['intention.url', d.intention && d.intention.url],
    ['bidding.url', d.bidding && d.bidding.url],
    ['terminated.url', d.terminated && d.terminated.url],
    ['completed.url', d.completed && d.completed.url]
  ]
  ;(d.corrections || []).forEach(function (c, i) { paths.push(['corrections.' + i + '.url', c && c.url]) })
  return paths
}
