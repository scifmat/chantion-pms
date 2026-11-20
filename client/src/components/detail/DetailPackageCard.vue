<template>
  <article class="dt-pkg">
    <div class="dt-pkg-head">
      <b>分包 {{ index + 1 }}</b>
      <span class="dt-pkg-name">{{ fmt(pkg.name) }}</span>
    </div>
    <div class="dt-pkg-rows">
      <div class="dt-pkg-cell"><span class="dt-k">分包类型</span>{{ fmt(pkg.type) }}</div>
      <div class="dt-pkg-cell"><span class="dt-k">分包中标金额</span>{{ fmtWan(pkg.amount_yuan) }}</div>
    </div>
    <div class="dt-pkg-winner" v-if="winnerFilled(pkg.winner)">
      <span class="dt-k">中标单位</span>
      <DetailWinner :winner="pkg.winner" />
    </div>
  </article>
</template>

<script setup>
import DetailWinner from './DetailWinner.vue'
import { fmt, fmtWan, winnerFilled } from '../../utils/detailFormat.js'

// 分包小卡片：包号/包名、类型、金额、中标单位；空字段由 fmt 统一显示 '-'
defineProps({
  pkg: { type: Object, required: true },
  index: { type: Number, required: true }
})
</script>
