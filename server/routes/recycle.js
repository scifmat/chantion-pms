/**
 * 回收站（011）：项目 / 采购单位 / 代理机构 / 竞争对手统一软删除管理。
 * - 删除入口只负责“移入回收站”，真正物理销毁只在本路由的彻底删除中发生。
 * - 恢复项目会重建 project_winners 并清全局看板缓存；恢复档案不会改写项目详情快照。
 */
const express = require('express');
const { db, nowText } = require('../db');
const { requireAdmin } = require('../auth');
const { TABLES, normName, countReferences } = require('../archive');
const { writeLog } = require('../operation');
const { replaceProjectWinners } = require('../winners');
const { invalidateGlobalCache } = require('../globalStats');
const T = require('../tracking');

const router = express.Router();

const TYPES = {
  project: { label: '项目', table: 'projects' },
  buyer: Object.assign({ key: 'buyer' }, TABLES.buyer),
  agency: Object.assign({ key: 'agency' }, TABLES.agency),
  competitor: Object.assign({ key: 'competitor' }, TABLES.competitor)
};
const ARCHIVE_TYPES = ['buyer', 'agency', 'competitor'];

function configOf(type) {
  const key = String(type || '').trim();
  return TYPES[key] ? Object.assign({ key: key }, TYPES[key]) : null;
}
function originalProjectNo(row) {
  return String(row.project_no || '').replace(/__DEL_\d+$/, '');
}
function originalArchiveName(row) {
  return row.original_name || String(row.name || '').replace(/__DEL_\d+$/, '');
}
function dateText(v) {
  return String(v == null ? '' : v).trim();
}

// GET /api/recycle?type=project|buyer|agency|competitor&q=&from=&to=
router.get('/', (req, res) => {
  const c = configOf(req.query && req.query.type || 'project');
  if (!c) return res.status(400).json({ ok: false, message: '回收站类型无效' });
  const where = ['deleted = 1'];
  const args = [];
  const q = dateText(req.query && req.query.q);
  if (q) {
    if (c.key === 'project') {
      where.push('(project_name LIKE ? OR project_no LIKE ?)');
      args.push('%' + q + '%', '%' + q + '%');
    } else {
      where.push('(name LIKE ? OR original_name LIKE ?)');
      args.push('%' + q + '%', '%' + q + '%');
    }
  }
  const from = dateText(req.query && req.query.from);
  const to = dateText(req.query && req.query.to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('deleted_at >= ?'); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('deleted_at <= ?'); args.push(to + ' 23:59:59'); }

  const cols = c.key === 'project'
    ? 'row_id AS id, project_no, project_name, detail, award_amount_fen, deleted_at, updated_at'
    : 'id, name, original_name, deleted_at';
  const rows = db.prepare('SELECT ' + cols + ' FROM ' + c.table +
    ' WHERE ' + where.join(' AND ') + ' ORDER BY deleted_at DESC, id DESC').all(...args);

  const flags = T.getFlags(db, c.key === 'project' ? rows.map(function (r) { return r.id; }) : []);
  const data = rows.map(function (row) {
    if (c.key === 'project') {
      return {
        id: row.id, type: 'project', label: c.label,
        no: originalProjectNo(row), name: row.project_name,
        deleted_at: row.deleted_at || dateText(row.updated_at), ref_count: 0,
        tracking_owner: flags[row.id] ? flags[row.id].tracking_owner : ''
      };
    }
    const original = originalArchiveName(row);
    return {
      id: row.id, type: c.key, label: c.label,
      no: '', name: original,
      deleted_at: row.deleted_at,
      ref_count: countReferences(db, c, original)
    };
  });
  res.json({ ok: true, data: data });
});

