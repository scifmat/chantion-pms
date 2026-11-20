/**
 * Excel 导出的「字段字典」—— 后端权威来源（单一事实来源）。
 *
 * 职责：
 *   1) 定义所有可导出字段：分组、表头、取值来源（主表列 / detail JSON）、格式化方式
 *   2) GET /api/export/fields 下发给前端渲染勾选框（只暴露展示用元数据）
 *   3) 导出时按用户勾选的 key 逐字段取值 + 扁平化，产出单元格文本
 *
 * 口径（与前端 detailFormat.js / money.js 完全对齐）：
 *   - 空白值一律导出为空字符串 ''
 *   - 金额一律「万元、两位小数、不带后缀」的纯数字串，方便 Excel 再计算
 *   - 复杂 JSON 结构拼成易读字符串（联合体 / 分包 / 评委 / 更正）
 *
 * 纯模块，不依赖 express / db。
 */
const { mergeDetail } = require('../detail');
const { normalizeAmount } = require('../money');

function text(v) { return v == null ? '' : String(v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }

/** 整数分 -> 万元两位纯数字串（空 / 0 / 非法 -> ''）。口径同前端 fenToWan */
function fenToWan(fen) {
  const n = Number(fen);
  if (!Number.isFinite(n) || n <= 0) return '';
  return (n / 1000000).toFixed(2);
}
/** 元文本 -> 万元两位纯数字串（空 / 0 / 非法 -> ''）。口径同前端 yuanToWan */
function yuanToWan(raw) {
  const s = text(raw).replace(/,/g, '');
  if (!s || /^0+(\.0*)?$/.test(s)) return '';
  const a = normalizeAmount(s); // 兼容纯元文本与带 元/万元/亿元 单位的历史值
  if (!a || !Number.isFinite(a.fen) || a.fen === 0) return '';
  return (a.fen / 1000000).toFixed(2);
}

/** 联合体中标：牵头方A，成员方B、C（成员仅 isUnion 时展示；空值剔除） */
function formatWinner(w) {
  w = w || {};
  const lead = text(w.lead);
  const members = (w.isUnion ? arr(w.members) : []).map(text).filter(Boolean);
  if (!lead && !members.length) return '';
  if (lead && members.length) return lead + '，' + members.join('、');
  return lead || members.join('、');
}

/** 分包明细：每包「包名：牵头/成员（金额万元）」，包间用「；」连接 */
function formatPackages(packages) {
  const parts = [];
  arr(packages).forEach(function (p) {
    p = p || {};
    const name = text(p.name);
    const winner = formatWinner(p.winner);
    const amount = yuanToWan(p.amount_yuan);
    const seg = [];
    if (name) seg.push(name);
    if (winner) seg.push(winner);
    if (amount) seg.push('金额 ' + amount + ' 万元');
    if (seg.length) parts.push(seg.join('：'));
  });
  return parts.join('；');
}

/** 评委：张三(组长), 李四(业主)——组长/业主可叠加为「组长·业主」，英文逗号+空格分隔 */
function formatJudges(judges) {
  const parts = [];
  arr(judges).forEach(function (j) {
    j = j || {};
    const name = text(j.name);
    if (!name) return;
    const tags = [];
    if (j.leader) tags.push('组长');
    if (j.owner) tags.push('业主');
    parts.push(name + (tags.length ? '(' + tags.join('·') + ')' : ''));
  });
  return parts.join(', ');
}

/** 更正公告：按「日期 内容」逐条，条目间用「；」连接 */
function formatCorrections(list) {
  const parts = [];
  arr(list).forEach(function (c) {
    c = c || {};
    const date = text(c.date);
    const content = text(c.content);
    const seg = [date, content].filter(Boolean).join(' ');
    if (seg) parts.push(seg);
  });
  return parts.join('；');
}

/**
 * 字段字典。
 * source: 'main' 从主表列取；'detail' 从 detail JSON 取（配合 path）
 * format: text / moneyFen / moneyYuan / union / packages / judges / corrections
 */
const FIELDS = [
  // ---- 基础信息（5）----
  { key: 'project_no',   label: '项目编号',   group: '基础信息', source: 'main', column: 'project_no',   format: 'text' },
  { key: 'project_name', label: '项目名称',   group: '基础信息', source: 'main', column: 'project_name', format: 'text' },
  { key: 'status',       label: '项目状态',   group: '基础信息', source: 'main', column: 'status',       format: 'text' },
  { key: 'project_types',label: '项目类型',   group: '基础信息', source: 'main', column: 'project_types',format: 'text' },
  { key: 'region',       label: '监管地区',   group: '基础信息', source: 'main', column: 'region',       format: 'text' },

  // ---- 金额与周期（7）----
  { key: 'budget',       label: '项目预算（万元）',   group: '金额与周期', source: 'main', column: 'budget_fen',      format: 'moneyFen' },
  { key: 'ceiling',      label: '最高限价（万元）',   group: '金额与周期', source: 'main', column: 'ceiling_fen',     format: 'moneyFen' },
  { key: 'method',       label: '采购方式',   group: '金额与周期', source: 'main', column: 'method',       format: 'text' },
  { key: 'period_days',  label: '合同履行期限（天）', group: '金额与周期', source: 'main', column: 'period_days', format: 'text' },
  { key: 'bid_end',      label: '投标截止时间',   group: '金额与周期', source: 'main', column: 'bid_end', format: 'text' },
  { key: 'intention_start', label: '意向公示开始', group: '金额与周期', source: 'detail', path: 'intention.startDate', format: 'text' },
  { key: 'intention_end',   label: '意向公示结束', group: '金额与周期', source: 'detail', path: 'intention.endDate',   format: 'text' },

  // ---- 中标与评审（8，重点：复杂字段扁平化）----
  { key: 'award',        label: '中标金额（万元）', group: '中标与评审', source: 'main', column: 'award_amount_fen', format: 'moneyFen' },
  { key: 'award_time',   label: '中标时间',       group: '中标与评审', source: 'main', column: 'award_time', format: 'text' },
  { key: 'winner_names', label: '中标单位（列表）', group: '中标与评审', source: 'main', column: 'winner_names', format: 'text' },
  { key: 'winner',       label: '中标单位（联合体）', group: '中标与评审', source: 'detail', path: 'completed.winner',   format: 'union' },
  { key: 'packages',     label: '分包明细',   group: '中标与评审', source: 'detail', path: 'completed.packages', format: 'packages' },
  { key: 'judges',       label: '评委',       group: '中标与评审', source: 'detail', path: 'completed.judges',   format: 'judges' },
  { key: 'corrections',  label: '更正公告',   group: '中标与评审', source: 'detail', path: 'corrections',        format: 'corrections' },
  { key: 'terminated_reason', label: '终止原因', group: '中标与评审', source: 'detail', path: 'terminated.reason', format: 'text' },

  // ---- 关联单位（8）----
  { key: 'buyer_name',   label: '采购单位',   group: '关联单位', source: 'main', column: 'buyer_name',  format: 'text' },
  { key: 'buyer_phone',  label: '采购单位电话', group: '关联单位', source: 'detail', path: 'buyer.phone',   format: 'text' },
  { key: 'buyer_email',  label: '采购单位邮箱', group: '关联单位', source: 'detail', path: 'buyer.email',   format: 'text' },
  { key: 'buyer_address',label: '采购单位地址', group: '关联单位', source: 'detail', path: 'buyer.address', format: 'text' },
  { key: 'agency_name',  label: '代理机构',   group: '关联单位', source: 'main', column: 'agency_name', format: 'text' },
  { key: 'agency_phone', label: '代理机构电话', group: '关联单位', source: 'detail', path: 'agency.phone',  format: 'text' },
  { key: 'agency_email', label: '代理机构邮箱', group: '关联单位', source: 'detail', path: 'agency.email',  format: 'text' },
  { key: 'agency_address',label:'代理机构地址', group: '关联单位', source: 'detail', path: 'agency.address',format: 'text' },

  // ---- 其它（3，相对不重要的信息）----
  { key: 'detail_url',   label: '中标公告网址', group: '其它', source: 'detail', path: 'completed.url', format: 'text' },
  { key: 'created_at',   label: '创建时间',     group: '其它', source: 'main', column: 'created_at',   format: 'text' },
  { key: 'updated_at',   label: '更新时间',     group: '其它', source: 'main', column: 'updated_at', format: 'text' }
];

const FIELD_MAP = {};
FIELDS.forEach(function (f) { FIELD_MAP[f.key] = f; });

// 首页导出默认勾选的 7 个核心字段：即首页表格的 6 个数据列（状态/名称/地区/预算/中标金额/中标时间）
// 加上项目编号这一核心标识。高级查询不传默认键，前端保持全选。
const HOME_DEFAULT_KEYS = ['project_no', 'status', 'project_name', 'region', 'budget', 'award', 'award_time'];

/** 分组顺序（按首次出现顺序） */
function groups() {
  const order = [];
  FIELDS.forEach(function (f) { if (order.indexOf(f.group) < 0) order.push(f.group); });
  return order;
}

/** 下发给前端的字段字典（去掉 source/path/column 等内部实现细节） */
function dictionary(queryType) {
  const isHome = String(queryType || '') === 'home';
  return {
    groups: groups(),
    fields: FIELDS.map(function (f) {
      return { key: f.key, label: f.label, group: f.group };
    }),
    // 默认勾选：首页 7 个核心字段；高级查询为全选（前端收到空数组则全选）
    defaultKeys: isHome ? HOME_DEFAULT_KEYS.slice() : []
  };
}

/**
 * 导出取数列集 —— 由字段字典自动派生，与 cellValue 的取值来源严格同源。
 * 避免「字典声明了某 main 字段，但 SELECT 漏查该列 → 静默导出空列」的隐患
 * （如 award_time 曾因列集手工维护而漏掉）。新增字段只要登记进 FIELDS 即自动覆盖。
 * @param {boolean} withDetail 是否带 detail（存在 detail 字段时必需）
 */
function selectColumns(withDetail) {
  const seen = {};
  const cols = [];
  FIELDS.forEach(function (f) {
    if (f.source === 'main' && !seen[f.column]) { seen[f.column] = 1; cols.push(f.column); }
  });
  return cols.join(', ') + (withDetail ? ', detail' : '');
}

function getPath(o, p) {
  return String(p).split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o);
}

/** 取单个字段的单元格文本 */
function cellValue(field, row, detail) {
  const f = FIELD_MAP[field];
  if (!f) return '';
  let raw;
  if (f.source === 'main') raw = row[f.column];
  else raw = getPath(detail, f.path);

  switch (f.format) {
    case 'moneyFen':    return fenToWan(raw);
    case 'moneyYuan':   return yuanToWan(raw);
    case 'union':       return formatWinner(raw);
    case 'packages':    return formatPackages(raw);
    case 'judges':      return formatJudges(raw);
    case 'corrections': return formatCorrections(raw);
    default:            return text(raw); // text：空值统一为 ''
  }
}

/** 把一行主表记录解析成「已归一化的 detail」 */
function rowDetail(row) {
  let parsed = {};
  try { parsed = JSON.parse(row.detail || '{}'); } catch (e) { parsed = {}; }
  return mergeDetail(parsed);
}

module.exports = {
  FIELDS, FIELD_MAP, HOME_DEFAULT_KEYS, dictionary, groups, cellValue, rowDetail, selectColumns,
  fenToWan, yuanToWan, formatWinner, formatPackages, formatJudges, formatCorrections
};
