/**
 * 查询条件 WHERE 构造器 —— 唯一事实来源。
 *
 * 从 routes/projects.js 抽出，供「列表查询」与「Excel 导出」共用，避免各写一遍条件导致口径漂移：
 *   - buildHomeWhere(q)     首页列表：GET /api/projects      + 导出 queryType='home'
 *   - buildAdvancedWhere(q) 高级查询：GET /api/projects/advanced + 导出 queryType='advanced'
 *
 * 口径（与原实现逐字一致）：
 *   - 条件之间一律 AND；高级查询多值字段内部按「或」用括号 OR 分组
 *   - 金额一律用 INTEGER 分比较，后端只接受「整数分」字符串，不接触万元与浮点
 *   - 日期按 YYYY-MM-DD 字符串比较，字典序即时间序
 *   - 所有值走 ? 占位符，不拼接任何 SQL 字符串
 *   - 软删除项目不参与
 *
 * 纯函数，不依赖 express / db。
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 高级查询 14 列所需的全部字段（含 003 派生列），不带 detail 大 JSON。
// 导出时在末尾拼接 ', detail' 以取复杂字段；列表直接用本常量。
const ADV_COLUMNS = 'row_id, project_no, project_name, status, region, budget_yuan, budget_fen, ceiling_yuan, ceiling_fen, award_amount_yuan, award_amount_fen, project_types, buyer_name, agency_name, method, period_days, bid_end, winner_names';

/**
 * 首页 5 个条件的 WHERE 构造器（与 GET /api/projects、导出 queryType='home' 共用）。
 * 逐字复刻原 routes/projects.js 首页逻辑：
 *   status / name / region 走 LIKE；timeStart / timeEnd 按 award_time 日期字典序比较；
 *   条件之间 AND；软删除不参与；非法日期忽略。
 */
function buildHomeWhere(q) {
  q = q || {};
  const where = ['deleted = 0'];
  const args = [];
  const like = function (v) { return '%' + String(v).trim() + '%'; };
  if (q.status && String(q.status).trim()) { where.push('status LIKE ?'); args.push(like(q.status)); }
  if (q.name && String(q.name).trim()) { where.push('project_name LIKE ?'); args.push(like(q.name)); }
  if (q.region && String(q.region).trim()) { where.push('region LIKE ?'); args.push(like(q.region)); }
  if (q.timeStart && DATE_RE.test(String(q.timeStart).trim())) { where.push('award_time >= ?'); args.push(String(q.timeStart).trim()); }
  if (q.timeEnd && DATE_RE.test(String(q.timeEnd).trim())) { where.push('award_time <= ?'); args.push(String(q.timeEnd).trim()); }
  return { where, args };
}

function buildAdvancedWhere(q) {
  q = q || {};
  const where = ['deleted = 0'];
  const args = [];

  function addLike(col, value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return;
    where.push(col + ' LIKE ?');
    args.push('%' + s + '%');
  }
  // 逗号串字段：输入「货物类」命中「货物类,服务类」；多个关键字组内 OR（任一命中即可）
  function addMulti(col, value) {
    const keys = String(value == null ? '' : value)
      .split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!keys.length) return;
    where.push('(' + keys.map(function () { return col + ' LIKE ?'; }).join(' OR ') + ')');
    keys.forEach(function (k) { args.push('%' + k + '%'); });
  }
  // 只接受「整数分」字符串；非法值忽略（等同未提供该条件）
  function fenParam(value) {
    const s = String(value == null ? '' : value).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  }
  function addAmountRange(col, min, max) {
    const lo = fenParam(min), hi = fenParam(max);
    if (lo === null && hi === null) return;
    where.push(col + ' > 0'); // 无值（列表显示 —）的项目不参与金额区间命中
    if (lo !== null) { where.push(col + ' >= ?'); args.push(lo); }
    if (hi !== null) { where.push(col + ' <= ?'); args.push(hi); }
  }

  addLike('status', q.status);
  addMulti('project_types', q.type);
  addLike('region', q.region);
  addLike('project_no', q.no);
  addLike('project_name', q.name);
  addAmountRange('budget_fen', q.budgetMinFen, q.budgetMaxFen);
  addAmountRange('ceiling_fen', q.ceilingMinFen, q.ceilingMaxFen);
  addLike('buyer_name', q.buyer);
  addLike('agency_name', q.agency);
  addLike('method', q.method);
  addLike('period_days', q.period);
  if (q.bidFrom && DATE_RE.test(String(q.bidFrom).trim())) { where.push('bid_end >= ?'); args.push(String(q.bidFrom).trim()); }
  if (q.bidTo && DATE_RE.test(String(q.bidTo).trim())) { where.push('bid_end <= ?'); args.push(String(q.bidTo).trim()); }
  addMulti('winner_names', q.winner);
  addAmountRange('award_amount_fen', q.amountMinFen, q.amountMaxFen);

  return { where, args };
}

module.exports = { buildHomeWhere, buildAdvancedWhere, ADV_COLUMNS, DATE_RE };
