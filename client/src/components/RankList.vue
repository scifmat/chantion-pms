<template>
  <div class="panel rank-card">
    <div class="chart-title">{{ title }}</div>
    <div v-if="!items.length" class="chart-empty">{{ emptyText }}</div>
    <div v-else class="rank-list">
      <div class="rank-row" v-for="(it, idx) in items" :key="it.name + '-' + idx">
        <span class="rank-medal" :class="'medal-' + (idx + 1)">{{ idx + 1 }}</span>
        <div class="rank-main">
          <div class="rank-name">
            {{ it.name }}
            <SelfBadge v-if="showSelfBadge" :name="it.name" />
            <span class="rank-badge" v-if="showTopBadge && idx < 3">TOP{{ idx + 1 }}</span>
            <span class="rank-attr" v-if="showAttribute && it.attribute">{{ it.attribute }}</span>
            <span class="rank-attr" v-if="showAttrField && it.attr">{{ it.attr }}</span>
          </div>
          <div class="rank-bar"><div class="rank-bar-fill" :class="tone" :style="{ width: barWidth(it) }"></div></div>
        </div>
        <span class="rank-value">{{ itemValue(it) }}{{ valueSuffix }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import SelfBadge from './SelfBadge.vue'

const props = defineProps({
  title: { type: String, default: '' },
  items: { type: Array, default: function () { return [] } },
  valueKey: { type: String, default: 'value' },
  valueSuffix: { type: String, default: ' 次' },
  emptyText: { type: String, default: '暂无数据' },
  tone: { type: String, default: '' },
  showTopBadge: { type: Boolean, default: true },
  showAttribute: { type: Boolean, default: true },
  showAttrField: { type: Boolean, default: false }
})

function itemValue(it) { return it && it[props.valueKey] != null ? it[props.valueKey] : 0 }
function barWidth(it) {
  const max = Math.max.apply(null, (props.items || []).map(itemValue).concat([0])) || 1
  return Math.max(6, Math.round(itemValue(it) * 100 / max)) + '%'
}
</script>
