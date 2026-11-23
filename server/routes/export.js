/**
 * 通用 Excel 导出底座（路由层）。
 *
 * 接口：
 *   GET  /api/export/fields —— 字段字典下发（前端渲染勾选框，只暴露展示元数据）
 *   POST /api/export/excel  —— 按查询条件 + 勾选字段生成 Excel 并流式下载
 *
 * 设计要点：
 *   - 权限：挂在全局 attachUser + guardWrite 之后，POST 未登录会被 401（requireLogin 二次防御）
 *   - 零漂移：WHERE 条件复用 ../queryBuilder 的 buildHomeWhere / buildAdvancedWhere，与各列表查询逐字一致
 *   - 防 OOM：SQL LIMIT 5001 多取一行判断是否截断；exceljs 流式 write 到 res，不攒大 Buffer
 *   - 扩展点：queryType 支持 'home' 与 'advanced'；两类共用同一底座，仅构造器/列集/默认字段不同
 */
const express = require('express');
const { db } = require('../db');
const { requireLogin } = require('../auth');
const { buildHomeWhere, buildAdvancedWhere } = require('../queryBuilder');
const { dictionary, FIELD_MAP, cellValue, rowDetail, selectColumns } = require('../export/fields');
const { buildWorkbook } = require('../export/workbook');

const router = express.Router();

const MAX_ROWS = 5000;          // 单次最大导出行数（防 OOM）

// 字段字典下发：GET 公开（不含敏感信息），前端按 queryType 拉取（home 会附带默认勾选的 7 个核心字段）
router.get('/fields', (req, res) => {
  res.json({ ok: true, data: dictionary(req.query && req.query.queryType) });
});

// POST 导出：全局 guardWrite 已拦未登录请求，这里再挂 requireLogin 做路由级二次防御
router.post('/excel', requireLogin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const queryType = String(body.queryType || 'advanced');
    // 构造器 + 列集按 queryType 选择；两类共用同一底座，条件口径与各自列表查询完全一致
    const QUERIES = {
      home: { buildWhere: buildHomeWhere },
      advanced: { buildWhere: buildAdvancedWhere }
    };
    const spec = QUERIES[queryType];
    if (!spec) {
      return res.status(400).json({ ok: false, message: '不支持的导出类型：' + queryType });
    }

    // 字段白名单校验：过滤掉非法 key，保持用户勾选顺序
    const requested = Array.isArray(body.fields) ? body.fields : [];
    const fields = [];
    const seen = {};
    requested.forEach(function (k) {
      const key = String(k);
      if (FIELD_MAP[key] && !seen[key]) { seen[key] = 1; fields.push(FIELD_MAP[key]); }
    });
    if (!fields.length) {
      return res.status(400).json({ ok: false, message: '请至少选择一个有效的导出字段' });
    }

    const conditions = (body.conditions && typeof body.conditions === 'object' && !Array.isArray(body.conditions))
      ? body.conditions : {};
    const { where, args } = spec.buildWhere(conditions);
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

    // 精确匹配总数（用于截断提示）
    const matched = db.prepare('SELECT COUNT(*) AS c FROM projects' + whereSql).get(...args).c;

    // 取数列集由字段字典自动派生，与 cellValue 同源，杜绝「字典有字段但 SELECT 漏列 → 空列」；
    // 有 detail 字段时带上 detail JSON（复杂字段扁平化需要），多取 1 行判断是否截断
    const needDetail = fields.some(function (f) { return f.source === 'detail'; });
    const columns = selectColumns(needDetail);
    // 导出也属于列表：与页面同口径按最近更新在前，截断时保留的也是最新更新的记录
    const sql = 'SELECT ' + columns + ' FROM projects' + whereSql +
      ' ORDER BY updated_at DESC, version DESC, row_id DESC LIMIT ' + (MAX_ROWS + 1);
    const rows = db.prepare(sql).all(...args);

    const truncated = rows.length > MAX_ROWS;
    const data = truncated ? rows.slice(0, MAX_ROWS) : rows;

    // 扁平化：把每行按勾选字段转成单元格二维数组
    const table = data.map(function (row) {
      const detail = needDetail ? rowDetail(row) : {};
      return fields.map(function (f) { return cellValue(f.key, row, detail); });
    });
    const headers = fields.map(function (f) { return { key: f.key, label: f.label }; });

    const wb = await buildWorkbook(headers, table, { sheetName: '导出数据' });

    // 文件名：中文走 RFC5987 编码
    const rawName = String(body.filename || '导出数据').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '导出数据';
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = rawName + '_' + stamp + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
    res.setHeader('X-Export-Truncated', truncated ? '1' : '0');
    res.setHeader('X-Export-Matched', String(matched));
    res.setHeader('X-Export-Rows', String(table.length));
    res.setHeader('Cache-Control', 'no-store');

    // 流式输出：不攒大 Buffer（防 OOM）
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
