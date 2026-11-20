<template>
  <ElDialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="导出设置"
    width="720px"
    :close-on-click-modal="false"
    destroy-on-close
    align-center
    class="export-dialog"
  >
    <div class="ex-tip">按业务模块点选需要导出的字段，再次点击可取消。系统将按当前查询条件生成 Excel 文件。</div>

    <div v-if="loading" class="ex-loading">正在加载字段…</div>
    <div v-else-if="loadError" class="ex-error">
      字段加载失败：{{ loadError }}
      <button class="btn sm" style="margin-left:8px" @click="loadFields">重试</button>
    </div>
    <template v-else>
      <div class="ex-toolbar">
        <button class="ex-tool" @click="selectAll">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          全选
        </button>
        <button class="ex-tool" @click="selectNone">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          清空
        </button>
        <span class="ex-count">已选 <b>{{ selected.length }}</b> / {{ allKeys.length }} 项</span>
      </div>

      <div class="ex-groups">
        <section class="ex-group" v-for="g in groups" :key="g">
          <div class="ex-group-head">
            <span class="ex-group-title">{{ g }}</span>
            <span class="ex-group-meta">
              <span class="ex-group-count">{{ isGroupAll(g) ? groupFields(g).length : groupSelectedCount(g) }}/{{ groupFields(g).length }}</span>
              <button class="ex-mini" @click="toggleGroupAll(g)">
                {{ isGroupAll(g) ? '取消全选' : '全选' }}
              </button>
            </span>
          </div>
          <div class="ex-pills">
            <button
              class="ex-pill"
              :class="{ on: selected.includes(f.key) }"
              v-for="f in groupFields(g)"
              :key="f.key"
              :title="f.label"
              @click="toggleField(f.key)"
            >
              <span class="ex-pill-check" v-if="selected.includes(f.key)">✓</span>
              <span class="ex-pill-text">{{ f.label }}</span>
            </button>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <span class="ex-footer-hint" v-if="busy">正在生成文件…</span>
      <button class="btn" @click="close" :disabled="busy">取消</button>
      <button class="btn primary" style="margin-left:8px" :disabled="busy || !selected.length || loading" @click="confirm">
        {{ busy ? '生成中…' : '确认导出' }}
      </button>
    </template>
  </ElDialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { getExportFields, downloadExcel } from '../api.js'
import { toastSuccess, toastWarning } from '../utils/toast.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  queryType: { type: String, default: 'advanced' },
  filename: { type: String, default: '导出数据' },
  // 由页面注入：返回 { conditions } —— 与查询共用同一份条件构造逻辑
  buildPayload: { type: Function, default: () => ({}) }
})
const emit = defineEmits(['update:modelValue'])

const groups = ref([])
const fields = ref([])
const selected = ref([])
const loading = ref(false)
const loadError = ref('')
const busy = ref(false)
let loadedOnce = false

const allKeys = ref([])

function groupFields(g) { return fields.value.filter(f => f.group === g) }
function isGroupAll(g) {
  const keys = groupFields(g).map(f => f.key)
  return keys.length > 0 && keys.every(k => selected.value.includes(k))
}
function groupSelectedCount(g) {
  return groupFields(g).filter(f => selected.value.includes(f.key)).length
}
// 单个胶囊点击：选中则取消、未选则加入
function toggleField(key) {
  const i = selected.value.indexOf(key)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(key)
}
// 分组的「全选 / 取消全选」极简按钮
function toggleGroupAll(g) {
  if (isGroupAll(g)) {
    const keys = groupFields(g).map(f => f.key)
    selected.value = selected.value.filter(k => !keys.includes(k))
  } else {
    groupFields(g).forEach(f => { if (!selected.value.includes(f.key)) selected.value.push(f.key) })
  }
}
function selectAll() { selected.value = allKeys.value.slice() }
function selectNone() { selected.value = [] }

