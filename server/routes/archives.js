const express = require('express');
const { db, nowText } = require('../db');
const {
  TABLES, UNIT_ATTRIBUTES, normName, countReferences, parseArchiveValues, displayArchiveValues,
  normFieldValue, serializeArchiveValues
} = require('../archive');
const { writeLog } = require('../operation');
const { replaceProjectWinners } = require('../winners');
const { invalidateGlobalCache } = require('../globalStats');

const router = express.Router();

// 表名只从白名单取，绝不拼接用户输入；所有查询值一律 ? 占位符
function cfg(type) { return TABLES[String(type == null ? '' : type).trim()] || null; }
function like(v) { return '%' + String(v == null ? '' : v).trim() + '%'; }
function badType(res) { return res.status(400).json({ ok: false, message: '档案类型不在可选范围内' }); }
function text(v) { return String(v == null ? '' : v).trim(); }

// 本轮开放「改/删」的三类档案；评委档案保持只读（App.vue 中也没有对应入口）
const EDITABLE = new Set(['buyer', 'agency', 'competitor']);

/**
 * 3.2.3 多值联系方式：库里存 JSON 数组字符串（或历史纯文本），
 * 对前端同时给出「逗号分隔展示串」+「结构化数组」两种形态。
 * judges 表没有这三列，原样返回。
 */
function withValueLists(r) {
  if (r.phone === undefined) return Object.assign({}, r);
  return Object.assign({}, r, {
    phone: displayArchiveValues(r.phone),
    email: displayArchiveValues(r.email),
    address: displayArchiveValues(r.address),
    phoneList: parseArchiveValues(r.phone),
    emailList: parseArchiveValues(r.email),
    addressList: parseArchiveValues(r.address)
  });
}

/** 档案行 -> 列表/编辑回显统一结构（含引用数与多值联系方式） */
function toListRow(c, r) {
  return Object.assign(withValueLists(r), {
    refCount: countReferences(db, c, r.name),
    refApprox: !c.projectCol
  });
}

/* ---------- 改名同步：只改「真正引用该档案」的项目，两个字段都做归一化精确匹配 ---------- */

/** 主列替换：buyer/agency 为单值；competitor 为逗号串，逐项替换后仍按逗号串落库 */
function renameMainColumn(value, type, oldKey, newName) {
  if (type === 'competitor') {
    const parts = String(value == null ? '' : value).split(',');
    let changed = false;
    const out = parts.map(function (p) {
      if (normName(p) === oldKey) { changed = true; return newName; }
      return p;
    });
    return changed ? { value: out.join(','), changed: true } : { value: value, changed: false };
  }
  if (normName(value) === oldKey) return { value: newName, changed: true };
  return { value: value, changed: false };
}

/**
 * detail 内字段替换：只替换归一化后与旧名完全相等的值，避免误伤相似名称。
 * 历史 detail 非法 / 残缺时原样返回，不把脏数据写回；主列同步不受影响。
 */
function renameInDetail(rawDetail, type, oldKey, newName) {
  let d;
  try {
    d = JSON.parse(rawDetail || '{}');
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { detail: rawDetail, changed: false };
  } catch (e) { return { detail: rawDetail, changed: false }; }

  let changed = false;
  function replaceField(obj, key) {
    if (obj && typeof obj === 'object' && typeof obj[key] === 'string' && normName(obj[key]) === oldKey) {
      obj[key] = newName;
      changed = true;
    }
  }
  function replaceWinner(w) {
    if (!w || typeof w !== 'object') return;
    replaceField(w, 'lead');
    if (Array.isArray(w.members)) {
      w.members = w.members.map(function (m) {
        if (typeof m === 'string' && normName(m) === oldKey) { changed = true; return newName; }
        return m;
      });
    }
  }

  if (type === 'buyer') replaceField(d.buyer, 'name');
  else if (type === 'agency') replaceField(d.agency, 'name');
  else if (type === 'competitor') {
    const c = d.completed;
    if (!c || typeof c !== 'object') return { detail: rawDetail, changed: false };
    if (c.isSplit) {
      if (Array.isArray(c.packages)) c.packages.forEach(function (p) { replaceWinner(p && p.winner); });
    } else replaceWinner(c.winner);
  }
  return changed ? { detail: JSON.stringify(d), changed: true } : { detail: rawDetail, changed: false };
}

/**
 * 档案改名 -> 同步全部关联项目（未删除）。调用方必须已处在事务内。
 * 先用 LIKE 粗筛候选（含精确匹配项），再用 normName 精确判断，避免误改。
 * @returns {number} 实际发生同步的项目数
 */
