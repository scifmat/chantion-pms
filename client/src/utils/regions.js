/**
 * 全国三级行政区划（省 / 市 / 区县）前端数据层。
 *
 * 数据文件由 scripts/build-regions.mjs 从
 * 02-数据/Administrative-divisions-of-China-master/dist/pca-code.json 离线精简生成，
 * 放在 client/public/data/regions.json，运行时按需 fetch 一次并模块级缓存：
 *   - 不进入主 JS bundle，首屏零负担；
 *   - 拼音首字母 p / 全拼 s 是离线预生成的索引，搜索时不做任何拼音计算。
 *
 * 节点结构：{ c: code, n: 名称, p: 拼音首字母, s: 全拼, h: 子节点数组(可选) }
 *
 * region 存储格式统一为「-」分隔的显示名，与历史数据完全一致：
 *   北京市-东城区            （二级名为「市辖区」等无区分度的中间层时跳过）
 *   浙江省-杭州市-西湖区
 *   北京市                   （checkStrictly 允许只选到省 / 市）
 * 查询接口仍用 LIKE 模糊匹配这个字符串，无需改动后端。
 */

const GENERIC_MIDDLE = new Set([
  '市辖区', '县', '市', '省直辖县级行政区划',
  '自治区直辖县级行政区划', '直辖县级行政区划', '省直辖行政单位'
])

let cache = null       // Promise，多个 RegionPicker 实例共享
let index = null       // { data, byCode: Map<code, {node, path}> }

export function loadRegions() {
  if (!cache) {
    cache = fetch('/data/regions.json')
      .then(function (r) {
        if (!r.ok) throw new Error('行政区划数据加载失败（' + r.status + '）')
        return r.json()
      })
      .then(function (data) {
        index = buildIndex(data)
        return data
      })
      .catch(function (e) { cache = null; throw e })
  }
  return cache
}

function buildIndex(data) {
  const byCode = new Map()
  function walk(nodes, parents) {
    (nodes || []).forEach(function (n) {
      const path = parents.concat(n)
      byCode.set(n.c, { node: n, path: path })
      if (n.h) walk(n.h, path)
    })
  }
  walk(data, [])
  return { data: data, byCode: byCode }
}

/** codes 数组 -> region 显示文本（跳过无区分度的中间层，保持历史格式） */
export function formatRegion(codes) {
  if (!index || !Array.isArray(codes) || !codes.length) return ''
  const names = codes.map(function (c) {
    const hit = index.byCode.get(String(c))
    return hit ? hit.node.n : ''
  }).filter(Boolean)
  if (!names.length || names.length !== codes.length) return ''
  if (names.length === 3 && GENERIC_MIDDLE.has(names[1])) return names[0] + '-' + names[2]
  return names.join('-')
}

/**
 * region 显示文本 -> codes 数组（编辑回显用）。
 * 逐层按名称匹配，兼容 1 / 2 / 3 段和「省-区」这种跳过市辖区的历史写法。
 * 匹配不上返回 ok:false，由 RegionPicker 降级展示原文本，绝不抛错、不改写原值。
 */
export function parseRegion(text) {
  const parts = String(text == null ? '' : text).trim().split(/[-/]/).map(function (s) { return s.trim() }).filter(Boolean)
  if (!index || !parts.length) return { ok: false, codes: [] }
  const provinces = index.data.filter(function (p) { return p.n === parts[0] })
  for (const p of provinces) {
    if (parts.length === 1) return { ok: true, codes: [p.c] }

    if (parts.length === 3) {
      const city = (p.h || []).find(function (c) { return c.n === parts[1] })
      if (city) {
        const area = (city.h || []).find(function (a) { return a.n === parts[2] })
        if (area) return { ok: true, codes: [p.c, city.c, area.c] }
      }
    }

    if (parts.length === 2) {
      // 先按「省-市」匹配
      const city = (p.h || []).find(function (c) { return c.n === parts[1] })
      if (city) return { ok: true, codes: [p.c, city.c] }
      // 再按「省-区」匹配（历史数据跳过了「市辖区」这类中间层）
      for (const c of (p.h || [])) {
        const area = (c.h || []).find(function (a) { return a.n === parts[1] })
        if (area) return { ok: true, codes: [p.c, c.c, area.c] }
      }
    }
  }
  return { ok: false, codes: [] }
}

/**
 * el-cascader 自定义搜索：汉字 / 拼音首字母 / 全拼 / 完整路径均可命中。
 * 例：bj -> 北京市(p=bjs)；beijing -> 北京市(s=beijingshi)；东城 -> 东城区。
 * node.text 由 Element Plus 在过滤前算好（含「省 / 市 / 区」完整路径）。
 */
export function filterRegion(node, keyword) {
  const k = String(keyword == null ? '' : keyword).trim().toLowerCase()
  if (!k) return true
  const d = node && node.data ? node.data : {}
  if (String(d.n || '').toLowerCase().indexOf(k) >= 0) return true
  if (d.p && String(d.p).indexOf(k) === 0) return true
  if (d.s && String(d.s).indexOf(k) >= 0) return true
  if (node && node.text && String(node.text).toLowerCase().indexOf(k) >= 0) return true
  return false
}

/** el-cascader 的 props：hover 展开、允许选父级、字段映射到精简数据 */
export const CASCADER_PROPS = {
  expandTrigger: 'hover',
  checkStrictly: true,
  value: 'c',
  label: 'n',
  children: 'h'
}
