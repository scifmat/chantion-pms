// 项目-中标单位映射：把 detail JSON 里的中标结构拆成可 SQL 聚合的规范化行。
// 与 stats.js 的 collectCompetitor 同口径：单包取项目 award_amount_fen，
// 分包取「该单位实际参与的包」金额；联合体牵头/成员都算中标方，同一包内按名去重。
const { normName } = require('./archive');
const { normalizeAmount } = require('./money');

function text(v) { return String(v == null ? '' : v).trim(); }

function yuanToFen(raw) {
  const a = normalizeAmount(text(raw).replace(/,/g, ''));
  return a ? a.fen : 0;
}

/** 从 detail.completed 提取 [{name, norm, awardFen, src}]；调用方负责同一事务内先删后插 */
function buildWinnerRows(detail, projectNo, projectAwardFen) {
  let completed = {};
  // 写接口传进来的是已解析的 detail 对象；迁移回填时传的是数据库里的 JSON 字符串，两种都要兼容
  let d = detail;
  if (typeof d === 'string') {
    try { d = JSON.parse(d || '{}'); } catch (e) { d = {}; }
  }
  if (d && typeof d === 'object' && d.completed && typeof d.completed === 'object') completed = d.completed;

  const rows = [];
  const seen = new Set();

  function addWinner(w, awardFen, src) {
    if (!w || typeof w !== 'object') return;
    const names = [];
    const lead = text(w.lead);
    if (lead) names.push(lead);
    if (w.isUnion && Array.isArray(w.members)) w.members.forEach(function (m) { if (text(m)) names.push(text(m)); });
    names.forEach(function (name) {
      const norm = normName(name);
      if (!norm) return;
      const key = norm + '|' + src;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ project_no: projectNo, winner_name: name, winner_norm: norm, award_fen: Number(awardFen) || 0, src: src });
    });
  }

  if (completed.isSplit && Array.isArray(completed.packages)) {
    completed.packages.forEach(function (p, idx) {
      if (!p || typeof p !== 'object') return;
      addWinner(p.winner || {}, yuanToFen(p.amount_yuan), 'package:' + idx);
    });
  } else {
    addWinner(completed.winner || {}, Number(projectAwardFen) || 0, 'solo');
  }
  return rows;
}

/** 同一事务内调用：先清本项目旧映射，再写入新映射 */
function replaceProjectWinners(db, projectNo, detail, projectAwardFen) {
  db.prepare('DELETE FROM project_winners WHERE project_no = ?').run(projectNo);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO project_winners (project_no, winner_name, winner_norm, award_fen, src) VALUES (?, ?, ?, ?, ?)'
  );
  buildWinnerRows(detail, projectNo, projectAwardFen).forEach(function (r) {
    ins.run(r.project_no, r.winner_name, r.winner_norm, r.award_fen, r.src);
  });
}

/** 迁移 010 一次性回填：只处理未软删除项目；历史数据不改主表、不改 detail */
function backfillWinners(db) {
  const rows = db.prepare('SELECT project_no, detail, award_amount_fen FROM projects WHERE deleted = 0').all();
  let written = 0;
  const run = db.transaction(function () {
    rows.forEach(function (r) {
      replaceProjectWinners(db, r.project_no, r.detail, r.award_amount_fen);
      written++;
    });
  });
  run();
  return { projects: rows.length, written: written };
}

module.exports = { buildWinnerRows, replaceProjectWinners, backfillWinners };
