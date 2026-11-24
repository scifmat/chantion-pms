<template>
  <div class="dash-page">
    <div class="dash-head">
      <div>
        <button class="btn" @click="emit('back')">← 返回{{ fromLabel }}</button>
        <div class="dash-title-row">
          <h2 class="dash-title">{{ profile ? profile.name : '参与项目数据看板' }}</h2>
          <!-- 本企业画像：用金色「本企业」标签替代蓝色的档案类型标签 -->
          <SelfBadge v-if="isSelfProfile" :name="profile.name" />
          <span v-else class="dash-type-tag">{{ typeLabel }}</span>
        </div>
        <div class="dash-sub" v-if="profile">
          {{ isSelfProfile ? '本企业' : typeLabel }}<span v-if="profile.attribute"> · {{ profile.attribute }}</span>
        </div>
      </div>
      <!-- 全局年份筛选：选项从后端实际数据动态生成，覆盖图表区与榜单区 -->
      <div class="year-filter" v-if="availableYears.length">
        <span class="year-filter-label">统计年份</span>
        <select v-model="selectedYear" class="year-select" @change="load">
          <option value="">全部年份</option>
          <option v-for="y in availableYears" :key="y" :value="String(y)">{{ y }} 年</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="panel dash-loading">正在汇总数据…</div>
    <div v-else-if="loadError" class="panel err-box">
      读取看板数据失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load">重试</button>
    </div>

    <template v-else-if="profile">
      <!-- 汇总卡片：数值大且醒目，单位小 -->
      <div class="stat-grid">
        <div
          class="stat-card"
          v-for="(s, i) in visibleSummary"
          :key="s.key"
          :class="'stat-tone-' + (i % 4)"
        >
          <div class="stat-label">{{ statParts(s).label }}<span v-if="statParts(s).hint" class="hint-text">（{{ statParts(s).hint }}）</span></div>
          <div class="stat-value-row">
            <span class="stat-value">{{ s.value }}</span>
            <span class="stat-unit" v-if="s.unit">{{ s.unit }}</span>
          </div>
          <div class="stat-accent"></div>
        </div>
      </div>

      <!-- ===== 采购单位专属：模块二 采购偏好分布（ECharts） + 模块三 情报榜单 ===== -->
      <template v-if="isBuyer">
        <div class="section-title">采购偏好分布</div>
        <div class="chart-grid echarts-grid">
          <div class="panel chart-card">
            <div class="chart-title">预算区间分布</div>
            <ChartBar v-if="echarts" :items="budgetItems" mode="bar" value-suffix=" 个" />
          </div>
          <div class="panel chart-card">
            <div class="chart-title">采购方式分布</div>
            <ChartPie v-if="echarts" :items="methodItems" />
          </div>
          <div class="panel chart-card chart-card-wide">
            <div class="chart-title">活跃月份分布</div>
            <ChartBar v-if="echarts" :items="monthItems" mode="line" name-key="month" value-suffix=" 个" />
          </div>
        </div>

        <div class="section-title">竞争格局与人脉情报</div>
        <div class="rank-grid rank-grid-3">
          <RankList title="常胜供应商 TOP 5" :items="rankSupplier" empty-text="暂无中标数据" />
          <RankList title="核心代理机构 TOP 5" :items="rankAgency" empty-text="暂无代理数据" tone="rank-tone-1" />
          <RankList title="惯用业主评委 TOP 5" :items="rankOwner" empty-text="暂无业主评委数据" tone="rank-tone-2" />
        </div>
      </template>

      <!-- ===== 代理机构专属：模块二 业务特征（ECharts） + 模块三 情报榜单 ===== -->
      <template v-else-if="isAgency">
        <div class="section-title">业务特征与偏好</div>
        <div class="chart-grid echarts-grid">
          <div class="panel chart-card">
            <div class="chart-title">核心服务采购单位 TOP 5</div>
            <ChartBar v-if="echarts" :items="buyerTopItems" mode="horizontal" color="#2f6fed" value-suffix=" 个" />
          </div>
          <div class="panel chart-card">
            <div class="chart-title">采购方式偏好</div>
            <ChartPie v-if="echarts" :items="methodItems" />
          </div>
          <div class="panel chart-card">
            <div class="chart-title">活跃地区 TOP 5</div>
            <ChartBar v-if="echarts" :items="agencyRegionTopItems" mode="horizontal" color="#0f9d6e" value-suffix=" 个" />
          </div>
          <div class="panel chart-card">
            <div class="chart-title">项目类型分布</div>
            <ChartBar v-if="echarts" :items="projectTypeItems" mode="bar" color="#7c4dff" value-suffix=" 个" />
          </div>
        </div>

        <div class="section-title">竞争格局与人脉情报</div>
        <div class="rank-grid">
          <RankList title="常驻组长评委 TOP 5" :items="rankLeader" empty-text="暂无组长评委数据（detail.completed.judges 中 leader=true 的评委）" tone="rank-tone-2" />
          <RankList title="常胜供应商 TOP 5" :items="rankSupplier" empty-text="暂无中标数据" />
        </div>
      </template>

      <!-- ===== 竞争对手专属：模块二 主战场（ECharts） + 模块三 关系网榜单 ===== -->
      <template v-else-if="isCompetitor">
        <div class="section-title">主战场与舒适区</div>
        <div class="chart-grid echarts-grid-3">
          <div class="panel chart-card">
            <div class="chart-title">项目类型分布</div>
            <ChartPie v-if="echarts" :items="compTypeItems" />
          </div>
          <div class="panel chart-card">
            <div class="chart-title">采购方式偏好</div>
            <ChartPie v-if="echarts" :items="compMethodItems" />
          </div>
          <div class="panel chart-card">
            <div class="chart-title">中标金额区间分布</div>
            <ChartBar v-if="echarts" :items="awardBucketItems" mode="bar" color="#2f6fed" value-suffix=" 个" />
          </div>
        </div>

        <!-- 地区热力图 + 中标数 TOP5 榜单：下钻省份时榜单同步切到该省地市 -->
        <div class="geo-grid" v-if="echarts">
          <div class="panel map-panel">
            <div class="chart-title">{{ regionMapTitle }} <span class="hint-text">点击省份下钻市级 · 滚轮缩放 · 左键拖动</span></div>
            <ChinaMap :key="regionMapVersion" :geo-data="regionGeoData" :city-data="regionCityData"
                      @drill="onRegionDrill" @back="onRegionBack" />
          </div>
          <div class="panel chart-card geo-rank-card">
            <div class="chart-title">{{ regionRankTitle }} <span class="hint-text">单位：个</span></div>
            <ChartBar :items="regionRankItems" mode="horizontal" color="#0f9d6e" value-suffix=" 个" />
          </div>
        </div>

        <div class="section-title">关系网与人脉情报</div>
        <div class="rank-grid rank-grid-3">
          <RankList title="关系最铁的采购单位 TOP 5" :items="rankBuyers" empty-text="暂无数据" />
          <RankList title="最常合作的代理机构 TOP 5" :items="rankAgencies" empty-text="暂无数据" tone="rank-tone-1" />
          <RankList title="黄金搭档（联合体）TOP 5" :items="rankPartners" empty-text="该对手暂无联合体合作记录" tone="rank-tone-2" :show-top-badge="false" show-attr-field />
        </div>
      </template>

      <!-- 明细表：角色列用彩色 Tag 一眼看懂参与方式 -->
      <div class="panel detail-panel">
        <div class="detail-head">
          <h3>{{ isAgency ? '代理项目明细' : isBuyer ? '招标项目明细' : '参与项目明细' }}</h3>
          <span class="detail-count">共 {{ projects.length }} 个项目</span>
        </div>
        <div class="table-wrap">
          <table class="dash-table">
            <thead>
              <tr>
                <th>项目状态</th><th>项目编号</th><th>项目名称</th><th>监管地区</th>
                <th>预算（万元）</th><th>参与中标（万元）</th><th>采购方式</th><th>参与角色</th>
                <th v-if="isCompetitor">参与深度</th><th>中标时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in sortedProjects" :key="p.project_no">
                <td><span class="status-tag" :data-status="p.status">{{ p.status }}</span></td>
                <td>{{ p.project_no }}</td>
                <td class="dash-name" :title="p.project_name">{{ p.project_name }}</td>
                <td>{{ p.region || '—' }}</td>
                <td>{{ p.budgetWan }}</td>
                <td class="dash-amount">{{ p.awardWan }}</td>
                <td>{{ p.method || '—' }}</td>
                <td><span class="role-tag" :class="roleClass(p.role)">{{ p.role }}</span></td>
                <td v-if="isCompetitor">
                  <span class="depth-tag" :class="p.isSplit ? 'split' : 'full'" :title="p.packages && p.packages.join('、')">
                    {{ p.isSplit ? (p.packages && p.packages.length > 1 ? p.packages.join(' / ') : (p.packages && p.packages[0]) || '分包') : '全包' }}
                  </span>
                </td>
                <td>{{ p.awardTime || '—' }}</td>
              </tr>
              <tr v-if="!projects.length"><td :colspan="isCompetitor ? 10 : 9" class="empty">暂无参与项目</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { getArchiveStats } from '../api.js'
