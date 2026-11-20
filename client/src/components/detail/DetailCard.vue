<template>
  <section class="dt-card">
    <h3 class="dt-card-title">
      {{ title }}
      <span v-if="sub" class="dt-card-sub">{{ sub }}</span>
    </h3>
    <div class="dt-grid"><slot /></div>
  </section>
</template>

<script setup>
// 只读分区卡片：只负责标题 + 栅格容器，字段全部由 DetailItem / 业务片段组件填充。
defineProps({
  title: { type: String, required: true },
  sub: { type: String, default: '' }
})
</script>
