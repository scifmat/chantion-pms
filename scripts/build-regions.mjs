/**
 * 三级行政区划数据构建脚本（离线运行一次即可，运行时不依赖它）。
 *
 * 数据源：02-数据/Administrative-divisions-of-China-master/dist/pca-code.json
 *   —— 该仓库已整理好 省(31) → 市(342) → 区县(2978) 的三级树，正好是我们需要的层级，
 *      比 pcas-code.json（含第四级街道、1.9MB）小得多。
 *
 * 提取与精简：
 *   1. 只取三级，丢弃街道/村居等更细层级；
 *   2. 每个节点只保留 c(code) / n(name) / p(拼音首字母) / s(全拼) / h(children)，短键名 + 无缩进 JSON；
 *   3. p / s 是离线预生成的搜索索引：运行时不做任何拼音计算，直接字符串匹配，搜索极快；
 *   4. 产物放 client/public/data/regions.json，由浏览器按需 fetch 一次并模块级缓存，
 *      不进入主 JS bundle，首屏零负担。
 *
 * 拼音生成：优先用 pinyin-pro（离线生成时临时安装即可，不加入项目依赖）；
 * 找不到时回退到 Node 内置 ICU 拼音排序生成首字母（全拼留空，汉字/首字母搜索仍可用）。
 *
 * 用法：node scripts/build-regions.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, '02-数据', 'Administrative-divisions-of-China-master', 'dist', 'pca-code.json')
const OUT = path.join(ROOT, 'client', 'public', 'data', 'regions.json')

// ---- 拼音能力：pinyin-pro 可选；没有则用 ICU 拼音排序推首字母 ----
let pinyin = null
try {
  pinyin = require('pinyin-pro').pinyin
} catch (e) {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  try { pinyin = require(path.join(home, 'node_modules', 'pinyin-pro')).pinyin } catch (e2) { /* 回退 ICU */ }
}

const BOUNDS = [
  ['a', '啊'], ['b', '八'], ['c', '擦'], ['d', '搭'], ['e', '蛾'], ['f', '发'], ['g', '嘎'], ['h', '哈'],
  ['j', '击'], ['k', '喀'], ['l', '垃'], ['m', '妈'], ['n', '拿'], ['o', '哦'], ['p', '啪'], ['q', '七'],
  ['r', '然'], ['s', '撒'], ['t', '塌'], ['w', '挖'], ['x', '西'], ['y', '丫'], ['z', '匝']
]
const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin')
function initialOf(ch) {
  for (let i = BOUNDS.length - 1; i >= 0; i--) if (collator.compare(ch, BOUNDS[i][1]) >= 0) return BOUNDS[i][0]
  return ''
}
function spell(name) {
  const clean = String(name || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
  if (!clean) return { p: '', s: '' }
  if (pinyin) {
    const full = pinyin(clean, { toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z0-9]/g, '')
    const first = pinyin(clean, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z0-9]/g, '')
    return { p: first || [...clean].map(initialOf).join(''), s: full }
  }
  return { p: [...clean].map(initialOf).join(''), s: '' }
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const stat = { provinces: 0, cities: 0, areas: 0 }

function node(src, level) {
  const name = String(src.name || '').trim()
  const { p, s } = spell(name)
  const out = { c: String(src.code || ''), n: name, p, s }
  const children = Array.isArray(src.children) ? src.children : []
  if (children.length && level < 3) {
    out.h = children.map(function (x) { return node(x, level + 1) })
    if (level === 1) stat.cities += out.h.length
    if (level === 2) stat.areas += out.h.length
  }
  return out
}

const data = raw.map(function (x) { return node(x, 1) })
stat.provinces = data.length

fs.mkdirSync(path.dirname(OUT), { recursive: true })
const text = JSON.stringify(data)
fs.writeFileSync(OUT, text, 'utf8')

console.log('source :', SRC)
console.log('output :', OUT)
console.log('levels :', JSON.stringify(stat), 'total nodes =', stat.provinces + stat.cities + stat.areas)
console.log('size   :', (Buffer.byteLength(text) / 1024).toFixed(1) + ' KB (minified JSON)', '| gzip ~', (require('node:zlib').gzipSync(text).length / 1024).toFixed(1) + ' KB')
console.log('pinyin :', pinyin ? 'pinyin-pro (full + initials)' : 'ICU initials only')
console.log('sample :', JSON.stringify({ c: data[0].c, n: data[0].n, p: data[0].p, s: data[0].s, child: { n: data[0].h && data[0].h[0].n, p: data[0].h && data[0].h[0].p } }))
