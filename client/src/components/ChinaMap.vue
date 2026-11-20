<template>
  <div class="china-map-wrap">
    <!-- 返回全国按钮：仅下钻后显示，右上角 -->
    <button v-if="drillable && drilled" class="map-back-btn" @click="backToChina">← 返回全国</button>
    <div v-if="drillable && drilled" class="map-drill-label">{{ currentProvince }} · 市级分布</div>
    <div ref="mapEl" class="china-map-canvas"></div>
    <div v-if="loadError" class="map-error">{{ loadError }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

/**
 * 全国→省级下钻热力地图。地图 GeoJSON 全部本地化在 /map/，零外网依赖。
 * props.geoData: [{name:'湖北省', value:3}]  全国省级中标次数
 * props.cityData: { '湖北省': {'武汉市':2,...} }  省级下钻用；也兼容 [{name:'武汉市',value:2}] 数组形状
 */
const props = defineProps({
  geoData: { type: Array, default: function () { return [] } },
  cityData: { type: Object, default: function () { return null } },
  drillable: { type: Boolean, default: true },
  valueUnit: { type: String, default: '个' }
})
// 下钻/返回时通知父组件，右侧榜单可同步切换数据口径
const emit = defineEmits(['drill', 'back'])

const mapEl = ref(null)
const drilled = ref(false)
const currentProvince = ref('')
const loadError = ref('')

let echarts = null
let chart = null
let observer = null
let disposed = false
let provinceIndex = null   // 省名 -> { adcode, file, noDrill }

async function ensureEcharts() {
  if (!echarts) echarts = (await import('../utils/echarts.js')).default
  return echarts
}

function dataToPairs(data) {
  // 无数据的区域给 0，保证地图不着色但正常显示
  return (data || []).map(function (x) { return { name: x.name, value: Number(x.value) || 0 }; })
}

function buildOption(mapName, pairs, title) {
  const values = pairs.map(function (p) { return p.value; })
  const max = Math.max.apply(null, values.concat([0]))
  // 全国图：GeoJSON 里的南海断续线一直延伸到北纬 3° 附近，ECharts 会按这个极南坐标
  // 计算整图外框，导致大陆只占上半部分、下方大片留白。用 boundingCoords 把视野锁定在
  // 大陆+近海（北纬 18° 以北），南海诸岛由 ECharts 内置的标准小图在右下角继续展示。
  // 省级下钻图沿用普通布局，不能套用全国经纬度范围。
  const chinaView = mapName === 'china' ? { boundingCoords: [[73, 54], [135, 18]] } : {}
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: '#fff', borderColor: '#e3e7ee', borderWidth: 1, padding: [8, 12],
      textStyle: { color: '#374151', fontSize: 12 },
      extraCssText: 'box-shadow:0 4px 16px rgba(16,24,40,.12);border-radius:6px;',
      formatter: function (p) { return p.name + '<br/>' + (props.valueUnit === '万元' ? '招标预算：<b>' : '中标项目数：<b>') + (Number(p.value) || 0) + '</b> ' + props.valueUnit; }
    },
    // visualMap 只做着色，不显示控件（用户要求去掉冗余控件）
    visualMap: {
      show: false, min: 0, max: max || 1,
      inRange: { color: ['#eaf1fb', '#a9c6f8', '#5b90f0', '#2f6fed', '#1749a8'] },
      calculable: false
    },
    series: [{
      type: 'map', map: mapName,
      // 初始地图尽量铺满画布：四边留 1% 内边距，preserveAspect 保持地图比例不拉伸。
      // ECharts 默认只取容器的 80% 尺寸，全国图四周留白偏大；这样设置可放大到不溢出的极限。
      left: '1%', top: '1%', right: '1%', bottom: '1%',
      preserveAspect: true,
      ...chinaView,
      // 开启交互：鼠标滚轮缩放 + 左键拖动平移（用户可放大查看小省份/密集区域）
      roam: true,
      // 缩放范围限制：防止缩到看不见或无限放大
      scaleLimit: { min: 0.8, max: 8 },
      name: title || '中标项目数',
      label: { show: false },
      itemStyle: { areaColor: '#eef1f6', borderColor: '#ffffff', borderWidth: 1.2 },
      emphasis: { label: { show: false }, itemStyle: { areaColor: '#2f6fed', borderColor: '#fff', borderWidth: 1.5 } },
      select: { disabled: true },
      data: pairs
    }]
  }
}