function syncProjectsOnRename(db, c, type, oldName, newName) {
  const oldKey = normName(oldName);
  const refCol = c.projectCol;
  const rows = db.prepare(
    'SELECT row_id, project_no, award_amount_fen, ' + refCol + ' AS mainVal, detail FROM projects WHERE deleted = 0 AND ' + refCol + ' LIKE ?'
  ).all(like(oldName));
  if (!rows.length) return 0;
  const upd = db.prepare('UPDATE projects SET ' + refCol + ' = ?, detail = ?, updated_at = ? WHERE row_id = ?');
  const t = nowText();
  let count = 0;
  rows.forEach(function (row) {
    const main = renameMainColumn(row.mainVal, type, oldKey, newName);
    const detail = renameInDetail(row.detail, type, oldKey, newName);
    if (!main.changed && !detail.changed) return; // 粗筛命中但精确不匹配：不动
    upd.run(main.value, detail.detail, t, row.row_id);
    // 竞争对手改名必须同步规范化映射：全局看板按 name_norm JOIN project_winners，
    // 只改 detail / winner_names 会让「本企业战力卡」找不到任何中标记录。
    if (type === 'competitor') {
      replaceProjectWinners(db, row.project_no, detail.detail, row.award_amount_fen || 0);
    }
    count++;
  });
  return count;
}

/** 编辑表单里的多值字段：数组按归一化去重后 JSON 序列化；非数组按单值处理 */
function storedValues(v, mode) {
  const list = Array.isArray(v) ? v : (text(v) ? [text(v)] : []);
  const seen = new Set();
  const clean = [];
  list.forEach(function (raw) {
    const s = normFieldValue(raw, mode);
    if (!s || seen.has(s)) return;
    seen.add(s);
    clean.push(s);
  });
  return serializeArchiveValues(clean);
}

/* ---------- 接口 ---------- */

// GET /api/archives/search?type=...&q=...[&exact=1] —— 录入弹窗候选
router.get('/search', (req, res) => {
  const c = cfg(req.query && req.query.type);
  if (!c) return badType(res);
  const q = text(req.query && req.query.q);
  if (!q) return res.json({ ok: true, data: [] });
  const exact = String((req.query && req.query.exact) || '') === '1';
  const cols = c.table === 'judges'
    ? 'id, name, name_norm, leader, owner'
    : 'id, name, name_norm, phone, email, address';
  const sql = exact
    ? 'SELECT ' + cols + ' FROM ' + c.table + ' WHERE deleted = 0 AND name_norm = ? LIMIT 1'
    : 'SELECT ' + cols + ' FROM ' + c.table + ' WHERE deleted = 0 AND name LIKE ? ORDER BY updated_at DESC, id DESC LIMIT 10';
  const rows = exact ? db.prepare(sql).all(normName(q)) : db.prepare(sql).all(like(q));
  res.json({ ok: true, data: rows.map(withValueLists) });
});

// GET /api/archives?type=&q= —— 档案列表页（含引用次数）
router.get('/', (req, res) => {
  const c = cfg(req.query && req.query.type);
  if (!c) return badType(res);
  const q = text(req.query && req.query.q);
  const cols = c.table === 'judges'
    ? 'id, name, name_norm, leader, owner, source_project_no, created_at, updated_at'
    : 'id, name, name_norm, attribute' + (c.table === 'competitors' ? ', is_self' : '') +
      ', phone, email, address, source_project_no, created_at, updated_at';
  // 全局默认排序：最近更新的档案在前；同秒更新用 id 兜底
  const sql = 'SELECT ' + cols + ' FROM ' + c.table + ' WHERE deleted = 0' + (q ? ' AND name LIKE ?' : '') + ' ORDER BY updated_at DESC, id DESC';
  const rows = q ? db.prepare(sql).all(like(q)) : db.prepare(sql).all();
  res.json({ ok: true, data: rows.map(function (r) { return toListRow(c, r); }) });
});

