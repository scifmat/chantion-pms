<template>
  <div>
    <div class="page-head">
      <div style="display:flex;gap:12px;align-items:center">
        <button class="btn" @click="emit('back')">← 返回项目列表</button>
        <h2 style="margin:0">高级查询</h2>
      </div>
      <div class="muted">共 {{ rows.length }} 条结果</div>
    </div>

    <!--
      14 个条件与 14 列一一对应；条件之间「且」，多值字段内部「或」。
      本轮只重构条件区 UI：统一 5 列栅格 + 3 条极矮的分组分隔条，
      常规条件 1 列、区间 2 列；v-model / load / reset / datalist 全部保持原样。
    -->
    <section class="aq-card">
      <div class="aq-head">
        <div class="aq-title">
          <span class="aq-title-bar"></span>
          查询条件
          <span class="aq-count">共 14 项</span>
        </div>
        <div class="aq-actions">
          <button class="btn primary" @click="load">查询</button>
          <button class="btn" @click="reset">恢复</button>
          <button class="btn" v-if="canWrite" @click="exportOpen = true">导出 Excel</button>
        </div>
      </div>

      <div class="aq-grid">
        <!-- 第一组：项目基本信息（常展开） -->
        <div class="aq-group">
          <div class="aq-divider">项目基本信息<span class="aq-divider-count">5 项</span></div>
          <QueryField class="aq-cell" label="项目状态">
            <input v-model="filters.status" list="adv-statuses">
          </QueryField>
          <QueryField class="aq-cell" label="项目类型">
            <input v-model="filters.type" list="adv-types" placeholder="逗号分隔">
          </QueryField>
          <QueryField class="aq-cell" label="监管地区">
            <RegionPicker v-model="filters.region" placeholder="输入汉字或拼音" />
          </QueryField>
          <QueryField class="aq-cell" label="项目编号">
            <input v-model="filters.no">
          </QueryField>
          <QueryField class="aq-cell" label="项目名称">
            <input v-model="filters.name">
          </QueryField>
        </div>

        <!-- 第二组：主体与方式（可折叠） -->
        <div class="aq-group" :class="{ collapsed: collapsed.party }">
          <div class="aq-divider aq-divider-toggle" @click="collapsed.party = !collapsed.party">
            <span class="aq-caret" :class="{ closed: collapsed.party }">▾</span>
            主体与方式<span class="aq-divider-count">4 项</span>
            <span v-if="collapsed.party && partyFilled" class="aq-filled-dot" :title="partyFilled + ' 项已填写'">{{ partyFilled }} 项已填</span>
          </div>
          <div class="aq-group-body">
            <QueryField class="aq-cell" label="采购单位">
              <input v-model="filters.buyer">
            </QueryField>
            <QueryField class="aq-cell" label="代理机构">
              <input v-model="filters.agency">
            </QueryField>
            <QueryField class="aq-cell" label="采购方式">
              <input v-model="filters.method" list="adv-methods">
            </QueryField>
            <QueryField class="aq-cell" label="合同履行期限">
              <input v-model="filters.period" placeholder="天">
            </QueryField>
          </div>
        </div>

        <!-- 第三组：金额与时间范围（可折叠；区间占 2 列） -->
        <div class="aq-group" :class="{ collapsed: collapsed.amount }">
          <div class="aq-divider aq-divider-toggle" @click="collapsed.amount = !collapsed.amount">
            <span class="aq-caret" :class="{ closed: collapsed.amount }">▾</span>
            金额与时间范围<span class="aq-divider-count">5 项</span>
            <span v-if="collapsed.amount && amountFilled" class="aq-filled-dot" :title="amountFilled + ' 项已填写'">{{ amountFilled }} 项已填</span>
          </div>
          <div class="aq-group-body">
            <RangeField
              class="aq-cell aq-span2"
              label="项目预算（万元）"
              v-model:from="filters.budgetMin" v-model:to="filters.budgetMax"
              :tip="errors.budgetMin || errors.budgetMax || ''"
            />
            <RangeField
              class="aq-cell aq-span2"
              label="最高限价（万元）"
              v-model:from="filters.ceilingMin" v-model:to="filters.ceilingMax"
              :tip="errors.ceilingMin || errors.ceilingMax || ''"
            />
            <QueryField class="aq-cell" label="中标单位">
              <input v-model="filters.winner" placeholder="逗号分隔">
            </QueryField>
            <RangeField
              class="aq-cell aq-span2"
              label="中标金额（万元）"
              v-model:from="filters.amountMin" v-model:to="filters.amountMax"
              :tip="errors.amountMin || errors.amountMax || ''"
            />
            <RangeField
              class="aq-cell aq-span2"
              label="投标截止时间" type="date"
              v-model:from="filters.bidFrom" v-model:to="filters.bidTo"
            />
          </div>
        </div>
      </div>

      <datalist id="adv-statuses"><option v-for="s in statuses" :key="s" :value="s"></option></datalist>
      <datalist id="adv-types"><option v-for="t in types" :key="t" :value="t"></option></datalist>
      <datalist id="adv-methods"><option v-for="m in methods" :key="m" :value="m"></option></datalist>
    </section>

    <div class="panel err-box" v-if="loadError">
      查询失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <AdvancedTable :rows="rows" :loading="loading" />

    <ExportDialog
      v-model="exportOpen"
      query-type="advanced"
      filename="高级查询导出"
      :build-payload="buildAdvancedParams"
    />
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue'
import { advancedQuery } from '../api.js'
import { wanToFen } from '../utils/money.js'
import { opts } from '../utils/options.js'
import QueryField from '../components/query/QueryField.vue'
import RangeField from '../components/query/RangeField.vue'
import AdvancedTable from '../components/query/AdvancedTable.vue'
import RegionPicker from '../components/form/RegionPicker.vue'
import ExportDialog from '../components/ExportDialog.vue'
import { canWrite } from '../store/auth.js'

