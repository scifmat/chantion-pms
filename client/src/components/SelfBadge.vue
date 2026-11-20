<template>
  <span v-if="isSelf" class="self-badge" title="当前系统配置的所属企业（本企业）">本企业</span>
</template>

<script setup>
import { computed } from 'vue'
import { settings } from '../store/system.js'

const props = defineProps({ name: { type: String, default: '' } })

function norm(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase()
}
const isSelf = computed(function () {
  return !!settings.selfCompetitorName && norm(props.name) === norm(settings.selfCompetitorName)
})
</script>

<style scoped>
.self-badge{
  display:inline-block;flex:none;margin-left:6px;padding:0 6px;
  font-size:10px;line-height:16px;border-radius:4px;
  color:#b54708;background:#fff7e6;border:1px solid #f0c36b;
  font-weight:500;white-space:nowrap;vertical-align:middle;
}
</style>
