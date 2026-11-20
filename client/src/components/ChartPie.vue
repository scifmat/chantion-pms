<template>
  <EChart :option="option" :height="height" />
</template>

<script setup>
import { computed } from 'vue'
import EChart from './EChart.vue'
import { themeOption, TOOLTIP_STYLE } from '../utils/chartTheme.js'

/** 通用环形饼图：items [{ name, value }]，统一主题、去冗余背景。 */
const props = defineProps({
  items: { type: Array, default: function () { return [] } },
  height: { type: String, default: '240px' },
  unit: { type: String, default: '个' }
})

const option = computed(function () {
  return themeOption({
    tooltip: Object.assign({ trigger: 'item', formatter: '{b}: {c} ' + props.unit + ' ({d}%)' }, TOOLTIP_STYLE),
    legend: { orient: 'vertical', right: 8, top: 'center', textStyle: { color: '#5b6577', fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
    series: [{
      type: 'pie', radius: ['42%', '66%'], center: ['36%', '50%'], avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 12, fontWeight: '500', color: '#374151' } },
      data: props.items || []
    }]
  })
})
</script>
