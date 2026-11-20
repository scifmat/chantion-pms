const express = require('express');
const { db } = require('../db');
const { getSettings, updateSettings, setLogo, resetLogo, readLogo } = require('../settings');
const { requireAdmin } = require('../auth');
const { writeLog } = require('../operation');
const { invalidateGlobalCache } = require('../globalStats');

const router = express.Router();

// GET 公开：访客也要看到左上角系统名称 / 所属企业
router.get('/settings', (req, res) => {
  res.json({ ok: true, data: getSettings(db) });
});

// PUT 管理员：写操作除全局 guardWrite 外再做一次路由级防御
router.put('/settings', requireAdmin, (req, res) => {
  const r = updateSettings(db, req.body);
  if (r.error) return res.status(400).json({ ok: false, message: r.error });
  writeLog(db, {
    project_no: 'system_settings',
    project_name: '更新系统设置',
    op_type: '系统设置',
    operator: req.user && req.user.username,
    summary: '系统名称：' + r.data.systemName + '；所属企业：' + (r.data.selfCompetitorName || '未设置')
  });
  invalidateGlobalCache();   // 本企业名称/系统名变更会影响本企业战力卡
  res.json({ ok: true, data: r.data });
});

// GET /api/system/logo —— 自定义 Logo（公开，客户端收到 404 时回退内置 SVG）
router.get('/logo', (req, res) => {
  const logo = readLogo(db);
  if (!logo) return res.status(404).json({ ok: false, message: '尚未设置自定义 Logo' });
  res.set('Content-Type', logo.mime);
  res.set('Cache-Control', 'no-store');
  res.send(logo.buffer);
});

// PUT /api/system/logo —— 管理员上传（body: { dataUrl }）
router.put('/logo', requireAdmin, (req, res) => {
  const r = setLogo(db, req.body && req.body.dataUrl);
  if (r.error) return res.status(400).json({ ok: false, message: r.error });
  writeLog(db, {
    project_no: 'system_logo', project_name: '更换系统 Logo', op_type: '系统设置',
    operator: req.user && req.user.username, summary: '上传并启用新的系统 Logo'
  });
  invalidateGlobalCache();   // 本企业名称/系统名变更会影响本企业战力卡
  res.json({ ok: true, data: r.data });
});

// DELETE /api/system/logo —— 恢复内置 Logo
router.delete('/logo', requireAdmin, (req, res) => {
  const r = resetLogo(db);
  if (r.error) return res.status(400).json({ ok: false, message: r.error });
  writeLog(db, {
    project_no: 'system_logo', project_name: '恢复默认 Logo', op_type: '系统设置',
    operator: req.user && req.user.username, summary: '已恢复系统内置 Logo'
  });
  invalidateGlobalCache();   // 本企业名称/系统名变更会影响本企业战力卡
  res.json({ ok: true, data: r.data });
});

module.exports = router;