const props = defineProps({ active: { type: Boolean, default: false } })
const emit = defineEmits(['back'])

const exportOpen = ref(false)

// 条件分组折叠状态：仅隐藏 UI，filters 值原样保留，折叠不影响查询/导出条件
const collapsed = reactive({ party: false, amount: false })

// 折叠时统计该组已填写的条件个数（区间字段 from/to 任一有值即算 1 项）
const PARTY_KEYS = ['buyer', 'agency', 'method', 'period']
const AMOUNT_PAIRS = [['budgetMin', 'budgetMax'], ['ceilingMin', 'ceilingMax'], ['amountMin', 'amountMax'], ['bidFrom', 'bidTo']]
const filled = function (keys) {
  return keys.filter(function (k) { return String(filters[k] == null ? '' : filters[k]).trim() !== '' }).length
}
const partyFilled = computed(function () { return filled(PARTY_KEYS) })
const amountFilled = computed(function () {
  return filled(['winner']) + AMOUNT_PAIRS.filter(function (p) {
    return p.some(function (k) { return String(filters[k] == null ? '' : filters[k]).trim() !== '' })
  }).length
})

// 下拉候选统一取自业务配置；停用项仍可手动输入关键字检索历史值
const statuses = computed(function () { return opts('status') })
const types = computed(function () { return opts('project_type') })
const methods = computed(function () { return opts('method') })

const emptyFilters = () => ({
  status: '', type: '', region: '', no: '', name: '',
  budgetMin: '', budgetMax: '', ceilingMin: '', ceilingMax: '',
  buyer: '', agency: '', method: '', period: '',
  bidFrom: '', bidTo: '', winner: '', amountMin: '', amountMax: ''
})
// 组件常驻（App.vue 用 v-show），filters / rows 切走再切回原样保留
const filters = reactive(emptyFilters())
const rows = ref([])
const loading = ref(false)
const loadError = ref('')
const errors = reactive({})
const loaded = ref(false)

const TEXT_KEYS = ['status', 'type', 'region', 'no', 'name', 'buyer', 'agency', 'method', 'period', 'bidFrom', 'bidTo', 'winner']
// 万元输入 -> 后端只接受整数分参数；1 万元 = 1,000,000 分
const AMOUNT_FIELDS = [
  ['budgetMin', 'budgetMinFen'], ['budgetMax', 'budgetMaxFen'],
  ['ceilingMin', 'ceilingMinFen'], ['ceilingMax', 'ceilingMaxFen'],
  ['amountMin', 'amountMinFen'], ['amountMax', 'amountMaxFen']
]

