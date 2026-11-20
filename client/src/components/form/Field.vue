<template>
  <div
    class="fld"
    :class="{ full: full }"
    @compositionstart.capture="onCompositionStart"
    @compositionend.capture="onCompositionEnd"
    @input.capture="onInput"
    @change.capture="onChange"
    @blur.capture="onBlur"
  >
    <label><span class="req" v-if="required">*</span>{{ label }}</label>
    <slot></slot>
    <!--
      常驻提示节点：内容由 watchEffect(flush:'sync') 直接写 DOM，不参与模板渲染。
      若改用 {{ hint }} 插值，输入时写 hints 会让组件进入渲染队列；浏览器在每个
      事件监听器返回后就会执行微任务检查，此时 input 上的 v-model 还没执行，
      vModelText.beforeUpdate 会用 form 旧值把 el.value 回退 —— 表现为吞字 / 要按两次。
    -->
    <div class="tip" ref="tipEl"></div>
  </div>
</template>

<script setup>
import { ref, inject, watchEffect, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  label: { type: String, default: '' },
  path: { type: String, default: '' },
  required: { type: Boolean, default: false },
  full: { type: Boolean, default: false },
  rule: { type: String, default: 'short' }   // short|multiline|address|projectNo|date|datetime|url|amount
})

const errors = inject('projectErrors')
const hints = inject('projectHints')
const validation = inject('projectValidation')
const form = inject('projectForm')
const tipEl = ref(null)

// 纯 DOM 副作用：读 reactive 但只写 textContent / className，
// 不 queueJob、不触发任何组件渲染 effect，因此输入期间组件零重渲染。
function renderTip() {
  const el = tipEl.value
  if (!el) return
  const e = (errors && props.path) ? (errors[props.path] || '') : ''
  const h = (hints && props.path) ? (hints[props.path] || '') : ''
  el.textContent = e || h
  el.className = 'tip' + (e ? ' err' : (h ? ' ok' : ''))
}
watchEffect(renderTip, { flush: 'sync' })
onMounted(renderTip)

function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o) }

// 中文输入法组合期间绝对不碰 value / 光标，避免拼音被打断或光标乱跳
let composing = false

function controlOf(e) {
  const el = e.target
  if (!el) return null
  const tag = el.tagName
  return (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') ? el : null
}

function process(e, phase) {
  if (composing || e.isComposing) return
  const el = controlOf(e)
  if (!el || !validation || !props.path) return
  // 行政区划级联组件内部有拼音搜索框，它的输入不属于本字段的值：
  // 若参与校验会改写搜索框内容、并把搜索关键字误写进 region。
  if (el.closest && el.closest('.region-picker')) return
  const typing = phase === 'input' || phase === 'change'
  validation.validateField(props.path, { el: el, phase: phase })
  // 金额输入过程只更新自己的换算提示（纯 DOM 副作用），不触发其它 reactive 扫描；
  // 失焦 / 提交时仍会跑完整的结构型与时间段联动校验。
  if (!(props.rule === 'amount' && typing)) {
    validation.validateStructural()
    validation.validateTimeOrder()
  }
}

function onCompositionStart() { composing = true }
function onCompositionEnd(e) {
  composing = false
  process(e, 'input')
}
function onInput(e) { process(e, 'input') }
function onChange(e) { process(e, 'change') }
function onBlur(e) { process(e, 'blur') }

onMounted(function () {
  if (validation && props.path) validation.register(props.path, props.rule, function () { return getPath(form, props.path) })
})
onUnmounted(function () {
  if (validation && props.path) validation.unregister(props.path)
})
</script>
