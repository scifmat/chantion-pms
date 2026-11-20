/**
 * 档案多值字段的展示口径（前端拆分）。
 *
 * 后端 /api/archives 同时返回：
 *   - phone/email/address：逗号拼接的展示串（历史纯文本或 displayArchiveValues 结果）
 *   - phoneList/emailList/addressList：结构化数组
 * 这里统一接受「数组 / 逗号分隔串 / 混合」，拆成干净的字符串数组：
 *   - 中英文逗号、分号、换行都当作分隔符（地址本身一般不含这些符号）
 *   - 逐项 trim、去空、按出现顺序去重
 */
export function splitArchiveValues(input) {
  const raw = Array.isArray(input) ? input : [input]
  const out = []
  raw.forEach(function (item) {
    String(item == null ? '' : item)
      .split(/[,，;；\r\n]+/)
      .forEach(function (part) {
        const s = part.trim()
        if (s && out.indexOf(s) < 0) out.push(s)
      })
  })
  return out
}
