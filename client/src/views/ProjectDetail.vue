<template>
  <div class="dt-page">
    <div class="dt-head">
      <div class="dt-head-main">
        <button class="btn" @click="emit('back')">← 返回项目列表</button>
        <div class="dt-title-row">
          <h2 class="dt-title">{{ fmt(projectName) }}</h2>
          <span class="status-tag" :data-status="status">{{ status }}</span>
        </div>
        <div class="dt-meta">
          项目编号 {{ fmt(projectNo) }} · 监管地区 {{ fmt(region) }} · 最后更新 {{ fmt(p && p.updated_at) }}
        </div>
      </div>
      <button class="btn primary" v-if="canWrite" @click="openEdit" :disabled="!project">编辑项目</button>
    </div>

    <div v-if="loading" class="panel dt-loading">正在读取项目详情…</div>
    <div v-else-if="loadError" class="panel err-box">
      {{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <template v-else-if="project">
      <!-- 项目跟进：仅在已跟进项目顶部展示横向轨迹 -->
      <TrackingSteps :stages="trackingStages" />

      <!-- 公共信息 -->
      <DetailCard title="公共信息">
        <DetailItem label="项目状态" :value="status" />
        <DetailItem label="监管地区" :value="pub.region" />
        <DetailItem label="项目编号" :value="pub.project_no" />
        <DetailItem label="项目名称" :value="pub.project_name" />
        <DetailItem label="项目预算" :value="fmtWan(pub.budget_yuan, p && p.budget_fen)" />
        <DetailItem label="最高限价" :value="fmtWan(pub.ceiling_yuan, p && p.ceiling_fen)" />
      </DetailCard>

      <DetailCard title="相关单位">
        <DetailItem label="采购单位名称" :value="buyer.name" />
        <DetailItem label="代理机构名称" :value="agency.name" />
      </DetailCard>

      <!-- 更正信息：按组展示 -->
      <DetailCard v-if="showCorrections" title="更正信息" :sub="corrections.length + ' 组'">
        <div class="dt-full dt-block">
          <div class="dt-pkg-grid">
            <DetailCorrectionCard v-for="(c, i) in corrections" :key="i" :c="c" :index="i" />
          </div>
        </div>
      </DetailCard>

      <!-- 意向公示 -->
      <DetailCard v-if="showIntention" title="意向公示">
        <DetailItem label="征求意见起始日期" :value="intention.startDate" />
        <DetailItem label="征求意见截止日期" :value="intention.endDate" />
        <DetailItem label="意向公告网址" :value="intention.url" :href="intention.url" full />
      </DetailCard>

      <!-- 正在招标 -->
      <DetailCard v-if="showBidding" title="正在招标">
        <DetailItem label="采购方式" :value="bidding.method" />
        <DetailItem label="合同履行期限" :value="periodText" />
        <DetailItem label="获取方式" :value="bidding.docWay" />
        <DetailItem label="备注" :value="bidding.docNote" />
        <DetailItem label="获取文件起始日期" :value="bidding.docStart" />
        <DetailItem label="获取文件截止日期" :value="bidding.docEnd" />
        <DetailItem label="采购需求" :value="bidding.demand" full />
        <DetailItem label="投标开始时间" :value="bidding.bidStart" />
        <DetailItem label="投标截止时间" :value="bidding.bidEnd" />
        <DetailItem label="招标公告网址" :value="bidding.url" :href="bidding.url" full />
      </DetailCard>

      <!-- 终止招标 -->
      <DetailCard v-if="showTerminated" title="终止招标">
        <DetailItem label="终止原因" :value="terminated.reason" full />
        <DetailItem label="补充说明" :value="terminated.note" full />
        <DetailItem label="终止公告网址" :value="terminated.url" :href="terminated.url" full />
      </DetailCard>

      <!-- 完成招标 -->
      <DetailCard v-if="showCompleted" title="完成招标">
        <template v-if="!completed.isSplit">
          <DetailItem label="项目类型" :value="completed.type" />
          <DetailItem label="中标金额" :value="fmtWan(completed.amount_yuan, p && p.award_amount_fen)" />
          <DetailItem label="中标时间" :value="completed.winDate" />
          <DetailItem v-if="winnerFilled(completed.winner)" label="中标单位" full>
            <DetailWinner :winner="completed.winner" />
          </DetailItem>
        </template>
        <template v-else>
          <DetailItem label="总中标金额" :value="fmtWan(p && p.award_amount_yuan, p && p.award_amount_fen)" />
          <DetailItem label="中标时间" :value="completed.winDate" />
          <DetailItem v-if="packages.length" label="分包信息" full>
            <div class="dt-pkg-grid">
              <DetailPackageCard v-for="(pkg, i) in packages" :key="i" :pkg="pkg" :index="i" />
            </div>
          </DetailItem>
        </template>
        <DetailItem v-if="judges.length" label="评委" full>
          <DetailJudges :judges="judges" />
        </DetailItem>
        <DetailItem label="中标公告网址" :value="completed.url" :href="completed.url" full />
      </DetailCard>
    </template>

    <!-- 编辑弹窗：复用唯一的 ProjectForm；保存后刷新详情并通知列表刷新 -->
    <ProjectForm
      v-if="dialogOpen"
      mode="edit"
      :project-id="projectId"
      :initial="project"
      @close="dialogOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { getProject } from '../api.js'
import { canWrite } from '../store/auth.js'
import { fmt, fmtWan, raw, anyFilled, winnerFilled } from '../utils/detailFormat.js'
import ProjectForm from '../components/ProjectForm.vue'
import DetailCard from '../components/detail/DetailCard.vue'
import DetailItem from '../components/detail/DetailItem.vue'
import DetailWinner from '../components/detail/DetailWinner.vue'
import DetailPackageCard from '../components/detail/DetailPackageCard.vue'
import DetailCorrectionCard from '../components/detail/DetailCorrectionCard.vue'
import DetailJudges from '../components/detail/DetailJudges.vue'
import TrackingSteps from '../components/tracking/TrackingSteps.vue'

const props = defineProps({
  projectId: { type: [Number, String], default: null },
  active: { type: Boolean, default: false }
})
const emit = defineEmits(['back', 'saved'])

const project = ref(null)
const loading = ref(false)
const loadError = ref('')
const dialogOpen = ref(false)

function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {} }
function arr(v) { return Array.isArray(v) ? v : [] }

const p = computed(function () { return project.value || null })
const d = computed(function () { return project.value ? obj(project.value.detail) : {} })
const pub = computed(function () { return obj(d.value.public) })
const buyer = computed(function () { return obj(d.value.buyer) })
const agency = computed(function () { return obj(d.value.agency) })
const intention = computed(function () { return obj(d.value.intention) })
const bidding = computed(function () { return obj(d.value.bidding) })
const terminated = computed(function () { return obj(d.value.terminated) })
const completed = computed(function () { return obj(d.value.completed) })
const corrections = computed(function () { return arr(d.value.corrections) })
const packages = computed(function () { return arr(completed.value.packages) })
const judges = computed(function () { return arr(completed.value.judges) })

const status = computed(function () { return raw(pub.value.status) || '意向公示' })
const projectName = computed(function () { return raw(pub.value.project_name) })
const projectNo = computed(function () { return raw(pub.value.project_no) })
const region = computed(function () { return raw(pub.value.region) })
const trackingStages = computed(function () {
  return p.value && p.value.tracking && p.value.tracking.active ? (p.value.tracking.stages || []) : []
})
const periodText = computed(function () {
  const v = raw(bidding.value.periodDays)
  return v ? v + ' 天' : ''
})

// 空模块不展示：按状态确定应出现的阶段，再要求该阶段至少有一个字段有值
const showCorrections = computed(function () {
  return !!d.value.correctionsOn && corrections.value.length > 0
})
const showIntention = computed(function () {
  return anyFilled(intention.value, ['startDate', 'endDate', 'url'])
})
const showBidding = computed(function () {
  return status.value !== '意向公示' && anyFilled(bidding.value, [
    'method', 'periodDays', 'docStart', 'docEnd', 'docWay', 'docNote', 'demand', 'bidStart', 'bidEnd', 'url'
  ])
})
const showTerminated = computed(function () {
  return status.value === '终止招标' && anyFilled(terminated.value, ['reason', 'note', 'url'])
})
const showCompleted = computed(function () {
  if (status.value !== '完成招标') return false
  const c = completed.value
  return anyFilled(c, ['type', 'amount_yuan', 'winDate', 'url']) ||
    winnerFilled(c.winner) || packages.value.length > 0 || judges.value.length > 0
})

async function load() {
  if (props.projectId == null) return
  loading.value = true
  loadError.value = ''
  try {
    project.value = await getProject(props.projectId)
  } catch (e) {
    loadError.value = e.message || '读取项目详情失败'
    project.value = null
  } finally {
    loading.value = false
  }
}

function openEdit() { if (project.value) dialogOpen.value = true }

async function onSaved() {
  dialogOpen.value = false
  emit('saved')          // 通知 App.vue 让列表刷新（列表只 load，不动 filters）
  await load()           // 详情页同步刷新
}

// 组件常驻（v-show）：每次进入详情或切换项目时重新拉取，保证数据最新
watch([function () { return props.active }, function () { return props.projectId }], function (values) {
  if (values[0] && props.projectId != null) load()
}, { immediate: true })
</script>