// POST /api/recycle/:type/:id/restore —— 恢复到正常列表
router.post('/:type/:id/restore', (req, res) => {
  const c = configOf(req.params.type);
  if (!c) return res.status(400).json({ ok: false, message: '回收站类型无效' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: '记录编号无效' });
  const t = nowText();

  try {
    const result = db.transaction(function () {
      if (c.key === 'project') {
        const row = db.prepare('SELECT row_id, project_no, project_name, detail, award_amount_fen FROM projects WHERE row_id = ? AND deleted = 1').get(id);
        if (!row) return { notFound: true };
        const no = originalProjectNo(row);
        const occupied = db.prepare('SELECT row_id FROM projects WHERE deleted = 0 AND project_no = ? AND row_id <> ?').get(no, id);
        if (occupied) return { conflict: '项目编号「' + no + '」已被其他项目占用，请先修改该项目编号' };
        const r = db.prepare("UPDATE projects SET deleted = 0, deleted_at = '', project_no = ?, updated_at = ?, version = version + 1 WHERE row_id = ? AND deleted = 1")
          .run(no, t, id);
        if (!r.changes) return { conflict: '数据状态已变化，请刷新后重试' };
        let detail = {};
        try { detail = JSON.parse(row.detail || '{}') } catch (e) { detail = {} }
        replaceProjectWinners(db, no, detail, row.award_amount_fen || 0);
        writeLog(db, {
          project_no: no, project_name: row.project_name,
          op_type: '恢复项目', operator: req.user && req.user.username,
          summary: '恢复项目「' + row.project_name + '」（' + no + '），从回收站放回列表'
        });
        return { restored: true, no: no, name: row.project_name };
      }

      const row = db.prepare('SELECT id, name, original_name FROM ' + c.table + ' WHERE id = ? AND deleted = 1').get(id);
      if (!row) return { notFound: true };
      const original = originalArchiveName(row);
      const norm = normName(original);
      const occupied = db.prepare('SELECT id FROM ' + c.table + ' WHERE deleted = 0 AND name_norm = ? AND id <> ?').get(norm, id);
      if (occupied) return { conflict: '名称「' + original + '」已被其他档案占用，请先修改该档案名称' };
      const r = db.prepare("UPDATE " + c.table +
        " SET name = ?, name_norm = ?, original_name = '', deleted = 0, deleted_at = '', updated_at = ? WHERE id = ? AND deleted = 1"
      ).run(original, norm, t, id);
      if (!r.changes) return { conflict: '数据状态已变化，请刷新后重试' };
      writeLog(db, {
        project_no: 'archive_' + c.key, project_name: c.label + '档案：' + original,
        op_type: '恢复档案', operator: req.user && req.user.username,
        summary: c.label + '档案恢复：' + original + '，从回收站放回列表'
      });
      return { restored: true, no: '', name: original };
    })();
    if (result.notFound) return res.status(404).json({ ok: false, message: '回收站中不存在该记录' });
    if (result.conflict) return res.status(409).json({ ok: false, message: result.conflict });
    invalidateGlobalCache();
    res.json({ ok: true, data: result });
  } catch (err) {
    if (String(err.code || '').indexOf('CONSTRAINT') >= 0) {
      return res.status(409).json({ ok: false, message: '名称或编号冲突，无法恢复' });
    }
    throw err;
  }
});

// DELETE /api/recycle/:type/:id —— 彻底删除（物理销毁），仅管理员
router.delete('/:type/:id', requireAdmin, (req, res) => {
  const c = configOf(req.params.type);
  if (!c) return res.status(400).json({ ok: false, message: '回收站类型无效' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: '记录编号无效' });

  try {
    const result = db.transaction(function () {
      if (c.key === 'project') {
        const row = db.prepare('SELECT row_id, project_no, project_name FROM projects WHERE row_id = ? AND deleted = 1').get(id);
        if (!row) return { notFound: true };
        // 防御性拦截：历史遗留或绕过软删除校验留下的已跟进项目，同样禁止彻底删除
        const owner = T.blockingOwner(db, id);
        if (owner) return { conflict: '该项目正由「' + owner + '」跟进，请先关闭跟进开关后再彻底删除' };
        const no = originalProjectNo(row);
        db.prepare('DELETE FROM project_winners WHERE project_no = ?').run(no);
        db.prepare('DELETE FROM project_winners WHERE project_no = ?').run(row.project_no);
        db.prepare('DELETE FROM projects WHERE row_id = ? AND deleted = 1').run(id);
        writeLog(db, {
          project_no: no, project_name: row.project_name,
          op_type: '彻底删除项目', operator: req.user && req.user.username,
          summary: '彻底删除项目「' + row.project_name + '」（' + no + '），不可恢复'
        });
        return { purged: true };
      }

      const row = db.prepare('SELECT id, name, original_name FROM ' + c.table + ' WHERE id = ? AND deleted = 1').get(id);
      if (!row) return { notFound: true };
      const original = originalArchiveName(row);
      if (c.key === 'competitor') {
        const self = db.prepare("SELECT value FROM system_settings WHERE key = 'self_competitor_id'").get();
        if (self && Number(self.value) === id) {
          return { conflict: '该竞争对手已设为「本企业」，请先在系统管理中取消后再彻底删除' };
        }
      }
      const refCount = countReferences(db, c, original);
      if (refCount > 0) {
        return { conflict: '该单位正在被 ' + refCount + ' 个项目引用，无法彻底删除' };
      }
      db.prepare('DELETE FROM ' + c.table + ' WHERE id = ? AND deleted = 1').run(id);
      writeLog(db, {
        project_no: 'archive_' + c.key, project_name: c.label + '档案：' + original,
        op_type: '彻底删除档案', operator: req.user && req.user.username,
        summary: c.label + '档案彻底删除：' + original + '，不可恢复'
      });
      return { purged: true };
    })();
    if (result.notFound) return res.status(404).json({ ok: false, message: '回收站中不存在该记录' });
    if (result.conflict) return res.status(409).json({ ok: false, message: result.conflict });
    invalidateGlobalCache();
    res.json({ ok: true, data: result });
  } catch (err) {
    throw err;
  }
});

module.exports = router;
