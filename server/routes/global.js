const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const { getGlobalStats } = require('../globalStats');

const router = express.Router();

// 系统级战略驾驶舱仅登录用户可见（普通用户 / 管理员）
router.use(requireLogin);

// GET /api/global/stats?year=&refresh=1 —— 全部聚合在 SQL 内完成，结果 5 分钟内存缓存
router.get('/stats', (req, res) => {
  try {
    const data = getGlobalStats(db, {
      year: req.query && req.query.year,
      refresh: String((req.query && req.query.refresh) || '') === '1'
    });
    res.json({ ok: true, data: data });
  } catch (e) {
    console.error('[GLOBAL STATS]', e && e.message ? e.message : e);
    res.status(500).json({ ok: false, message: '全局看板数据汇总失败' });
  }
});

module.exports = router;
