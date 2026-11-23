<template>
  <!-- 可视化日期/时间选择器：保留 .fld 外层包裹，内部换成 el-date-picker -->
  <div class="date-field" @paste.capture="onPaste" @blur.capture="onBlur" @keydown.capture="onKeydown">
    <el-date-picker
      :key="pickerKey"
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
import { computed, ref } from 'vue'
import { normalizeDateText } from './validation.js'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  kind: { type: String, default: 'date' },        // date | datetime
  placeholder: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
// 提交非标准输入后重建 picker：清掉 Element Plus 内部未解析的原始文本，避免界面回退
const pickerKey = ref(0)

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
 * 把输入框里的文本归一化并写回 model。
 * Element Plus 只按 format 精确解析，手输「2026年11月21日」「9:30」这类内容它不会提交；
 * 这里在 Enter / 失焦时接管，并在必要时重建 picker 以清掉它内部的原始文本。
 */
function commitInput(el) {
  if (!el || el.tagName !== 'INPUT') return false
  const n = normalizeDateText(el.value, isDatetime.value)
  if (!n) return false
  const model = String(props.modelValue == null ? '' : props.modelValue)
  if (n !== el.value) {
    el.value = n
    emit('update:modelValue', n)
    pickerKey.value += 1
    return true
  }
  if (n !== model) {
    emit('update:modelValue', n)
    return true
  }
  // 已是标准格式且与 model 一致：交回 Element Plus 处理（例如 Enter 关闭日历面板）
  return false
}

/** 主输入框直接粘贴：2026年11月13日 / 2026/11/13 9:30 / 2026.11.13 等都能识别 */
function onPaste(e) {
  const raw = e.clipboardData && e.clipboardData.getData('text')
  const n = normalizeDateText(raw, isDatetime.value)
  if (n) {
    e.preventDefault()
    e.stopPropagation()
    emit('update:modelValue', n)
    pickerKey.value += 1
  }
}

/** Enter 提交：捕获阶段先归一化，拦住 Element Plus 对非标准文本的解析告警 */
function onKeydown(e) {
  if (e.key !== 'Enter') return
  if (commitInput(e.target)) {
    e.preventDefault()
    e.stopPropagation()
  }
}

/** 失焦兜底：手输非标准格式也能写回标准值 */
function onBlur(e) { commitInput(e.target) }
</script>