import { splitLabelHint } from '../utils/labels.js'
import EChart from '../components/EChart.vue'
import ChartBar from '../components/ChartBar.vue'
import ChartPie from '../components/ChartPie.vue'
import ChinaMap from '../components/ChinaMap.vue'
import SelfBadge from '../components/SelfBadge.vue'
import RankList from '../components/RankList.vue'
import { settings } from '../store/system.js'
// 图表主题统一封装在 ChartBar/ChartPie/EChart 中；echarts 本体由 EChart.vue 动态 import，按需加载不拖慢首屏。

const props = defineProps({
  payload: { type: Object, default: null },   // { type, id, name, from }
  active: { type: Boolean, default: false }
})
const emit = defineEmits(['back'])
function statParts(s) { return splitLabelHint(s && s.label) }

const profile = ref(null)
const summary = ref([])
const charts = ref([])
const projects = ref([])
const echarts = ref(null)       // 采购单位：ECharts 图表数据
const rankings = ref(null)      // 采购单位：情报榜单数据
const availableYears = ref([])  // 后端返回的实际可用年份
const selectedYear = ref('')    // '' = 全部年份
const loading = ref(false)
const loadError = ref('')

const isBuyer = computed(function () { return props.payload && props.payload.type === 'buyer' })
const isAgency = computed(function () { return props.payload && props.payload.type === 'agency' })
const isCompetitor = computed(function () { return props.payload && props.payload.type === 'competitor' })
// 三类新看板都只展示前 4 张核心卡片（后端 summary 尾部为兼容旧测试的派生值）
const visibleSummary = computed(function () {
  return (isBuyer.value || isAgency.value || isCompetitor.value) ? summary.value.slice(0, 4) : summary.value
})
const rankSupplier = computed(function () { return (rankings.value && rankings.value.suppliers) || [] })
const rankAgency = computed(function () { return (rankings.value && rankings.value.agencies) || [] })
const rankOwner = computed(function () { return (rankings.value && rankings.value.ownerJudges) || [] })
const rankLeader = computed(function () { return (rankings.value && rankings.value.leaderJudges) || [] })
const rankBuyers = computed(function () { return (rankings.value && rankings.value.buyers) || [] })
const rankAgencies = computed(function () { return (rankings.value && rankings.value.agencies) || [] })
const rankPartners = computed(function () { return (rankings.value && rankings.value.partners) || [] })

