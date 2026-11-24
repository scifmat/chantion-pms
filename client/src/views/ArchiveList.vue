<template>
  <div>
    <div class="page-head">
      <div>
        <h2>{{ title || archiveLabel(type) }}</h2>
        <div class="muted">共 {{ rows.length }} 条档案</div>
      </div>
    </div>

    <div class="panel">
      <div class="query-grid">
        <div class="fld">
          <label>名称关键字</label>
          <input v-model="q" placeholder="输入名称查询" @keydown.enter="load">
        </div>
      </div>
      <div class="query-actions">
        <span class="spacer"></span>
        <button class="btn primary" @click="load">查询</button>
        <button class="btn" @click="reset">恢复</button>
      </div>
    </div>

    <div class="panel err-box" v-if="loadError">
      读取档案失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <!-- 定宽表格：不限高，纵向/横向滚动都由右侧工作区 #content 统一承担，表头吸顶 -->
    <div class="panel table-wrap archive-table-wrap">
      <table class="archive-table">
        <!-- 联系方式三列放宽：多值用标签换行展示，需足够宽度；最后一列留给编辑/删除 -->
        <colgroup>
          <col v-for="(w, i) in colWidths" :key="i" :style="{ width: w + 'px' }">
        </colgroup>
        <thead>
          <tr><th v-for="c in cols" :key="c" :class="{ 'col-frozen': c === '操作' }">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td v-cell-align class="cell-wrap" :title="r.name">
              <button v-if="hasDashboard" class="archive-name-link" @click="openDashboard(r)">{{ r.name }}</button>
              <span v-else>{{ r.name }}</span>
              <SelfBadge :name="r.name" />
            </td>
            <td v-cell-align class="cell-ellip">
              <span v-if="type === 'judge'">
                <template v-if="r.leader || r.owner">
                  <span class="pill" v-if="r.leader">组长</span><span class="pill" v-if="r.owner" style="margin-left:4px">业主</span>
                </template>
                <span v-else>—</span>
              </span>
              <span v-else>{{ r.attribute || '—' }}</span>
            </td>
            <td v-cell-align class="cell-ellip">
              <MultiValueCell :values="r.phoneList && r.phoneList.length ? r.phoneList : r.phone" label="联系电话" />
            </td>
            <td v-cell-align class="cell-ellip">
              <MultiValueCell :values="r.emailList && r.emailList.length ? r.emailList : r.email" label="电子邮箱" />
            </td>
            <td v-cell-align class="cell-ellip">
              <MultiValueCell :values="r.addressList && r.addressList.length ? r.addressList : r.address" label="地址" ellipsis />
            </td>
            <td v-cell-align class="cell-ellip">{{ r.refApprox ? '约 ' : '' }}{{ r.refCount }}</td>
            <td v-cell-align class="cell-ellip" :title="r.updated_at">{{ r.updated_at || '—' }}</td>
            <td v-cell-align class="cell-actions col-frozen" v-if="hasOps">
              <button class="btn sm" v-if="hasDashboard" @click="openDashboard(r)">看板</button>
              <template v-if="canEdit">
                <button class="btn sm" :style="hasDashboard ? 'margin-left:6px' : ''" @click="openEdit(r)">编辑</button>
                <button class="btn sm danger" style="margin-left:6px" @click="remove(r)">删除</button>
              </template>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="cols.length" class="empty">未查询到符合条件的档案</td></tr>
          <tr v-if="loading"><td :colspan="cols.length" class="empty">正在读取…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 编辑弹窗：三类档案共用同一套表单；名称改动由后端同事务同步到关联项目 -->
    <ElDialog
      v-model="dialogOpen"
      :title="'编辑' + archiveLabel(type)"
      width="540px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div class="archive-edit-form">
        <div class="fld">
          <label>名称 <span style="color:#d92d20">*</span></label>
          <input v-model="form.name" placeholder="单位 / 机构名称" @keydown.enter="saveEdit">
        </div>
        <div class="fld">
          <label>单位属性</label>
          <ElSelect v-model="form.attribute" placeholder="请选择（可不填）" clearable style="width:100%">
            <ElOption v-for="a in unitAttributes" :key="a" :label="a" :value="a" />
          </ElSelect>
        </div>
        <div class="edit-hint" v-if="form.refCount > 0">
          该档案被 {{ form.refCount }} 个项目引用。修改名称后，系统会同步更新这些项目列表与详情中的名称。
        </div>
        <div class="edit-hint" v-else>
          当前无项目引用该档案，修改名称不会影响已有项目。
        </div>
        <div class="fld">
          <label>联系电话（每行一个）</label>
          <textarea v-model="form.phone" rows="3" placeholder="每行填写一个联系电话，留空表示清空"></textarea>
        </div>
        <div class="fld">
          <label>电子邮箱（每行一个）</label>
          <textarea v-model="form.email" rows="3" placeholder="每行填写一个邮箱，留空表示清空"></textarea>
        </div>
        <div class="fld">
          <label>地址（每行一个）</label>
          <textarea v-model="form.address" rows="3" placeholder="每行填写一个地址，留空表示清空"></textarea>
        </div>
      </div>
      <template #footer>
        <button class="btn" :disabled="saving" @click="dialogOpen = false">取消</button>
        <button class="btn primary" style="margin-left:8px" :disabled="saving" @click="saveEdit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </ElDialog>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElDialog, ElMessageBox, ElSelect, ElOption } from 'element-plus'
