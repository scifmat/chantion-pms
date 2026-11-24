<template>
  <div>
    <div class="page-head">
      <div>
        <h2>操作记录</h2>
        <div class="muted">共 {{ rows.length }} 条 · 事件级留痕（何时 / 谁 / 做了什么）· 按操作时间倒序 · {{ isAdmin ? '含项目操作与系统设置' : '项目操作记录' }} · 本页只读</div>
      </div>
    </div>

    <div class="panel">
      <div class="query-grid">
        <div class="fld">
          <label>操作类型</label>
          <select v-model="filters.type">
            <option value="">全部</option>
            <option v-for="t in opTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="fld">
          <label>项目编号 / 名称 / 摘要</label>
          <input v-model="filters.keyword" placeholder="输入关键字">
        </div>
        <div class="fld">
          <label>项目编号</label>
          <input v-model="filters.no" placeholder="精确关键字">
        </div>
        <div class="fld">
          <label>操作时间</label>
          <div class="date-range">
            <DateField kind="date" v-model="filters.from" />
            <span class="sep">至</span>
            <DateField kind="date" v-model="filters.to" />
          </div>
        </div>
      </div>
      <div class="query-actions">
        <span class="spacer"></span>
        <button class="btn primary" @click="load">查询</button>
        <button class="btn" @click="reset">恢复</button>
      </div>
    </div>

    <div class="panel err-box" v-if="loadError">
      读取操作记录失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <!-- 6 列定宽：不限高，纵向随工作区滚动，超宽由工作区统一横向滚动，表头吸顶 -->
    <div class="panel table-wrap log-table-wrap">
      <table class="log-table">
        <colgroup>
          <col style="width:160px"><col style="width:120px"><col style="width:150px">
          <col style="width:200px"><col style="width:130px"><col style="width:420px">
        </colgroup>
        <thead><tr><th v-for="c in cols" :key="c">{{ c }}</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td v-cell-align class="cell-ellip" :title="r.created_at">{{ r.created_at }}</td>
            <td v-cell-align class="cell-ellip">{{ r.operator || '—' }}</td>
            <td v-cell-align class="cell-ellip" :title="r.project_no">{{ isSystemLog(r) ? '—' : (r.project_no || '—') }}</td>
            <td v-cell-align class="cell-wrap" :title="r.project_name">{{ isSystemLog(r) ? '—' : (r.project_name || '—') }}</td>
            <td v-cell-align class="cell-ellip">
              <span class="pill" :class="{ danger: r.op_type === '删除项目', system: r.op_type === '系统设置' }">{{ r.op_type }}</span>
            </td>
            <td v-cell-align class="cell-wrap" :title="r.summary">{{ r.summary || '—' }}</td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="6" class="empty">未查询到操作记录</td></tr>
          <tr v-if="loading"><td colspan="6" class="empty">正在读取…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { getOperationLogs, getOperationLogTypes } from '../api.js'
import { isAdmin } from '../store/auth.js'
import DateField from '../components/form/DateField.vue'

const props = defineProps({ active: { type: Boolean, default: false } })
// 操作类型下拉：从后端实际数据取（含系统设置等非项目操作），接口异常时用内置兜底
// 「状态切换清空」当前无记录且含义晦涩，不列入固定下拉；记录仍在库里，「全部」可见
const opTypes = ref(['新增项目', '编辑项目', '删除项目', '系统设置'])
const cols = ['操作时间', '操作人', '项目编号', '项目名称', '操作类型', '摘要']

// 系统类操作的 project_no 用 system_* 哨兵值，展示时以「—」代替，靠操作类型与摘要区分
function isSystemLog(r) {
  return String(r.project_no || '').indexOf('system_') === 0
}

const emptyFilters = () => ({ type: '', no: '', keyword: '', from: '', to: '' })
const filters = reactive(emptyFilters())
const rows = ref([])
const loading = ref(false)
const loadError = ref('')
const loaded = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try { rows.value = await getOperationLogs(filters) }
  catch (e) { loadError.value = e.message }
  finally { loading.value = false }
}
function reset() { Object.assign(filters, emptyFilters()); load() }

async function loadTypes() {
  try {
    const list = await getOperationLogTypes()
    if (Array.isArray(list) && list.length) opTypes.value = list
  } catch (e) { /* 接口异常时保留内置兜底列表 */ }
}

// 组件常驻（App.vue 用 v-show）：首次进入加载全量 + 操作类型下拉
watch(function () { return props.active; }, function (on) {
  if (on && !loaded.value) { loaded.value = true; load(); loadTypes() }
}, { immediate: true })

// 用户身份切换（普通用户 ↔ 管理员）时，数据可见范围会变：重置加载状态、筛选条件与旧数据，再重新加载。
// 必须一并清空 filters：否则会残留对当前身份无效的筛选值（如普通用户视角下的「系统设置」），
// 导致下拉选中值不在选项里（显示空白）+ 用无效条件查询出 0 条。
watch(isAdmin, function () {
  loaded.value = false
  Object.assign(filters, emptyFilters())
  rows.value = []
  if (props.active) { load(); loadTypes() }
})
</script>
