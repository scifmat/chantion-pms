<template>
  <!-- 原「业务配置」页抽离成面板：逻辑与副作用完全保留，仅去掉独立页头，供 SystemManage 的 Tab 复用 -->
  <div class="config-panel">
    <div class="config-toolbar">
      <button class="btn primary" :disabled="saving" @click="save">保存当前分组</button>
      <span class="muted">集中维护下拉选项 · 调整只影响后续新增/编辑与查询，历史原值保留且仍可检索</span>
    </div>

    <div class="panel">
      <div class="config-tabs">
        <button
          v-for="k in keys" :key="k"
          class="btn" :class="{ primary: current === k }"
          @click="switchTo(k)"
        >{{ labels[k] || k }}</button>
      </div>
      <div class="config-note">
        勾选「启用」控制该选项是否出现在录入 / 查询下拉；取消勾选即停用（不删除，历史项目原值保留、仍可按关键字检索）。
        <span v-if="current === 'status'">项目状态四个固定值不可停用或移除。</span>
        <span v-if="current === 'amount_unit'">倍率 = 该单位等于多少「元」；必须保留启用「元」且倍率为 1。</span>
      </div>

      <div class="config-actions">
        <button class="btn sm" @click="add">+ 新增选项</button>
        <span class="spacer"></span>
        <span class="muted">共 {{ items.length }} 项</span>
      </div>

      <!-- 定宽表格：不限高，纵向随工作区滚动，超宽由工作区统一横向滚动 -->
      <div class="panel table-wrap config-table-wrap">
        <table class="config-table">
          <colgroup>
            <col style="width:220px"><col style="width:140px"><col style="width:130px">
            <col style="width:130px"><col style="width:140px">
          </colgroup>
          <thead><tr><th>选项值</th><th>倍率（换算到元）</th><th>状态</th><th>排序</th><th class="col-frozen">操作</th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in items" :key="i">
              <td><input v-model="it.value" placeholder="选项内容"></td>
              <td>
                <input v-if="current === 'amount_unit'" v-model="it.factor" type="number" min="1" step="1">
                <span v-else class="muted">—</span>
              </td>
              <td>
                <label class="switch">
                  <input type="checkbox" v-model="it.enabled" :disabled="isFixed(it.value)">
                  <span class="track"></span><span>{{ it.enabled ? '启用' : '停用' }}</span>
                </label>
              </td>
              <td>
                <button class="btn sm" :disabled="i === 0" @click="move(i, -1)">↑</button>
                <button class="btn sm" :disabled="i === items.length - 1" @click="move(i, 1)">↓</button>
              </td>
              <td class="col-frozen"><button class="btn sm" :disabled="isFixed(it.value)" @click="remove(i)">移除</button></td>
            </tr>
            <tr v-if="!items.length"><td colspan="5" class="empty">该分组暂无选项，点「+ 新增选项」添加</td></tr>
          </tbody>
        </table>
      </div>

      <div class="query-actions">
        <span class="spacer"></span>
        <button class="btn" @click="reload" :disabled="saving">放弃修改</button>
        <button class="btn primary" @click="save" :disabled="saving">保存当前分组</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { getConfigOptions, saveConfigOptions } from '../../api.js'
import { optionGroups, applyConfig, GROUP_KEYS } from '../../utils/options.js'
import { toastSuccess, toastError, toastWarning } from '../../utils/toast.js'

const props = defineProps({ active: { type: Boolean, default: false } })
const keys = GROUP_KEYS
const labels = computed(function () { return optionGroups.labels })
const current = ref('status')
const items = ref([])
const detail = ref({})
const saving = ref(false)
const loaded = ref(false)
// 统一走屏幕正上方居中的全局 Toast（成功绿勾 / 失败红警 / 警告黄标）
function showToast(msg, type) {
  if (type === 'warning') toastWarning(msg)
  else if (type === 'info' || type === 'error') toastError(msg)
  else toastSuccess(msg)
}
function isFixed(value) {
  if (current.value === 'status') return optionGroups.fixedStatuses.indexOf(value) >= 0
  if (current.value === 'amount_unit') return value === '元'
  return false
}
function copyGroup(key) {
  return (detail.value[key] || []).map(function (x) {
    return { value: x.value, enabled: !!x.enabled, factor: x.factor == null ? '' : x.factor }
  })
}
async function reload() {
  try {
    const data = await getConfigOptions()
    applyConfig(data)                 // 关键副作用：金额单位倍率立即同步到所有页面
    detail.value = data.detail || {}
    items.value = copyGroup(current.value)
    loaded.value = true
  } catch (e) { showToast(e.message, 'info') }
}
function switchTo(k) { current.value = k; items.value = copyGroup(k) }
function add() { items.value.push({ value: '', enabled: true, factor: '' }) }
function remove(i) { items.value.splice(i, 1) }
function move(i, d) {
  const j = i + d
  if (j < 0 || j >= items.value.length) return
  const t = items.value[i]
  items.value[i] = items.value[j]
  items.value[j] = t
}
async function save() {
  const clean = items.value.map(function (x) {
    return {
      value: String(x.value == null ? '' : x.value).trim(),
      enabled: !!x.enabled,
      factor: current.value === 'amount_unit' ? Number(x.factor) : null
    }
  }).filter(function (x) { return !!x.value })
  if (!clean.length) { showToast('选项不能为空', 'info'); return }
  saving.value = true
  try {
    const data = await saveConfigOptions(current.value, clean)
    applyConfig(data)                 // 金额单位倍率立即刷新，所有页面下拉同步
    await reload()
    showToast('保存成功，所有页面选项已同步')
  } catch (e) { showToast(e.message, 'info') }
  finally { saving.value = false }
}

// Tab 首次激活才加载；原独立页的常驻逻辑改为由 active 驱动
watch(function () { return props.active; }, function (on) {
  if (on && !loaded.value) reload()
}, { immediate: true })
</script>

<style scoped>
.config-toolbar{display:flex;align-items:center;gap:14px;margin-bottom:12px;flex-wrap:wrap}
</style>
