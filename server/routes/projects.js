const express = require('express');
const { db, nowText } = require('../db');
const { buildHomeWhere, buildAdvancedWhere, ADV_COLUMNS } = require('../queryBuilder');
const { mergeDetail } = require('../detail');
const { deriveFromDetail, normalizeDetailAmounts } = require('../derive');
const { upsertArchives } = require('../archive');
const { writeLog, OPERATOR } = require('../operation');
const { replaceProjectWinners } = require('../winners');
const { invalidateGlobalCache } = require('../globalStats');

const router = express.Router();
const STATUSES = ['意向公示', '正在招标', '终止招标', '完成招标'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
const URL_RE = /^(https?):\/\/([^\/\s]+)(\/\S*)?$/i;
const SHORT_HOSTS = /^(bit\.ly|t\.cn|dwz\.cn|sina\.lt|is\.gd|tinyurl\.com|goo\.gl|tiny\.cc|url\.cn|suo\.im|m\.rw\.com)/i;

function urlOk(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return true;
  const m = URL_RE.exec(s);
  if (!m) return false;
  const host = m[2].toLowerCase().replace(/^www\./, '');
  return /^https?$/i.test(m[1]) && host.includes('.') && !SHORT_HOSTS.test(host);
}
function normPkg(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase()
    .replace(/[\uff01-\uff5e]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); });
}

// 列表只取展示/查询用的派生列，不传大 JSON；单条回显才带 detail
const LIST_COLUMNS = 'row_id, project_no, project_name, budget_yuan, budget_fen, region, status, created_at, updated_at, version, award_amount_yuan, award_amount_fen, award_time, ceiling_yuan, ceiling_fen, notice_url';
const FULL_COLUMNS = LIST_COLUMNS + ', detail';

function withDetail(row) {
  let parsed = {};
  try { parsed = JSON.parse(row.detail || '{}'); } catch (e) { parsed = {}; }
  // 兼容第 1/2 步录入的旧数据：它们没有 detail，编辑回显时用主表派生列回填，
  // 否则弹窗会显示空表单，保存时反而会把已有值清空。
  if (!parsed || !parsed.public) {
    parsed = {
      public: {
        status: row.status, region: row.region, project_no: row.project_no, project_name: row.project_name,
        budget_yuan: row.budget_yuan, ceiling_yuan: row.ceiling_yuan || '0'
      },
      completed: { amount_yuan: row.award_amount_yuan, winDate: row.award_time }
    };
  }
  return Object.assign({}, row, { detail: mergeDetail(parsed) });
}

function getPath(o, p) {
  return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o);
}

// 1.6 节基础必填：本轮只校验 6 项公共必填（服务端二次校验，K-9）
const REQUIRED_FIELDS = [
  ['public.status', '项目状态'], ['public.region', '监管地区'], ['public.project_no', '项目编号'],
  ['public.project_name', '项目名称'], ['buyer.name', '单位名称'], ['agency.name', '机构名称']
];

function validateBusiness(d) {
  const errors = {};
  const urls = [
    ['intention.url', d.intention.url], ['bidding.url', d.bidding.url],
    ['terminated.url', d.terminated.url], ['completed.url', d.completed.url]
  ];
  d.corrections.forEach(function (c, i) { urls.push(['corrections.' + i + '.url', c.url]); });
  urls.forEach(function (pair) { if (!urlOk(pair[1])) errors[pair[0]] = '网址格式不正确'; });
  const dates = [
    ['intention.startDate', d.intention.startDate], ['intention.endDate', d.intention.endDate],
    ['bidding.docStart', d.bidding.docStart], ['bidding.docEnd', d.bidding.docEnd],
    ['bidding.bidStart', d.bidding.bidStart], ['bidding.bidEnd', d.bidding.bidEnd]
  ];
  d.corrections.forEach(function (c, i) { dates.push(['corrections.' + i + '.date', c.date]); });
  dates.forEach(function (pair) {
    const v = String(pair[1] == null ? '' : pair[1]).trim();
    if (v && !(DATE_RE.test(v) || DATE_TIME_RE.test(v))) errors[pair[0]] = '日期格式不正确';
  });
  [['intention.startDate', 'intention.endDate'], ['bidding.docStart', 'bidding.docEnd'], ['bidding.bidStart', 'bidding.bidEnd']].forEach(function (pair) {
    const a = String(getPath(d, pair[0]) == null ? '' : getPath(d, pair[0])).trim();
    const b = String(getPath(d, pair[1]) == null ? '' : getPath(d, pair[1])).trim();
    if (a && b && b < a) errors[pair[1]] = '结束时间不能早于开始时间';
  });
  const c = d.completed;
  if (!c.isSplit && c.winner.isUnion && !String(c.winner.lead).trim()) errors['completed.winner.lead'] = '请输入牵头单位';
  if (c.isSplit) {
    const names = c.packages.map(function (x) { return normPkg(x.name); }).filter(Boolean);
    c.packages.forEach(function (x, i) {
      if (x.name && names.filter(function (n) { return n === normPkg(x.name); }).length > 1) errors['completed.packages.' + i + '.name'] = '包号/包名重复';
      if (x.winner && x.winner.isUnion && !String(x.winner.lead).trim()) errors['completed.packages.' + i + '.winner.lead'] = '请输入牵头单位';
    });
  }
  return errors;
}

