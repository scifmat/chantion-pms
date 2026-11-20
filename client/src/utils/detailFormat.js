/**
 * 项目详情页只读展示格式化（纯函数，不依赖 Vue / 接口）。
 * 口径：所有空值一律半角 '-'；金额统一 XXX.XX 万元；网址由展示组件决定是否渲染链接。
 */
import { yuanToWan, fenToWan } from './money.js'

/** 取原始去首尾空白的文本（用于判空、比较、href） */
export function raw(v) {
  if (v == null) return ''
  return String(v).trim()
}

/** 空值统一半角 '-' */
export function fmt(v) {
  const s = raw(v)
  return s === '' ? '-' : s
}

/** 数组/多值：去空后用顿号连接，全空则 '-' */
export function fmtList(arr) {
  if (!Array.isArray(arr)) return '-'
  const list = arr.map(raw).filter(Boolean)
  return list.length ? list.join('、') : '-'
}

/**
 * 金额：优先用主表已有的整数分（与列表页 fenToWan 完全一致），
 * 没有 fen 时（如分包金额只有元文本）走 yuanToWan（与后端 yuanToFen 同口径）。
 * 输出统一带「 万元」后缀；空 / 0 -> '-'。
 */
export function fmtWan(yuan, fen) {
  let w = ''
  if (fen != null && Number(fen) > 0) {
    const v = raw(yuan)
    if (v && v !== '0') w = fenToWan(yuan, fen)
  }
  if (!w) w = yuanToWan(yuan)
  return w ? w + ' 万元' : '-'
}

/** 对象在给定键上是否至少有一个非空值（用于「空模块不展示」） */
export function anyFilled(obj, keys) {
  if (!obj || typeof obj !== 'object') return false
  return keys.some(function (k) { return raw(obj[k]) !== '' })
}

/** 数组是否有非空元素 */
export function hasNonEmpty(arr) {
  return Array.isArray(arr) && arr.some(function (x) { return raw(x) !== '' })
}

/** 中标单位对象是否有内容 */
export function winnerFilled(w) {
  if (!w || typeof w !== 'object') return false
  return raw(w.lead) !== '' || hasNonEmpty(w.members)
}
