<template>
  <div class="archive-input">
    <!-- 关联字段的地址仍是 textarea（多行输入体验不变）；其余用 input -->
    <textarea
      v-if="multiline"
      ref="inputEl"
      autocomplete="off"
      :value="displayValue"
      :placeholder="placeholder"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    ></textarea>
    <input
      v-else
      ref="inputEl"
      type="text"
      autocomplete="off"
      :value="displayValue"
      :placeholder="placeholder"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    >
    <!--
      候选下拉是常驻空节点，内容由防抖请求回来后用 DOM API 直接写入。
      全程不写任何 reactive、不碰 input.value / selectionStart ——
      第 6 步特别要求：候选更新绝不能引起组件重绘，否则会重演第 5 步的吞字。
    -->
    <div class="archive-dd" ref="ddEl"></div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted, nextTick } from 'vue'
import { searchArchives } from '../../api.js'
import { normPkg } from './validation.js'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  type: { type: String, required: true },          // buyer | agency | competitor | judge
  placeholder: { type: String, default: '' },
  query: { type: String, default: '' },            // 可选：覆盖用于搜索的关键字
  pickMode: { type: String, default: 'replace' },  // replace=整体回填；event=交给父组件处理
  enter: { type: Boolean, default: false },        // 是否把 Enter 转发给父组件
  // —— 关联字段模式（3.2.3 多值联系方式）：单位名称匹配到档案后，聚焦电话/邮箱/地址给出历史候选 ——
  linked: { type: Boolean, default: false },
  field: { type: String, default: '' },            // phone | email | address
  partyName: { type: String, default: '' },        // 当前单位 / 机构名称
  multiline: { type: Boolean, default: false }     // 地址用 textarea
})
const emit = defineEmits(['update:modelValue', 'pick', 'enter', 'composing'])

const inputEl = ref(null)
const ddEl = ref(null)
const displayValue = computed(function () { return String(props.modelValue == null ? '' : props.modelValue) })

let composing = false
let timer = null
let blurTimer = null
let ctrl = null
let seq = 0
let lastKey = ''

/** 搜索关键字：优先用 query；评委输入取最后一段中文，避免整段长文本搜不到 */
function searchKey(raw) {
  const q = String(props.query == null ? '' : props.query).trim()
  if (q) return q
  const s = String(raw == null ? '' : raw)
  if (props.type === 'judge') {
    const parts = s.split(/[、,，;；\n（）()]/)
    const m = String(parts[parts.length - 1] || '').match(/[\u4e00-\u9fa5]{1,6}/)
    return m ? m[0] : ''
  }
  return s.trim()
}

/** 纯 DOM 渲染下拉：只用 textContent / appendChild，不经过 Vue 渲染 */
function renderDD(list) {
  const dd = ddEl.value
  if (!dd) return
  dd.textContent = ''
  if (!list.length) {
    // 关联字段模式：没有历史值就不展示任何候选项（用户要求「没匹配到单位名称则不做候选项展示」）
    if (props.linked) { hideDD(); return }
    const empty = document.createElement('div')
    empty.className = 'archive-empty'
    empty.textContent = '保存后将新增档案信息'
    dd.appendChild(empty)
  } else {
    list.forEach(function (item) {
      const row = document.createElement('div')
      row.className = 'archive-opt'
      const name = document.createElement('span')
      name.className = 'archive-name'
      name.textContent = String(item.name == null ? '' : item.name)
      row.appendChild(name)
      if (props.type === 'judge' && !props.linked) {
        const marks = []
        if (item.leader) marks.push('组长')
        if (item.owner) marks.push('业主')
        if (!marks.length) marks.push('无属性')
        marks.forEach(function (m) {
          const tag = document.createElement('span')
          tag.className = m === '无属性' ? 'archive-none' : 'archive-mark'
          tag.textContent = m
          row.appendChild(tag)
        })
      }
      // mousedown 而非 click：抢在 blur 隐藏之前完成选择
      row.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(item) })
      dd.appendChild(row)
    })
  }
  dd.style.display = 'block'
}

function hideDD() {
  const dd = ddEl.value
  if (!dd) return
  dd.style.display = 'none'
  dd.textContent = ''
}

/** 关联字段：按当前单位名称查档案，精确匹配后取该字段的历史多值列表 */
function scheduleLinked() {
  const name = String(props.partyName == null ? '' : props.partyName).trim()
  if (!name) { hideDD(); return }
  const my = seq
  const myCtrl = new AbortController()
  ctrl = myCtrl
  timer = setTimeout(async function () {
    try {
      const list = await searchArchives(props.type, name, myCtrl.signal, true)
      if (my !== seq) return                 // 过期响应直接丢弃
      const key = normPkg(name)
      const hit = (list || []).find(function (x) { return normPkg(x.name) === key })
      if (!hit) { hideDD(); return }         // 名称没匹配到已有档案：不展示候选项
      const values = hit[props.field + 'List'] || []
      renderDD(values.filter(Boolean).map(function (v) { return { name: String(v) } }))
    } catch (err) {
      if (my === seq && (!err || err.name !== 'AbortError')) hideDD()
    }
  }, 120)
}

/** 防抖 + AbortController：只负责更新下拉，绝不改写输入框的值或光标 */
function schedule(raw) {
  clearTimeout(timer)
  if (ctrl) { ctrl.abort(); ctrl = null }
  const my = ++seq
  if (props.linked) { scheduleLinked(); return }
  const key = searchKey(raw)
  lastKey = key
  if (!key) { hideDD(); return }
  const myCtrl = new AbortController()
  ctrl = myCtrl
  timer = setTimeout(async function () {
    try {
      const list = await searchArchives(props.type, key, myCtrl.signal)
      if (my !== seq) return                 // 过期响应直接丢弃
      renderDD(list || [])
    } catch (err) {
      if (my === seq && (!err || err.name !== 'AbortError')) hideDD()
    }
  }, 150)
}

function onInput(e) {
  if (composing || e.isComposing) return   // IME 组合期间不转发中间态
  const v = e.target.value
  emit('update:modelValue', v)             // 只读一次 value，绝不赋值、绝不碰 selectionStart
  // 关联字段的候选只取决于单位名称，输入过程中不重新请求，保证连续输入零打扰
  if (!props.linked) schedule(v)
}
function onCompositionStart() { composing = true; emit('composing', true) }
function onCompositionEnd(e) {
  composing = false
  emit('composing', false)
  if (!e.isComposing) onInput(e)           // 组合结束后同步最终值（仍只读，不改写）
}
function onFocus() { schedule(displayValue.value) }
function onBlur() {
  clearTimeout(blurTimer)
  blurTimer = setTimeout(hideDD, 150)
}
function onKeydown(e) {
  if (e.key === 'Escape') { hideDD(); return }
  if (e.key === 'Enter' && props.enter) { e.preventDefault(); emit('enter') }
}
function pick(item) {
  clearTimeout(blurTimer)
  hideDD()
  if (!props.linked && props.pickMode === 'event') {
    emit('pick', { item: item, key: lastKey })
    return
  }
  emit('update:modelValue', item.name)
  const el = inputEl.value
  if (el) el.value = item.name             // 用户主动点选（非输入过程），允许同步 DOM
  if (!props.linked) nextTick(function () { schedule(item.name) })
}

onUnmounted(function () {
  clearTimeout(timer)
  clearTimeout(blurTimer)
  if (ctrl) ctrl.abort()
})
</script>