// 查询与导出共用同一份条件构造：万元->整数分 BigInt 换算逻辑只有这一处，零漂移。
// 校验失败时填充 errors 并返回 null；调用方据此中止（查询不刷新 / 导出不发起）。
function buildAdvancedParams() {
  Object.keys(errors).forEach(function (k) { delete errors[k] })
  const params = {}
  TEXT_KEYS.forEach(function (k) {
    const v = String(filters[k] == null ? '' : filters[k]).trim()
    if (v) params[k] = v
  })
  let bad = false
  AMOUNT_FIELDS.forEach(function (pair) {
    const raw = String(filters[pair[0]] == null ? '' : filters[pair[0]]).trim()
    if (!raw) return
    const fen = wanToFen(raw)
    if (fen === null) {
      errors[pair[0]] = '请填非负数字（万元），最多 6 位小数'
      bad = true
      return
    }
    params[pair[1]] = fen
  })
  return bad ? null : params
}

async function load() {
  const params = buildAdvancedParams()
  if (params === null) return

  loading.value = true
  loadError.value = ''
  try {
    rows.value = await advancedQuery(params)
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}

function reset() {
  Object.assign(filters, emptyFilters())
  Object.keys(errors).forEach(function (k) { delete errors[k] })
  load()
}

// 首次进入默认展示全量；此后不再自动刷新，保证查询条件与结果不被重置
watch(function () { return props.active; }, function (on) {
  if (on && !loaded.value) {
    loaded.value = true
    load()
  }
}, { immediate: true })
</script>

<style scoped>
/* 条件区局部样式：只作用于本页，不影响全局 .adv-grid / .panel 与其它页面 */
.aq-card{
  background:#fff;
  border:1px solid #e3e7ee;
  border-radius:8px;
  padding:12px 16px;
  margin-bottom:14px;
  box-shadow:0 2px 10px rgba(16,24,40,.06);
}
.aq-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.aq-title{display:flex;align-items:center;gap:8px;margin:0;font-size:14px;font-weight:600;color:#243247}
.aq-title-bar{width:3px;height:14px;border-radius:2px;background:#2f6fed;flex-shrink:0}
.aq-count{font-size:12px;font-weight:400;color:#8a94a6}
.aq-actions{display:flex;align-items:center;gap:8px}

/* 统一栅格：常规 1 列、区间 2 列；行间距 10px、列间距 12px */
.aq-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px 12px;align-items:start}
.aq-cell{min-width:0}
.aq-span2{grid-column:span 2}

/* 分组容器：展开时用 contents 让内部条件项照常参与外层栅格（布局零变化）；
   折叠时退化为占满整行的普通块，只留可点击的分隔条 */
.aq-group{display:contents}
/* group-body 也用 contents，让其内部条件项穿透到外层 .aq-grid 参与 5 列布局 */
.aq-group-body{display:contents}
.aq-group.collapsed{display:block;grid-column:1/-1}
/* 折叠时 group-body 退回普通块并隐藏；分隔条作为 block 内唯一可见子元素占满整行 */
.aq-group.collapsed .aq-group-body{display:none}

/* 分组分隔条：只占 18px 的极矮小标题 + 淡渐变底色，不额外吃掉一行 */
.aq-divider{
  grid-column:1/-1;
  display:flex;align-items:center;gap:8px;
  height:16px;
  padding-left:8px;
  border-left:3px solid #a9bce0;
  border-radius:3px 0 0 3px;
  background:linear-gradient(90deg,#f3f7fd 0%,#ffffff 55%);
  font-size:12px;font-weight:600;color:#42526e;letter-spacing:.2px;
}
.aq-divider-count{font-size:11px;font-weight:400;color:#8a94a6}
/* 可折叠分隔条：整条可点，hover 高亮，箭头指示展开/收起 */
.aq-divider-toggle{cursor:pointer;user-select:none;transition:background .15s}
.aq-divider-toggle:hover{background:linear-gradient(90deg,#e7f0ff 0%,#f7faff 60%)}
.aq-caret{
  display:inline-block;font-size:10px;line-height:1;color:#5b7fd0;
  transition:transform .18s;transform:rotate(0deg);width:10px;text-align:center;
}
.aq-caret.closed{transform:rotate(-90deg)}
/* 折叠且该组有条件填写时的提示，避免误以为条件被清空 */
.aq-filled-dot{
  margin-left:auto;margin-right:6px;
  font-size:11px;font-weight:500;color:#2f6fed;
  background:#e8f0ff;border-radius:10px;padding:1px 8px;line-height:15px;
}

/* 响应式折行：宽屏 5 列 → 4 → 3 → 2 → 1；1 列时区间占满整行 */
@media (max-width:1280px){.aq-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:1024px){.aq-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:768px){.aq-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){
  .aq-grid{grid-template-columns:1fr}
  .aq-span2{grid-column:span 1}
  .aq-head{align-items:flex-start}
}
</style>
