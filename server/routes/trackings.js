/**
 * 项目跟进接口。所有请求（含 GET）均需登录：看板含个人数据，且不向访客开放。
 * 负责人校验在路由层二次执行：仅 owner_user_id === req.user.id 可维护 / 关闭 / 复盘。
 */
const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const T = require('../tracking');

const router = express.Router();
router.use(requireLogin);

function actor(req) { return { id: req.user.id, username: req.user.username }; }

function fail(res, status, message, extra) {
  return res.status(status).json(Object.assign({ ok: false, message: message }, extra || {}));
}

function activeById(id) {
  return db.prepare('SELECT * FROM bid_trackings WHERE id = ? AND is_tracking = 1').get(Number(id));
}

function activeByProject(projectId) {
  return db.prepare('SELECT * FROM bid_trackings WHERE project_id = ? AND is_tracking = 1').get(Number(projectId));
}

function projectById(id) {
  return db.prepare('SELECT row_id, project_no, project_name, status, detail FROM projects WHERE row_id = ? AND deleted = 0')
    .get(Number(id));
}

function projectByTracking(t) {
  return db.prepare('SELECT row_id, project_no, project_name, status, detail FROM projects WHERE row_id = ? AND deleted = 0')
    .get(Number(t.project_id));
}

// GET /api/trackings/summary —— 当前登录人的个人看板（注册在 /:id 之前）
router.get('/summary', (req, res) => {
  const now = T.nowText();
  T.syncActive(db, now);
  res.json({ ok: true, data: T.summary(db, req.user.id, now) });
});

// GET /api/trackings —— 跟进列表；进入时做一次状态自检（只有 derived_key 变化才写库）
router.get('/', (req, res) => {
  const now = T.nowText();
  T.syncActive(db, now);
  res.json({ ok: true, data: T.listRows(db, req.query || {}, req.user.id, now) });
});

// GET /api/trackings/:id —— 跟进详情（含跟进记录与复盘历史）
router.get('/:id', (req, res) => {
  const t = activeById(req.params.id);
  if (!t) return fail(res, 404, '跟进记录不存在或已关闭');
  const row = T.getRow(db, t.id, req.user.id, T.nowText());
  res.json({ ok: true, data: row });
});

// POST /api/trackings/project/:projectId/claim —— 认领；他人已占用返回 409
router.post('/project/:projectId/claim', (req, res) => {
  const project = projectById(req.params.projectId);
  if (!project) return fail(res, 404, '项目不存在');
  const r = T.claim(db, project, actor(req), T.nowText());
  if (r.status === 'conflict') return fail(res, 409, '该项目正由「' + r.owner + '」跟进，无法重复认领');
  if (r.status === 'already') return res.json({ ok: true, data: r.row });
  res.status(201).json({ ok: true, data: r.row });
});

// POST /api/trackings/project/:projectId/release —— 关闭跟进（仅负责人）
router.post('/project/:projectId/release', (req, res) => {
  const project = projectById(req.params.projectId);
  if (!project) return fail(res, 404, '项目不存在');
  const t = activeByProject(project.row_id);
  if (!t) return fail(res, 404, '该项目当前未被跟进');
  if (Number(t.owner_user_id) !== Number(req.user.id)) return fail(res, 403, '只有跟进负责人可以关闭跟进');
  if (!T.release(db, t, project, actor(req), T.nowText())) return fail(res, 409, '跟进状态已变化，请刷新后重试');
  res.json({ ok: true, data: { released: true } });
});

// PUT /api/trackings/:id/internal —— 维护内部动态 / 跟进记录
router.put('/:id/internal', (req, res) => {
  const t = activeById(req.params.id);
  if (!t) return fail(res, 404, '跟进记录不存在或已关闭');
  if (Number(t.owner_user_id) !== Number(req.user.id)) return fail(res, 403, '只有跟进负责人可以维护跟进状态');
  const project = projectByTracking(t);
  if (!project) return fail(res, 404, '项目不存在');
  const now = T.nowText();
  T.syncOne(db, project, t, now);   // 先按当前时间/项目状态对齐，再做人工维护
  const fresh = activeById(t.id);
  const body = req.body || {};
  const r = T.updateInternal(db, fresh, project, {
    internal_status: body.internal_status,
    note: body.note,
    version: body.version,
    operator: req.user.username
  }, now);
  if (r.status !== 200) return fail(res, r.status, r.message, { need_review: !!r.need_review });
  res.json({ ok: true, data: T.getRow(db, t.id, req.user.id, now) });
});

// PUT /api/trackings/:id/stages/:stageKey —— 统一「跟进轨迹」弹窗的单节点复盘/补录
router.put('/:id/stages/:stageKey', (req, res) => {
  const t = activeById(req.params.id);
  if (!t) return fail(res, 404, '跟进记录不存在或已关闭');
  if (Number(t.owner_user_id) !== Number(req.user.id)) return fail(res, 403, '只有跟进负责人可以复盘/补录');
  const project = projectByTracking(t);
  if (!project) return fail(res, 404, '项目不存在');
  const now = T.nowText();
  T.syncOne(db, project, t, now);
  const fresh = activeById(t.id);
  const body = req.body || {};
  const r = T.saveStage(db, fresh, project, req.params.stageKey, {
    internal_status: body.internal_status,
    review_category: body.review_category,
    review_reason: body.review_reason,
    version: body.version,
    operator: req.user.username
  }, now);
  if (r.status !== 200) return fail(res, r.status, r.message);
  res.json({ ok: true, data: T.getRow(db, t.id, req.user.id, now) });
});

// PUT /api/trackings/:id/review —— 旧入口兼容层（按动态定位阶段，委托 saveStage）
router.put('/:id/review', (req, res) => {
  const t = activeById(req.params.id);
  if (!t) return fail(res, 404, '跟进记录不存在或已关闭');
  if (Number(t.owner_user_id) !== Number(req.user.id)) return fail(res, 403, '只有跟进负责人可以填写复盘');
  const project = projectByTracking(t);
  if (!project) return fail(res, 404, '项目不存在');
  const now = T.nowText();
  T.syncOne(db, project, t, now);
  const fresh = activeById(t.id);
  const body = req.body || {};
  const r = T.updateReview(db, fresh, project, {
    internal_status: body.internal_status,
    review_category: body.review_category,
    review_reason: body.review_reason,
    version: body.version,
    operator: req.user.username
  }, now);
  if (r.status !== 200) return fail(res, r.status, r.message);
  res.json({ ok: true, data: T.getRow(db, t.id, req.user.id, now) });
});

module.exports = router;
