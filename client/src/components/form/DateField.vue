<template>
  <!-- 可视化日期/时间选择器：保留 .fld 外层包裹，内部换成 el-date-picker -->
  <div class="date-field" @paste.capture="onPaste" @blur.capture="onBlur">
    <el-date-picker
      v-model="inner"
      :type="kind"
      :value-format="valueFormat"
      :format="valueFormat"
      :placeholder="placeholder"
      :clearable="true"
      :editable="true"
      :teleported="true"
      placement="bottom-start"
      :popper-options="popperOptions"
      :popper-class="popperClass"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { normalizeDateText } from './validation.js'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  kind: { type: String, default: 'date' },        // date | datetime
  placeholder: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

// 面板 teleported 到 body：不受弹窗 overflow:auto 裁剪；flip/shift 自动向上翻转与左右避让，
// 保证输入框靠屏幕底部 / 右侧时面板也不会溢出或被遮挡。
const popperOptions = {
  placement: 'bottom-start',
  modifiers: [
    { name: 'flip', options: { fallbackPlacements: ['top-start', 'top-end', 'bottom-end'], padding: 12 } },
    { name: 'preventOverflow', options: { padding: 12 } },
    { name: 'offset', options: { offset: [0, 6] } }
  ]
}
const isDatetime = computed(function () { return props.kind === 'datetime' })
const valueFormat = computed(function () { return isDatetime.value ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD' })
// date / datetime 共用同一套主题类：面板宽度与内部布局全部交给 Element Plus 原生
// （两者同为 322px，时间选择是原生浮层），项目只做主题对齐、不再写死宽度。
const popperClass = 'chantion-date-popper'
const inner = computed({
  get: function () { return String(props.modelValue == null ? '' : props.modelValue) },
  set: function (v) { emit('update:modelValue', v == null ? '' : String(v)) }
})

/**
 * 粘贴兼容：从外部复制 2026年11月13日 / 2026/11/13 9:30 / 2026.11.13 等，
 * 统一识别后直接写入标准格式；只更新 model，绝不改写 DOM 值或光标。
 */
function onPaste(e) {
  const raw = e.clipboardData && e.clipboardData.getData('text')
  const n = normalizeDateText(raw, isDatetime.value)
  if (n) {
    e.preventDefault()
    e.stopPropagation()
    emit('update:modelValue', n)
  }
}

/** 手输非标准格式的兜底：失焦后把识别结果写回 model（此时用户已不再输入） */
function onBlur(e) {
  const el = e.target
  if (!el || el.tagName !== 'INPUT') return
  const n = normalizeDateText(el.value, isDatetime.value)
  if (n && n !== String(props.modelValue == null ? '' : props.modelValue)) emit('update:modelValue', n)
}
</script>