// 新增与编辑共用这一处：deriveFromDetail 同时产出主表列与 003 派生列，绝不出现两份口径
function buildSave(body) {
  const d = mergeDetail(body && body.detail);
  const missing = REQUIRED_FIELDS.filter(function (pair) {
    return !String(getPath(d, pair[0]) == null ? '' : getPath(d, pair[0])).trim();
  });
  if (missing.length) {
    return { error: '必填项未完成：' + missing.map(function (x) { return x[1]; }).join('、'), fields: missing.map(function (x) { return x[0]; }) };
  }
  const bizErrors = validateBusiness(d);
  if (Object.keys(bizErrors).length) {
    return { error: '校验未通过：' + Object.keys(bizErrors).map(function (k) { return bizErrors[k]; }).join('、'), fields: Object.keys(bizErrors) };
  }
  // 四类金额先统一换算成「元」写回 detail，再派生主表列：
  // 主表 budget_yuan / *_fen 与 detail.public.budget_yuan 从此完全同源，编辑回显无歧义。
  normalizeDetailAmounts(d);
  const r = deriveFromDetail(d);
  if (r.error) return { error: r.error };
  const v = Object.assign({}, r.values, { detail: JSON.stringify(d) });
  if (!STATUSES.includes(v.status)) return { error: '项目状态不在可选范围内' };
  return { values: v, detail: d };
}

function constraintError(err) {
  return String(err.code || '').indexOf('CONSTRAINT') >= 0;
}

/* ---------- 接口 ---------- */

// GET /api/projects —— 首页列表 + 5 个可选查询参数（条件之间为「且」）
// 条件构造器已抽到 ../queryBuilder.buildHomeWhere，与首页导出共用同一份 5 条件口径，零漂移。
router.get('/', (req, res) => {
  const { where, args } = buildHomeWhere(req.query || {});
  // 全局默认排序：最近更新在前；同一秒内多次保存用 version 决定先后（version 每次编辑 +1）
  const sql = 'SELECT ' + LIST_COLUMNS + ' FROM projects' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY updated_at DESC, version DESC, row_id DESC';
  res.json({ ok: true, data: db.prepare(sql).all(...args) });
});

// GET /api/projects/check-no —— 即时查重（编辑时 excludeId 排除自身）
// 放在 /:id 之前注册，避免被当成 id；事务内一次性快照读（WAL 下只读已提交数据），
// 且 project_no 唯一约束作为最终保障，避免并发时「提示不重复但保存被拒」。
router.get('/check-no', (req, res) => {
  const no = String(req.query.no || '').trim();
  const excludeId = Number(req.query.excludeId) || 0;
  if (!no) return res.json({ ok: true, data: { exists: false } });
  const row = db.transaction(function () {
    return db.prepare('SELECT row_id FROM projects WHERE project_no = ? AND row_id <> ? LIMIT 1').get(no, excludeId);
  })();
  res.json({ ok: true, data: { exists: !!row } });
});

// GET /api/projects/advanced —— 高级查询 14 列联合查询（必须注册在 /:id 之前）
// 条件构造器已抽到 ../queryBuilder，与 Excel 导出共用同一份 14 条件口径，零漂移。
router.get('/advanced', (req, res) => {
  const { where, args } = buildAdvancedWhere(req.query || {});
  // 与首页列表同口径：updated_at 倒序，最近更新的项目排在最前
  const sql = 'SELECT ' + ADV_COLUMNS + ' FROM projects' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY updated_at DESC, version DESC, row_id DESC';
  res.json({ ok: true, data: db.prepare(sql).all(...args) });
});

// GET /api/projects/:id —— 编辑回显，返回完整表单（含 detail 解析结果）
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT ' + FULL_COLUMNS + ' FROM projects WHERE row_id = ? AND deleted = 0').get(Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, message: '项目不存在' });
  res.json({ ok: true, data: withDetail(row) });
});

