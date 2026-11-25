/**
 * 第 5 步：全量表单 detail -> 主表列 + 003 派生列的「唯一」派生入口。
 *
 * 纯函数，不依赖 db / express，被三处共用：
 *   1) POST /api/projects      新增时同步写派生列
 *   2) PUT  /api/projects/:id  编辑时同步写派生列
 *   3) migrate.js 003 backfill 启动时修复历史数据
 * 目的：表单里填过的字段，高级查询一定能搜到；三处永远同一口径，不会漂移。
 *
 * 金额一律以「整数分」落库（防坑 K-1），比较时不再出现浮点。
 */
const { normalizeAmount } = require('./money');

// 003 迁移新增的 7 个派生列 + 012 的公告网址列；顺序即 INSERT / UPDATE / backfill 的取值顺序
const DERIVED_COLUMNS = [
  'bid_end', 'method', 'period_days', 'winner_names',
  'project_types', 'buyer_name', 'agency_name', 'notice_url'
];

function text(v) { return String(v == null ? '' : v).trim(); }

/** 多包总中标金额：BigInt 对齐小数位求和，小数如实保留、不因计算截断 */
function sumYuanText(list) {
  const parts = [];
  let maxDec = 0;
  list.forEach(function (raw) {
    const s = text(raw).replace(/,/g, '');
    if (!s || !/^\d+(\.\d+)?$/.test(s)) return; // 非法值由调用方先拦截
    const p = s.split('.');
    const dec = p[1] || '';
    maxDec = Math.max(maxDec, dec.length);
    parts.push({ int: p[0], dec: dec });
  });
  if (!parts.length) return '';
  const scale = 10n ** BigInt(maxDec);
  let total = 0n;
  parts.forEach(function (p) {
    total += BigInt(p.int) * scale + BigInt(p.dec || '0') * (10n ** BigInt(maxDec - p.dec.length));
  });
  const intPart = total / scale;
  const rem = total % scale;
  if (rem === 0n) return intPart.toString();
  return intPart.toString() + '.' + rem.toString().padStart(maxDec, '0').replace(/0+$/, '');
}

// 四类金额统一走 normalizeAmount：带单位输入先精确换算成「元」再落库，
// 纯数字默认「元」。后端是权威口径，前端 blur 规范化只是提前可见。
function moneyFen(raw, label) {
  const s = text(raw).replace(/,/g, '');
  if (s === '') return { yuan: '', fen: 0 };
  const a = normalizeAmount(s);
  if (!a) return { error: label + '格式不正确，请只填数字或带 元 / 万元 / 亿元' };
  return { yuan: a.yuan, fen: a.fen };
}

/** 投标截止时间：detail.bidding.bidEnd 可能是「年-月-日 时:分:秒」，列表按年月日展示 */
function bidEnd(d) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text(d.bidding.bidEnd));
  return m ? m[1] : '';
}

/** 项目类型：单包取 completed.type；分包取各包类型按出现顺序去重，逗号分隔 */
function projectTypes(c) {
  const list = [];
  if (c.isSplit) {
    (c.packages || []).forEach(function (p) { const s = text(p.type); if (s) list.push(s); });
  } else {
    const s = text(c.type);
    if (s) list.push(s);
  }
  return list.filter(function (x, i) { return list.indexOf(x) === i; }).join(',');
}

/** 当前状态对应的公告网址：意向/招标/终止/完成各取自己的 URL，状态切换后立即生效 */
function noticeUrl(d) {
  const status = text(d.public && d.public.status);
  if (status === '意向公示') return text(d.intention && d.intention.url);
  if (status === '正在招标') return text(d.bidding && d.bidding.url);
  if (status === '终止招标') return text(d.terminated && d.terminated.url);
  if (status === '完成招标') return text(d.completed && d.completed.url);
  return '';
}

/** 中标单位：总/分包全覆盖，牵头在前、成员随后、按包顺序；去空，逗号后不加空格 */
function winnerNames(c) {
  const list = [];
  function pushWinner(w) {
    if (!w) return;
    const lead = text(w.lead);
    if (lead) list.push(lead);
    if (w.isUnion) {
      (w.members || []).forEach(function (m) { const s = text(m); if (s) list.push(s); });
    }
  }
  if (c.isSplit) (c.packages || []).forEach(function (p) { pushWinner(p.winner); });
  else pushWinner(c.winner);
  return list.join(',');
}

/**
 * 把 detail 内四类金额就地规范化成「元」文本，使主表列与 detail 完全同源。
 * 放在 deriveFromDetail 之前调用；非法值保留原样，由 deriveFromDetail 统一报错。
 * 这样编辑回显看到的就是换算后的纯数字元值，不再出现「主表是元、detail 却带万元」的歧义。
 */
function normalizeDetailAmounts(d) {
  function apply(raw) {
    const s = text(raw).replace(/,/g, '');
    if (!s) return '';
    const a = normalizeAmount(s);
    return a ? a.yuan : s;
  }
  d.public.budget_yuan = apply(d.public.budget_yuan);
  d.public.ceiling_yuan = apply(d.public.ceiling_yuan);
  const c = d.completed;
  if (c.isSplit) (c.packages || []).forEach(function (p) { p.amount_yuan = apply(p.amount_yuan); });
  else c.amount_yuan = apply(c.amount_yuan);
  return d;
}

/**
 * @param {object} d 已由 mergeDetail 归一化的完整表单
 * @returns {{error:string}|{values:object}} values 含全部主表列 + 7 个派生列（不含 detail 字符串）
 */
function deriveFromDetail(d) {
  const p = d.public;
  const c = d.completed;

  const budget = moneyFen(p.budget_yuan, '项目预算');
  if (budget.error) return { error: budget.error };
  const ceiling = moneyFen(p.ceiling_yuan, '最高限价');
  if (ceiling.error) return { error: ceiling.error };

  let awardYuan;
  if (c.isSplit) {
    const parts = [];
    for (let i = 0; i < (c.packages || []).length; i++) {
      const raw = text(c.packages[i].amount_yuan).replace(/,/g, '');
      if (!raw) continue;
      const a = normalizeAmount(raw);
      if (!a) return { error: '分包中标金额格式不正确，请只填数字或带 元 / 万元 / 亿元' };
      parts.push(a.yuan); // 各包先换算成「元」，再精确求和
    }
    awardYuan = sumYuanText(parts); // 分包总金额：参与查询与展示
  } else {
    awardYuan = text(c.amount_yuan).replace(/,/g, '');
  }
  const award = moneyFen(awardYuan, '中标金额');
  if (award.error) return { error: award.error };

  return {
    values: {
      project_no: text(p.project_no),
      project_name: text(p.project_name),
      region: text(p.region),
      status: text(p.status) || '意向公示',
      budget_yuan: budget.yuan || '0',
      budget_fen: budget.fen,
      ceiling_yuan: ceiling.yuan || '0',
      ceiling_fen: ceiling.fen,
      award_amount_yuan: award.yuan || '0',
      award_amount_fen: award.fen,
      award_time: text(c.winDate),

      bid_end: bidEnd(d),
      method: text(d.bidding.method),
      period_days: text(d.bidding.periodDays),
      winner_names: winnerNames(c),
      project_types: projectTypes(c),
      buyer_name: text(d.buyer.name),
      agency_name: text(d.agency.name),
      notice_url: noticeUrl(d)
    }
  };
}

module.exports = { DERIVED_COLUMNS, deriveFromDetail, normalizeDetailAmounts, sumYuanText, projectTypes, winnerNames, noticeUrl };
