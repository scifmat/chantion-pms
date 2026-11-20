/**
 * 金额换算（第 5 步）：前端只做「万元文本 -> 整数分字符串」的整数运算，
 * 后端只接受整数分，比较全程不出现浮点。1 万元 = 1,000,000 分。
 */

// 万元 -> 整数分字符串；空串返回 ''；格式非法或小数超过 6 位返回 null
// 例：500.55 -> (500 * 1000000 + 550000) = "500550000"
export function wanToFen(text) {
  const s = String(text == null ? '' : text).trim()
  if (s === '') return ''
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const parts = s.split('.')
  const int = parts[0]
  const dec = parts[1] || ''
  if (dec.length > 6) return null // 万元的第 6 位小数已是 1 分，再细无意义
  const frac = (dec + '000000').slice(0, 6)
  return (BigInt(int) * 1000000n + BigInt(frac)).toString()
}

// 整数分 -> 万元两位（仅用于展示，不参与比较）；原始元值为空或 0 时显示 —
export function fenToWan(yuan, fen) {
  const v = String(yuan == null ? '' : yuan).trim()
  if (!v || v === '0' || !Number(fen)) return '—'
  return (Number(fen || 0) / 1000000).toFixed(2)
}

/**
 * 详情页只读展示用：把「元」十进制文本换算成「万元」两位文本。
 * 与 server/money.js 的 yuanToFen 完全同口径（BigInt 定点、四舍五入到分），
 * 再除以 1,000,000 得到万元并严格 toFixed(2)；绝不经过浮点乘法。
 * 空值 / 0 / 非法值返回 ''，由展示层的 fmt 统一渲染成 '-'。
 * 例：25532300 元 -> fen 2553230000 -> "2553.23"
 */
export function yuanToFen(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const parts = s.split('.')
  const intPart = parts[0]
  const dec = parts[1] || ''
  if (dec.length === 0) return Number(BigInt(intPart) * 100n)
  const frac = BigInt(dec)
  const pow = 10n ** BigInt(dec.length)
  const numerator = frac * 100n
  let fen = BigInt(intPart) * 100n + numerator / pow
  if ((numerator % pow) * 2n >= pow) fen += 1n
  return Number(fen)
}

export function yuanToWan(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/,/g, '')
  if (!s || /^0+(\.0*)?$/.test(s)) return ''
  const fen = yuanToFen(s)
  if (fen === null || !Number.isFinite(fen) || fen === 0) return ''
  return (fen / 1000000).toFixed(2)
}
