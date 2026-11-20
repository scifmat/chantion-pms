/**
 * 地图 GeoJSON 下载脚本（第 15 步）：从阿里云 DataV.GeoAtlas 下载全国 + 34 省级地图到本地。
 * 目的：内网部署零外网依赖，前端直接从 /map/*.json 静态读取。
 *
 * 数据源：https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json
 *  - 100000_full.json = 全国（含省级边界）
 *  - 各省 adcode_full.json = 该省（含地级市边界），用于下钻
 *
 * 运行：node scripts/download-maps.mjs
 * 输出：client/public/map/china.json + {adcode}.json + index.json（adcode→名称映射）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT_DIR = path.join(ROOT, 'client/public/map')
const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'

// 34 个省级行政区 adcode（含直辖市、自治区、特别行政区）
const PROVINCES = [
  [110000, '北京市'], [120000, '天津市'], [130000, '河北省'], [140000, '山西省'], [150000, '内蒙古自治区'],
  [210000, '辽宁省'], [220000, '吉林省'], [230000, '黑龙江省'],
  [310000, '上海市'], [320000, '江苏省'], [330000, '浙江省'], [340000, '安徽省'],
  [350000, '福建省'], [360000, '江西省'], [370000, '山东省'],
  [410000, '河南省'], [420000, '湖北省'], [430000, '湖南省'], [440000, '广东省'], [450000, '广西壮族自治区'], [460000, '海南省'],
  [500000, '重庆市'], [510000, '四川省'], [520000, '贵州省'], [530000, '云南省'], [540000, '西藏自治区'],
  [610000, '陕西省'], [620000, '甘肃省'], [630000, '青海省'], [640000, '宁夏回族自治区'], [650000, '新疆维吾尔自治区'],
  [710000, '台湾省'], [810000, '中国香港'], [820000, '中国澳门']
]

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const text = await res.text()
  const data = JSON.parse(text) // 校验是合法 JSON
  if (!data.features || !Array.isArray(data.features)) throw new Error('非 GeoJSON FeatureCollection')
  fs.writeFileSync(dest, text)
  return data.features.length
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  let ok = 0, fail = 0
  const index = {}

  // 全国
  try {
    const n = await download(BASE + '/100000_full.json', path.join(OUT_DIR, 'china.json'))
    console.log('  OK   全国地图 china.json （' + n + ' 个省级要素）')
    ok++
  } catch (e) { console.log('  FAIL 全国地图: ' + e.message); fail++ }

  // 各省
  for (const [adcode, name] of PROVINCES) {
    try {
      const n = await download(BASE + '/' + adcode + '_full.json', path.join(OUT_DIR, adcode + '.json'))
      index[name] = { adcode: adcode, file: adcode + '.json', features: n }
      console.log('  OK   ' + name + ' (' + adcode + ') — ' + n + ' 个市级要素')
      ok++
    } catch (e) {
      // 台湾省 DataV 不提供 full 数据：尝试无下钻的省级边界，失败则标记不可下钻（不算失败）
      if (adcode === 710000) {
        try {
          const n = await download(BASE + '/710000.json', path.join(OUT_DIR, '710000.json'))
          index[name] = { adcode: adcode, file: '710000.json', features: n, noDrill: true }
          console.log('  OK   ' + name + ' (' + adcode + ') — 省级边界（不可下钻到市）')
          ok++
        } catch (e2) {
          index[name] = { adcode: adcode, file: null, noDrill: true }
          console.log('  WARN ' + name + ' — 无地图数据，全国图仍显示边界，不可下钻')
        }
      } else {
        console.log('  FAIL ' + name + ' (' + adcode + '): ' + e.message)
        fail++
      }
    }
    // 轻微限速，避免对数据源造成压力
    await new Promise(function (r) { setTimeout(r, 60) })
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2))
  console.log('\n========================================')
  console.log('  下载完成: 成功 ' + ok + ' / 失败 ' + fail)
  console.log('  输出目录: ' + OUT_DIR)
  console.log('========================================')
  if (fail > 0) process.exitCode = 1
}
main().catch(function (e) { console.error('下载异常:', e); process.exitCode = 1 })
