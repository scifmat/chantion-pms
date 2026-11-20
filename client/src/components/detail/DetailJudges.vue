<template>
  <div class="dt-judges">
    <span v-for="(j, i) in list" :key="i" class="dt-judge">
      {{ fmt(j.name) }}
      <em v-if="j.leader">组长</em>
      <em v-if="j.owner">业主</em>
    </span>
    <span v-if="!list.length" class="dt-empty">-</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { fmt } from '../../utils/detailFormat.js'

// 评委 Tag 列表：姓名 + 组长 / 业主 小标记，两属性可同时出现，界面不显示方括号
const props = defineProps({
  judges: { type: Array, default: () => [] }
})
const list = computed(function () {
  return (props.judges || []).filter(function (j) { return j && typeof j === 'object' })
})
</script>
