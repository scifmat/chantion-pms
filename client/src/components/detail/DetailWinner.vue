<template>
  <div class="dt-winner">
    <template v-if="isUnion">
      <div class="dt-winner-row"><span class="dt-k">牵头单位：</span>{{ fmt(lead) }}</div>
      <div class="dt-winner-row"><span class="dt-k">成员单位：</span>{{ fmtList(members) }}</div>
    </template>
    <div v-else class="dt-winner-row"><span class="dt-k">单位名称：</span>{{ fmt(lead) }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { fmt, fmtList } from '../../utils/detailFormat.js'

// 单包中标与每个分包共用同一个 winner 结构 { lead, members[], isUnion }
const props = defineProps({
  winner: { type: Object, default: null }
})
const isUnion = computed(function () { return !!(props.winner && props.winner.isUnion) })
const lead = computed(function () { return props.winner ? props.winner.lead : '' })
const members = computed(function () { return props.winner && Array.isArray(props.winner.members) ? props.winner.members : [] })
</script>
