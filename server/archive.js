/**
 * 第 6 步：独立信息档案。
 *
 * 只依赖 ./detail（纯函数），不 require ./db —— 否则会形成 db.js -> migrate.js -> archive.js -> db.js 循环。
 * 时间文本在本文件内生成，口径与 db.js 的 nowText 一致。
 *
 * 关键约束（用户特别叮嘱）：历史 detail 可能残缺、为 '{}'、甚至非法 JSON，
 * 抽取与回填全程做空值防护，单行出错只跳过该行，绝不导致服务启动失败。
 */
const { mergeDetail } = require('./detail');

// 单位属性白名单：档案页编辑时可改，录入项目时不录入（与前端 utils/archive.js 保持一致）
const UNIT_ATTRIBUTES = ['政府机关', '事业单位', '国有企业', '民营企业', '外资企业', '其他'];

// 表名白名单：SQL 中的表名只从这里取，绝不拼接用户输入
const TABLES = {
  buyer: { table: 'buyers', label: '采购单位', projectCol: 'buyer_name' },
  agency: { table: 'agencies', label: '代理机构', projectCol: 'agency_name' },
  competitor: { table: 'competitors', label: '竞争对手', projectCol: 'winner_names' },
  judge: { table: 'judges', label: '评委', projectCol: null }
};

function nowText() {
  return new Date().toLocaleString('sv-SE', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    hour12: false
  });
}

function text(v) { return String(v == null ? '' : v).trim(); }

/** 名称归一化：去所有空白 + 全半角归一 + 小写（与前端 normPkg 同口径） */
/** 统计正常项目对某档案名的引用数（字符串快照口径，非外键）。回收站列表/删除校验共用。 */
function countReferences(db, config, name) {
  if (!config || !config.projectCol) return 0;
  const n = String(name == null ? '' : name).trim();
  if (!n) return 0;
  return db.prepare('SELECT COUNT(*) AS n FROM projects WHERE deleted = 0 AND ' + config.projectCol + ' LIKE ?')
    .get('%' + n + '%').n;
}

function normName(v) {
  return text(v).replace(/\s+/g, '')
    .replace(/[\uff01-\uff5e]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); })
    .toLowerCase();
}

function asArr(v) { return Array.isArray(v) ? v : []; }

/**
 * 从一份（可能残缺的）detail 抽取 4 类档案条目。
 * mergeDetail 已把顶层键、buyer/agency、completed、winner、packages、judges 全部补齐为安全结构，
 * 这里仍逐层做一次空值防护，避免旧数据里出现 null / 字符串 / 非数组等异常形态。
 * @returns {{buyer:Array, agency:Array, competitor:Array, judge:Array}} 已按 name_norm 去重；judges 同名属性取或
 */
function extractArchives(rawDetail, projectNo) {
  const d = mergeDetail(rawDetail);
  const no = text(projectNo);
  const out = { buyer: [], agency: [], competitor: [], judge: [] };
  const seen = { buyer: new Set(), agency: new Set(), competitor: new Set(), judge: new Map() };

  function add(kind, name, extra) {
    const n = text(name);
    const key = normName(n);
    if (!n || !key) return;              // 空名称一律跳过，不建空档案
    if (kind === 'judge') {
      const cur = seen.judge.get(key);
      if (cur) {
        cur.leader = cur.leader || !!extra.leader;
        cur.owner = cur.owner || !!extra.owner;
      } else {
        const item = { name: n, name_norm: key, leader: !!extra.leader, owner: !!extra.owner, source_project_no: no };
        seen.judge.set(key, item);
        out.judge.push(item);
      }
      return;
    }
    if (seen[kind].has(key)) return;
    seen[kind].add(key);
    out[kind].push(Object.assign({
      name: n, name_norm: key, phone: '', email: '', address: '', source_project_no: no
    }, extra || {}));
  }

  const buyer = d.buyer || {};
  add('buyer', buyer.name, { phone: text(buyer.phone), email: text(buyer.email), address: text(buyer.address) });
  const agency = d.agency || {};
  add('agency', agency.name, { phone: text(agency.phone), email: text(agency.email), address: text(agency.address) });

  const c = d.completed || {};
  function addWinner(w) {
    if (!w || typeof w !== 'object') return;
    add('competitor', w.lead);
    if (w.isUnion) asArr(w.members).forEach(function (m) { add('competitor', m); });
  }
  if (c.isSplit) {
    asArr(c.packages).forEach(function (p) { if (p && typeof p === 'object') addWinner(p.winner); });
  } else {
    addWinner(c.winner);
  }
  asArr(c.judges).forEach(function (j) {
    if (typeof j === 'string') add('judge', j, { leader: false, owner: false });
    else if (j && typeof j === 'object') add('judge', j.name, { leader: !!j.leader, owner: !!j.owner });
  });
  return out;
}

/* ---------- 多值联系方式：JSON 数组字符串存储（不改表结构，向后兼容历史纯文本） ----------
   选 JSON 数组而不是逗号拼接：地址、邮箱本身可能含逗号，逗号拼接会产生歧义、无法无损拆分。
   历史数据仍是纯文本（或非法 JSON）时，parseArchiveValues 一律当作「单值数组」读取，不丢数据；
   只有真正追加了新值时才把该行改写成 JSON 数组格式。 */

/** 值标准化：短文本（电话/邮箱）去所有空白；地址只合并连续空格并去首尾空格 */
function normFieldValue(v, mode) {
  const s = text(v);
  return mode === 'address' ? s.replace(/[ \t]+/g, ' ').trim() : s.replace(/\s+/g, '');
}

