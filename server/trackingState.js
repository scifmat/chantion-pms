/**
 * 项目跟进状态机（纯模块，不依赖 db / express）。
 *
 * 设计要点：
 * - derived_key = 项目状态 + '|' + 时间桶；只有它变化才需要写库。
 * - 时间桶的允许集合保留负责人手选（如「已报名」仍合法时不冲掉），否则写默认值。
 * - 客观状态倒退或完成/终止互换时算重置：归档复盘、按当前时间重算动态。
 */
const { mergeDetail } = require('./detail');

const STAGE_FOLLOWING = '跟进中';
const STAGE_ENDED = '已结束';

const INTERNAL = Object.freeze({
  EVALUATING: '评估中',
  NOT_REGISTERED: '未报名',
  REGISTERED: '已报名',
  NOT_BID: '未投标',
  BID: '已投标',
  NOT_WON: '未中标',
  WON: '已中标',
  FLOATED: '已流标'
});

// 项目客观状态层级：意向公示 0 → 正在招标 1 → 完成/终止 2
const STATUS_RANK = Object.freeze({
  '意向公示': 0,
  '正在招标': 1,
  '完成招标': 2,
  '终止招标': 2
});

// 时间桶：意向公示 / bidding-doc（报名）/ bidding-bid（投标）/ 完成招标 / 终止招标
const ALLOWED = Object.freeze({
  '意向公示': [INTERNAL.EVALUATING],
  'bidding-doc': [INTERNAL.NOT_REGISTERED, INTERNAL.REGISTERED],
  'bidding-bid': [INTERNAL.NOT_BID, INTERNAL.BID],
  '完成招标': [INTERNAL.NOT_WON, INTERNAL.WON],
  '终止招标': [INTERNAL.FLOATED]
});

const DEFAULT_INTERNAL = Object.freeze({
  '意向公示': INTERNAL.EVALUATING,
  'bidding-doc': INTERNAL.NOT_REGISTERED,
  'bidding-bid': INTERNAL.NOT_BID,
  '完成招标': INTERNAL.NOT_WON,
  '终止招标': INTERNAL.FLOATED
});

const REVIEW_REQUIRED = new Set([
  INTERNAL.NOT_REGISTERED, INTERNAL.NOT_BID, INTERNAL.NOT_WON, INTERNAL.FLOATED
]);

const FOLLOWING_INTERNALS = [
  INTERNAL.EVALUATING, INTERNAL.NOT_REGISTERED, INTERNAL.REGISTERED,
  INTERNAL.NOT_BID, INTERNAL.BID
];
const ENDED_INTERNALS = [INTERNAL.NOT_WON, INTERNAL.WON, INTERNAL.FLOATED];

// 历史补录白名单：只允许「已发生或当前」动态，禁止穿越到未来。
// 注意与 ALLOWED（顺流默认值）的区别：ALLOWED 是当下时间桶的可选项，这里是全部可回溯项。
const HISTORY_ALLOWED = Object.freeze({
  '意向公示': [INTERNAL.EVALUATING],
  'bidding-doc': [INTERNAL.EVALUATING, INTERNAL.NOT_REGISTERED, INTERNAL.REGISTERED],
  'bidding-bid': [INTERNAL.EVALUATING, INTERNAL.NOT_REGISTERED, INTERNAL.REGISTERED, INTERNAL.NOT_BID, INTERNAL.BID],
  '完成招标': [INTERNAL.EVALUATING, INTERNAL.NOT_REGISTERED, INTERNAL.REGISTERED, INTERNAL.NOT_BID, INTERNAL.BID, INTERNAL.NOT_WON, INTERNAL.WON],
  '终止招标': [INTERNAL.EVALUATING, INTERNAL.NOT_REGISTERED, INTERNAL.REGISTERED, INTERNAL.NOT_BID, INTERNAL.BID, INTERNAL.FLOATED]
});

const TODO_WINDOW_DAYS = 7;

