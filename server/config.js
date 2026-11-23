/**
 * 第 7 步：业务配置项集中维护（需求 12.1 / 12.2）。
 * 只依赖 ./money（纯模块），不 require ./db，避免 db -> migrate -> config -> db 循环。
 *
 * 约定：
 *  - 启动 seed 只补齐缺失项（INSERT OR IGNORE），绝不覆盖用户已有的停用/排序/倍率调整。
 *  - 选项调整走「停用」（enabled=0），从不物理删除；历史项目 detail 原值不改写、仍可检索。
 *  - 项目状态四态固定不可停用（2.3 状态联动依赖）；金额单位必须保留启用且倍率 1 的「元」。
 */
const { setAmountUnits } = require('./money');

const FIXED_STATUSES = ['意向公示', '正在招标', '终止招标', '完成招标'];
const GROUPS = {
  status: { label: '项目状态', values: FIXED_STATUSES },
  method: { label: '采购方式', values: ['公开招标', '邀请招标', '竞争性谈判', '竞争性磋商', '询价采购', '单一来源'] },
  project_type: { label: '项目类型 / 分包类型', values: ['货物类', '工程类', '服务类'] },
  correction_item: { label: '更正事项（多选）', values: ['采购公告', '采购文件', '采购结果', '其它更正'] },
  doc_way: { label: '获取方式', values: ['线上', '线下'] },
  // 监管地区已改由全国三级行政区划静态数据驱动（client/public/data/regions.json），
  // 不再作为可配置的模拟下拉项；数据库里已有历史配置行保留不动。
  amount_unit: {
    label: '金额单位（倍率）',
    values: [{ value: '元', factor: 1 }, { value: '万元', factor: 10000 }, { value: '亿元', factor: 100000000 }]
  }
};
const GROUP_KEYS = Object.keys(GROUPS);
const GROUP_LABELS = {};
GROUP_KEYS.forEach(function (k) { GROUP_LABELS[k] = GROUPS[k].label; });

function nowText() {
  return new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'Asia/Shanghai', hour12: false });
}
function factorOf(extra) {
  try {
    const e = JSON.parse(extra || '{}');
    const f = Number(e && e.factor);
    return Number.isSafeInteger(f) && f > 0 ? f : null;
  } catch (e) { return null; }
}

/** 启动 seed：只补缺失项，不覆盖已有调整。返回新增条数 */
function seedDefaults(db) {
  const t = nowText();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO config_options (group_key, option_value, sort_no, enabled, extra, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)'
  );
  let added = 0;
  GROUP_KEYS.forEach(function (key) {
    GROUPS[key].values.forEach(function (v, i) {
      const value = typeof v === 'string' ? v : v.value;
      const extra = typeof v === 'string' ? '' : JSON.stringify({ factor: v.factor });
      added += ins.run(key, value, i, extra, t, t).changes;
    });
  });
  return added;
}

function groupRows(db, key, includeDisabled) {
  // 例外：业务配置的 sort_no 是人工指定的展示顺序，不套用「updated_at DESC」默认规范
  const sql = 'SELECT id, option_value, sort_no, enabled, extra FROM config_options WHERE group_key = ?' +
    (includeDisabled ? '' : ' AND enabled = 1') + ' ORDER BY sort_no ASC, id ASC';
  return db.prepare(sql).all(key);
}

/** 启用选项（供录入 / 编辑 / 查询下拉使用） */
function getGroups(db) {
  const out = {};
  GROUP_KEYS.forEach(function (k) { out[k] = groupRows(db, k, false).map(function (r) { return r.option_value; }); });
  return out;
}

/** 全部选项含停用项与倍率（供业务配置维护页） */
function getDetail(db) {
  const out = {};
  GROUP_KEYS.forEach(function (k) {
    out[k] = groupRows(db, k, true).map(function (r) {
      return { value: r.option_value, enabled: !!r.enabled, factor: factorOf(r.extra), sort_no: r.sort_no };
    });
  });
  return out;
}

/** 启用金额单位 -> 倍率映射 */
function amountUnitMap(db) {
  const map = {};
  groupRows(db, 'amount_unit', false).forEach(function (r) {
    const f = factorOf(r.extra);
    if (f) map[r.option_value] = f;
  });
  return map;
}
function syncAmountUnits(db) {
  const map = amountUnitMap(db);
  setAmountUnits(map);       // money.js 模块级映射，保存时立即生效
  return map;
}

/**
 * 整组替换（事务内）：提交项 upsert；未提交的现有项只置 enabled=0，绝不 DELETE。
 * 返回 {error} 或 {ok:true}
 */
function replaceGroup(db, key, items) {
  if (!GROUPS[key]) return { error: '配置分组不存在' };
  if (!Array.isArray(items) || !items.length) return { error: '选项不能为空' };
  const seen = new Set();
  const clean = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const value = String(it.value == null ? '' : it.value).trim();
    if (!value) return { error: '选项内容不能为空' };
    if (seen.has(value)) return { error: '选项重复：' + value };
    seen.add(value);
    let factor = null;
    if (key === 'amount_unit') {
      factor = Number(it.factor);
      if (!Number.isSafeInteger(factor) || factor <= 0) return { error: '金额单位倍率必须是正整数：' + value };
    }
    clean.push({ value: value, enabled: it.enabled === false ? 0 : 1, factor: factor });
  }
  if (key === 'status') {
    const enabled = clean.filter(function (x) { return x.enabled; }).map(function (x) { return x.value; });
    const missing = FIXED_STATUSES.filter(function (s) { return enabled.indexOf(s) < 0; });
    if (missing.length) return { error: '项目状态四个固定值不可停用或删除：' + missing.join('、') };
  }
  if (key === 'amount_unit') {
    const yuan = clean.find(function (x) { return x.value === '元' && x.enabled; });
    if (!yuan || yuan.factor !== 1) return { error: '金额单位必须保留启用「元」且倍率为 1' };
  }
  const t = nowText();
  const run = db.transaction(function () {
    const upsert = db.prepare(
      'INSERT INTO config_options (group_key, option_value, sort_no, enabled, extra, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(group_key, option_value) DO UPDATE SET' +
      '   sort_no = excluded.sort_no, enabled = excluded.enabled, extra = excluded.extra, updated_at = excluded.updated_at'
    );
    clean.forEach(function (x, i) {
      upsert.run(key, x.value, i, x.enabled, x.factor == null ? '' : JSON.stringify({ factor: x.factor }), t, t);
    });
    const holes = clean.map(function () { return '?'; }).join(',');
    db.prepare('UPDATE config_options SET enabled = 0, updated_at = ? WHERE group_key = ? AND option_value NOT IN (' + holes + ')')
      .run(t, key, ...clean.map(function (x) { return x.value; }));
  });
  run();
  syncAmountUnits(db);
  return { ok: true };
}

module.exports = {
  GROUPS, GROUP_KEYS, GROUP_LABELS, FIXED_STATUSES,
  seedDefaults, getGroups, getDetail, amountUnitMap, syncAmountUnits, replaceGroup
};
