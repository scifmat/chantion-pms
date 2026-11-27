<template>
  <div class="overlay">
    <div class="modal" style="max-width:1020px">
      <header>
        <b>{{ mode === 'edit' ? '编辑项目' : '新增项目' }}</b>
        <button class="icon-btn" @click="emit('close')">×</button>
      </header>
      <div class="body">
        <PublicInfo />
        <PartyInfo party="buyer" title="采购单位" />
        <PartyInfo party="agency" title="代理机构" />
        <CorrectionInfo />
        <IntentionInfo />
        <BiddingInfo v-if="stages.bidding" />
        <TerminatedInfo v-if="stages.terminated" />
        <CompletedInfo v-if="stages.completed" />
      </div>
      <footer>
        <span class="muted" style="flex:1;text-align:left">输入即校验 · 所见即所得</span>
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" :disabled="saving || validation.blocking.value" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </footer>
    </div>
  </div>

  <!-- 状态互斥二次确认（2.3（3）） -->
  <div class="confirm" v-if="confirmState">
    <div class="box">
      <div v-if="confirmState.conflict" style="font-size:15px;margin-bottom:14px">
        切换到「{{ confirmState.to }}」将清空已填写的「{{ confirmState.conflict === 'completed' ? '完成招标' : '终止招标' }}」信息，且不可恢复。是否继续？意向公示、正在招标与公共信息不会被清空。
      </div>
      <div v-if="confirmState.trackingReset" style="font-size:14px;margin-bottom:14px;color:#c0261b;line-height:1.7">
        项目状态由「{{ confirmState.from }}」变为「{{ confirmState.to }}」，属于状态倒退/切换：该项目的跟进状态将重置，<b>原复盘记录会归档到历史</b>，内部动态按当前时间重新计算。请确认继续。
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" @click="cancelSwitch">取消</button>
        <button class="btn primary" @click="confirmSwitch">确定</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, provide, watch } from 'vue'
import { createProject, updateProject } from '../api.js'
import { toastError } from '../utils/toast.js'
import { useValidation } from './form/useValidation.js'
import { isResetSwitch } from '../utils/tracking.js'
import * as V from './form/validation.js'
import PublicInfo from './form/PublicInfo.vue'
import PartyInfo from './form/PartyInfo.vue'
import CorrectionInfo from './form/CorrectionInfo.vue'
import IntentionInfo from './form/IntentionInfo.vue'
import BiddingInfo from './form/BiddingInfo.vue'
import TerminatedInfo from './form/TerminatedInfo.vue'
import CompletedInfo from './form/CompletedInfo.vue'

const props = defineProps({
  mode: { type: String, default: 'add' },
  projectId: { type: Number, default: null },
  initial: { type: Object, default: null },
  // 仅已跟进项目倒退状态时才提示复盘归档，避免对未跟进项目误报
  tracked: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'saved'])

function emptyDetail() {
  return {
    public: { status: '意向公示', region: '', project_no: '', project_name: '', budget_yuan: '', ceiling_yuan: '' },
    buyer: { name: '', phone: '', email: '', address: '' },
    agency: { name: '', phone: '', email: '', address: '' },
    correctionsOn: false,
    corrections: [],
    intention: { startDate: '', endDate: '', url: '' },
    bidding: { method: '', periodDays: '', docStart: '', docEnd: '', docWay: '', docNote: '', demand: '', bidStart: '', bidEnd: '', url: '' },
    terminated: { reason: '', note: '', url: '' },
    completed: {
      type: '', amount_yuan: '', winDate: '',
      winner: { lead: '', members: [''], isUnion: false },
      isSplit: false, packages: [], judges: [], url: ''
    },
    operationLog: []
  }
}

function clone(o) { return JSON.parse(JSON.stringify(o)) }

const form = reactive(clone(props.initial && props.initial.detail ? props.initial.detail : emptyDetail()))
const version = ref(props.initial ? props.initial.version : null)
const saving = ref(false)
const confirmState = ref(null)
let suppressStatusWatch = false

// 统一校验中枢：provide 给 10 个子组件
const validation = useValidation(form, { excludeId: props.projectId || 0 })
provide('projectForm', form)
provide('projectErrors', validation.errors)
provide('projectHints', validation.hints)
provide('projectValidation', validation)

// 严格按业务需求 2.3：状态决定显示哪些私有模块（不删除数据）
const stages = computed(function () {
  const s = form.public.status
  return {
    bidding: s !== '意向公示',
    terminated: s === '终止招标',
    completed: s === '完成招标'
  }
})

// 状态互斥：只在「完成招标 ↔ 终止招标」且对方阶段已填数据时二次确认
watch(function () { return form.public.status; }, function (next, prev) {
  if (suppressStatusWatch) { suppressStatusWatch = false; return }
  let conflict = null
  if (next === '终止招标' && prev === '完成招标' && V.hasStageData(form.completed)) conflict = 'completed'
  if (next === '完成招标' && prev === '终止招标' && V.hasStageData(form.terminated)) conflict = 'terminated'
  // 倒退 / 完成↔终止互换：提示跟进复盘会被归档（后端同事务执行重置）
  const trackingReset = props.tracked && isResetSwitch(prev, next)
  if (conflict || trackingReset) confirmState.value = { from: prev, to: next, conflict: conflict, trackingReset: trackingReset }
})

function confirmSwitch() {
  const c = confirmState.value
  if (!c) return
  // 只清空目标模块，绝不触碰 intention / bidding / 公共信息
  if (c.conflict === 'completed') Object.assign(form.completed, V.emptyCompleted())
  else Object.assign(form.terminated, V.emptyTerminated())
  form.public.status = c.to
  if (!Array.isArray(form.operationLog)) form.operationLog = []
  form.operationLog.push({
    type: '状态切换清空', from: c.from, to: c.to, cleared: c.conflict,
    time: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
  })
  confirmState.value = null
}

function cancelSwitch() {
  const c = confirmState.value
  suppressStatusWatch = true
  form.public.status = c.from
  confirmState.value = null
}

async function submit() {
  if (validation.blocking.value) { toastError('请修正标红项'); return }
  const no = String(form.public.project_no || '').trim()
  if (no) await validation.checkNo(no)   // 保存前同步查一次，避免并发脏提示
  if (!validation.validateAll() || validation.blocking.value) { toastError('请修正标红项'); return }
  saving.value = true
  try {
    const payload = { detail: clone(form) }
    if (props.mode === 'edit') {
      payload.version = version.value
      await updateProject(props.projectId, payload)
    } else {
      await createProject(payload)
    }
    emit('saved')
  } catch (e) {
    toastError(e.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>