// PUT /api/archives/:type/:id —— 统一编辑入口（改联系方式 + 改名同步关联项目，同事务）
router.put('/:type/:id', (req, res) => {
  const key = String(req.params.type || '').trim();
  const c = cfg(key);
  if (!c || !EDITABLE.has(key)) return badType(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, message: '档案编号无效' });
  }
  const body = req.body || {};
  const name = text(body.name);
  if (!name) return res.status(400).json({ ok: false, message: '名称不能为空', fields: ['name'] });
  // 单位属性：允许留空（未设置），非空时必须在六项白名单内
  const attribute = text(body.attribute);
  if (attribute && UNIT_ATTRIBUTES.indexOf(attribute) < 0) {
    return res.status(400).json({ ok: false, message: '单位属性不在可选范围内', fields: ['attribute'] });
  }
  const values = {
    name: name,
    name_norm: normName(name),
    attribute: attribute,
    phone: storedValues(body.phone, 'short'),
    email: storedValues(body.email, 'short'),
    address: storedValues(body.address, 'address')
  };
  const cols = 'id, name, name_norm, attribute, phone, email, address, source_project_no, created_at, updated_at';

  try {
    const result = db.transaction(function () {
      const cur = db.prepare('SELECT id, name FROM ' + c.table + ' WHERE deleted = 0 AND id = ?').get(id);
      if (!cur) return { notFound: true };
      const dup = db.prepare('SELECT id FROM ' + c.table + ' WHERE deleted = 0 AND name_norm = ? AND id <> ?').get(values.name_norm, id);
      if (dup) return { duplicated: true };
      const renamed = values.name_norm !== normName(cur.name);
      db.prepare('UPDATE ' + c.table +
        ' SET name = ?, name_norm = ?, attribute = ?, phone = ?, email = ?, address = ?, updated_at = ? WHERE id = ?'
      ).run(values.name, values.name_norm, values.attribute, values.phone, values.email, values.address, nowText(), id);
      const synced = renamed ? syncProjectsOnRename(db, c, key, cur.name, values.name) : 0;
      const row = db.prepare('SELECT ' + cols + ' FROM ' + c.table + ' WHERE id = ?').get(id);
      writeLog(db, {
        project_no: 'archive_' + key,
        project_name: c.label + '档案：' + values.name,
        op_type: '档案维护',
        operator: req.user && req.user.username,
        summary: (renamed
          ? c.label + '档案改名：' + cur.name + ' -> ' + values.name
          : c.label + '档案信息更新：' + values.name) + (synced ? '，同步项目 ' + synced + ' 个' : '')
      });
      return { row: toListRow(c, row), synced: synced, renamed: renamed };
    })();
    if (result.notFound) return res.status(404).json({ ok: false, message: '档案不存在' });
    if (result.duplicated) return res.status(409).json({ ok: false, message: '该名称已存在，请勿重复建档' });
    if (result.renamed) invalidateGlobalCache(); // 名称进入全局榜单口径，刷新看板缓存
    res.json({ ok: true, data: result });
  } catch (err) {
    if (String(err.code || '').indexOf('CONSTRAINT') >= 0) {
      return res.status(409).json({ ok: false, message: '该名称已存在，请勿重复建档' });
    }
    throw err;
  }
});

// DELETE /api/archives/:type/:id —— 统一删除入口：引用数 > 0 拦截；否则移入回收站（软删除）
router.delete('/:type/:id', (req, res) => {
  const key = String(req.params.type || '').trim();
  const c = cfg(key);
  if (!c || !EDITABLE.has(key)) return badType(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, message: '档案编号无效' });
  }
  const result = db.transaction(function () {
    const cur = db.prepare('SELECT id, name FROM ' + c.table + ' WHERE deleted = 0 AND id = ?').get(id);
    if (!cur) return { notFound: true };
    const refCount = countReferences(db, c, cur.name);
    if (refCount > 0) return { referenced: refCount };
    // 改名释放 name_norm 唯一键；原名叫 original_name，可在回收站恢复
    const recycleName = cur.name + '__DEL_' + id;
    db.prepare('UPDATE ' + c.table +
      ' SET name = ?, name_norm = ?, original_name = ?, deleted = 1, deleted_at = ?, updated_at = ? WHERE id = ?'
    ).run(recycleName, normName(recycleName), cur.name, nowText(), nowText(), id);
    writeLog(db, {
      project_no: 'archive_' + key,
      project_name: c.label + '档案：' + cur.name,
      op_type: '档案维护',
      operator: req.user && req.user.username,
      summary: c.label + '档案移入回收站：' + cur.name + '（可在回收站恢复）'
    });
    return { deleted: true, recycled: true };
  })();
  if (result.notFound) return res.status(404).json({ ok: false, message: '档案不存在' });
  if (result.referenced > 0) {
    return res.status(409).json({
      ok: false,
      refCount: result.referenced,
      message: '该单位正在被 ' + result.referenced + ' 个项目引用，无法删除，请先修改关联项目'
    });
  }
  res.json({ ok: true, data: { deleted: true, recycled: true } });
});

module.exports = router;
