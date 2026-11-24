<template>
  <div class="global-dash-page">
    <div class="page-head">
      <div>
        <h2>数据看板</h2>
        <div class="muted">数据每 5 分钟更新<span v-if="data" class="global-updated"> · 更新时间：{{ data.updatedAt }}</span></div>
      </div>
      <div class="global-head-actions">
        <button class="btn sm global-refresh" :disabled="loading" @click="load(true)">{{ loading ? '刷新中…' : '刷新' }}</button>
        <select v-if="data && data.years.length" v-model="selectedYear" class="year-select" @change="load(false)">
          <option value="">全部年份</option>
          <option v-for="y in data.years" :key="y" :value="String(y)">{{ y }} 年</option>
        </select>
      </div>
    </div>

    <div v-if="loading && !data" class="panel dash-loading">正在汇总全局数据…</div>
    <div v-else-if="loadError" class="panel err-box">
      读取数据看板失败：{{ loadError }}
      <button class="btn sm" style="margin-left:10px" @click="load(true)">重试</button>
    </div>

    <template v-else-if="data">
      <!-- 宏观大盘 -->
      <div class="stat-grid">
        <div class="stat-card" v-for="(s, i) in data.summary" :key="s.key" :class="'stat-tone-' + (i % 4)">
          <div class="stat-label">{{ statParts(s).label }}<span v-if="statParts(s).hint" class="hint-text">（{{ statParts(s).hint }}）</span></div>
          <div class="stat-value-row"><span class="stat-value">{{ s.value }}</span><span class="stat-unit" v-if="s.unit">{{ s.unit }}</span></div>
          <div class="stat-accent"></div>
        </div>
      </div>

      <!-- 趋势与结构 -->
      <div class="section-title">趋势与结构</div>
      <div class="overview-grid">
        <div class="panel chart-card">
          <div class="chart-title">月度发标趋势<span class="hint-text">（近 12 个月）</span></div>
          <TrendChart :items="data.trend" height="300px" />
        </div>
        <div class="panel chart-card">
          <div class="chart-title">项目类型分布</div>
          <ChartPie :items="data.types" unit="个" />
        </div>
      </div>

      <!-- 竞争格局 -->
      <div class="section-title">竞争格局</div>
      <div class="competition-grid">
        <RankList title="全局竞争红黑榜 TOP 10" :items="data.competitors" value-key="awardWan" value-suffix=" 万元"
                  empty-text="暂无中标数据" tone="rank-tone-1" />
        <div class="panel rank-card self-card">
          <div class="chart-title">本企业战力卡</div>
          <div v-if="!data.self.configured" class="self-empty">
            尚未设置本企业。<br>请在「系统管理 → 基本设置」中选择所属企业，即可查看排名、市占率与差距。
          </div>
          <template v-else>
            <div class="self-name">{{ data.self.name }} <SelfBadge :name="data.self.name" /></div>
            <div class="self-metrics">
              <div><span>全局排名</span><b>第 {{ data.self.rank }} 名</b><em v-if="!data.self.inTop10">未进入前十</em></div>
              <div><span>市占率</span><b>{{ data.self.sharePct }}%</b></div>
              <div><span>中标总额</span><b>{{ data.self.awardWan }} <small>万元</small></b></div>
              <div><span>中标项目数</span><b>{{ data.self.projectCount }} <small>个</small></b></div>
              <div><span>项目平均中标额</span><b>{{ selfAvgAward }} <small>万元</small></b></div>
            </div>
            <div v-if="data.self.isTop1" class="self-lead">当前位列全局第一</div>
            <div v-else class="self-gap">
              与 Top 1「{{ data.self.gapTo }}」金额差距<br><b>{{ data.self.gapWan }} 万元</b>
            </div>
          </template>
        </div>
      </div>

      <!-- 客户与渠道 -->
      <div class="section-title">客户与渠道生态</div>
      <div class="rank-grid">
        <RankList title="Top 10 采购大户" :items="data.buyers" value-key="count" value-suffix=" 个"
                  empty-text="暂无发标数据" tone="rank-tone-2" />
        <RankList title="Top 10 活跃代理机构" :items="data.agencies" value-key="count" value-suffix=" 个"
                  empty-text="暂无代理数据" />
      </div>

      <!-- 热力地图 + 省份预算 TOP10 -->
      <div class="section-title">全局热力地图</div>
      <div class="geo-grid">
        <div class="panel map-panel">
          <div class="chart-title">{{ mapTitle }} <span class="hint-text">单位：万元 · 颜色越深预算越高</span></div>
          <ChinaMap :key="mapVersion" :geo-data="data.geo" :city-data="data.cityGeo || {}" :drillable="true"
                    value-unit="万元" @drill="onMapDrill" @back="onMapBack" />
        </div>
        <div class="panel chart-card geo-rank-card">
          <div class="chart-title">{{ geoRankTitle }} <span class="hint-text">单位：万元</span></div>
          <ChartBar :items="topGeoItems" mode="horizontal" height="430px" value-suffix=" 万元" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { getGlobalStats } from '../api.js'
