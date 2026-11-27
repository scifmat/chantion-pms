/**
 * 项目跟进服务层：事务内的认领 / 关闭 / 状态自检 / 维护 / 复盘。
 * 约定：本模块不 require ./db（避免循环依赖），所有函数第一个参数都是外部传入的 db。
 */
const { writeLog } = require('./operation');
const S = require('./trackingState');

function nowText() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: process.env.TZ || 'Asia/Shanghai', hour12: false
  });
}

function text(v) { return String(v == null ? '' : v).trim(); }

function parseArray(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

function capArray(arr) { return arr.length > 200 ? arr.slice(-200) : arr; }

function archiveReview(history, t, now, cause) {
  const item = {
    internal_status: t.internal_status || '',
    review_category: t.review_category || '',
    review_reason: t.review_reason || '',
    archived_at: now,
    cause: cause || '状态流转'
  };
  if (!item.internal_status && !item.review_category && !item.review_reason) return history;
  return capArray(history.concat([item]));
}

function sourceKey(id, kind, now) {
  return 'tracking:' + id + ':' + kind + ':' + now + ':' + Math.random().toString(36).slice(2, 6);
}

/** 认领 / 重新认领时的初始状态（复用旧行时保留 review_history，活跃复盘按当前状态重算）。 */
function initialPatch(project, exp, now, owner, oldRow) {
  const followLog = [{ time: now, operator: owner.username, text: '认领项目跟进' }];
  let category = '';
  let reason = '';
  if (exp.bucket === '终止招标') {
    category = '项目终止';
    reason = exp.terminateReason;
  }
  return {
    is_tracking: 1,
    owner_user_id: owner.id,
    owner_username: owner.username,
    follow_stage: exp.stage,
    internal_status: exp.internal,
    derived_key: exp.key,
    review_required: S.needsReview(exp.internal) ? 1 : 0,
    review_category: category,
    review_reason: reason,
    review_history: oldRow ? (oldRow.review_history || '[]') : '[]',
    follow_log: JSON.stringify(followLog),
    status_snapshot: text(project.status),
    deadline_snapshot: S.deadlineSnapshot(exp),
    last_reset_at: '',
    version: oldRow ? Number(oldRow.version || 0) + 1 : 1,
    created_at: oldRow ? oldRow.created_at : now,
    updated_at: now
  };
}

/**
 * 计算状态自检补丁。
 * 关键性能约定：derived_key 未变化一律返回 null，调用方不执行任何 UPDATE。
 */
function computePatch(project, t, now) {
  const exp = S.expectedOf(project, now);
  if (text(t.derived_key) === exp.key) return null;

  const prevStatus = text(t.status_snapshot) || text(project.status);
  const reset = S.isResetSwitch(prevStatus, project.status) ||
    (t.follow_stage === S.STAGE_ENDED && exp.stage === S.STAGE_FOLLOWING);
  const allowed = exp.allowed;
  const internal = reset ? exp.internal
    : (allowed.indexOf(t.internal_status) >= 0 ? t.internal_status : exp.internal);
  const internalChanged = internal !== t.internal_status;

  let history = parseArray(t.review_history);
  let category = t.review_category || '';
  let reason = t.review_reason || '';
  if (internalChanged && (S.needsReview(t.internal_status) || category || reason)) {
    history = archiveReview(history, t, now, reset ? '逆流重置' : '状态流转');
    category = '';
    reason = '';
  }
  // 已流标：自动读取主项目「终止原因」，分类默认「项目终止」，负责人后续可编辑
  if (exp.bucket === '终止招标') {
    category = '项目终止';
    reason = exp.terminateReason;
  }

  const logText = reset
    ? '项目状态由「' + prevStatus + '」变为「' + project.status + '」，跟进状态重置为「' + internal + '」，原复盘已归档'
    : '状态流转，内部动态变为「' + internal + '」';
  const followLog = capArray(parseArray(t.follow_log).concat([
    { time: now, operator: '系统', text: logText }
  ]));

  return {
    patch: {
      follow_stage: exp.stage,
      internal_status: internal,
      derived_key: exp.key,
      review_required: S.needsReview(internal) ? 1 : 0,
      review_category: category,
      review_reason: reason,
      review_history: JSON.stringify(history),
      follow_log: JSON.stringify(followLog),
      status_snapshot: text(project.status),
      deadline_snapshot: S.deadlineSnapshot(exp),
      last_reset_at: reset ? now : (t.last_reset_at || ''),
      updated_at: now
    },
    meta: {
      reset: reset,
      from: t.internal_status,
      to: internal,
      fromKey: t.derived_key,
      toKey: exp.key,
      logText: logText
    }
  };
}

const SYNC_FIELDS = [
  'follow_stage', 'internal_status', 'derived_key', 'review_required',
  'review_category', 'review_reason', 'review_history', 'follow_log',
  'status_snapshot', 'deadline_snapshot', 'last_reset_at', 'updated_at'
];

/** 单条同步：CAS 条件为旧 derived_key，避免并发重复写。返回是否真正更新。 */
function syncOne(db, project, t, now) {
  const computed = computePatch(project, t, now);
  if (!computed) return false;
  const values = SYNC_FIELDS.map(function (k) { return computed.patch[k]; });
  const r = db.prepare(
    'UPDATE bid_trackings SET ' + SYNC_FIELDS.map(function (k) { return k + ' = ?'; }).join(', ') +
    ' WHERE id = ? AND derived_key = ?'
  ).run(...values, t.id, t.derived_key);
  if (!r.changes) return false;
  writeLog(db, {
    project_no: project.project_no,
    project_name: project.project_name,
    op_type: computed.meta.reset ? '跟进状态重置' : '跟进状态变更',
    summary: computed.meta.logText,
    operator: '系统',
    source_key: sourceKey(t.id, computed.meta.reset ? 'reset' : 'flow', now)
  });
  return true;
}

/** 全量已跟进项目自检；只在 derived_key 变化时写库。 */
function syncActive(db, now) {
  now = now || nowText();
  const rows = db.prepare(
    'SELECT bt.*, p.project_no, p.project_name, p.status AS project_status, p.detail ' +
    'FROM bid_trackings bt JOIN projects p ON p.row_id = bt.project_id ' +
    'WHERE bt.is_tracking = 1 AND p.deleted = 0'
  ).all();
  if (!rows.length) return 0;
  return db.transaction(function () {
    let changed = 0;
    rows.forEach(function (r) {
      const project = {
        row_id: r.project_id, project_no: r.project_no, project_name: r.project_name,
        status: r.project_status, detail: r.detail
      };
      if (syncOne(db, project, r, now)) changed++;
    });
    return changed;
  })();
}

/** 首页列表：一次查询补齐跟进标记，避免改动 queryBuilder / 导出口径。 */
function getFlags(db, projectIds) {
  const ids = (projectIds || []).map(Number).filter(function (x) { return Number.isInteger(x) && x > 0; });
  const map = {};
  if (!ids.length) return map;
  const ph = ids.map(function () { return '?'; }).join(',');
  const rows = db.prepare(
    'SELECT project_id, owner_user_id, owner_username, internal_status, follow_stage, review_required ' +
    'FROM bid_trackings WHERE is_tracking = 1 AND project_id IN (' + ph + ')'
  ).all(...ids);
  rows.forEach(function (r) {
    map[r.project_id] = {
      tracking_active: true,
      tracking_owner_id: r.owner_user_id,
      tracking_owner: r.owner_username,
      tracking_internal: r.internal_status,
      tracking_stage: r.follow_stage,
      tracking_review_required: !!r.review_required
    };
  });
  return map;
}

/* ---------- 阶段轨迹（bid_tracking_stages） ---------- */

function stageRow(db, trackingId, key) {
  return db.prepare('SELECT * FROM bid_tracking_stages WHERE tracking_id = ? AND stage_key = ?')
    .get(Number(trackingId), key);
}

function upsertStage(db, trackingId, key, data, now) {
  const cur = stageRow(db, trackingId, key);
  if (cur) {
    return db.prepare(
      'UPDATE bid_tracking_stages SET internal_status = ?, review_category = ?, review_reason = ?, ' +
      'reviewed_at = ?, updated_at = ? WHERE id = ?'
    ).run(data.internal_status || '', data.review_category || '', data.review_reason || '',
      data.reviewed_at || '', now, cur.id);
  }
  return db.prepare(
    'INSERT INTO bid_tracking_stages (tracking_id, stage_key, internal_status, review_category, ' +
    'review_reason, reviewed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(trackingId, key, data.internal_status || '', data.review_category || '',
    data.review_reason || '', data.reviewed_at || '', now);
}

/** 把历史复盘/当前复盘回填到阶段表；幂等，重复执行不覆盖已有内容。 */
function backfillStages(db) {
  const rows = db.prepare('SELECT * FROM bid_trackings').all();
  const now = nowText();
  let written = 0;
  rows.forEach(function (t) {
    const key = S.stageKeyOfInternal(t.internal_status || '');
    if (!key) return;
    upsertStage(db, t.id, key, {
      internal_status: t.internal_status || S.STAGE_BY_KEY[key].default,
      review_category: t.review_category || '',
      review_reason: t.review_reason || '',
      reviewed_at: t.review_reason ? (t.updated_at || now) : ''
    }, now);
    written++;
    parseArray(t.review_history).forEach(function (h) {
      const hk = S.stageKeyOfInternal(String(h.internal_status || ''));
      if (!hk || hk === key) return;
      const cur = stageRow(db, t.id, hk);
      if (cur && cur.review_reason) return;
      upsertStage(db, t.id, hk, {
        internal_status: h.internal_status || S.STAGE_BY_KEY[hk].default,
        review_category: h.review_category || '',
        review_reason: h.review_reason || '',
        reviewed_at: h.archived_at || ''
      }, now);
      written++;
    });
  });
  return { rows: rows.length, written: written };
}

/** 四个节点的展示数据：静态定义 + 已落库的阶段记录。 */
function getStages(db, t, now) {
  const exp = S.expectedOf({ status: t.project_status, detail: t.detail }, now);
  const currentKey = S.stageKeyForBucket(exp.bucket);
  return S.STAGES.map(function (def) {
    const row = stageRow(db, t.id, def.key);
    const isCurrent = def.key === currentKey;
    // 当前节点以 bid_trackings 的全局状态为唯一权威，避免阶段表历史值把当前节点带偏；
    // 历史节点才读阶段表的补录内容。
    const internal = isCurrent
      ? (t.internal_status || def.default)
      : (row && row.internal_status ? row.internal_status : def.default);
    const category = isCurrent
      ? (t.review_category || '')
      : (row ? (row.review_category || '') : '');
    const reason = isCurrent
      ? (t.review_reason || '')
      : (row ? (row.review_reason || '') : '');
    return {
      key: def.key,
      label: def.label,
      objective: def.objective,
      internal_status: internal,
      allowed_internals: S.stageInternalsFor(def.key, exp.bucket),
      review_category: category,
      review_reason: reason,
      reviewed: !!reason,
      reviewed_at: row ? (row.reviewed_at || '') : '',
      reached: S.stageReachable(def.key, exp.bucket),
      current: isCurrent
    };
  });
}

/**
 * 保存某个节点的复盘/补录。只允许已到达节点；当前节点会同步全局动态，
 * 历史节点只写阶段表与时间线，不回退当前动态。
 */
function saveStage(db, t, project, stageKey, payload, now) {
  now = now || nowText();
  if (Number(payload.version) !== Number(t.version)) {
    return { status: 409, message: '跟进信息已被他人修改，请刷新后重试' };
  }
  const def = S.STAGE_BY_KEY[stageKey];
  if (!def) return { status: 400, message: '阶段无效' };
  const exp = S.expectedOf(project, now);
  if (!S.stageReachable(stageKey, exp.bucket)) {
    return { status: 400, message: '该阶段尚未发生，不能补录' };
  }
  const currentKey = S.stageKeyForBucket(exp.bucket);
  const old = stageRow(db, t.id, stageKey);
  const internal = text(payload.internal_status) ||
    (old && old.internal_status) || (stageKey === currentKey ? t.internal_status : def.default);
  const allowed = S.stageInternalsFor(stageKey, exp.bucket);
  if (allowed.indexOf(internal) < 0) {
    return { status: 400, message: '该阶段不允许「' + internal + '」这一内部动态' };
  }
  let category = text(payload.review_category);
  let reason = text(payload.review_reason);
  if (internal === S.INTERNAL.FLOATED) {
    if (!category) category = '项目终止';
    if (!reason) reason = exp.terminateReason;
  }
  if (!category || !reason) return { status: 400, message: '复盘分类与具体原因/经验说明均为必填' };

  const internalChanged = !old || old.internal_status !== internal;
  const reviewChanged = !old || old.review_reason !== reason || old.review_category !== category;
  const logText = '复盘补录：' + def.label + '「' + (old && old.internal_status ? old.internal_status : '未填写') +
    '」→「' + internal + '」，' + category + '（' + reason + '）';
  const followLog = capArray(parseArray(t.follow_log).concat([
    { time: now, operator: payload.operator || '当前操作人', text: logText }
  ]));

  db.transaction(function () {
    upsertStage(db, t.id, stageKey, {
      internal_status: internal,
      review_category: category,
      review_reason: reason,
      reviewed_at: now
    }, now);
    if (stageKey === currentKey) {
      db.prepare(
        'UPDATE bid_trackings SET internal_status = ?, review_required = ?, review_category = ?, ' +
        'review_reason = ?, follow_log = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
      ).run(internal, S.needsReview(internal) ? 1 : 0, category, reason,
        JSON.stringify(followLog), now, t.id, t.version);
    } else {
      db.prepare(
        'UPDATE bid_trackings SET follow_log = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?'
      ).run(JSON.stringify(followLog), now, t.id, t.version);
    }
    writeLog(db, {
      project_no: project.project_no, project_name: project.project_name,
      op_type: '复盘填写', summary: logText,
      operator: payload.operator || '当前操作人', created_at: now
    });
  })();
  return { status: 200, internalChanged: internalChanged, reviewChanged: reviewChanged };
}

function decorate(db, r, now, userId) {
  const exp = S.expectedOf({ status: r.project_status, detail: r.detail }, now);
  const warnings = [];
  const todos = [];
  if (exp.docEnd && now > exp.docEnd && r.internal_status === S.INTERNAL.NOT_REGISTERED) {
    warnings.push('获取文件已截止，仍未报名');
  }
  if (exp.bidEnd && now > exp.bidEnd && r.internal_status === S.INTERNAL.NOT_BID) {
    warnings.push('投标已截止，仍未投标');
  }
  if (r.review_required && !text(r.review_reason)) todos.push('待复盘');
  const d1 = S.daysUntil(exp.docEnd, now);
  const d2 = S.daysUntil(exp.bidEnd, now);
  if (r.internal_status === S.INTERNAL.NOT_REGISTERED && d1 !== null && d1 >= 0 && d1 <= S.TODO_WINDOW_DAYS) {
    todos.push('报名即将截止');
  }
  if (r.internal_status === S.INTERNAL.NOT_BID && d2 !== null && d2 >= 0 && d2 <= S.TODO_WINDOW_DAYS) {
    todos.push('投标即将截止');
  }
  return {
    id: r.id,
    project_id: r.project_id,
    project_no: r.project_no,
    project_name: r.project_name,
    status: r.project_status,
    budget_yuan: r.budget_yuan,
    budget_fen: r.budget_fen,
    bid_end: r.bid_end || '',
    doc_end: exp.docEnd || '',
    bid_end_at: exp.bidEnd || '',
    follow_stage: r.follow_stage,
    internal_status: r.internal_status,
    derived_key: r.derived_key,
    review_required: !!r.review_required,
    review_category: r.review_category || '',
    review_reason: r.review_reason || '',
    review_history: parseArray(r.review_history),
    follow_log: parseArray(r.follow_log),
    owner_user_id: r.owner_user_id,
    owner_username: r.owner_username,
    allowed_internal: exp.allowed,
    // 复盘弹窗的历史补录白名单：只能回溯或持平，不能穿越到未来
    history_allowed: S.historyAllowedFor(r.derived_key),
    allowed_stages: S.stagesAllowedFor(r.derived_key),
    stages: getStages(db, r, now),
    can_edit: Number(r.owner_user_id) === Number(userId),
    warnings: warnings,
    todos: todos,
    last_reset_at: r.last_reset_at || '',
    version: Number(r.version || 1),
    updated_at: r.updated_at || '',
    terminate_reason: exp.terminateReason
  };
}

const LIST_SQL =
  'SELECT bt.*, p.project_no, p.project_name, p.status AS project_status, ' +
  'p.budget_yuan, p.budget_fen, p.bid_end, p.detail ' +
  'FROM bid_trackings bt JOIN projects p ON p.row_id = bt.project_id ' +
  'WHERE bt.is_tracking = 1 AND p.deleted = 0 ORDER BY bt.updated_at DESC, bt.id DESC';

function listRows(db, q, userId, now) {
  now = now || nowText();
  const rows = db.prepare(LIST_SQL).all().map(function (r) { return decorate(db, r, now, userId); });
  q = q || {};
  const stage = text(q.stage);
  const internal = text(q.internal);
  const status = text(q.status);
  const owner = text(q.owner);
  const keyword = text(q.keyword);
  return rows.filter(function (r) {
    if (stage && r.follow_stage !== stage) return false;
    if (internal && r.internal_status !== internal) return false;
    if (status && r.status !== status) return false;
    if (owner === 'mine' && !r.can_edit) return false;
    if (owner === 'other' && r.can_edit) return false;
    if (keyword && (r.project_name + r.project_no + r.owner_username).indexOf(keyword) < 0) return false;
    return true;
  });
}

function getRow(db, id, userId, now) {
  now = now || nowText();
  const r = db.prepare(
    'SELECT bt.*, p.project_no, p.project_name, p.status AS project_status, ' +
    'p.budget_yuan, p.budget_fen, p.bid_end, p.detail ' +
    'FROM bid_trackings bt JOIN projects p ON p.row_id = bt.project_id ' +
    'WHERE bt.id = ? AND bt.is_tracking = 1 AND p.deleted = 0'
  ).get(Number(id));
  return r ? decorate(db, r, now, userId) : null;
}

/** 顶部个人看板。 */
function summary(db, userId, now) {
  now = now || nowText();
  const rows = db.prepare(LIST_SQL).all().filter(function (r) {
    return Number(r.owner_user_id) === Number(userId);
  }).map(function (r) { return decorate(db, r, now, userId); });
  const month = now.slice(0, 7);
  const ended = rows.filter(function (r) {
    return r.follow_stage === S.STAGE_ENDED && String(r.updated_at).slice(0, 7) === month;
  });
  return {
    pending: rows.filter(function (r) { return r.todos.length > 0; }).length,
    following: rows.filter(function (r) { return r.follow_stage === S.STAGE_FOLLOWING; }).length,
    ended_month: ended.length,
    won_month: ended.filter(function (r) { return r.internal_status === S.INTERNAL.WON; }).length,
    lost_month: ended.filter(function (r) { return r.internal_status !== S.INTERNAL.WON; }).length
  };
}

/** 认领：未跟进 / 历史关闭行可认领；已被他人占用返回 conflict。 */
function claim(db, project, user, now) {
  now = now || nowText();
  const cur = db.prepare('SELECT * FROM bid_trackings WHERE project_id = ?').get(project.row_id);
  if (cur && cur.is_tracking) {
    if (Number(cur.owner_user_id) === Number(user.id)) return { status: 'already' };
    return { status: 'conflict', owner: cur.owner_username || '其他用户' };
  }
  const exp = S.expectedOf(project, now);
  const patch = initialPatch(project, exp, now, user, cur);
  db.transaction(function () {
    if (cur) {
      const fields = Object.keys(patch);
      db.prepare('UPDATE bid_trackings SET ' + fields.map(function (k) { return k + ' = ?'; }).join(', ') +
        ' WHERE id = ? AND is_tracking = 0').run(...fields.map(function (k) { return patch[k]; }), cur.id);
    } else {
      const fields = ['project_id'].concat(Object.keys(patch));
      db.prepare('INSERT INTO bid_trackings (' + fields.join(', ') + ') VALUES (' +
        fields.map(function () { return '?'; }).join(', ') + ')').run(...[project.row_id].concat(Object.keys(patch).map(function (k) { return patch[k]; })));
    }
    writeLog(db, {
      project_no: project.project_no, project_name: project.project_name,
      op_type: '跟进认领', summary: '「' + user.username + '」认领项目跟进',
      operator: user.username, created_at: now
    });
  })();
  const id = cur ? cur.id : db.prepare('SELECT id FROM bid_trackings WHERE project_id = ?').get(project.row_id).id;
  return { status: 'ok', row: getRow(db, id, user.id, now) };
}

/** 关闭：仅负责人；不删行，释放删除限制。 */
function release(db, t, project, user, now) {
  now = now || nowText();
  const r = db.transaction(function () {
    const res = db.prepare(
      'UPDATE bid_trackings SET is_tracking = 0, owner_user_id = 0, owner_username = ?, ' +
      'version = version + 1, updated_at = ? WHERE id = ? AND is_tracking = 1'
    ).run('', now, t.id);
    if (!res.changes) return false;
    writeLog(db, {
      project_no: project.project_no, project_name: project.project_name,
      op_type: '关闭跟进', summary: '「' + user.username + '」关闭项目跟进，复盘历史已保留',
      operator: user.username, created_at: now
    });
    return true;
  })();
  return !!r;
}

/**
 * 跟进维护：只写「当前动态 + 跟进记录」，绝不接收复盘字段。
 * 动态变化时旧复盘归档并清空活跃复盘；失败态只置 review_required=1，由前端提示去复盘/补录。
 */
function updateInternal(db, t, project, payload, now) {
  now = now || nowText();
  if (Number(payload.version) !== Number(t.version)) {
    return { status: 409, message: '跟进信息已被他人修改，请刷新后重试' };
  }
  const next = text(payload.internal_status);
  const allowed = S.allowedForDerivedKey(t.derived_key);
  if (allowed.indexOf(next) < 0) {
    return { status: 400, message: '当前阶段不允许「' + (next || '空') + '」这一内部动态' };
  }
  const changed = t.internal_status !== next;
  let history = parseArray(t.review_history);
  if (changed) history = archiveReview(history, t, now, '内部动态变更');
  const note = text(payload.note);
  const logText = '内部动态由「' + t.internal_status + '」改为「' + next + '」' + (note ? '；' + note : '');
  const followLog = capArray(parseArray(t.follow_log).concat([
    { time: now, operator: payload.operator || '当前操作人', text: logText }
  ]));
  db.transaction(function () {
    if (changed) {
      db.prepare(
        'UPDATE bid_trackings SET internal_status = ?, review_required = ?, review_category = ?, ' +
        'review_reason = ?, review_history = ?, follow_log = ?, version = version + 1, updated_at = ? ' +
        'WHERE id = ? AND version = ?'
      ).run(next, S.needsReview(next) ? 1 : 0, '', '',
        JSON.stringify(history), JSON.stringify(followLog), now, t.id, t.version);
    } else {
      db.prepare(
        'UPDATE bid_trackings SET follow_log = ?, version = version + 1, updated_at = ? ' +
        'WHERE id = ? AND version = ?'
      ).run(JSON.stringify(followLog), now, t.id, t.version);
    }
    writeLog(db, {
      project_no: project.project_no, project_name: project.project_name,
      op_type: '跟进状态变更', summary: logText,
      operator: payload.operator || '当前操作人', created_at: now
    });
  })();
  return { status: 200 };
}

/**
 * 旧 /review 入口的兼容层：按 internal_status 找到对应阶段，委托给 saveStage。
 * 新的统一「跟进轨迹」弹窗直接调用 /stages/:stageKey。
 */
function updateReview(db, t, project, payload, now) {
  const internal = text(payload.internal_status) || t.internal_status;
  const key = S.stageKeyOfInternal(internal);
  // 显式传回当前动态，避免 saveStage 回退到该阶段的历史记录（可能已被状态机推进）
  return saveStage(db, t, project, key, Object.assign({}, payload, { internal_status: internal }), now);
}

/** 删除拦截：返回被占用的负责人名，未占用返回空串。 */
function blockingOwner(db, projectId) {
  const row = db.prepare(
    'SELECT owner_username FROM bid_trackings WHERE project_id = ? AND is_tracking = 1'
  ).get(Number(projectId));
  return row ? (row.owner_username || '其他用户') : '';
}

module.exports = {
  nowText, text, parseArray, computePatch, syncOne, syncActive, getFlags,
  listRows, getRow, summary, claim, release, updateInternal, saveStage, getStages,
  backfillStages, updateReview, blockingOwner
};