// 图表数据切片，交给通用 ChartBar / ChartPie 组件渲染（主题统一）
const budgetItems = computed(function () { return (echarts.value && echarts.value.budgetBucket) || [] })
const methodItems = computed(function () { return (echarts.value && echarts.value.method) || [] })
const monthItems = computed(function () { return (echarts.value && echarts.value.month) || [] })
const buyerTopItems = computed(function () { return (echarts.value && echarts.value.buyerTop) || [] })
const regionItems = computed(function () { return (echarts.value && echarts.value.region) || [] })
const agencyRegionTopItems = computed(function () { return (echarts.value && echarts.value.regionTop) || [] })
const projectTypeItems = computed(function () { return (echarts.value && echarts.value.projectType) || [] })
const compTypeItems = computed(function () { return (echarts.value && echarts.value.type) || [] })
const regionTopItems = computed(function () { return (echarts.value && echarts.value.regionTop) || [] })
const awardBucketItems = computed(function () { return (echarts.value && echarts.value.awardBucket) || [] })
const compMethodItems = computed(function () { return (echarts.value && echarts.value.method) || [] })
const regionGeoData = computed(function () { return (echarts.value && echarts.value.regionGeo) || [] })
const regionCityData = computed(function () { return (echarts.value && echarts.value.regionCity) || {} })

