/**
 * 第 7 步：全局业务配置项（可配置下拉选项）。
 * 应用启动时先填内置默认值（首屏不闪、接口不可用也能正常录入），再异步拉取服务端配置覆盖。
 * 所有录入 / 编辑 / 查询下拉统一从这里取，避免不同页面各用一套口径（需求 12.2）。
 */
import { reactive } from 'vue'
import { getConfigOptions } from '../api.js'
import {
  setAmountUnits,
  STATUSES, METHODS, TYPES, DOC_WAYS, CORRECTION_ITEMS
} from '../components/form/validation.js'
import { REVIEW_REASON_DEFAULTS } from './tracking.js'

export const GROUP_LABELS = {
  status: '项目状态',
  method: '采购方式',
  project_type: '项目类型 / 分包类型',
  correction_item: '更正事项（多选）',
  doc_way: '获取方式',
  review_reason: '复盘原因分类',
  amount_unit: '金额单位（倍率）'
  // 监管地区不再是可配置下拉：改由全国三级行政区划数据驱动（utils/regions.js）
}
export const GROUP_KEYS = Object.keys(GROUP_LABELS)

const DEFAULTS = {
  status: STATUSES.slice(),
  method: METHODS.slice(),
  project_type: TYPES.slice(),
  correction_item: CORRECTION_ITEMS.slice(),
  doc_way: DOC_WAYS.slice(),
  review_reason: REVIEW_REASON_DEFAULTS.slice(),
  amount_unit: ['元', '万元', '亿元']
}
const DEFAULT_UNITS = { '元': 1, '万元': 10000, '亿元': 100000000 }

export const optionGroups = reactive({
  status: [], method: [], project_type: [], correction_item: [], doc_way: [], review_reason: [], amount_unit: [],
  labels: Object.assign({}, GROUP_LABELS),
  fixedStatuses: STATUSES.slice(),
  ready: false
})

function fillDefaults() {
  Object.keys(DEFAULTS).forEach(function (k) { optionGroups[k] = DEFAULTS[k].slice() })
  setAmountUnits(DEFAULT_UNITS)
}
fillDefaults()

/** 启用选项（录入 / 查询下拉） */
export function opts(group) { return optionGroups[group] || [] }

/**
 * 编辑历史项目时，若原值已被停用 / 不在当前选项里，把它临时追加进候选，
 * 保证「历史已录入项目保留原值展示、不自动改写」（需求 12.2 第 6 条）。
 */
export function optsWithCurrent(group, current) {
  const base = opts(group).slice()
  const v = String(current == null ? '' : current).trim()
  if (v && base.indexOf(v) < 0) base.push(v)
  return base
}

export function applyConfig(data) {
  if (!data) return
  if (data.groups) {
    Object.keys(DEFAULTS).forEach(function (k) {
      if (Array.isArray(data.groups[k])) optionGroups[k] = data.groups[k].slice()
    })
  }
  if (data.labels) optionGroups.labels = Object.assign({}, optionGroups.labels, data.labels)
  if (data.fixedStatuses) optionGroups.fixedStatuses = data.fixedStatuses.slice()
  if (data.amountUnits) setAmountUnits(data.amountUnits)
  optionGroups.ready = true
}

export async function loadOptions() {
  try { applyConfig(await getConfigOptions()) }
  catch (e) { optionGroups.ready = true }   // 接口不可用：沿用内置默认值，不阻塞页面
  return optionGroups
}
