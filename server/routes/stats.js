const express = require('express');
const { db } = require('../db');
const { computeStats } = require('../stats');

const router = express.Router();

// GET /api/archives/:type/:id/stats —— 参与项目数据看板（只读聚合）
router.get('/:type/:id/stats', (req, res) => {
  const type = String((req.params && req.params.type) || '');
  const year = (req.query && req.query.year != null) ? String(req.query.year) : null;
  const result = computeStats(db, type, req.params.id, year);
  if (result.error) {
    const status = result.notFound ? 404 : 400;
    return res.status(status).json({ ok: false, message: result.error });
  }
  res.json({ ok: true, data: result });
});

module.exports = router;