// 地区热力图下钻：右侧 TOP5 榜单同步切到该省地市（全国时即活跃地区 TOP5）
const drilledRegion = ref('')
const regionMapVersion = ref(0)
const regionMapTitle = computed(function () {
  return drilledRegion.value ? drilledRegion.value + '各市级中标热力图' : '地区中标热力图'
})
const regionRankTitle = computed(function () {
  return drilledRegion.value ? drilledRegion.value + '中标数 TOP 5 地市' : '活跃地区中标数 TOP 5 省份'
})
const regionRankItems = computed(function () {
  if (!drilledRegion.value) return regionTopItems.value.slice(0, 5)
  const m = (echarts.value && echarts.value.regionCity && echarts.value.regionCity[drilledRegion.value]) || {}
  return Object.keys(m).map(function (k) { return { name: k, value: Number(m[k]) || 0 } })
    .sort(function (a, b) { return b.value - a.value }).slice(0, 5)
})
function onRegionDrill(name) { drilledRegion.value = name }
function onRegionBack() { drilledRegion.value = '' }
// 明细按中标时间倒序（无中标时间的排后），让近期项目在前
const sortedProjects = computed(function () {
  return projects.value.slice().sort(function (a, b) { return String(b.awardTime || '').localeCompare(String(a.awardTime || '')); })
})

const typeLabel = computed(function () {
  const m = { buyer: '采购单位', agency: '代理机构', competitor: '竞争对手' }
  return m[props.payload && props.payload.type] || '档案'
})
function normName(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase() }
const isSelfProfile = computed(function () {
  return !!profile.value && !!settings.selfCompetitorName &&
    normName(profile.value.name) === normName(settings.selfCompetitorName)
})
const fromLabel = computed(function () {
  return props.payload && props.payload.from ? props.payload.from : '档案列表'
})

watch(function () { return props.payload && (props.payload.type + ':' + props.payload.id) }, function () {
  if (props.active && props.payload) {
    selectedYear.value = ''   // 切换档案时重置为全部年份
    load()
  }
}, { immediate: true })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await getArchiveStats(props.payload.type, props.payload.id, selectedYear.value)
    profile.value = data.profile
    summary.value = data.summary || []
    charts.value = data.charts || []
    projects.value = data.projects || []
    echarts.value = data.echarts || null
    rankings.value = data.rankings || null
    drilledRegion.value = ''
    regionMapVersion.value++
    if (Array.isArray(data.years)) availableYears.value = data.years
  } catch (e) {
    loadError.value = e.message || '读取失败'
  } finally {
    loading.value = false
  }
}

/** 占比条宽度：以该项在同类中的最大值为基准，最大值占满、其余按比例，视觉更饱满 */
function barWidth(item, chart) {
  const max = Math.max.apply(null, chart.items.map(function (x) { return x.value; })) || 1
  const pct = Math.max(4, Math.round(item.value * 100 / max))
  return pct + '%'
}

function roleClass(role) {
  const s = String(role || '')
  if (s.indexOf('牵头') >= 0) return 'lead'
  if (s.indexOf('成员') >= 0) return 'member'
  if (s.indexOf('分包') >= 0) return 'split'
  return 'other'
}
</script>

<style scoped>
.detail-panel{margin-top:24px}
.echarts-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.geo-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:14px;margin-bottom:16px}
.geo-grid .map-panel{margin-bottom:0}
@media(max-width:1250px){.echarts-grid-3{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:900px){.echarts-grid-3,.geo-grid{grid-template-columns:1fr}}
</style>
