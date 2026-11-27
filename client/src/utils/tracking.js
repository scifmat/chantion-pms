// 项目跟进：前端只用于展示与二次确认提示，业务判定以服务端 trackingState.js 为准。
export const TRACK_STAGES = ['跟进中', '已结束']

export const TRACK_INTERNAL = {
  EVALUATING: '评估中',
  NOT_REGISTERED: '未报名',
  REGISTERED: '已报名',
  NOT_BID: '未投标',
  BID: '已投标',
  NOT_WON: '未中标',
  WON: '已中标',
  FLOATED: '已流标'
}

export const FOLLOWING_INTERNALS = [
  TRACK_INTERNAL.EVALUATING,
  TRACK_INTERNAL.NOT_REGISTERED,
  TRACK_INTERNAL.REGISTERED,
  TRACK_INTERNAL.NOT_BID,
  TRACK_INTERNAL.BID
]

export const ENDED_INTERNALS = [
  TRACK_INTERNAL.NOT_WON,
  TRACK_INTERNAL.WON,
  TRACK_INTERNAL.FLOATED
]

// 同一 config_options 分组 review_reason，按内部动态联动过滤
export const REVIEW_CATEGORY_GROUPS = {
  negative: ['价格劣势', '技术不达标', '资质不符', '商务条款不符', '内部主动放弃', '无合适产品', '其他'],
  positive: ['价格优势', '技术领先', '资质完备', '商务条款灵活', '响应及时', '产品匹配度高', '其他'],
  float: ['项目终止', '其他']
}

export const REVIEW_REASON_DEFAULTS = [
  '价格劣势', '技术不达标', '资质不符', '商务条款不符', '内部主动放弃', '无合适产品', '其他',
  '价格优势', '技术领先', '资质完备', '商务条款灵活', '响应及时', '产品匹配度高',
  '项目终止'
]

export const CATEGORY_LABELS = {
  negative: '失败原因分类',
  positive: '成功经验分类',
  float: '流标原因分类'
}

export function reviewKind(internal) {
  if (internal === TRACK_INTERNAL.FLOATED) return 'float'
  if ([TRACK_INTERNAL.REGISTERED, TRACK_INTERNAL.BID, TRACK_INTERNAL.WON].indexOf(internal) >= 0) return 'positive'
  return 'negative'
}

export function categoriesFor(internal, allCategories) {
  const kind = reviewKind(internal)
  const pool = Array.isArray(allCategories) && allCategories.length ? allCategories : REVIEW_REASON_DEFAULTS
  return pool.filter(function (c) { return REVIEW_CATEGORY_GROUPS[kind].indexOf(c) >= 0 })
}

export function categoryLabel(internal) { return CATEGORY_LABELS[reviewKind(internal)] }

/** 跟进状态由内部动态单方面推导，禁止人工手选，避免与客观状态打架。 */
export function stageForInternal(internal) {
  return FOLLOWING_INTERNALS.indexOf(internal) >= 0 ? '跟进中' : '已结束'
}

export const ALL_INTERNALS = FOLLOWING_INTERNALS.concat(ENDED_INTERNALS)

export const REVIEW_REQUIRED_INTERNALS = [
  TRACK_INTERNAL.NOT_REGISTERED,
  TRACK_INTERNAL.NOT_BID,
  TRACK_INTERNAL.NOT_WON,
  TRACK_INTERNAL.FLOATED
]

export const STATUS_RANK = {
  '意向公示': 0,
  '正在招标': 1,
  '完成招标': 2,
  '终止招标': 2
}

export function needsReview(internal) {
  return REVIEW_REQUIRED_INTERNALS.indexOf(internal) >= 0
}

/** 客观状态倒退或完成↔终止互换：跟进复盘会被归档、内部动态会重算。 */
export function isResetSwitch(from, to) {
  const a = STATUS_RANK[from]
  const b = STATUS_RANK[to]
  if (a === undefined || b === undefined) return false
  if (b < a) return true
  return a === 2 && b === 2 && from !== to
}
