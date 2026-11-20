/**
 * 第 8 步：独立操作记录（事件级）。
 * 只依赖纯模块，不 require ./db，避免 db -> migrate -> operation -> db 循环。
 *
 * 关键：writeLog 由调用方放在 POST / PUT / DELETE 的同一事务内执行，
 * 绝不出现「数据删了但记录没写」。本轮不做字段级 diff。
 */
const OPERATOR = process.env.OPERATOR || '当前操作人';

function nowText() {
  return new Date().toLocaleString('sv-SE', { timeZone: process.env.TZ || 'Asia/Shanghai', hour12: false });
}
function text(v) { return String(v == null ? '' : v).trim(); }

/** 事务内调用：写一条操作记录。source_key 为空表示实时写入（不参与回填去重） */
function writeLog(db, o) {
  return db.prepare(
    'INSERT OR IGNORE INTO operation_logs (project_no, project_name, op_type, summary, operator, source_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    text(o.project_no), text(o.project_name), text(o.op_type), text(o.summary),
    text(o.operator) || OPERATOR, o.source_key || null, text(o.created_at) || nowText()
  );
}

/**
 * 启动时把历史 detail.operationLog（状态互斥清空等）回填一次。
 * source_key = backfill:<row_id>:<index> + INSERT OR IGNORE，重复启动不会重复写。
 * 单行解析失败只跳过，绝不影响服务启动。
 */
function backfillLogs(db) {
  const rows = db.prepare('SELECT row_id, project_no, project_name, detail FROM projects').all();
  const stat = { rows: rows.length, inserted: 0, skipped: 0 };
  const run = db.transaction(function () {
    rows.forEach(function (row) {
      let parsed = {};
      try {
        parsed = JSON.parse(row.detail || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
      } catch (e) { parsed = {}; }
      const logs = Array.isArray(parsed.operationLog) ? parsed.operationLog : [];
      logs.forEach(function (item, i) {
        if (!item || typeof item !== 'object') return;
        const type = text(item.type) || '状态切换清空';
        const from = text(item.from), to = text(item.to), cleared = text(item.cleared);
        const stage = cleared === 'completed' ? '完成招标' : cleared === 'terminated' ? '终止招标' : cleared;
        const summary = '项目状态由「' + from + '」切换为「' + to + '」' + (stage ? '，清空「' + stage + '」信息' : '');
        const r = writeLog(db, {
          project_no: row.project_no,
          project_name: row.project_name,
          op_type: type,
          summary: summary,
          operator: OPERATOR,
          source_key: 'backfill:' + row.row_id + ':' + i,
          created_at: text(item.time) || nowText()
        });
        stat.inserted += r.changes;
      });
    });
  });
  try { run() } catch (e) { stat.skipped++; console.log('[MIGRATION 006] log backfill error: ' + e.message) }
  return stat;
}

// 系统管理类操作的 op_type（普通用户不可见这类记录）
const SYSTEM_OP_TYPE = '系统设置';

/** 只读列表：操作类型 / 项目编号 / 时间区间，全部 ? 占位符，按时间倒序。
 *  opts.includeSystem=false 时排除系统设置类记录（普通用户视角）。 */
function listLogs(db, q, opts) {
  q = q || {};
  opts = opts || {};
  const where = ['1 = 1'];
  const args = [];
  if (opts.includeSystem === false) { where.push("op_type <> ?"); args.push(SYSTEM_OP_TYPE); }
  if (text(q.type)) { where.push('op_type LIKE ?'); args.push('%' + text(q.type) + '%'); }
  if (text(q.no)) { where.push('project_no LIKE ?'); args.push('%' + text(q.no) + '%'); }
  if (text(q.keyword)) { where.push('(summary LIKE ? OR project_name LIKE ?)'); args.push('%' + text(q.keyword) + '%', '%' + text(q.keyword) + '%'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(q.from))) { where.push('created_at >= ?'); args.push(text(q.from)); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(q.to))) { where.push('created_at <= ?'); args.push(text(q.to) + ' 23:59:59'); }
  return db.prepare(
    'SELECT id, project_no, project_name, op_type, summary, operator, created_at FROM operation_logs WHERE ' +
    where.join(' AND ') + ' ORDER BY created_at DESC, id DESC'
  ).all(...args);
}

/**
 * 操作类型下拉全集：固定列出所有项目操作类型（含当前暂无记录的「删除项目」），
 * 管理员在末位追加「系统设置」；普通用户不含系统设置。顺序固定，不随数据波动。
 */
// 「状态切换清空」不列入下拉：当前无此类记录且含义晦涩；历史/将来这类记录仍在「全部」可见。
const PROJECT_OP_TYPES = ['新增项目', '编辑项目', '删除项目'];
function listOpTypes(includeSystem) {
  const list = PROJECT_OP_TYPES.slice();
  if (includeSystem) list.push(SYSTEM_OP_TYPE);
  return list;
}

module.exports = { OPERATOR, nowText, writeLog, backfillLogs, listLogs, listOpTypes, SYSTEM_OP_TYPE };
