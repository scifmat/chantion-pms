<template>
  <div>
    <div class="page-head">
      <div>
        <h2>项目跟进</h2>
        <div class="muted">共 {{ rows.length }} 条 · 数据按当前登录人视角统计</div>
      </div>
      <div class="muted">{{ roleLabel }}</div>
    </div>

    <!-- 顶部个人看板 -->
    <div class="stat-grid">
      <div class="stat-card todo">
        <span class="stat-label">待办提醒</span>
        <b class="stat-num">{{ summary.pending }}</b>
        <span class="stat-note">7 天内截止 / 待复盘</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">进行中</span>
        <b class="stat-num">{{ summary.following }}</b>
        <span class="stat-note">我负责的跟进中项目</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">本月已结束</span>
        <b class="stat-num">{{ summary.ended_month }}</b>
        <span class="stat-note">中标 {{ summary.won_month }} / 落标 {{ summary.lost_month }}</span>
      </div>
    </div>

    <div class="panel">
      <div class="query-grid">
        <div class="fld">
          <label>跟进状态</label>
          <select v-model="filters.stage">
            <option value="">全部</option>
            <option v-for="s in stageOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="fld">
          <label>内部动态</label>
          <select v-model="filters.internal">
            <option value="">全部</option>
            <option v-for="s in internalOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="fld">
          <label>项目状态</label>
          <select v-model="filters.status">
            <option value="">全部</option>
            <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="fld">
          <label>负责人</label>
          <select v-model="filters.owner">
            <option value="">全部</option>
            <option value="mine">我负责的</option>
            <option value="other">其他人的</option>
          </select>
        </div>
      </div>
      <div class="query-grid" style="margin-top:8px">
        <div class="fld">
          <label>项目编号 / 名称 / 负责人</label>
          <input v-model="filters.keyword" placeholder="输入关键字">
        </div>
        <div class="fld"></div>
        <div class="fld"></div>
        <div class="fld"></div>
      </div>
      <!-- 按钮单独一行并右对齐，与首页项目列表排版一致 -->
      <div class="query-actions">
        <span class="spacer"></span>
        <button class="btn primary" @click="load">查询</button>
        <button class="btn" @click="reset">恢复</button>
      </div>
    </div>

    <div class="panel err-box" v-if="loadError">
      读取跟进数据失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <div class="panel table-wrap">
      <table>
        <colgroup>
          <col style="width:20%"><col style="width:11%"><col style="width:10%">
          <col style="width:13%"><col style="width:10%"><col style="width:12%">
          <col style="width:10%"><col style="width:14%">
        </colgroup>
        <thead>
          <tr>
            <th>项目名称</th><th>项目状态</th><th>跟进状态</th><th>内部动态</th>
            <th>跟进负责人</th><th>投标截止时间</th><th>预算（万元）</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td v-cell-align class="cell-wrap" :title="r.project_name">
              <button class="project-name-link" @click="emit('go-detail', r.project_id)">{{ r.project_name }}</button>
              <div class="sub-no">{{ r.project_no }}</div>
            </td>
            <td v-cell-align><span class="status-tag" :data-status="r.status">{{ r.status }}</span></td>
            <td v-cell-align><span class="pill" :class="{ ended: r.follow_stage === '已结束' }">{{ r.follow_stage }}</span></td>
            <td v-cell-align>
              <span class="pill">{{ r.internal_status }}</span>
              <span v-if="needsReview(r.internal_status)" class="review-badge" :class="{ done: !!r.review_reason }">
                {{ r.review_reason ? '已复盘' : '待复盘' }}
              </span>
            </td>
            <td v-cell-align class="cell-ellip">{{ r.owner_username || '—' }}</td>
            <td v-cell-align class="cell-ellip">
              {{ r.bid_end || '—' }}
              <div v-for="w in r.warnings" :key="w" class="warn-text">{{ w }}</div>
            </td>
            <td v-cell-align class="cell-ellip">{{ fenToWan(r.budget_yuan, r.budget_fen) }}</td>
            <td v-cell-align>
              <button class="btn sm" :disabled="!r.can_edit" title="查看时间线 / 按节点复盘补录" @click="openTimeline(r)">跟进详情</button>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="8" class="empty">暂无数据：请到「项目列表」打开跟进开关认领项目</td></tr>
          <tr v-if="loading"><td colspan="8" class="empty">正在读取…</td></tr>
        </tbody>
      </table>
    </div>

    <TrackingTimelineDialog v-if="timelineRow" :row="timelineRow" @close="timelineRow = null" />
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { getTrackings, getTrackingSummary } from '../api.js'
import { dataVersion } from '../store/dataVersion.js'
import { roleLabel, auth } from '../store/auth.js'
import { opts } from '../utils/options.js'
import { fenToWan } from '../utils/money.js'
import { TRACK_STAGES, TRACK_INTERNAL, needsReview } from '../utils/tracking.js'
import { toastError } from '../utils/toast.js'
import TrackingTimelineDialog from '../components/tracking/TrackingTimelineDialog.vue'