// POST /api/projects —— 新增（全量表单）；主表列与 003 派生列在同一次 INSERT 中写入
router.post('/', (req, res) => {
  const s = buildSave(req.body);
  if (s.error) return res.status(400).json({ ok: false, message: s.error, fields: s.fields || [] });
  const v = s.values;
  const t = nowText();
  try {
    // 项目与独立信息档案在同一次事务中写入：保存成功即建档，不会出现「项目存了、档案没存」
    const rowId = db.transaction(function () {
      const info = db.prepare(
        `INSERT INTO projects
          (project_no, project_name, budget_yuan, budget_fen, ceiling_yuan, ceiling_fen, region, status,
           award_amount_yuan, award_amount_fen, award_time, detail, created_at, updated_at, version,
           bid_end, method, period_days, winner_names, project_types, buyer_name, agency_name, notice_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(v.project_no, v.project_name, v.budget_yuan, v.budget_fen, v.ceiling_yuan, v.ceiling_fen,
        v.region, v.status, v.award_amount_yuan, v.award_amount_fen, v.award_time, v.detail, t, t,
        v.bid_end, v.method, v.period_days, v.winner_names, v.project_types, v.buyer_name, v.agency_name, v.notice_url);
      upsertArchives(db, s.detail, v.project_no);
      // 同一事务维护 winner 映射：项目与聚合来源不会出现脱节
      replaceProjectWinners(db, v.project_no, s.detail, v.award_amount_fen);
      // 与 INSERT 同一事务：不会出现「项目存了、操作记录没写」
      writeLog(db, {
        project_no: v.project_no, project_name: v.project_name,
        op_type: '新增项目', summary: '新增项目「' + v.project_name + '」（' + v.project_no + '）',
        operator: (req.user && req.user.username) || OPERATOR, created_at: t
      });
      return info.lastInsertRowid;
    })();
    const row = db.prepare('SELECT ' + FULL_COLUMNS + ' FROM projects WHERE row_id = ?').get(rowId);
    invalidateGlobalCache();
    res.status(201).json({ ok: true, data: withDetail(row) });
  } catch (err) {
    if (constraintError(err)) return res.status(409).json({ ok: false, message: '项目编号已存在' });
    throw err;
  }
});

// PUT /api/projects/:id —— 保存编辑；version 乐观锁防覆盖（防坑 K-3）
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const version = Number(req.body && req.body.version);
  if (!Number.isInteger(version)) {
    return res.status(400).json({ ok: false, message: '缺少版本号，请刷新后重试' });
  }
  const s = buildSave(req.body);
  if (s.error) return res.status(400).json({ ok: false, message: s.error, fields: s.fields || [] });
  const v = s.values;
  const t = nowText();
  try {
    // 事务扩展点：整份 detail（含状态互斥清空的 operationLog）在一次事务中写入；
    // 后续做操作记录页时，可在此事务内同时写独立操作记录表，结构无需改动。
    const result = db.transaction(function () {
      const cur = db.prepare('SELECT version, detail, project_no FROM projects WHERE row_id = ? AND deleted = 0').get(id);
      if (!cur) return { notFound: true };
      if (cur.version !== version) return { conflict: true };
      const r = db.prepare(
        `UPDATE projects SET
           project_no = ?, project_name = ?, budget_yuan = ?, budget_fen = ?, ceiling_yuan = ?, ceiling_fen = ?,
           region = ?, status = ?, award_amount_yuan = ?, award_amount_fen = ?, award_time = ?,
           detail = ?, updated_at = ?, version = version + 1,
           bid_end = ?, method = ?, period_days = ?, winner_names = ?,
           project_types = ?, buyer_name = ?, agency_name = ?, notice_url = ?
         WHERE row_id = ? AND version = ? AND deleted = 0`
      ).run(v.project_no, v.project_name, v.budget_yuan, v.budget_fen, v.ceiling_yuan, v.ceiling_fen,
        v.region, v.status, v.award_amount_yuan, v.award_amount_fen, v.award_time,
        v.detail, t,
        v.bid_end, v.method, v.period_days, v.winner_names, v.project_types, v.buyer_name, v.agency_name, v.notice_url,
        id, version);
      if (!r.changes) return { changes: 0 };
      // 与项目更新同一事务：编辑后档案立即反映最新名称，version 乐观锁逻辑不变
      upsertArchives(db, s.detail, v.project_no);
      // 编号可能改变：先清旧编号的映射，再按新编号重建，保证与 projects 绝对同步
      db.prepare('DELETE FROM project_winners WHERE project_no = ?').run(cur.project_no);
      replaceProjectWinners(db, v.project_no, s.detail, v.award_amount_fen);
      // 把本轮新增的状态互斥清空事件写成独立留痕（只写差量，避免每次编辑重复记录）
      let oldLogs = [];
      try {
        const oldDetail = JSON.parse(cur.detail || '{}');
        if (Array.isArray(oldDetail.operationLog)) oldLogs = oldDetail.operationLog;
      } catch (e) { oldLogs = []; }
      const newLogs = Array.isArray(s.detail.operationLog) ? s.detail.operationLog : [];
      newLogs.slice(oldLogs.length).forEach(function (item) {
        const from = String((item && item.from) || '');
        const to = String((item && item.to) || '');
        const cleared = String((item && item.cleared) || '');
        const stage = cleared === 'completed' ? '完成招标' : cleared === 'terminated' ? '终止招标' : '';
        writeLog(db, {
          project_no: v.project_no, project_name: v.project_name,
          op_type: String((item && item.type) || '状态切换清空'),
          summary: '项目状态由「' + from + '」切换为「' + to + '」' + (stage ? '，清空「' + stage + '」信息' : ''),
          operator: (req.user && req.user.username) || OPERATOR, created_at: String((item && item.time) || t)
        });
      });
      writeLog(db, {
        project_no: v.project_no, project_name: v.project_name,
        op_type: '编辑项目', summary: '编辑项目「' + v.project_name + '」（' + v.project_no + '）',
        operator: (req.user && req.user.username) || OPERATOR, created_at: t
      });
      return { changes: r.changes };
    })();
    if (result.notFound) return res.status(404).json({ ok: false, message: '项目不存在' });
    if (result.conflict || result.changes === 0) {
      return res.status(409).json({ ok: false, message: '数据已被他人修改，请刷新后重试' });
    }
    const row = db.prepare('SELECT ' + FULL_COLUMNS + ' FROM projects WHERE row_id = ?').get(id);
    invalidateGlobalCache();
    res.json({ ok: true, data: withDetail(row) });
  } catch (err) {
    if (constraintError(err)) return res.status(409).json({ ok: false, message: '项目编号已存在' });
    throw err;
  }
});

// DELETE /api/projects/:id —— 软删除（deleted=1）；与操作记录在同一事务内，version 乐观锁防并发覆盖
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const version = Number(req.body && req.body.version);
  if (!Number.isInteger(version)) {
    return res.status(400).json({ ok: false, message: '缺少版本号，请刷新后重试' });
  }
  const t = nowText();
  try {
    const result = db.transaction(function () {
      const cur = db.prepare('SELECT version, project_no, project_name FROM projects WHERE row_id = ? AND deleted = 0').get(id);
      if (!cur) return { notFound: true };
      if (cur.version !== version) return { conflict: true };
      // 释放原编号：软删除行不再占用 project_no UNIQUE，删除后可重新使用同一编号；
      // 原行仍完整保留（deleted=1），操作记录里存的是删除前的原编号，可追溯。
      const r = db.prepare(
        'UPDATE projects SET deleted = 1, deleted_at = ?, project_no = ?, updated_at = ?, version = version + 1 WHERE row_id = ? AND version = ? AND deleted = 0'
      ).run(t, cur.project_no + '__DEL_' + id, t, id, version);
      if (!r.changes) return { changes: 0 };
      // 软删除同时清理映射：即使编号日后被复用，也不会残留旧聚合行
      db.prepare('DELETE FROM project_winners WHERE project_no = ?').run(cur.project_no);
      writeLog(db, {
        project_no: cur.project_no, project_name: cur.project_name,
        op_type: '删除项目',
        summary: '删除项目「' + cur.project_name + '」（' + cur.project_no + '），移入回收站，可在回收站恢复',
        operator: (req.user && req.user.username) || OPERATOR, created_at: t
      });
      return { changes: r.changes };
    })();
    if (result.notFound) return res.status(404).json({ ok: false, message: '项目不存在' });
    if (result.conflict || result.changes === 0) {
      return res.status(409).json({ ok: false, message: '数据已被他人修改，请刷新后重试' });
    }
    invalidateGlobalCache();
    res.json({ ok: true, data: { deleted: true } });
  } catch (err) {
    if (constraintError(err)) return res.status(409).json({ ok: false, message: '项目编号已存在' });
    throw err;
  }
});

module.exports = router;
