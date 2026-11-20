<template>
  <EChart :option="option" :height="height" />
</template>

<script setup>
import { computed } from 'vue'
import EChart from './EChart.vue'
import { themeOption, TOOLTIP_STYLE } from '../utils/chartTheme.js'

/** 近 12 个月发标趋势：柱状=项目数（左轴，个），折线=预算规模（右轴，万元）。 */
const props = defineProps({
  items: { type: Array, default: function () { return [] } },
  height: { type: String, default: '320px' }
})

const option = computed(function () {
  const items = props.items || []
  const months = items.map(function (x) { return String(x.month || '').slice(5) + '月' })
  const counts = items.map(function (x) { return Number(x.count) || 0 })
  const budgets = items.map(function (x) { return Number(x.budgetWan) || 0 })
  return themeOption({
    tooltip: Object.assign({
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: '#c9d3e2' } },
      formatter: function (ps) {
        if (!ps || !ps.length) return ''
        const raw = items[ps[0].dataIndex] || {}
        return String(raw.month || '') + '<br/>' +
          ps.map(function (p) {
            return p.marker + p.seriesName + '：<b>' + Number(p.value).toLocaleString('zh-CN') +
              (p.seriesName === '项目数' ? ' 个' : ' 万元') + '</b>'
          }).join('<br/>')
      }
    }, TOOLTIP_STYLE),
    // 图例居中，左右轴名称各占一角，避免「预算（万元）」与图例重叠
    legend: { data: ['项目数', '预算规模'], left: 'center', top: 0, textStyle: { color: '#5b6577', fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 16, right: 18, top: 40, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: months, boundaryGap: true,
      axisLine: { lineStyle: { color: '#d8dee8' } }, axisTick: { show: false },
      axisLabel: { color: '#5b6577', fontSize: 11, interval: 0 }
    },
    yAxis: [
      {
        type: 'value', name: '项目数（个）', minInterval: 1,
        nameTextStyle: { color: '#5b6577', fontSize: 11, align: 'left' },
        axisLabel: { color: '#5b6577', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eef1f6', type: 'dashed' } }
      },
      {
        type: 'value', name: '预算（万元）', minInterval: 1,
        nameTextStyle: { color: '#5b6577', fontSize: 11, align: 'right' },
        axisLabel: { color: '#8a94a6', fontSize: 11, formatter: function (v) { return v >= 10000 ? (v / 10000).toFixed(1) + '亿' : v } },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '项目数', type: 'bar', yAxisIndex: 0, data: counts, barMaxWidth: 22,
        itemStyle: { color: '#2f6fed', borderRadius: [4, 4, 0, 0] }
      },
      {
        name: '预算规模', type: 'line', yAxisIndex: 1, data: budgets, smooth: true, symbolSize: 6,
        lineStyle: { color: '#e8833a', width: 2.5 }, itemStyle: { color: '#e8833a' }
      }
    ]
  })
})
</script>
