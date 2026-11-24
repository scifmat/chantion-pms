// 第 17 步：系统级全局数据看板（战略驾驶舱）聚合模块。
// 所有金额全程整数分在 SQL 内聚合，最后统一转万元；Node 只处理十余行聚合结果与 12 个月补零。
// 不 require('./db')：db.js 启动时会加载 migrate.js，避免任何循环依赖；db 由调用方注入。
const { normName } = require('./archive');

const TTL = 5 * 60 * 1000;
const cache = new Map();

function nowText() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: process.env.TZ || 'Asia/Shanghai', hour12: false
  });
}
function wan(fen) { return Number(((Number(fen || 0) / 1000000).toFixed(2))) }
function pct(a, b) { return b ? Math.round((a * 1000) / b) / 10 : 0 }
function typeLabel(s) { return String(s == null ? '' : s).replace(/类$/, '').trim() }

/** 管理员写操作后调用：项目增删改、业务配置、本企业/系统名变更都会使看板缓存失效 */
function invalidateGlobalCache() { cache.clear() }

function yearWhere(year, prefix) {
  const p = prefix ? prefix + '.' : '';
  return year ? (" AND substr(" + p + "created_at,1,4) = '" + String(year).replace(/[^0-9]/g, '') + "'") : '';
}

function lastMonths(year) {
  const end = year ? new Date(Date.UTC(Number(year), 11, 1)) : new Date();
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    out.push(String(d.getUTCFullYear()) + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
  }
  return out;
}

