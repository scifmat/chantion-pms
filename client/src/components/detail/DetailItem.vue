<template>
  <div class="dt-item" :class="{ 'dt-full': full }">
    <div class="dt-label">{{ label }}</div>
    <div class="dt-value">
      <slot>
        <a v-if="link" :href="link" target="_blank" rel="noopener noreferrer" class="dt-link">{{ text }}</a>
        <span v-else :class="{ 'dt-empty': empty }">{{ text }}</span>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { fmt, raw } from '../../utils/detailFormat.js'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: '' },
  full: { type: Boolean, default: false },   // 长文本 / 网址独占整行
  href: { type: String, default: '' }        // 有值时渲染成新窗口链接
})

const text = computed(function () { return fmt(props.value) })
const empty = computed(function () { return raw(props.value) === '' })
const link = computed(function () { return raw(props.href) })
</script>
