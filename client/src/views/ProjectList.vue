<template>
  <div>
    <div class="page-head">
      <div>
        <h2>项目列表</h2>
        <div class="muted">共 {{ rows.length }} 条</div>
      </div>
      <div style="display:flex;gap:8px" v-if="canWrite">
        <button class="btn" @click="exportOpen = true">导出 Excel</button>
        <button class="btn primary" @click="openAdd">+ 新增项目</button>
      </div>
    </div>

    <!-- 首页普通查询：4 列等宽栅格 -->
    <div class="panel">
      <div class="query-grid">
        <div class="fld">
          <label>项目状态</label>
          <select v-model="filters.status">
            <option value="">全部</option>
            <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="fld">
          <label>项目名称</label>
          <input v-model="filters.name" placeholder="输入名称关键字">
        </div>
        <div class="fld">
          <label>监管地区</label>
          <RegionPicker v-model="filters.region" placeholder="全部（输入汉字或拼音）" />
        </div>
        <div class="fld">
          <label>中标时间</label>
          <div class="date-range">
            <DateField kind="date" v-model="filters.timeStart" />
            <span class="sep">至</span>
            <DateField kind="date" v-model="filters.timeEnd" />
          </div>
        </div>
      </div>
      <div class="query-actions">
        <span class="spacer"></span>
        <button class="btn primary" @click="load">查询</button>
        <button class="btn" @click="resetFilters">恢复</button>
        <button class="btn-link" @click="emit('go-advanced')">高级查询 →</button>
      </div>
    </div>

    <div class="panel err-box" v-if="loadError">
      读取项目列表失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <!-- 表格默认 width:100% 撑满容器；项目状态列自适应（不设固定宽度），其余列按比例 -->
    <div class="panel table-wrap">
      <table>
        <colgroup>
          <col><col style="width:20%"><col style="width:17%">
          <col style="width:13%"><col style="width:13%"><col style="width:12%"><col style="width:15%">
        </colgroup>
        <thead>
          <tr>
            <th>项目状态</th><th>项目名称</th><th>监管地区</th>
            <th>项目预算（万元）</th><th>中标金额（万元）</th><th>中标时间</th><th class="col-frozen">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.row_id">
            <td v-cell-align class="status-cell"><span class="status-tag" :data-status="r.status">{{ r.status }}</span></td>
            <td v-cell-align class="cell-wrap" :title="r.project_name">
              <button class="project-name-link" @click="emit('go-detail', r.row_id)">{{ r.project_name }}</button>
            </td>
            <td v-cell-align class="cell-ellip region-cell" :title="r.region">{{ r.region || '—' }}</td>
            <td v-cell-align class="cell-ellip">{{ moneyCell(r.budget_yuan, r.budget_fen) }}</td>
            <td v-cell-align class="cell-ellip">{{ moneyCell(r.award_amount_yuan, r.award_amount_fen) }}</td>
            <td v-cell-align class="cell-ellip">{{ r.award_time || '—' }}</td>
            <td v-cell-align class="cell-ellip col-frozen">
              <a v-if="r.notice_url" class="btn sm" :href="r.notice_url" target="_blank" rel="noopener noreferrer">公告</a>
              <button v-else class="btn sm" disabled title="当前项目未填写公告网址">公告</button>
              <template v-if="canWrite">
                <button class="btn sm" style="margin-left:5px" @click="openEdit(r)">编辑</button>
                <button class="btn sm danger" style="margin-left:5px" @click="confirmDelete(r)">删除</button>
              </template>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="empty">未查询到符合条件的项目</td></tr>
          <tr v-if="loading"><td colspan="7" class="empty">正在读取…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 通用导出弹窗：queryType=home，默认勾选首页 7 个核心字段（后端字典下发） -->
    <ExportDialog
      v-model="exportOpen"
      query-type="home"
      filename="项目列表"
      :build-payload="buildHomeParams"
    />

    <!-- 全量录入/编辑弹窗：由 ProjectForm 负责分区、状态联动与校验 -->
    <ProjectForm
      v-if="dialogOpen"
      :mode="dialogMode"
      :project-id="editingId"
      :initial="editingProject"
      @close="dialogOpen = false"
      @saved="onSaved"
    />

  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { getProjects, getProject, deleteProject } from '../api.js'
