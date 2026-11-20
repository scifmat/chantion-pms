<template>
  <article class="dt-pkg">
    <div class="dt-pkg-head">
      <b>更正 {{ index + 1 }}</b>
      <span class="dt-pkg-name">{{ fmt(c.date) }}</span>
    </div>
    <div class="dt-pkg-rows dt-pkg-lines">
      <div class="dt-line">
        <span class="dt-k">更正事项</span>
        <span class="dt-tags">
          <span v-for="(it, i) in items" :key="i" class="dt-tag">{{ it }}</span>
          <span v-if="!items.length" class="dt-empty">-</span>
        </span>
      </div>
      <div class="dt-line"><span class="dt-k">更正内容</span>{{ fmt(c.content) }}</div>
      <div class="dt-line">
        <span class="dt-k">更正公告网址</span>
        <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" class="dt-link">{{ url }}</a>
        <span v-else class="dt-empty">-</span>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { fmt, raw } from '../../utils/detailFormat.js'

// 更正信息按组展示：事项 Tag 列表、内容、日期、网址
const props = defineProps({
  c: { type: Object, required: true },
  index: { type: Number, required: true }
})
const items = computed(function () {
  return Array.isArray(props.c.items) ? props.c.items.map(raw).filter(Boolean) : []
})
const url = computed(function () { return raw(props.c.url) })
</script>
