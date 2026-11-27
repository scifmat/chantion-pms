<template>
  <div class="overlay">
    <div class="modal" style="max-width:780px">
      <header>
        <b>跟进轨迹 · {{ row.project_name }}</b>
        <button class="icon-btn" @click="emit('close')">×</button>
      </header>
      <div class="body">
        <div class="context-bar">
          <span>项目状态：<b>{{ row.status }}</b></span>
          <span>当前动态：<span class="pill">{{ row.internal_status }}</span></span>
          <span>负责人：{{ row.owner_username || '—' }}</span>
          <span class="muted">置灰节点尚未发生；已结束项目可回到前面的节点补录</span>
        </div>

        <div class="timeline">
          <div
            v-for="(s, i) in stages"
            :key="s.key"
            class="timeline-item"
            :class="{ current: s.current, disabled: !s.reached }"
          >
            <div class="node-col">
              <div class="node-dot">{{ i + 1 }}</div>
              <div v-if="i < stages.length - 1" class="node-line"></div>
            </div>
            <div class="node-body">
              <div class="node-head">
                <b>{{ s.label }}</b>
                <span class="muted objective">{{ s.objective }}</span>
                <span class="pill">{{ s.internal_status }}</span>
                <span v-if="s.current" class="tag current-tag">当前</span>
                <span v-if="s.reviewed" class="tag done-tag">已复盘</span>
                <span v-else-if="s.reached && needsReview(s.internal_status)" class="tag pending-tag">待复盘</span>
                <button
                  class="btn sm"
                  style="margin-left:auto"
                  :disabled="!s.reached"
                  @click="startEdit(s)"
                >{{ s.reviewed ? '已复盘' : '去复盘' }}</button>
              </div>

              <div v-if="s.review_reason" class="node-reason">
                {{ s.review_category }} · {{ s.review_reason }}
              </div>

              <!-- 节点内的小表单：分类联动 + 原因/经验；可同时修正该阶段动态 -->
              <div v-if="editing === s.key" class="mini-form">
                <div class="mini-row">
                  <div class="fld">
                    <label>内部动态</label>
                    <select v-model="form[s.key].internal_status" @change="onInternalChange(s.key)">
                      <option v-for="x in s.allowed_internals" :key="x" :value="x">{{ x }}</option>
                    </select>
                  </div>
                  <div class="fld">
                    <label>{{ categoryLabelText(s.key) }}</label>
                    <select v-model="form[s.key].review_category">
                      <option value="">请选择</option>
                      <option v-for="c in categoryOptions(s.key)" :key="c" :value="c">{{ c }}</option>
                    </select>
                  </div>
                </div>
                <div class="fld">
                  <label>具体原因 / 经验说明</label>
                  <textarea v-model="form[s.key].review_reason" rows="3" placeholder="请填写该阶段的原因或可复用经验"></textarea>
                  <span v-if="form[s.key].internal_status === '已流标'" class="muted tip">
                    已自动读取项目主表「终止原因」，可编辑补充。
                  </span>
                </div>
                <div class="mini-actions">
                  <button class="btn sm" @click="editing = ''">取消</button>
                  <button class="btn sm primary" :disabled="saving" @click="submit(s)">
                    {{ saving ? '保存中…' : '保存' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <footer>
        <span class="muted" style="flex:1;text-align:left">每一次复盘/补录都会写入跟进时间线与操作记录</span>
        <button class="btn primary" @click="emit('close')">完成</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { saveStageReview } from '../../api.js'
import { bumpDataVersion } from '../../store/dataVersion.js'
import { opts } from '../../utils/options.js'
import {
  TRACK_INTERNAL, needsReview, categoriesFor, categoryLabel
} from '../../utils/tracking.js'
import { toastError, toastSuccess } from '../../utils/toast.js'

const props = defineProps({ row: { type: Object, required: true } })
const emit = defineEmits(['close'])

const allCategories = opts('review_reason')
const stages = ref((props.row.stages || []).map(function (s) { return Object.assign({}, s) }))
const editing = ref('')
const saving = ref(false)
const currentVersion = ref(props.row.version)
const form = reactive({})

stages.value.forEach(function (s) {
  const floated = s.internal_status === TRACK_INTERNAL.FLOATED
  form[s.key] = {
    internal_status: s.internal_status,
    review_category: s.review_category || (floated ? '项目终止' : ''),
    review_reason: s.review_reason || (floated ? (props.row.terminate_reason || '') : '')
  }
})

function categoryOptions(stageKey) {
  return categoriesFor(form[stageKey].internal_status, allCategories)
}
function categoryLabelText(stageKey) {
  return categoryLabel(form[stageKey].internal_status)
}
function onInternalChange(stageKey) {
  const f = form[stageKey]
  if (f.internal_status === TRACK_INTERNAL.FLOATED) {
    f.review_category = '项目终止'
    if (!f.review_reason) f.review_reason = props.row.terminate_reason || ''
  } else if (categoryOptions(stageKey).indexOf(f.review_category) < 0) {
    f.review_category = ''
  }
}

function startEdit(s) {
  if (!s.reached) return
  editing.value = editing.value === s.key ? '' : s.key
}

async function submit(s) {
  const f = form[s.key]
  if (s.allowed_internals.indexOf(f.internal_status) < 0) {
    toastError('该阶段不允许此内部动态')
    return
  }
  if (!f.review_category || categoryOptions(s.key).indexOf(f.review_category) < 0) {
    toastError('请选择' + categoryLabelText(s.key))
    return
  }
  if (!String(f.review_reason).trim()) {
    toastError('请填写具体原因 / 经验说明')
    return
  }
  saving.value = true
  try {
    const data = await saveStageReview(props.row.id, s.key, {
      internal_status: f.internal_status,
      review_category: f.review_category,
      review_reason: f.review_reason,
      version: currentVersion.value
    })
    currentVersion.value = data.version
    bumpDataVersion()
    const fresh = (data.stages || []).find(function (x) { return x.key === s.key })
    if (fresh) {
      const idx = stages.value.findIndex(function (x) { return x.key === s.key })
      if (idx >= 0) stages.value[idx] = fresh
    }
    editing.value = ''
    toastSuccess(s.reviewed ? '该节点复盘已更新' : '该节点已完成复盘')
  } catch (e) {
    toastError(e.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.context-bar { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 12px; color: #5b6577; background: #f7f9fc; border-radius: 6px; padding: 8px 10px; margin-bottom: 14px; }
.timeline { display: flex; flex-direction: column; }
.timeline-item { display: flex; gap: 10px; }
.node-col { width: 24px; display: flex; flex-direction: column; align-items: center; flex: none; }
.node-dot { width: 22px; height: 22px; border-radius: 50%; background: #d8dee8; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; flex: none; }
.node-line { width: 2px; flex: 1; min-height: 18px; background: #e3e7ee; }
.node-body { flex: 1; min-width: 0; padding: 0 0 14px; }
.node-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 28px; }
.objective { font-size: 12px; }
.tag { padding: 1px 7px; border-radius: 9px; font-size: 11px; white-space: nowrap; }
.current-tag { background: #eaf2ff; color: #2f6fed; }
.done-tag { background: #e8f7ee; color: #137a4b; }
.pending-tag { background: #fdecea; color: #c0261b; }
.node-reason { margin-top: 5px; font-size: 12px; color: #5b6577; background: #f7f9fc; border-radius: 4px; padding: 5px 8px; }
.timeline-item.current .node-dot { background: #2f6fed; }
.timeline-item.current .node-body { border-left: 2px solid #2f6fed; padding-left: 8px; margin-left: -10px; }
.timeline-item.disabled { opacity: .48; }
.mini-form { margin-top: 10px; border: 1px solid #e3e7ee; border-radius: 6px; padding: 10px; background: #fff; }
.mini-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.mini-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.tip { display: block; margin-top: 4px; font-size: 11px; }
</style>