import { getArchives, updateArchive, deleteArchive } from '../api.js'
import { archiveLabel, UNIT_ATTRIBUTES, REF_COL_LABEL } from '../utils/archive.js'
import MultiValueCell from '../components/MultiValueCell.vue'
import SelfBadge from '../components/SelfBadge.vue'
import { toastSuccess, toastError, toastWarning } from '../utils/toast.js'
import { canWrite } from '../store/auth.js'

const unitAttributes = UNIT_ATTRIBUTES

const props = defineProps({
  type: { type: String, required: true },   // buyer | agency | competitor | judge
  title: { type: String, default: '' },
  active: { type: Boolean, default: false }
})
// 第 10 步：仅三类业务档案有看板（评委无关联项目）
const emit = defineEmits(['go-dashboard'])
const hasDashboard = computed(function () {
  return ['buyer', 'agency', 'competitor'].indexOf(props.type) >= 0
})
function openDashboard(r) {
  emit('go-dashboard', { type: props.type, id: r.id, name: r.name, from: props.title || archiveLabel(props.type) })
}

// 只有三类业务档案开放改 / 删；评委档案保持只读；未登录访客全部只读
const canEdit = computed(function () {
  return canWrite.value && ['buyer', 'agency', 'competitor'].indexOf(props.type) >= 0
})
// 引用数列按业务语义动态命名；评委等未配置的类型回退为通用名
const refColName = computed(function () { return REF_COL_LABEL[props.type] || '引用项目数' })
// 操作列：有编辑权限或有看板入口时都显示（访客也能看看板）
const hasOps = computed(function () { return canEdit.value || hasDashboard.value })
const cols = computed(function () {
  const base = ['名称', '属性', '联系电话', '电子邮箱', '地址', refColName.value, '更新时间']
  return hasOps.value ? base.concat(['操作']) : base
})
// 与 cols 一一对应：去掉「首次出现编号」列
const colWidths = computed(function () {
  return hasOps.value
    ? [160, 90, 150, 170, 220, 90, 130, 110]
    : [160, 90, 150, 170, 220, 90, 130]
})

const q = ref('')
const rows = ref([])
const loading = ref(false)
const loadError = ref('')
const loaded = ref(false)

// 编辑弹窗状态
const dialogOpen = ref(false)
const saving = ref(false)
const form = ref({ id: null, name: '', attribute: '', phone: '', email: '', address: '', refCount: 0 })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await getArchives(props.type, q.value)
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}
function reset() { q.value = ''; load() }

function openEdit(r) {
  form.value = {
    id: r.id,
    name: r.name,
    attribute: r.attribute || '',
    phone: (r.phoneList || []).join('\n'),
    email: (r.emailList || []).join('\n'),
    address: (r.addressList || []).join('\n'),
    refCount: r.refCount || 0
  }
  dialogOpen.value = true
}

function lines(v) {
  return String(v == null ? '' : v).split(/\r?\n/).map(function (s) { return s.trim() }).filter(Boolean)
}

async function saveEdit() {
  const f = form.value
  const name = String(f.name == null ? '' : f.name).trim()
  if (!name) { toastError('名称不能为空'); return }
  saving.value = true
  try {
    const data = await updateArchive(props.type, f.id, {
      name: name,
      attribute: f.attribute || '',
      phone: lines(f.phone),
      email: lines(f.email),
      address: lines(f.address)
    })
    dialogOpen.value = false
    toastSuccess(data && data.renamed
      ? '保存成功，已同步更新 ' + (data.synced || 0) + ' 个关联项目'
      : '保存成功')
    await load()
  } catch (e) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}

async function remove(r) {
  // 前端先按引用数拦截，体验更快；后端仍会独立严格校验，双保险
  if (r.refCount > 0) {
    toastWarning('该单位正在被 ' + r.refCount + ' 个项目引用，无法删除，请先修改关联项目')
    return
  }
  try {
    await ElMessageBox.confirm(
      '确定删除档案「' + r.name + '」吗？删除后会移入「回收站」，可在回收站恢复。',
      '删除确认',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) { return } // 用户取消
  try {
    await deleteArchive(props.type, r.id)
    toastSuccess('档案已移入回收站')
    await load()
  } catch (e) {
    toastError(e.message)
    await load() // 后端拦截时刷新真实的引用数
  }
}

// 组件常驻（App.vue 用 v-show）：首次进入加载全量，此后切走再切回条件与结果原样保留
watch(function () { return props.active; }, function (on) {
  if (on && !loaded.value) {
    loaded.value = true
    load()
  }
}, { immediate: true })
</script>

<style scoped>
.archive-edit-form { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
.archive-edit-form textarea { resize: vertical; min-height: 62px; }
.edit-hint {
  font-size: 12px;
  color: #42526e;
  background: #eef4ff;
  border: 1px solid #d8e4ff;
  border-radius: 5px;
  padding: 8px 10px;
  line-height: 1.5;
}
.cell-actions { white-space: nowrap; }
</style>