// 跟进轨迹的四个节点。阶段是否「已到达」由客观状态/时间桶判定，不允许穿越。
const STAGES = Object.freeze([
  { key: 'evaluation',   label: '评估阶段', objective: '意向公示', internals: [INTERNAL.EVALUATING], default: INTERNAL.EVALUATING },
  { key: 'registration', label: '报名阶段', objective: '正在招标', internals: [INTERNAL.NOT_REGISTERED, INTERNAL.REGISTERED], default: INTERNAL.NOT_REGISTERED },
  { key: 'bidding',      label: '投标阶段', objective: '正在招标', internals: [INTERNAL.NOT_BID, INTERNAL.BID], default: INTERNAL.NOT_BID },
  { key: 'result',       label: '结果阶段', objective: '完成招标 / 终止招标', internals: [INTERNAL.NOT_WON, INTERNAL.WON, INTERNAL.FLOATED], default: INTERNAL.NOT_WON }
]);
const STAGE_ORDER = STAGES.map(function (s) { return s.key; });
const STAGE_BY_KEY = Object.freeze(STAGES.reduce(function (m, s) { m[s.key] = s; return m; }, {}));

function text(v) { return String(v == null ? '' : v).trim(); }

/** 日期补成当天 23:59:59；日期时间补秒。返回 '' 表示无法解析。 */
function normDeadline(v) {
  const s = text(v);
  if (!s) return '';
  let m = /^(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m) return m[1] + ' 23:59:59';
  m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return m[1] + ' ' + m[2] + ':' + (m[3] || '00');
  return '';
}

