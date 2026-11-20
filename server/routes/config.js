const express = require('express');
const { db } = require('../db');
const C = require('../config');
const { writeLog } = require('../operation');
const { invalidateGlobalCache } = require('../globalStats');

const router = express.Router();

// GET /api/config/options —— 启用选项（录入/查询用）+ 全部含停用项（维护页用）+ 金额单位倍率
router.get('/options', (req, res) => {
  res.json({
    ok: true,
    data: {
      groups: C.getGroups(db),
      detail: C.getDetail(db),
      amountUnits: C.amountUnitMap(db),
      labels: C.GROUP_LABELS,
      keys: C.GROUP_KEYS,
      fixedStatuses: C.FIXED_STATUSES
    }
  });
});

// PUT /api/config/options/:group —— 整组替换；未提交项停用而非删除；成功后立即刷新金额单位倍率
router.put('/options/:group', (req, res) => {
  const key = String((req.params && req.params.group) || '');
  if (C.GROUP_KEYS.indexOf(key) < 0) {
    return res.status(400).json({ ok: false, message: '配置分组不存在' });
  }
  const r = C.replaceGroup(db, key, req.body && req.body.items);
  if (r.error) return res.status(400).json({ ok: false, message: r.error });
  writeLog(db, {
    project_no: 'system_config',
    project_name: '业务配置：' + (C.GROUP_LABELS[key] || key),
    op_type: '系统设置',
    operator: req.user && req.user.username,
    summary: '保存选项 ' + ((req.body && req.body.items || []).length) + ' 项，未提交项已停用'
  });
  invalidateGlobalCache();   // 类型选项可能影响全局看板类型分布
  res.json({
    ok: true,
    data: {
      groups: C.getGroups(db),
      detail: C.getDetail(db),
      amountUnits: C.amountUnitMap(db)
    }
  });
});

module.exports = router;