import { fenToWan } from '../utils/money.js'
import { opts } from '../utils/options.js'
import { toastSuccess, toastError } from '../utils/toast.js'
import { confirmAction } from '../utils/confirm.js'
import { canWrite } from '../store/auth.js'
import ProjectForm from '../components/ProjectForm.vue'
import DateField from '../components/form/DateField.vue'
import RegionPicker from '../components/form/RegionPicker.vue'
import ExportDialog from '../components/ExportDialog.vue'

const props = defineProps({
  // 详情页编辑保存后由 App.vue +1：只重新拉数据，绝不动 filters
  refreshToken: { type: Number, default: 0 }
})
const emit = defineEmits(['go-advanced', 'go-detail'])

const exportOpen = ref(false)

// 下拉选项统一取自业务配置（监管地区改由全国行政区划级联组件提供）
const statuses = computed(function () { return opts('status') })

const rows = ref([])
const loading = ref(true)
const loadError = ref('')

const dialogOpen = ref(false)
const dialogMode = ref('add')
const editingId = ref(null)
const editingProject = ref(null)

const emptyFilters = () => ({ status: '', name: '', region: '', timeStart: '', timeEnd: '' })
const filters = reactive(emptyFilters())

// 金额展示与高级查询共用同一份换算（整数分 -> 万元两位，防坑 K-1）
function moneyCell(yuan, fen) {
  return fenToWan(yuan, fen)
}

// 统一走屏幕正上方居中的全局 Toast（成功绿勾 / 失败红警，3 秒渐隐）
function showToast(msg, type = '') {
  if (type === 'info' || type === 'error') toastError(msg)
  else toastSuccess(msg)
}

// 首页查询参数组装 —— 列表查询与导出共用同一份，保证「所见即所得」。
// 返回 filters 的纯对象快照；空值由 getProjects(QUERY_KEYS) 与后端 buildHomeWhere 各自按同样规则忽略。
function buildHomeParams() {
  return {
    status: filters.status,
    name: filters.name,
    region: filters.region,
    timeStart: filters.timeStart,
    timeEnd: filters.timeEnd
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await getProjects(buildHomeParams())
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

// 详情页编辑保存后由 App.vue 通知：只 load() 刷新数据，查询条件 filters 原样保留
watch(function () { return props.refreshToken }, function () { load() })

// 恢复：清空全部条件并重新拉全量
function resetFilters() {
  Object.assign(filters, emptyFilters())
  load()
}

function openAdd() {
  dialogMode.value = 'add'
  editingId.value = null
  editingProject.value = null
  dialogOpen.value = true
}

// 编辑：先取单条完整数据（含 detail 与 version），再打开同一个弹窗回填
async function openEdit(row) {
  try {
    const data = await getProject(row.row_id)
    dialogMode.value = 'edit'
    editingId.value = row.row_id
    editingProject.value = data
    dialogOpen.value = true
  } catch (e) {
    showToast(e.message, 'info')
  }
}

// 保存成功后只重新加载列表，不动 filters —— 查询条件原样保留
function onSaved() {
  dialogOpen.value = false
  load()
  showToast('保存成功')
}

// 软删除：统一二次确认后才调用；服务端在同一事务内写操作记录
async function confirmDelete(r) {
  try {
    await confirmAction({
      title: '删除项目',
      object: '确定要移入回收站：「' + r.project_name + '」（' + r.project_no + '）吗？',
      consequence: '删除后将不再出现在列表中，您可以在回收站恢复。',
      confirmText: '移入回收站',
      danger: true
    })
  } catch (e) { return }
  try {
    await deleteProject(r.row_id, r.version)
    toastSuccess('项目「' + r.project_name + '」已移入回收站')
    load()   // 只刷新列表，不动 filters，查询条件原样保留
  } catch (e) {
    toastError(e.message || '删除失败，请重试')
  }
}
</script>
