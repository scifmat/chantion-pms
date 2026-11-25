<template>
  <!-- 14 列表格：完全复用全局 table 样式（table-layout:fixed + width:100%），按视口均分铺满，
       长文本列由 .cell-wrap 自适应换行；高度自动撑高、表头吸顶，与其它页面表格交互一致 -->
  <div class="panel table-wrap adv-table-wrap">
    <table class="adv-table">
      <colgroup>
        <!-- 按内容分配的基础比例（合计 100%）；fixed 布局下长列给多点、短列收紧，避免某列挤爆换行过多 -->
        <col style="width:8%"><col style="width:6%"><col style="width:8%"><col style="width:8%">
        <col style="width:13%"><col style="width:7%"><col style="width:7%">
        <col style="width:9%"><col style="width:9%">
        <col style="width:6%"><col style="width:6%"><col style="width:8%">
        <col style="width:11%"><col style="width:7%">
      </colgroup>
      <thead>
        <tr>
          <th v-for="c in cols" :key="c">{{ c }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.row_id">
          <td v-cell-align class="status-cell"><span class="status-tag" :data-status="r.status">{{ r.status }}</span></td>
          <td v-cell-align class="cell-wrap" :title="r.project_types">{{ r.project_types || '—' }}</td>
          <td v-cell-align class="cell-ellip region-cell" :title="r.region">{{ r.region || '—' }}</td>
          <td v-cell-align class="cell-ellip" :title="r.project_no">{{ r.project_no || '—' }}</td>
          <td v-cell-align class="cell-wrap" :title="r.project_name">{{ r.project_name || '—' }}</td>
          <td v-cell-align class="cell-ellip">{{ fenToWan(r.budget_yuan, r.budget_fen) }}</td>
          <td v-cell-align class="cell-ellip">{{ fenToWan(r.ceiling_yuan, r.ceiling_fen) }}</td>
          <td v-cell-align class="cell-wrap" :title="r.buyer_name">{{ r.buyer_name || '—' }}</td>
          <td v-cell-align class="cell-wrap" :title="r.agency_name">{{ r.agency_name || '—' }}</td>
          <td v-cell-align class="cell-ellip">{{ r.method || '—' }}</td>
          <td v-cell-align class="cell-ellip">{{ r.period_days ? r.period_days + ' 天' : '—' }}</td>
          <td v-cell-align class="cell-ellip">{{ r.bid_end || '—' }}</td>
          <td v-cell-align class="cell-ellip">
            <MultiValueCell :values="r.winner_names" label="中标单位" ellipsis />
          </td>
          <td v-cell-align class="cell-ellip">{{ fenToWan(r.award_amount_yuan, r.award_amount_fen) }}</td>
        </tr>
        <tr v-if="!rows.length && !loading"><td colspan="14" class="empty">未查询到符合条件的项目</td></tr>
        <tr v-if="loading"><td colspan="14" class="empty">正在读取…</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { fenToWan } from '../../utils/money.js'
import MultiValueCell from '../MultiValueCell.vue'

defineProps({
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false }
})

const cols = [
  '项目状态', '项目类型', '监管地区', '项目编号', '项目名称',
  '项目预算（万元）', '最高限价（万元）', '采购单位', '代理机构',
  '采购方式', '合同履行期限', '投标截止时间（年月日）', '中标单位', '中标金额（万元）'
]
</script>
