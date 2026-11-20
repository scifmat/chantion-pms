/**
 * 全量表单结构归一化。
 * 第 5 步从 routes/projects.js 抽出，理由是：003 迁移的历史回填也要用同一份
 * mergeDetail，若留在路由里会形成 app.js -> db.js -> migrate.js -> routes -> db.js 循环依赖。
 * 纯函数，不依赖 express / db，可被写入链路与迁移链路共同引用。
 */
function asObj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }

function normalizeWinner(w) {
  w = asObj(w);
  return {
    lead: String(w.lead == null ? '' : w.lead),
    members: (Array.isArray(w.members) && w.members.length) ? w.members.map(function (x) { return String(x == null ? '' : x); }) : [''],
    isUnion: !!w.isUnion
  };
}

function normalizePackage(p) {
  p = asObj(p);
  return {
    name: String(p.name == null ? '' : p.name),
    type: String(p.type == null ? '' : p.type),
    amount_yuan: String(p.amount_yuan == null ? '' : p.amount_yuan),
    winner: normalizeWinner(p.winner)
  };
}

function normalizeJudge(j) {
  if (typeof j === 'string') return { name: j, leader: false, owner: false };
  j = asObj(j);
  return { name: String(j.name == null ? '' : j.name), leader: !!j.leader, owner: !!j.owner };
}

function mergeDetail(input) {
  const src = asObj(input);
  const c = asObj(src.completed);
  return {
    public: Object.assign({ status: '意向公示', region: '', project_no: '', project_name: '', budget_yuan: '', ceiling_yuan: '' }, asObj(src.public)),
    buyer: Object.assign({ name: '', phone: '', email: '', address: '' }, asObj(src.buyer)),
    agency: Object.assign({ name: '', phone: '', email: '', address: '' }, asObj(src.agency)),
    correctionsOn: !!src.correctionsOn,
    corrections: Array.isArray(src.corrections) ? src.corrections.map(function (x) {
      x = asObj(x);
      return {
        items: Array.isArray(x.items) ? x.items.map(String) : [],
        content: String(x.content == null ? '' : x.content),
        date: String(x.date == null ? '' : x.date),
        url: String(x.url == null ? '' : x.url)
      };
    }) : [],
    intention: Object.assign({ startDate: '', endDate: '', url: '' }, asObj(src.intention)),
    bidding: Object.assign({ method: '', periodDays: '', docStart: '', docEnd: '', docWay: '', docNote: '', demand: '', bidStart: '', bidEnd: '', url: '' }, asObj(src.bidding)),
    terminated: Object.assign({ reason: '', note: '', url: '' }, asObj(src.terminated)),
    completed: {
      type: String(c.type == null ? '' : c.type),
      amount_yuan: String(c.amount_yuan == null ? '' : c.amount_yuan),
      winDate: String(c.winDate == null ? '' : c.winDate),
      winner: normalizeWinner(c.winner),
      isSplit: !!c.isSplit,
      packages: Array.isArray(c.packages) ? c.packages.map(normalizePackage) : [],
      judges: Array.isArray(c.judges) ? c.judges.map(normalizeJudge) : [],
      url: String(c.url == null ? '' : c.url)
    },
    operationLog: Array.isArray(src.operationLog) ? src.operationLog : []
  };
}

module.exports = { asObj, mergeDetail };
