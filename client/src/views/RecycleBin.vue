<template>
  <div>
    <div class="page-head">
      <div>
        <h2>回收站</h2>
        <div class="muted">共 {{ rows.length }} 条</div>
      </div>
    </div>

    <div class="panel">
      <div class="recycle-tabs">
        <button
          v-for="t in tabs" :key="t.key"
          class="tab-btn" :class="{ on: tab === t.key }"
          @click="switchTab(t.key)"
        >{{ t.label }}</button>
      </div>
      <div class="query-grid">
        <div class="fld">
          <label>{{ tab === 'project' ? '项目编号 / 名称' : '原档案名称' }}</label>
          <input v-model="filters.q" :placeholder="tab === 'project' ? '输入关键字' : '输入名称关键字'">
        </div>
        <div class="fld">
          <label>删除时间</label>
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
        <button class="btn" @click="reset">恢复条件</button>
      </div>
    </div>

    <div class="panel err-box" v-if="loadError">
      读取回收站失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <div class="panel table-wrap">
      <table>
        <colgroup>
          <col style="width:22%"><col style="width:32%"><col style="width:16%"><col style="width:12%"><col style="width:18%">
        </colgroup>
        <thead>
          <tr>
            <th>{{ tab === 'project' ? '项目编号' : '档案类型' }}</th>
            <th>{{ tab === 'project' ? '项目名称' : '原档案名称' }}</th>
            <th>删除时间</th>
            <th>{{ tab === 'project' ? '—' : '原引用数' }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="tab + '_' + r.id">
            <td v-cell-align class="cell-ellip" :title="tab === 'project' ? r.no : r.label">
              {{ tab === 'project' ? r.no : r.label }}
            </td>
            <td v-cell-align class="cell-wrap" :title="r.name">{{ r.name }}</td>
            <td v-cell-align class="cell-ellip">{{ r.deleted_at || '—' }}</td>
            <td v-cell-align class="cell-ellip">{{ tab === 'project' ? '—' : r.ref_count }}</td>
            <td v-cell-align>
              <button class="btn sm" @click="restore(r)">恢复</button>
              <button
                v-if="isAdmin"
                class="btn sm danger"
                style="margin-left:6px"
                :disabled="tab === 'project' && !!r.tracking_owner"
                :title="tab === 'project' && r.tracking_owner ? '该项目正由「' + r.tracking_owner + '」跟进，请先关闭跟进开关' : '物理销毁，不可恢复'"
                @click="purge(r)"
              >彻底删除</button>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="5" class="empty">回收站是空的</td></tr>
          <tr v-if="loading"><td colspan="5" class="empty">正在读取…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { getRecycleItems, restoreRecycleItem, purgeRecycleItem } from '../api.js'
import { isAdmin } from '../store/auth.js'
import { toastSuccess, toastError, toastWarning } from '../utils/toast.js'
import { confirmAction, confirmInput } from '../utils/confirm.js'
import DateField from '../components/form/DateField.vue'

const props = defineProps({ active: { type: Boolean, default: false } })

const tabs = [
  { key: 'project', label: '项目' },
  { key: 'buyer', label: '采购单位' },
  { key: 'agency', label: '代理机构' },
  { key: 'competitor', label: '竞争对手' }
]
const emptyFilters = () => ({ q: '', from: '', to: '' })
const tab = ref('project')
const filters = reactive(emptyFilters())
const rows = ref([])
const loading = ref(false)
const loadError = ref('')
const loaded = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    rows.value = await getRecycleItems(Object.assign({ type: tab.value }, filters))
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}
function reset() { Object.assign(filters, emptyFilters()); load() }
function switchTab(next) { tab.value = next; load() }

async function restore(r) {
  const isProject = tab.value === 'project'
  try {
    await confirmAction({
      title: isProject ? '恢复项目' : '恢复档案',
      object: isProject
        ? '确定要恢复：「' + r.name + '」（' + r.no + '）吗？'
        : '确定要恢复：「' + r.name + '」吗？',
      consequence: isProject
        ? '恢复后将放回项目列表，并重建统计映射。'
        : '恢复后将放回原档案列表。',
      confirmText: '确定恢复',
      danger: false
    })
  } catch (e) { return }
  try {
    await restoreRecycleItem(tab.value, r.id)
    toastSuccess('已恢复到原列表')
    await load()
  } catch (e) { toastError(e.message) }
}

async function purge(r) {
  const isProject = tab.value === 'project'
  const expected = isProject ? r.no : r.name
  try {
    await confirmInput({
      title: isProject ? '彻底删除项目' : '彻底删除档案',
      object: isProject
        ? '确定要彻底删除：「' + r.name + '」（' + r.no + '）吗？'
        : '确定要彻底删除：「' + r.name + '」吗？',
      consequence: '彻底删除将物理销毁数据，且不可恢复，操作会记入操作记录。',
      confirmText: '彻底删除',
      expected: expected,
      inputPlaceholder: '请输入原' + (isProject ? '项目编号' : '名称') + '：' + expected
    })
  } catch (e) { return }
  try {
    await purgeRecycleItem(tab.value, r.id)
    toastSuccess('已彻底删除')
    await load()
  } catch (e) {
    toastError(e.message)
    toastWarning('如因本企业或引用关系被拦截，请先到对应页面解除后再试')
    await load()
  }
}

watch(function () { return props.active }, function (on) {
  if (on && !loaded.value) { loaded.value = true; load() }
}, { immediate: true })
</script>

<style scoped>
.recycle-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.tab-btn { border: 1px solid #dcdfe6; background: #fff; color: #606266; padding: 6px 14px; border-radius: 4px; cursor: pointer; }
.tab-btn.on { border-color: #409eff; color: #409eff; background: #ecf5ff; }
</style>
