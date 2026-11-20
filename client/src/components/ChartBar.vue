<template>
  <EChart :option="option" :height="height" />
</template>

<script setup>
import { computed } from 'vue'
import EChart from './EChart.vue'
import { themeOption, TOOLTIP_STYLE } from '../utils/chartTheme.js'

/**
 * 通用柱状/折线/横向条形图：统一主题（#2f6fed、无冗余网格线）。
 * items: [{ name, value }]（折线可用 { month, value }，用 nameKey 指定）。
 */
const props = defineProps({
  items: { type: Array, default: function () { return [] } },
  mode: { type: String, default: 'bar' },   // bar | line | horizontal
  nameKey: { type: String, default: 'name' },
  height: { type: String, default: '240px' },
  color: { type: String, default: '#2f6fed' },
  valueSuffix: { type: String, default: '' }  // tooltip 数值后缀，如 ' 个'
})

const option = computed(function () {
  const items = props.items || []
  const names = items.map(function (x) { return x[props.nameKey] + (props.mode === 'line' && props.nameKey === 'month' ? '月' : ''); })
  const values = items.map(function (x) { return x.value; })
  const isH = props.mode === 'horizontal'
  const isLine = props.mode === 'line'

  const base = {
    tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: isH ? 'shadow' : 'axis' } }, TOOLTIP_STYLE, props.valueSuffix ? { valueFormatter: function (v) { return v + props.valueSuffix; } } : {}),
    grid: { left: 12, right: isH ? 28 : 16, top: 18, bottom: 8, containLabel: true }
  }
  const catAxis = { type: 'category', data: names, axisLine: { lineStyle: { color: '#d8dee8' } }, axisTick: { show: false }, axisLabel: { color: '#5b6577', fontSize: 11, interval: 0 } }
  const valAxis = { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#eef1f6', type: 'dashed' } }, axisLabel: { color: '#8a94a6', fontSize: 11 } }

  if (isH) {
    base.xAxis = valAxis
    base.yAxis = Object.assign({}, catAxis, { inverse: true })
    base.series = [{ type: 'bar', data: values, barMaxWidth: 20, itemStyle: { color: props.color, borderRadius: [0, 5, 5, 0] }, label: { show: true, position: 'right', color: '#5b6577', fontSize: 11 } }]
  } else if (isLine) {
    base.xAxis = catAxis
    base.yAxis = valAxis
    base.series = [{ type: 'line', data: values, smooth: true, symbolSize: 7, lineStyle: { color: props.color, width: 2.5 }, itemStyle: { color: props.color }, areaStyle: { color: hexAlpha(props.color, .12) } }]
  } else {
    base.xAxis = catAxis
    base.yAxis = valAxis
    base.series = [{ type: 'bar', data: values, barMaxWidth: 38, itemStyle: { color: props.color, borderRadius: [5, 5, 0, 0] }, label: { show: true, position: 'top', color: '#374151', fontSize: 11 } }]
  }
  return themeOption(base)
})

function hexAlpha(hex, a) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}
</script>