function computeGlobal(db, year) {
  const yw = yearWhere(year);
  const pYW = yearWhere(year, 'p');

  // 1) KPI：有效项目=完成+终止；中标类=仅完成招标
  const base = db.prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(budget_fen),0) budget FROM projects WHERE deleted=0 AND status IN ('完成招标','终止招标')" + yw
  ).get();
  const award = db.prepare(
    "SELECT COALESCE(SUM(award_amount_fen),0) award, AVG(CASE WHEN budget_fen>0 THEN (budget_fen-award_amount_fen)*1.0/budget_fen END) rate FROM projects WHERE deleted=0 AND status='完成招标'" + yw
  ).get();
  const summary = [
    { key: 'projectCount', label: '已结束项目数（完成+终止）', value: Number(base.n || 0), unit: '个' },
    { key: 'totalBudget', label: '总预算规模', value: wan(base.budget), unit: '万元' },
    { key: 'totalAward', label: '总中标金额', value: wan(award.award), unit: '万元' },
    { key: 'avgSaving', label: '平均资金节约率', value: (Math.round(Number(award.rate || 0) * 1000) / 10).toFixed(1), unit: '%' }
  ];

  // 2) 月度发标趋势：近 12 个月，缺月补 0
  const months = lastMonths(year);
  const trendRows = db.prepare(
    "SELECT substr(created_at,1,7) ym, COUNT(*) n, COALESCE(SUM(budget_fen),0) budget FROM projects WHERE deleted=0 AND substr(created_at,1,7) >= ?" + yw + ' GROUP BY ym ORDER BY ym'
  ).all(months[0]);
  const byMonth = {};
  trendRows.forEach(function (r) { byMonth[r.ym] = r; });
  const trend = months.map(function (m) {
    const r = byMonth[m] || {};
    return { month: m, count: Number(r.n || 0), budgetWan: wan(r.budget) };
  });

  // 3) 项目类型分布：递归 CTE 拆逗号串；一项目多类型各计一次
  const typeRows = db.prepare(
    'WITH RECURSIVE s(no, rest, type) AS (' +
    " SELECT project_no, project_types || ',', '' FROM projects WHERE deleted=0 AND project_types <> ''" + yw +
    " UNION ALL SELECT no, substr(rest, instr(rest,',')+1), substr(rest,1,instr(rest,',')-1) FROM s WHERE rest <> ''" +
    ') SELECT trim(type) name, COUNT(DISTINCT no) value FROM s WHERE trim(type) <> \'\' GROUP BY name ORDER BY value DESC'
  ).all();
  const types = typeRows.map(function (r) { return { name: typeLabel(r.name), value: Number(r.value) }; });

  // 4) 竞争格局：project_winners 已是「项目×单位×包」规范化行，直接 SQL 分组 + 窗口排名
  const competitorRows = db.prepare(
    'SELECT pw.winner_norm AS norm, MAX(pw.winner_name) AS name, ' +
    'COUNT(DISTINCT p.project_no) AS project_count, SUM(pw.award_fen) AS award_fen, ' +
    'CASE WHEN c.is_self = 1 THEN 1 ELSE 0 END AS is_self, ' +
    'ROW_NUMBER() OVER (ORDER BY SUM(pw.award_fen) DESC, MIN(pw.winner_name) ASC) AS rank ' +
    'FROM project_winners pw JOIN projects p ON p.project_no = pw.project_no AND p.deleted = 0 AND p.status = \'完成招标\'' + pYW +
    ' LEFT JOIN competitors c ON c.name_norm = pw.winner_norm ' +
    'GROUP BY pw.winner_norm ORDER BY award_fen DESC, name ASC'
  ).all();
  const competitors = competitorRows.map(function (r) {
    return {
      rank: Number(r.rank), name: r.name, norm: r.norm,
      projectCount: Number(r.project_count), awardWan: wan(r.award_fen),
      pct: pct(Number(r.award_fen), Number(award.award)), isSelf: !!r.is_self
    };
  }).slice(0, 10);
  const selfRow = competitorRows.find(function (r) { return r.is_self === 1; });
  const top1 = competitorRows[0];
  let self;
  if (!selfRow) {
    self = { configured: false };
  } else {
    const selfFen = Number(selfRow.award_fen);
    const topFen = top1 ? Number(top1.award_fen) : 0;
    const rank = Number(selfRow.rank);
    self = {
      configured: true,
      inTop10: rank <= 10,
      rank: rank,
      name: selfRow.name,
      projectCount: Number(selfRow.project_count),
      awardWan: wan(selfFen),
      sharePct: pct(selfFen, Number(award.award)),
      isTop1: rank === 1,
      gapWan: rank === 1 ? 0 : wan(topFen - selfFen),
      gapTo: rank === 1 ? '' : (top1 ? top1.name : '')
    };
  }

  // 5) 客户与渠道生态
  const buyers = db.prepare(
    "SELECT buyer_name name, COUNT(*) project_count, COALESCE(SUM(budget_fen),0) budget_fen FROM projects WHERE deleted=0 AND buyer_name <> ''" + yw +
    ' GROUP BY buyer_name ORDER BY budget_fen DESC, name ASC LIMIT 10'
  ).all().map(function (r, i) {
    return { rank: i + 1, name: r.name, count: Number(r.project_count), budgetWan: wan(r.budget_fen) };
  });
  const agencies = db.prepare(
    "SELECT agency_name name, COUNT(*) project_count FROM projects WHERE deleted=0 AND agency_name <> ''" + yw +
    ' GROUP BY agency_name ORDER BY project_count DESC, name ASC LIMIT 10'
  ).all().map(function (r, i) {
    return { rank: i + 1, name: r.name, count: Number(r.project_count) };
  });

  // 6) 地图：region 首段即省/直辖市；同时按第二段汇总「省→市/区县」预算，供地图下钻与右侧榜单联动
  const geo = db.prepare(
    "SELECT CASE WHEN instr(region,'-') > 0 THEN substr(region,1,instr(region,'-')-1) ELSE region END name, " +
    'COALESCE(SUM(budget_fen),0) value FROM projects WHERE deleted=0 AND region <> \'\'' + yw +
    ' GROUP BY name ORDER BY value DESC'
  ).all().map(function (r) { return { name: r.name, value: wan(r.value) }; });

  const cityRows = db.prepare(
    'WITH r AS (' +
    " SELECT CASE WHEN instr(region,'-') > 0 THEN substr(region,1,instr(region,'-')-1) ELSE region END province," +
    " CASE WHEN instr(region,'-') > 0 THEN substr(region,instr(region,'-')+1) ELSE '' END rest, budget_fen" +
    " FROM projects WHERE deleted=0 AND region <> ''" + yw +
    '), c AS (' +
    " SELECT province, CASE WHEN instr(rest,'-') > 0 THEN substr(rest,1,instr(rest,'-')-1) ELSE rest END city, budget_fen" +
    " FROM r WHERE rest <> ''" +
    ')' +
    ' SELECT province, city, COALESCE(SUM(budget_fen),0) fen FROM c GROUP BY province, city ORDER BY fen DESC'
  ).all();
  const cityGeo = {};
  cityRows.forEach(function (r) {
    if (!cityGeo[r.province]) cityGeo[r.province] = [];
    cityGeo[r.province].push({ name: r.city, value: wan(r.fen) });
  });
  Object.keys(cityGeo).forEach(function (p) {
    cityGeo[p].sort(function (a, b) { return b.value - a.value || String(a.name).localeCompare(String(b.name), 'zh-CN'); });
  });

  const years = db.prepare(
    "SELECT DISTINCT substr(created_at,1,4) y FROM projects WHERE deleted=0 AND created_at >= '2000-01-01' ORDER BY y DESC"
  ).all().map(function (r) { return Number(r.y); }).filter(function (y) { return Number.isInteger(y) && y > 2000; });

  return {
    updatedAt: nowText(),
    years: years,
    summary: summary,
    trend: trend,
    types: types,
    competitors: competitors,
    self: self,
    buyers: buyers,
    agencies: agencies,
    geo: geo,
    cityGeo: cityGeo
  };
}

function getGlobalStats(db, options) {
  const opts = options || {};
  const year = opts.year == null || opts.year === '' ? '' : String(opts.year);
  const key = year || 'all';
  const hit = cache.get(key);
  if (!opts.refresh && hit && (Date.now() - hit.at) < TTL) return hit.data;
  const data = computeGlobal(db, year);   // 注意传原始年份（''=全部），不是缓存 key 'all'
  cache.set(key, { at: Date.now(), data: data });
  return data;
}

module.exports = { getGlobalStats, invalidateGlobalCache, computeGlobal, TTL };