async function loadFields() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await getExportFields(props.queryType)
    groups.value = data.groups || []
    fields.value = data.fields || []
    allKeys.value = fields.value.map(f => f.key)
    // 默认勾选：优先用后端按 queryType 下发的 defaultKeys（home=7 个核心字段），
    // 空数组表示全选（advanced）。过滤掉无效 key 保证健壮。
    const defaults = Array.isArray(data.defaultKeys) ? data.defaultKeys : []
    if (defaults.length) {
      const valid = defaults.filter(k => allKeys.value.includes(k))
      selected.value = valid.length ? valid : allKeys.value.slice()
    } else {
      selected.value = allKeys.value.slice()
    }
    loadedOnce = true
  } catch (e) {
    loadError.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

watch(function () { return props.modelValue }, function (open) {
  if (open && !loadedOnce) loadFields()
})

function close() { emit('update:modelValue', false) }

async function confirm() {
  if (busy.value || !selected.value.length) return
  // 让页面用与查询完全相同的条件构造逻辑；返回 null 表示校验未通过，不发起下载
  const base = props.buildPayload()
  if (base === null) {
    toastWarning('查询条件有误，请先修正后再导出')
    return
  }
  busy.value = true
  try {
    // buildPayload() 返回的是与页面查询完全同源的扁平条件对象（advancedQuery 用的同一份），
    // 必须整体放进 conditions 键；后端只读 body.conditions，平铺到顶层会导致条件丢失、导出全量。
    const payload = {
      queryType: props.queryType,
      conditions: base || {},
      fields: selected.value.slice(),
      filename: props.filename
    }
    const result = await downloadExcel(payload)
    close()
    if (result.truncated) {
      toastWarning('已导出前 ' + result.rows + ' 行（共匹配 ' + result.matched + ' 行），请细化条件以获取全部数据')
    } else {
      toastSuccess('导出成功，共 ' + result.rows + ' 行')
    }
  } catch (e) {
    // downloadExcel 内部已对 401 / 错误 JSON 弹 Toast，这里不重复弹
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.ex-tip{font-size:13px;color:#6b778c;line-height:1.6;margin-bottom:12px}

.ex-loading,.ex-error{padding:24px;text-align:center;color:#8a94a6;font-size:13px}
.ex-error{color:#c0392b}

/* 顶部快捷操作：带小图标的工具按钮 + 已选计数 */
.ex-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.ex-tool{
  display:inline-flex;align-items:center;gap:5px;
  height:28px;padding:0 11px;border:1px solid #d8dee8;border-radius:6px;
  background:#fff;color:#42526e;font-size:12px;font-family:inherit;cursor:pointer;
  transition:all .15s;
}
.ex-tool:hover{background:#f0f5ff;border-color:#2f6fed;color:#2f6fed}
.ex-tool svg{width:14px;height:14px;flex-shrink:0}
.ex-count{margin-left:auto;font-size:12px;color:#8a94a6;letter-spacing:.2px}
.ex-count b{font-size:14px;color:#2f6fed;font-weight:600;margin:0 2px}

/* 分组滚动区 */
.ex-groups{max-height:440px;overflow-y:auto;padding-right:6px}
.ex-groups::-webkit-scrollbar{width:6px}
.ex-groups::-webkit-scrollbar-thumb{background:#d3dae6;border-radius:3px}

/* 分组卡片：浅灰背景 + 细边框，视觉独立 */
.ex-group{
  background:#f8fafc;border:1px solid #e8edf4;border-radius:10px;
  padding:12px 14px 14px;margin-bottom:12px;
}
.ex-group:last-child{margin-bottom:0}
.ex-group-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.ex-group-title{
  position:relative;padding-left:10px;
  font-size:14px;font-weight:600;color:#1f2d45;letter-spacing:.3px;
}
.ex-group-title::before{
  content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:3px;height:14px;border-radius:2px;background:#2f6fed;
}
.ex-group-meta{display:flex;align-items:center;gap:10px}
.ex-group-count{font-size:12px;color:#9aa5b8;font-variant-numeric:tabular-nums}
.ex-mini{
  border:0;background:transparent;color:#2f6fed;font-size:12px;font-family:inherit;
  cursor:pointer;padding:2px 4px;border-radius:4px;transition:background .15s;
}
.ex-mini:hover{background:#e8f0ff}

/* 胶囊标签：默认灰底灰字，选中蓝底白字 + 极小对勾 */
.ex-pills{display:flex;flex-wrap:wrap;gap:8px}
.ex-pill{
  display:inline-flex;align-items:center;gap:5px;
  min-height:30px;padding:0 12px;border-radius:15px;
  border:1px solid #e2e7ef;background:#fff;color:#5b6577;
  font-size:13px;font-family:inherit;line-height:1;white-space:nowrap;cursor:pointer;
  transition:all .15s ease;
}
.ex-pill:hover{border-color:#9dbcf5;color:#2f6fed;background:#f5f9ff}
.ex-pill.on{
  background:#2f6fed;border-color:#2f6fed;color:#fff;
  box-shadow:0 2px 6px rgba(47,111,237,.22);
}
.ex-pill.on:hover{background:#2559c9;border-color:#2559c9;color:#fff}
.ex-pill-check{
  display:inline-flex;align-items:center;justify-content:center;
  width:13px;height:13px;border-radius:50%;
  background:rgba(255,255,255,.28);color:#fff;font-size:10px;font-weight:700;line-height:1;
  flex-shrink:0;
}
.ex-pill-text{white-space:nowrap}

.ex-footer-hint{float:left;font-size:12px;color:#8a94a6;line-height:32px}

@media (max-width:560px){
  .ex-pills{gap:6px}
  .ex-pill{min-height:28px;padding:0 10px;font-size:12px}
  .ex-group{padding:10px 12px 12px}
}
</style>