import { splitLabelHint } from '../utils/labels.js'
import TrendChart from '../components/TrendChart.vue'
import ChartPie from '../components/ChartPie.vue'
import ChartBar from '../components/ChartBar.vue'
import RankList from '../components/RankList.vue'
import SelfBadge from '../components/SelfBadge.vue'
import ChinaMap from '../components/ChinaMap.vue'

const props = defineProps({ active: { type: Boolean, default: false } })
function statParts(s) { return splitLabelHint(s && s.label) }
const data = ref(null)
const selectedYear = ref('')
const loading = ref(false)
const loadError = ref('')
const loaded = ref(false)

// 地图下钻状态：进入省份后右侧榜单同步切到该省的地市/区县预算
const drilledProvince = ref('')
const mapVersion = ref(0)   // 数据重载后重建地图，避免停留在旧省份的下钻视图
const mapTitle = computed(function () {
  return drilledProvince.value ? drilledProvince.value + '各区域招标预算' : '全国各省份招标预算'
})
const geoRankTitle = computed(function () {
  return drilledProvince.value ? drilledProvince.value + '招标预算 TOP 10 区域' : '招标预算 TOP 10 省份'
})
// 全国看 geo（已按预算降序），下钻看 cityGeo[当前省]，均最多 10 条
const topGeoItems = computed(function () {
  const d = data.value
  if (!d) return []
  if (drilledProvince.value) return ((d.cityGeo && d.cityGeo[drilledProvince.value]) || []).slice(0, 10)
  return (d.geo || []).slice(0, 10)
})
function onMapDrill(name) { drilledProvince.value = name }
function onMapBack() { drilledProvince.value = '' }

// 战力卡补充维度：单项目平均中标额（已有中标总额 / 中标项目数，无需改后端）
const selfAvgAward = computed(function () {
  const s = data.value && data.value.self
  if (!s || !s.configured || !s.projectCount) return '0.00'
  return (Number(s.awardWan || 0) / Number(s.projectCount)).toFixed(2)
})

watch(function () { return props.active; }, function (on) {
  if (on && !loaded.value) load(false)
}, { immediate: true })

async function load(refresh) {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await getGlobalStats(selectedYear.value, refresh)
    drilledProvince.value = ''
    mapVersion.value++
    loaded.value = true
  } catch (e) {
    loadError.value = e.message || '读取失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.global-head-actions{display:flex;align-items:center;gap:10px;flex-wrap:nowrap}
.global-updated{color:#64748b}
.global-head-actions .global-refresh{height:32px;min-width:64px}
.overview-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;margin-bottom:14px}
.geo-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:14px;margin-bottom:14px}
.geo-grid .map-panel{margin-bottom:0}
.competition-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;margin-bottom:14px}
.self-card{display:flex;flex-direction:column;background:linear-gradient(160deg,#fff,#fbfdff)}
.self-empty{flex:1;font-size:13px;color:#8a94a6;line-height:1.8;padding:16px 4px}
.self-name{font-size:15px;font-weight:600;color:#243247;margin-bottom:14px}
.self-metrics{display:flex;flex-direction:column;flex:1;justify-content:space-evenly;gap:6px}
.self-metrics>div{display:flex;align-items:baseline;gap:10px;border-bottom:1px dashed #e8edf5;padding-bottom:8px}
.self-metrics span{font-size:12px;color:#8a94a6;min-width:62px}
.self-metrics b{font-size:17px;color:#2f6fed;font-variant-numeric:tabular-nums}
.self-metrics small{font-size:11px;font-weight:400;color:#8a94a6}
.self-metrics em{font-style:normal;font-size:11px;color:#c96a1f;background:#fff7e6;border:1px solid #f7ddc0;padding:0 6px;border-radius:10px}
.self-gap,.self-lead{margin-top:14px;padding:10px 12px;border-radius:6px;font-size:12px;line-height:1.7}
.self-gap{background:#fff7e6;border:1px solid #f7ddc0;color:#8a5a1f}
.self-gap b{font-size:18px;color:#b54708}
.self-lead{background:#e8f7ee;border:1px solid #b7ebc8;color:#137a4b}
@media(max-width:1100px){.overview-grid,.competition-grid,.geo-grid{grid-template-columns:1fr}}
</style>
