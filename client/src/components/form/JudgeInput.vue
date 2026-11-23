<template>
  <div>
    <!--
      评委输入沿用第 4 步的整段智能识别；ArchiveInput 只负责弹出档案候选，
      并清晰标出「组长 / 业主」属性供录入人员参考；点选候选只替换当前正在输入的姓名片段，
      不会覆盖已录入的整段文本。
    -->
    <ArchiveInput
      type="judge"
      v-model="text"
      pick-mode="event"
      enter
      placeholder="如：张三（包1组长）、赵四（采购人代表）｜输完按 Enter 或点别处识别"
      @enter="flushNow"
      @blur="onBlurInput"
      @composing="onComposing"
      @pick="onPick"
    />
    <div style="margin-top:6px">
      <span class="tag" v-for="(j, i) in form.completed.judges" :key="i">
        {{ j.name }}<em v-if="j.leader || j.owner">{{ marks(j) }}</em>
        <span class="tag-x" @click="remove(i)" title="移除">×</span>
      </span>
      <span class="muted" v-if="!form.completed.judges.length">暂无评委</span>
    </div>
    <div class="tip err" v-if="unknown.length">无法识别：{{ unknown.join('、') }}</div>
  </div>
</template>

<script setup>
import { ref, inject } from 'vue'
import { parseJudges } from './validation.js'
import ArchiveInput from './ArchiveInput.vue'

const form = inject('projectForm')
const text = ref('')
const unknown = ref([])
let composing = false

function marks(j) {
  const a = []
  if (j.leader) a.push('组长')
  if (j.owner) a.push('业主')
  return a.join(' ')
}

// 只在失焦 / Enter 时识别：打字过程中绝不自动清空输入框，避免后面还有内容没输完。
function flush() {
  const raw = String(text.value || '').trim()
  if (!raw) return
  const r = parseJudges(raw)
  unknown.value = r.unknown
  r.list.forEach(function (j) {
    const ex = form.completed.judges.find(function (x) { return x.name === j.name; })
    if (ex) { ex.leader = ex.leader || j.leader; ex.owner = ex.owner || j.owner }
    else form.completed.judges.push({ name: j.name, leader: j.leader, owner: j.owner })
  })
  // 无法识别的原文留在输入框里，便于直接改正后再次失焦 / Enter
  text.value = r.unknown.length ? r.unknown.join('、') : ''
}

function flushNow() { if (!composing) flush() }
function onBlurInput() { flushNow() }
function onComposing(v) { composing = !!v }
function onPick(p) {
  const s = String(text.value || '')
  const key = String(p.key || '')
  const name = String(p.item && p.item.name ? p.item.name : '')
  if (!name) return
  if (key && s.endsWith(key)) text.value = s.slice(0, s.length - key.length) + name
  else text.value = s ? s + '、' + name : name
}
function remove(i) { form.completed.judges.splice(i, 1) }
</script>