async function renderMap(mapName, pairs, title) {
  const ec = await ensureEcharts()
  if (disposed || !chartElReady()) return
  if (!chart) {
    chart = ec.init(mapEl.value)
    // 挂到 DOM 便于外部集成/自动化获取实例（echarts.getInstanceByDom 的替代）
    mapEl.value.__mapChart = chart
  }
  chart.setOption(buildOption(mapName, pairs, title), true)
}
function chartElReady() { return !!(mapEl.value && mapEl.value.offsetParent !== null) }

/** 加载全国图并注册 */
async function loadChina() {
  loadError.value = ''
  try {
    const res = await fetch('/map/china.json')
    if (!res.ok) throw new Error('全国地图数据加载失败')
    const geo = await res.json()
    const ec = await ensureEcharts()
    if (disposed) return
    ec.registerMap('china', geo)
    await nextTick()
    await renderMap('china', dataToPairs(props.geoData), '中标项目数')
  } catch (e) {
    loadError.value = '地图数据加载失败：' + (e.message || e)
  }
}

/** 加载省份索引（用于点击下钻时查 adcode） */
async function ensureIndex() {
  if (provinceIndex) return provinceIndex
  try {
    const res = await fetch('/map/index.json')
    provinceIndex = res.ok ? await res.json() : {}
  } catch (e) { provinceIndex = {} }
  return provinceIndex
}

/** 地图点击：下钻到省级 */
async function onMapClick(params) {
  if (!props.drillable) return
  const name = params && params.name
  if (!name) return
  const idx = await ensureIndex()
  const meta = idx[name]
  if (!meta || !meta.file || meta.noDrill) return   // 无省级数据或不可下钻 → 保持全国图，不着色
  loadError.value = ''
  try {
    const res = await fetch('/map/' + meta.file)
    if (!res.ok) throw new Error('省级地图加载失败')
    const geo = await res.json()
    const ec = await ensureEcharts()
    if (disposed) return
    ec.registerMap('drill-down', geo)
    currentProvince.value = name
    drilled.value = true
    // cityData 支持两种形状：{ 省名: { 城市: 数值 } }（档案看板）与 { 省名: [{name,value}] }（全局看板）
    const raw = (props.cityData && props.cityData[name]) || null
    const cityPairs = Array.isArray(raw)
      ? raw.map(function (x) { return { name: x.name, value: Number(x.value) || 0 }; })
      : Object.keys(raw || {}).map(function (k) { return { name: k, value: Number(raw[k]) || 0 }; })
    await nextTick()
    await renderMap('drill-down', cityPairs, name + '市级中标数')
    emit('drill', name)
  } catch (e) {
    // 兜底：省级文件加载失败 → 退回全国图，保持正常显示
    loadError.value = name + ' 地图加载失败，已保留全国视图（' + (e && e.message ? e.message : e) + '）'
    await backToChina()
  }
}

async function backToChina() {
  drilled.value = false
  currentProvince.value = ''
  await renderMap('china', dataToPairs(props.geoData), '中标项目数')
  emit('back')
}

onMounted(async function () {
  await nextTick()
  await loadChina()
  if (chart) chart.on('click', onMapClick)
  if (typeof ResizeObserver !== 'undefined' && mapEl.value) {
    observer = new ResizeObserver(function () { if (chart) chart.resize() })
    observer.observe(mapEl.value)
  } else {
    window.addEventListener('resize', resize)
  }
})

function resize() { if (chart) chart.resize() }

// 年份切换导致数据变化时，保持当前视图级别重新渲染
watch(function () { return [props.geoData, props.cityData] }, function () {
  if (!chart || drilled.value) return
  chart.setOption(buildOption('china', dataToPairs(props.geoData), '中标项目数'), true)
}, { deep: true })

onBeforeUnmount(function () {
  disposed = true
  if (observer) { observer.disconnect(); observer = null }
  else window.removeEventListener('resize', resize)
  if (chart) { chart.dispose(); chart = null }
})

// 暴露给外部/自动化下钻（传入省份名，如「湖北省」）
defineExpose({ drillInto: onMapClick, backToChina })
</script>

<style scoped>
.china-map-wrap{position:relative;width:100%;min-width:0}
.china-map-canvas{width:100%;height:430px}
.map-back-btn{position:absolute;right:12px;top:6px;z-index:5;padding:5px 11px;border:1px solid #d8dee8;border-radius:5px;background:#fff;color:#2f6fed;font:inherit;font-size:12px;cursor:pointer;box-shadow:0 2px 6px rgba(16,24,40,.08);transition:background .18s}
.map-back-btn:hover{background:#eef4ff}
.map-drill-label{position:absolute;left:12px;top:8px;z-index:5;font-size:12px;color:#5b6577}
.map-error{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:5;font-size:12px;color:#c96a1f;background:#fff8ef;border:1px solid #f7ddc0;padding:5px 12px;border-radius:4px}
</style>
