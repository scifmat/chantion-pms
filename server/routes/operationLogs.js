const express = require('express');
const { db } = require('../db');
const { listLogs, listOpTypes } = require('../operation');

const router = express.Router();

// 仅管理员可见系统设置类记录（用户管理 / Logo / 配置）；普通用户与访客一律过滤
function isAdmin(req) { return !!(req.user && req.user.role === 'admin'); }

// GET /api/operation-logs/types —— 操作类型下拉全集（含「删除项目」，系统设置仅管理员追加且在末位）
router.get('/types', (req, res) => {
  res.json({ ok: true, data: listOpTypes(isAdmin(req)) });
});

// GET /api/operation-logs —— 只读列表（事件级），支持操作类型 / 编号 / 关键字 / 时间区间
router.get('/', (req, res) => {
  res.json({ ok: true, data: listLogs(db, req.query || {}, { includeSystem: isAdmin(req) }) });
});

module.exports = router;
