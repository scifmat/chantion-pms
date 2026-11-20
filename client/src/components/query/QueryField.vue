<template>
  <div class="fld">
    <label>{{ label }}</label>
    <slot />
    <div class="tip err" v-if="tip">{{ tip }}</div>
  </div>
</template>

<script setup>
// 查询页的单条件容器：只复用录入弹窗的 .fld 视觉，不引入 useValidation，
// 避免把「必填 / 网址 / IME」等录入规则带进只读的查询条件区。
defineProps({
  label: { type: String, required: true },
  tip: { type: String, default: '' }
})
</script>