/** 解析存储值：JSON 数组优先；历史纯文本 / 非法 JSON 视为单值 */
function parseArchiveValues(v) {
  const s = text(v);
  if (!s) return [];
  if (s.charAt(0) === '[') {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(function (x) { return text(x); }).filter(Boolean);
    } catch (e) { /* 落到单值分支 */ }
  }
  return [s];
}

function serializeArchiveValues(list) { return JSON.stringify(list); }

/** 列表展示串（中文逗号分隔），供 title / 纯文本场景使用 */
function displayArchiveValues(v) { return parseArchiveValues(v).join('，'); }

/**
 * 3.2.3「去重后追加」：新值与已有值逐一比对，重复的不追加，不重复的追加到末尾。
 * @returns {{value:string, changed:boolean}} value 为序列化存储值；changed 表示是否真的追加了新值
 */
function appendUniqueValues(stored, incoming, mode) {
  const before = parseArchiveValues(stored);
  const val = normFieldValue(incoming, mode);
  const seen = new Set(before.map(function (x) { return normFieldValue(x, mode); }));
  const after = before.slice();
  if (val && !seen.has(val)) after.push(val);
  return { value: serializeArchiveValues(after), changed: after.length !== before.length };
}

/**
 * 把一份 detail 里的档案写入 4 张表。调用方必须已处在事务内（POST / PUT / backfill）。
 * buyer / agency：按 name_norm 匹配；匹配到时 phone / email / address 按 3.2.3「去重后追加」合并，
 *   没匹配到时新建。competitor：只按名称去重（不填联系方式），保持 INSERT OR IGNORE。
 * judge：同名合并「组长 / 业主」属性取或。
 * 事务边界、version 乐观锁、派生列全部由调用方负责，本函数只写 4 张档案表。
 * @returns {number} 本次实际新建的档案条数（追加更新不计入，保持既有语义）
 */
function upsertArchives(db, rawDetail, projectNo) {
  const items = extractArchives(rawDetail, projectNo);
  const t = nowText();
  let inserted = 0;

  ['buyer', 'agency'].forEach(function (kind) {
    const table = TABLES[kind].table;
    const sel = db.prepare('SELECT id, phone, email, address FROM ' + table + ' WHERE name_norm = ?');
    const ins = db.prepare('INSERT OR IGNORE INTO ' + table +
      ' (name, name_norm, phone, email, address, source_project_no, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const upd = db.prepare('UPDATE ' + table +
      ' SET phone = ?, email = ?, address = ?, updated_at = ? WHERE id = ?');
    items[kind].forEach(function (a) {
      const cur = sel.get(a.name_norm);
      const ph = appendUniqueValues(cur ? cur.phone : '', a.phone, 'short');
      const em = appendUniqueValues(cur ? cur.email : '', a.email, 'short');
      const ad = appendUniqueValues(cur ? cur.address : '', a.address, 'address');
      if (!cur) {
        const info = ins.run(a.name, a.name_norm, ph.value, em.value, ad.value,
          a.source_project_no, t, t);
        inserted += info.changes;
      } else if (ph.changed || em.changed || ad.changed) {
        // 只有真的追加了新值才写：重复 backfill 幂等，也不无谓刷新 updated_at
        upd.run(ph.value, em.value, ad.value, t, cur.id);
      }
    });
  });

  const competitorStmt = db.prepare('INSERT OR IGNORE INTO competitors' +
    ' (name, name_norm, phone, email, address, source_project_no, created_at, updated_at)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  items.competitor.forEach(function (a) {
    const info = competitorStmt.run(a.name, a.name_norm, a.phone, a.email, a.address,
      a.source_project_no, t, t);
    inserted += info.changes;
  });

  const judgeStmt = db.prepare(
    'INSERT INTO judges (name, name_norm, leader, owner, source_project_no, created_at, updated_at)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?)' +
    ' ON CONFLICT(name_norm) DO UPDATE SET' +
    '   leader = CASE WHEN excluded.leader = 1 THEN 1 ELSE judges.leader END,' +
    '   owner  = CASE WHEN excluded.owner  = 1 THEN 1 ELSE judges.owner  END,' +
    '   updated_at = excluded.updated_at'
  );
  items.judge.forEach(function (j) {
    judgeStmt.run(j.name, j.name_norm, j.leader ? 1 : 0, j.owner ? 1 : 0, j.source_project_no, t, t);
  });
  return inserted;
}

/**
 * 启动时回填历史项目（用户已确认自动建档）。
 * 只 INSERT OR IGNORE / ON CONFLICT，不动 projects 的 version / updated_at / 派生列，幂等。
 * 单行解析或写入出错只跳过该行并打印日志，绝不让服务启动失败。
 * @returns {{rows:number, inserted:number, skipped:number}}
 */
function backfillArchives(db) {
  const rows = db.prepare('SELECT row_id, project_no, detail FROM projects').all();
  const stat = { rows: rows.length, inserted: 0, skipped: 0 };
  const run = db.transaction(function () {
    rows.forEach(function (row) {
      let parsed = {};
      try {
        parsed = JSON.parse(row.detail || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
      } catch (e) { parsed = {}; }
      try {
        stat.inserted += upsertArchives(db, parsed, row.project_no);
      } catch (e) {
        stat.skipped++;
        console.log('[MIGRATION 004] backfill skipped row ' + row.row_id + ': ' + (e && e.message ? e.message : e));
      }
    });
  });
  run();
  return stat;
}

module.exports = {
  TABLES, UNIT_ATTRIBUTES, normName, countReferences, extractArchives, upsertArchives, backfillArchives,
  normFieldValue, parseArchiveValues, serializeArchiveValues, displayArchiveValues, appendUniqueValues
};