function parseDetail(row) {
  let parsed = {};
  try { parsed = JSON.parse((row && row.detail) || '{}'); } catch (e) { parsed = {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  return mergeDetail(parsed);
}

function bucketOf(status, detail, now) {
  if (status === '意向公示') return '意向公示';
  if (status === '正在招标') {
    const doc = normDeadline(detail.bidding.docEnd);
    if (doc && now < doc) return 'bidding-doc';
    return 'bidding-bid';
  }
  if (status === '完成招标') return '完成招标';
  if (status === '终止招标') return '终止招标';
  return status || '意向公示';
}

/**
 * 由项目主表 + 当前时间算出「应有」跟进状态。
 * @returns {object} {key,bucket,stage,internal,allowed,reviewRequired,detail,docEnd,bidEnd,terminateReason}
 */
function expectedOf(project, now) {
  const detail = parseDetail(project);
  const bucket = bucketOf(project.status, detail, now);
  const internal = DEFAULT_INTERNAL[bucket] || INTERNAL.EVALUATING;
  const allowed = ALLOWED[bucket] || [internal];
  return {
    key: String(project.status || '') + '|' + bucket,
    bucket: bucket,
    stage: (bucket === '完成招标' || bucket === '终止招标') ? STAGE_ENDED : STAGE_FOLLOWING,
    internal: internal,
    allowed: allowed,
    reviewRequired: REVIEW_REQUIRED.has(internal),
    detail: detail,
    docEnd: normDeadline(detail.bidding.docEnd),
    bidEnd: normDeadline(detail.bidding.bidEnd),
    terminateReason: text(detail.terminated.reason)
  };
}

/** 客观状态是否发生「倒退」或「完成↔终止」横向切换（需要归档复盘并重置）。 */
function isResetSwitch(from, to) {
  const a = STATUS_RANK[text(from)];
  const b = STATUS_RANK[text(to)];
  if (a === undefined || b === undefined) return false;
  if (b < a) return true;
  return a === 2 && b === 2 && from !== to;
}

function needsReview(internal) { return REVIEW_REQUIRED.has(text(internal)); }

function allowedForDerivedKey(key) {
  const bucket = String(key || '').split('|')[1];
  return ALLOWED[bucket] || [];
}

/** 当前客观状态下允许回溯或持平的内部动态（用于复盘补录防呆）。 */
function historyAllowedFor(key) {
  const bucket = String(key || '').split('|')[1];
  return (HISTORY_ALLOWED[bucket] || []).slice();
}

/** 当前客观状态允许的跟进状态：未出结果不能选「已结束」。 */
function stagesAllowedFor(key) {
  const bucket = String(key || '').split('|')[1];
  return (bucket === '完成招标' || bucket === '终止招标')
    ? [STAGE_FOLLOWING, STAGE_ENDED]
    : [STAGE_FOLLOWING];
}

function stageInternalValid(stage, internal) {
  if (stage === STAGE_FOLLOWING) return FOLLOWING_INTERNALS.indexOf(internal) >= 0;
  if (stage === STAGE_ENDED) return ENDED_INTERNALS.indexOf(internal) >= 0;
  return false;
}

/** 跟进状态由内部动态单方面推导，复盘接口绝不接收手选 follow_stage。 */
function stageForInternal(internal) {
  return FOLLOWING_INTERNALS.indexOf(internal) >= 0 ? STAGE_FOLLOWING : STAGE_ENDED;
}

/** 当前时间桶对应的轨迹节点 key。 */
function stageKeyForBucket(bucket) {
  if (bucket === '意向公示') return 'evaluation';
  if (bucket === 'bidding-doc') return 'registration';
  if (bucket === 'bidding-bid') return 'bidding';
  if (bucket === '完成招标' || bucket === '终止招标') return 'result';
  return 'evaluation';
}

function stageKeyOfInternal(internal) {
  if (internal === INTERNAL.EVALUATING) return 'evaluation';
  if (internal === INTERNAL.NOT_REGISTERED || internal === INTERNAL.REGISTERED) return 'registration';
  if (internal === INTERNAL.NOT_BID || internal === INTERNAL.BID) return 'bidding';
  return 'result';
}

/** 节点是否已发生：只能回溯或持平，不能点未来节点。 */
function stageReachable(stageKey, bucket) {
  const a = STAGE_ORDER.indexOf(stageKey);
  const b = STAGE_ORDER.indexOf(stageKeyForBucket(bucket));
  return a >= 0 && b >= 0 && a <= b;
}

/** 结果节点可选动态受客观状态约束：终止招标只能已流标，完成招标只能未中标/已中标。 */
function resultAllowedFor(bucket) {
  return bucket === '终止招标' ? [INTERNAL.FLOATED] : [INTERNAL.NOT_WON, INTERNAL.WON];
}

function stageInternalsFor(stageKey, bucket) {
  if (stageKey === 'result') return resultAllowedFor(bucket);
  const def = STAGE_BY_KEY[stageKey];
  return def ? def.internals.slice() : [];
}

function deadlineSnapshot(exp) { return (exp.docEnd || '') + '|' + (exp.bidEnd || ''); }

/** 天数差（deadline - now），负数表示已逾期；无法解析返回 null。 */
function daysUntil(deadline, now) {
  if (!deadline) return null;
  const a = Date.parse(deadline.replace(' ', 'T'));
  const b = Date.parse(String(now).replace(' ', 'T'));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (a - b) / 86400000;
}

module.exports = {
  STAGE_FOLLOWING, STAGE_ENDED, INTERNAL, STATUS_RANK, ALLOWED,
  STAGES, STAGE_ORDER, STAGE_BY_KEY,
  FOLLOWING_INTERNALS, ENDED_INTERNALS, REVIEW_REQUIRED, TODO_WINDOW_DAYS,
  text, normDeadline, parseDetail, bucketOf, expectedOf, isResetSwitch,
  allowedForDerivedKey, historyAllowedFor, stagesAllowedFor, stageInternalValid, stageForInternal,
  stageKeyForBucket, stageKeyOfInternal, stageReachable, resultAllowedFor, stageInternalsFor,
  needsReview, deadlineSnapshot, daysUntil
};