const emit = defineEmits(['go-detail'])
const props = defineProps({ active: { type: Boolean, default: false } })

const statuses = opts('status')
const stageOptions = TRACK_STAGES
const internalOptions = Object.values(TRACK_INTERNAL)

const emptyFilters = () => ({ stage: '', internal: '', status: '', owner: '', keyword: '' })
const filters = reactive(emptyFilters())
const rows = ref([])
const summary = ref({ pending: 0, following: 0, ended_month: 0, won_month: 0, lost_month: 0 })
const loading = ref(false)
const loadError = ref('')
const loaded = ref(false)
const timelineRow = ref(null)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [list, sum] = await Promise.all([getTrackings(filters), getTrackingSummary()])
    rows.value = list
    summary.value = sum
  } catch (e) {
    loadError.value = e.message
    toastError(e.message || '读取跟进数据失败')
  } finally {
    loading.value = false
  }
}
function reset() { Object.assign(filters, emptyFilters()); load() }

function openTimeline(r) { timelineRow.value = Object.assign({}, r) }

// 组件常驻：首次进入加载；任何跟进写操作（含首页认领）后面板自动刷新
watch(function () { return props.active }, function (on) {
  if (on && !loaded.value) { loaded.value = true; load() }
}, { immediate: true })
watch(dataVersion, function () { if (props.active && loaded.value) load() })

// 账号切换（退出后换人登录）：立即丢弃上一人的数据并重新拉取，不依赖 F5
watch([
  function () { return auth.user ? auth.user.id : 0 },
  function () { return auth.token || '' }
], function () {
  loaded.value = false
  rows.value = []
  summary.value = { pending: 0, following: 0, ended_month: 0, won_month: 0, lost_month: 0 }
  Object.assign(filters, emptyFilters())
  timelineRow.value = null
  if (props.active) load()
})
</script>

<style scoped>
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
.stat-card { background: #fff; border: 1px solid #e3e7ee; border-radius: 8px; padding: 14px 18px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
.stat-card.todo { border-color: #f3c6bf; background: #fff8f7; }
.stat-label { font-size: 13px; color: #5b6577; }
.stat-num { font-size: 26px; line-height: 1.2; color: #1f2937; }
.stat-card.todo .stat-num { color: #c0261b; }
.stat-note { font-size: 12px; color: #94a3b8; }
.sub-no { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.pill.ended { background: #e8f7ee; color: #137a4b; }
.review-badge { margin-left: 4px; padding: 1px 6px; border-radius: 9px; font-size: 11px; background: #fdecea; color: #c0261b; white-space: nowrap; }
.review-badge.done { background: #eaf2ff; color: #2f6fed; }
.warn-text { font-size: 11px; color: #c0261b; margin-top: 2px; }
</style>
