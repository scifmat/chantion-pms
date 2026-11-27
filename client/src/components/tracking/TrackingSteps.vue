<template>
  <div class="track-steps panel" v-if="stages && stages.length">
    <div class="steps-title">
      <b>跟进轨迹</b>
      <span class="muted">悬停节点查看该阶段复盘记录</span>
    </div>
    <div class="steps-row">
      <template v-for="(s, i) in stages" :key="s.key">
        <el-tooltip placement="top" :disabled="!s.reached">
          <template #content>
            <div class="tip-title">{{ s.label }} · {{ s.internal_status }}</div>
            <div v-if="s.review_reason" class="tip-reason">
              <b>{{ s.review_category }}</b>：{{ s.review_reason }}
            </div>
            <div v-else class="tip-empty">暂无复盘记录</div>
          </template>
          <div
            class="step"
            :class="{ current: s.current, done: s.reached && !s.current, disabled: !s.reached }"
          >
            <div class="step-dot">
              <span v-if="s.reached && !s.current">✓</span>
              <span v-else>{{ i + 1 }}</span>
            </div>
            <div class="step-label">{{ s.label }}</div>
            <div class="step-status">{{ s.internal_status }}</div>
          </div>
        </el-tooltip>
        <div
          v-if="i < stages.length - 1"
          class="step-line"
          :class="{ done: s.reached && !s.current }"
        ></div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ElTooltip } from 'element-plus'

defineProps({
  stages: { type: Array, default: function () { return [] } }
})
</script>

<style scoped>
.track-steps { padding: 14px 18px; }
.steps-title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; font-size: 14px; }
.steps-title .muted { font-size: 12px; }
.steps-row { display: flex; align-items: flex-start; }
.step { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: default; }
.step-dot { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; background: #d8dee8; color: #fff; }
.step-label { font-size: 12px; color: #5b6577; white-space: nowrap; }
.step-status { font-size: 13px; color: #1f2937; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.step.current .step-dot { background: #2f6fed; box-shadow: 0 0 0 4px rgba(47, 111, 237, .12); }
.step.current .step-status { color: #2f6fed; }
.step.done .step-dot { background: #137a4b; }
.step.done .step-status { color: #137a4b; }
.step.disabled { opacity: .45; }
.step-line { flex: none; width: 36px; height: 2px; background: #e3e7ee; margin-top: 12px; }
.step-line.done { background: #b7ebc8; }
/* Tooltip 使用 Element Plus 深色浮层，内容必须显式用浅色文字保证对比度 */
.tip-title { font-size: 12px; color: rgba(255,255,255,.95); margin-bottom: 4px; }
.tip-reason { font-size: 12px; color: #fff; max-width: 280px; line-height: 1.6; }
.tip-reason b { color: #fff; }
.tip-empty { font-size: 12px; color: rgba(255,255,255,.65); }
</style>
