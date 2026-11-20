/**
 * 第 10 步：参与项目数据看板的纯计算模块。
 * 只依赖纯模块（db 由调用方注入），不 require express，便于在 DB 副本上单测。
 *
 * 核心口径（已与用户确认）：
 *  - 名称匹配：archive.name_norm 与项目派生列拆分后逐项 normName 精确相等，避免子串误判。
 *  - 金额：全程整数分求和，展示层再 /1e6 转万元；中标类指标只统计 status='完成招标'。
 *  - 平均资金节约率：逐项目 (预算分-中标分)/预算分 的算术平均，预算=0 的中标项目跳过。
 *  - 竞争对手：单包取 award_amount_fen；分包取「该单位实际参与的包」金额之和（不按项目总额，避免夸大）。
 *  - 去重：项目数 / 明细按 project_no 唯一；联合体成员与分包中标都算参与。
 */
const { normName } = require('./archive');
const { normalizeAmount } = require('./money');

const TABLES = { buyer: 'buyers', agency: 'agencies', competitor: 'competitors' };

function text(v) { return String(v == null ? '' : v).trim(); }
function fenToWan(fen) { return (Number(fen || 0) / 1000000).toFixed(2); }

/** 逗号串按档案名精确命中；proj_types 形如「货物类,服务类」，winner_names 形如「A,B,C」 */
function splitCsv(s) {
  return text(s).split(',').map(function (x) { return text(x); }).filter(Boolean);
}
function csvHasName(csv, targetNorm) {
  return splitCsv(csv).some(function (x) { return normName(x) === targetNorm; });
}

/** 金额元文本 -> 整数分（与 derive.moneyFen 同口径；非法值按 0 处理，不打断统计） */
function yuanToFen(raw) {
  const a = normalizeAmount(text(raw).replace(/,/g, ''));
  return a ? a.fen : 0;
}

/** 项目类型归一：detail 里是「货物类/工程类/服务类」，去掉「类」字便于展示，未知原样 */
function typeLabel(v) {
  const s = text(v);
  return s.replace(/类$/, '') || s;
}

/** 省/直辖市：region 形如「上海市-浦东新区」「浙江省-杭州市-西湖区」，取首段 */
function province(region) {
  return text(region).split('-')[0].trim();
}

/** 地级市/直辖市区：region 第二段。如「湖北省-武汉市」→武汉市；「北京市-海淀区」→海淀区 */
function cityOf(region) {
  const parts = text(region).split('-');
  return (parts[1] || '').trim();
}

/** 从 projects.detail 安全解析 completed（非法 JSON 返回空结构） */
function completedOf(detail) {
  let d = {};
  try { d = JSON.parse(detail || '{}'); } catch (e) { d = {}; }
  return (d && typeof d === 'object' && d.completed && typeof d.completed === 'object') ? d.completed : {};
}

/**
 * 单包/分包里，目标单位出现的角色次数统计。
 * 返回 { hit, lead, member, winFen, types, hitPackages, soloHits, unionHits, partners }
 *  - hitPackages: 命中的包号（单包为 ['全包']），供明细「参与深度」Tag 使用
 *  - soloHits / unionHits: 独立中标 / 联合体中标的「次数」（按角色点，非项目去重）
 *  - partners: 联合体搭档 [{ name, role }]；目标为牵头时搭档是成员方，目标为成员时搭档是牵头方
 */
function collectCompetitor(row, targetNorm) {
  const c = completedOf(row.detail);
  const stat = { hit: false, lead: 0, member: 0, winFen: 0, types: [], hitPackages: [], soloHits: 0, unionHits: 0, partners: [] };

  function checkWinner(w) {
    if (!w || typeof w !== 'object') return null;
    const lead = text(w.lead);
    const members = (Array.isArray(w.members) ? w.members : []).map(text).filter(Boolean);
    const isLead = normName(lead) === targetNorm;
    const memberHits = members.filter(function (m) { return normName(m) === targetNorm; });
    if (!isLead && !memberHits.length) return null;
    stat.hit = true;
    if (isLead) stat.lead++;
    stat.member += memberHits.length;
    const union = !!(w.isUnion || (lead && members.length));
    if (union) stat.unionHits++; else stat.soloHits++;
    // 记录搭档：目标当牵头 -> 成员方是搭档；目标当成员 -> 牵头方是搭档
    if (isLead) members.forEach(function (m) { if (normName(m) !== targetNorm) stat.partners.push({ name: m, role: '成员方' }); });
    memberHits.forEach(function () { if (lead && normName(lead) !== targetNorm) stat.partners.push({ name: lead, role: '牵头方' }); });
    return { union: union };
  }

  if (c.isSplit) {
    const packages = Array.isArray(c.packages) ? c.packages : [];
    packages.forEach(function (p, idx) {
      if (!p || typeof p !== 'object') return;
      const result = checkWinner(p.winner || {});
      if (!result) return;
      stat.hitPackages.push(text(p.name) || ('包' + (idx + 1)));
      stat.winFen += yuanToFen(p.amount_yuan);
      if (text(p.type)) stat.types.push(typeLabel(p.type));
    });
  } else {
    const result = checkWinner(c.winner || {});
    if (result) {
      stat.hitPackages.push('全包');
      stat.winFen = Number(row.award_amount_fen || 0);
      if (text(c.type)) stat.types.push(typeLabel(c.type));
    }
  }
  return stat;
}

/** 分布计数 -> 降序 Top N 数组 [{name,value,pct}] */
function distribution(countMap, total, topN) {
  const arr = Object.keys(countMap).map(function (name) {
    return { name: name, value: countMap[name], pct: total ? Math.round(countMap[name] * 1000 / total) / 10 : 0 };
  });
  arr.sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); });
  return topN ? arr.slice(0, topN) : arr;
}

function inc(map, key) { if (key) map[key] = (map[key] || 0) + 1; }

/* ===== 第 11 步：采购单位四大情报模块辅助函数 ===== */

/** 从单条项目提取所有中标单位名（牵头 + 联合体成员 + 每个分包的中标方），按项目去重 */
function winnerNamesOf(row) {
  const c = completedOf(row.detail);
  const list = [];
  function push(w) {
    if (!w || typeof w !== 'object') return;
    const lead = text(w.lead);
    if (lead) list.push(lead);
    if (w.isUnion) (Array.isArray(w.members) ? w.members : []).forEach(function (m) { if (text(m)) list.push(text(m)); });
  }
  if (c.isSplit) (Array.isArray(c.packages) ? c.packages : []).forEach(function (p) { if (p) push(p.winner || {}); });
  else push(c.winner || {});
  // 同一项目同一单位可能既是牵头又是成员，按归一化名去重
  const seen = new Set();
  return list.filter(function (n) { const k = normName(n); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** 从 detail.completed.judges 过滤 owner=true 的业主评委名（按项目去重） */
function ownerJudgesOf(row) {
  const c = completedOf(row.detail);
  const list = (Array.isArray(c.judges) ? c.judges : [])
    .filter(function (j) { return j && typeof j === 'object' && j.owner === true; })
    .map(function (j) { return text(j.name); })
    .filter(Boolean);
  const seen = new Set();
  return list.filter(function (n) { const k = normName(n); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 从 detail.completed.judges 过滤 leader=true 的组长评委名（按项目去重） */
function leaderJudgesOf(row) {
  const c = completedOf(row.detail);
  const list = (Array.isArray(c.judges) ? c.judges : [])
    .filter(function (j) { return j && typeof j === 'object' && j.leader === true; })
    .map(function (j) { return text(j.name); })
    .filter(Boolean);
  const seen = new Set();
  return list.filter(function (n) { const k = normName(n); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 预算（整数分）落入的区间标签 */
function budgetBucket(fen) {
  const v = Number(fen || 0);
  if (v < 100000000) return '100万以下';        // 100万 = 1e8 分
  if (v < 500000000) return '100-500万';        // 500万 = 5e8 分
  if (v < 1000000000) return '500-1000万';      // 1000万 = 1e9 分
  return '1000万以上';
}

/** 从项目创建时间取发标月份（1-12） */
function monthOf(row) {
  const m = /^\d{4}-(\d{2})/.exec(text(row.created_at));
  return m ? Number(m[1]) : 0;
}

/** 榜单：countMap -> 带属性标注的 Top N [{name,value,attribute}] */
function ranking(countMap, attrMap, topN) {
  return distribution(countMap, 0, topN).map(function (x) {
    return { name: x.name, value: x.value, attribute: (attrMap && attrMap[normName(x.name)]) || '' };
  });
}

/**
 * 计算看板数据
 * @param db better-sqlite3 实例
 * @param type buyer|agency|competitor
 * @param id 档案主键
 * @param year 可选年份（数字或字符串）；不传则全部年份
 * @returns {{error?:string, notFound?:boolean, ...}}
 */
function computeStats(db, type, archiveId, year) {
  const table = TABLES[type];
  if (!table) return { error: '看板类型不在可选范围内' };
  const id = Number(archiveId);
  if (!Number.isInteger(id)) return { error: '档案标识无效' };

  const profile = db.prepare('SELECT id, name, name_norm, attribute FROM ' + table + ' WHERE id = ?').get(id);
  if (!profile) return { error: '档案不存在', notFound: true };

  // 可用年份：从全库未删除项目的 created_at 动态提取（降序），供前端年份下拉使用
  const years = db.prepare("SELECT DISTINCT substr(created_at,1,4) y FROM projects WHERE deleted = 0 AND created_at >= '2000-01-01' ORDER BY y DESC").all()
    .map(function (r) { return Number(r.y); }).filter(function (y) { return Number.isInteger(y) && y > 2000; });

  const name = text(profile.name);
  const targetNorm = normName(name);
  let all = db.prepare('SELECT row_id, project_no, project_name, status, region, budget_fen, award_amount_fen, award_time, created_at, buyer_name, agency_name, method, winner_names, project_types, detail FROM projects WHERE deleted = 0').all();
  // 年份筛选：按项目创建/发标时间（覆盖所有状态项目，不依赖 award_time）
  const yearNum = Number(year);
  if (year != null && year !== '' && Number.isInteger(yearNum) && yearNum > 2000) {
    all = all.filter(function (r) { return Number(text(r.created_at).slice(0, 4)) === yearNum; });
  }
  const done = function (r) { return r.status === '完成招标'; };

  let summary = [];
  let charts = [];
  let projects = [];

  if (type === 'buyer') {
    // 采购单位：buyer_name 精确命中 = 该单位发包的项目
    const matched = all.filter(function (r) { return normName(r.buyer_name) === targetNorm; });
    const doneRows = matched.filter(done);
    const totalBudgetFen = matched.reduce(function (s, r) { return s + Number(r.budget_fen || 0); }, 0);
    const totalAwardFen = doneRows.reduce(function (s, r) { return s + Number(r.award_amount_fen || 0); }, 0);

    // ===== 模块一：核心商业价值总览 =====
    const rates = doneRows.filter(function (r) { return Number(r.budget_fen) > 0; })
      .map(function (r) { return (Number(r.budget_fen) - Number(r.award_amount_fen || 0)) / Number(r.budget_fen); });
    const avgRate = rates.length ? rates.reduce(function (a, b) { return a + b; }, 0) / rates.length : 0;
    const avgBudgetFen = matched.length ? Math.round(totalBudgetFen / matched.length) : 0;
    const typeMap = {}, methodMap = {}, agencyMap = {}, supplierMap = {}, ownerJudgeMap = {};

    matched.forEach(function (r) {
      inc(methodMap, text(r.method));
      inc(agencyMap, text(r.agency_name));
      // 项目类型：从 detail 的 completed.type / packages[].type 提取（更真实）
      const ct = completedOf(r.detail);
      const types = ct.isSplit
        ? (Array.isArray(ct.packages) ? ct.packages.map(function (p) { return p && typeLabel(p.type); }) : [])
        : [typeLabel(ct.type)];
      types.forEach(function (t) { if (t) inc(typeMap, t); });
      // 常胜供应商：中标单位（单包+分包+联合体成员全部计入）
      winnerNamesOf(r).forEach(function (n) { inc(supplierMap, n); });
      // 惯用业主评委：owner=true
      ownerJudgesOf(r).forEach(function (n) { inc(ownerJudgeMap, n); });
    });

    // 大概率项目类型：频次最高的 1-2 种
    const topTypes = distribution(typeMap, 0, 2).map(function (x) { return x.name; });
    // 前 4 项供新看板四大模块展示（顺序即卡片顺序）；
    // 后 2 项为兼容旧测试/旧客户端保留的派生值（新看板不额外渲染）。
    summary = [
      { key: 'totalBudget', label: '累计采购规模', value: fenToWan(totalBudgetFen), unit: '万元' },
      { key: 'avgBudget', label: '平均单项目预算', value: fenToWan(avgBudgetFen), unit: '万元' },
      { key: 'avgSaving', label: '平均资金节约率', value: (Math.round(avgRate * 1000) / 10).toFixed(1), unit: '%' },
      { key: 'topType', label: '大概率项目类型', value: topTypes.length ? topTypes.join(' / ') : '—', unit: '' },
      { key: 'projectCount', label: '总招标项目数', value: matched.length, unit: '个' },
      { key: 'totalAward', label: '总中标金额', value: fenToWan(totalAwardFen), unit: '万元' }
    ];

    // ===== 模块二：采购偏好分布（ECharts 数据） =====
    const bucketOrder = ['100万以下', '100-500万', '500-1000万', '1000万以上'];
    const bucketMap = {};
    bucketOrder.forEach(function (b) { bucketMap[b] = 0; });
    matched.forEach(function (r) { bucketMap[budgetBucket(r.budget_fen)]++; });
    const monthMap = {};
    for (let m = 1; m <= 12; m++) monthMap[m] = 0;
    matched.forEach(function (r) { const m = monthOf(r); if (m >= 1 && m <= 12) monthMap[m]++; });
    const echarts = {
      budgetBucket: bucketOrder.map(function (b) { return { name: b, value: bucketMap[b] }; }),
      method: distribution(methodMap, 0).map(function (x) { return { name: x.name, value: x.value }; }),
      month: Object.keys(monthMap).map(function (m) { return { month: Number(m), value: monthMap[m] }; })
    };

    // ===== 模块三：竞争格局与人脉情报 =====
    // 属性映射：competitors.attribute（企业属性）与 judges 的 leader/owner 标记
    const attrMap = {};
    db.prepare('SELECT name_norm, attribute FROM competitors').all().forEach(function (r) { attrMap[r.name_norm] = r.attribute; });
    const rankings = {
      suppliers: ranking(supplierMap, attrMap, 5),
      agencies: ranking(agencyMap, null, 5),
      ownerJudges: ranking(ownerJudgeMap, null, 5)
    };

    // 兼容旧字段（其他看板复用一套渲染；buyer 走新模块，但这些保留不碍事）
    charts = [
      { key: 'method', label: '常用采购方式分布', items: distribution(methodMap, matched.length) },
      { key: 'agency', label: '主要合作的代理机构', items: distribution(agencyMap, matched.length, 3) }
    ];
    projects = matched.map(function (r) {
      return { row_id: r.row_id, project_no: r.project_no, project_name: r.project_name, status: r.status, region: r.region, budgetWan: fenToWan(r.budget_fen), awardWan: fenToWan(r.award_amount_fen), method: r.method, awardTime: r.award_time, role: '招标方' };
    });

    return { profile: { id: profile.id, name: name, type: type, attribute: profile.attribute }, summary: summary, charts: charts, projects: projects, echarts: echarts, rankings: rankings, years: years, year: (year == null || year === '' ? null : yearNum) };

  } else if (type === 'agency') {
    // 代理机构：agency_name 精确命中 = 该机构代理的项目
    const matched = all.filter(function (r) { return normName(r.agency_name) === targetNorm; });
    const doneRows = matched.filter(done);
    const totalAwardFen = doneRows.reduce(function (s, r) { return s + Number(r.award_amount_fen || 0); }, 0);
    const totalBudgetFen = matched.reduce(function (s, r) { return s + Number(r.budget_fen || 0); }, 0);
    const terminated = matched.filter(function (r) { return r.status === '终止招标'; }).length;

    // ===== 模块一：代理实力与规模 =====
    const rates = doneRows.filter(function (r) { return Number(r.budget_fen) > 0; })
      .map(function (r) { return (Number(r.budget_fen) - Number(r.award_amount_fen || 0)) / Number(r.budget_fen); });
    const avgRate = rates.length ? rates.reduce(function (a, b) { return a + b; }, 0) / rates.length : 0;
    const terminateRate = matched.length ? Math.round(terminated * 1000 / matched.length) / 10 : 0;

    const buyerMap = {}, methodMap = {}, regionMap = {}, supplierMap = {}, leaderJudgeMap = {}, projectTypeMap = {};
    matched.forEach(function (r) {
      inc(buyerMap, text(r.buyer_name));
      inc(methodMap, text(r.method));
      inc(regionMap, province(r.region));
      // 项目类型：从 project_types 派生列（逗号串，已按包去重）统计，供投标方判断代理擅长领域
      splitCsv(r.project_types).forEach(function (t) { inc(projectTypeMap, typeLabel(t)); });
      winnerNamesOf(r).forEach(function (n) { inc(supplierMap, n); });
      leaderJudgesOf(r).forEach(function (n) { inc(leaderJudgeMap, n); });
    });

    // 前 4 项为新看板卡片；后 3 项为兼容旧测试的派生值（按 key 查找，顺序无关）
    summary = [
      { key: 'projectCount', label: '累计代理项目数', value: matched.length, unit: '个' },
      { key: 'totalAward', label: '累计代理中标金额', value: fenToWan(totalAwardFen), unit: '万元' },
      { key: 'avgSaving', label: '平均资金节约率', value: (Math.round(avgRate * 1000) / 10).toFixed(1), unit: '%' },
      { key: 'terminateRate', label: '流标 / 终止率', value: terminateRate.toFixed(1), unit: '%' },
      { key: 'terminated', label: '终止 / 流标项目数', value: terminated, unit: '个' },
      { key: 'totalBudget', label: '总预算金额', value: fenToWan(totalBudgetFen), unit: '万元' }
    ];

    // ===== 模块二：业务特征与偏好（ECharts 数据） =====
    const echarts = {
      buyerTop: distribution(buyerMap, 0, 5).map(function (x) { return { name: x.name, value: x.value }; }),
      method: distribution(methodMap, 0).map(function (x) { return { name: x.name, value: x.value }; }),
      region: distribution(regionMap, 0).map(function (x) { return { name: x.name, value: x.value }; }),
      regionTop: distribution(regionMap, 0, 5).map(function (x) { return { name: x.name, value: x.value }; }),
      projectType: distribution(projectTypeMap, 0).map(function (x) { return { name: x.name, value: x.value }; })
    };

    // ===== 模块三：竞争格局与人脉情报 =====
    const attrMap = {};
    db.prepare('SELECT name_norm, attribute FROM competitors').all().forEach(function (r) { attrMap[r.name_norm] = r.attribute; });
    const rankings = {
      leaderJudges: ranking(leaderJudgeMap, null, 5),
      suppliers: ranking(supplierMap, attrMap, 5)
    };

    charts = [
      { key: 'buyer', label: '主要服务的采购单位', items: distribution(buyerMap, matched.length, 3) },
      { key: 'method', label: '采购方式偏好', items: distribution(methodMap, matched.length) }
    ];
    projects = matched.map(function (r) {
      return { row_id: r.row_id, project_no: r.project_no, project_name: r.project_name, status: r.status, region: r.region, budgetWan: fenToWan(r.budget_fen), awardWan: fenToWan(r.award_amount_fen), method: r.method, awardTime: r.award_time, role: '代理方' };
    });

    return { profile: { id: profile.id, name: name, type: type, attribute: profile.attribute }, summary: summary, charts: charts, projects: projects, echarts: echarts, rankings: rankings, years: years, year: (year == null || year === '' ? null : yearNum) };

  } else {
    // ===== 竞争对手画像：严格只统计「完成招标」项目（反映真实战果） =====
    const seen = new Map();          // project_no -> { project, winFen, ... }
    let leadTotal = 0, memberTotal = 0;
    const buyerMap = {}, agencyMap = {}, partnerLeadMap = {}, partnerMemberMap = {}, methodMap = {};

    all.filter(done).forEach(function (r) {
      const stat = collectCompetitor(r, targetNorm);
      if (!stat.hit) return;
      leadTotal += stat.lead;
      memberTotal += stat.member;
      inc(buyerMap, text(r.buyer_name));
      inc(agencyMap, text(r.agency_name));
      inc(methodMap, text(r.method));
      // 黄金搭档：按搭档角色分别计数（牵头方 / 成员方）
      stat.partners.forEach(function (pt) {
        if (pt.role === '牵头方') inc(partnerLeadMap, pt.name);
        else inc(partnerMemberMap, pt.name);
      });

      const key = text(r.project_no) || ('row_' + r.row_id);
      const existing = seen.get(key);
      if (!existing) {
        const isSplit = !!completedOf(r.detail).isSplit;
        seen.set(key, {
          project: {
            row_id: r.row_id, project_no: r.project_no, project_name: r.project_name,
            status: r.status, region: r.region, budgetWan: fenToWan(r.budget_fen),
            awardWan: fenToWan(stat.winFen), method: r.method, awardTime: r.award_time,
            role: stat.lead > 0 ? (stat.member > 0 ? '牵头 + 成员' : '牵头方') : '联合体成员',
            isSplit: isSplit,
            packages: stat.hitPackages.slice(),
            depth: !isSplit ? '全包' : stat.hitPackages.join('、')
          },
          winFen: stat.winFen,
          budgetFen: Number(r.budget_fen || 0),
          types: stat.types.slice(),
          region: province(r.region),
          city: cityOf(r.region),
          solo: stat.soloHits > 0 && stat.unionHits === 0,
          union: stat.unionHits > 0
        });
      } else {
        // 同一项目多包命中：累加各命中包金额，合并类型/包号/角色
        existing.winFen += stat.winFen;
        stat.types.forEach(function (t) { if (existing.types.indexOf(t) < 0) existing.types.push(t); });
        stat.hitPackages.forEach(function (p) { if (existing.project.packages.indexOf(p) < 0) existing.project.packages.push(p); });
        existing.project.depth = existing.project.packages.join('、');
        if (stat.lead > 0) existing.project.role = '牵头 + 成员';
        if (stat.unionHits > 0) existing.union = true;
      }
    });

    const rows = Array.from(seen.values());
    const totalWinFen = rows.reduce(function (s, x) { return s + x.winFen; }, 0);
    const typeMap = {}, regionMap = {}, regionCityMap = {}, bucketMap = {};
    const bucketOrder = ['100万以下', '100-500万', '500-1000万', '1000万以上'];
    bucketOrder.forEach(function (b) { bucketMap[b] = 0; });
    const rates = [];
    rows.forEach(function (x) {
      x.types.forEach(function (t) { inc(typeMap, t); });
      inc(regionMap, x.region);
      // 市级下钻数据：按省分组的地级市中标次数
      if (x.region && x.city) {
        if (!regionCityMap[x.region]) regionCityMap[x.region] = {};
        inc(regionCityMap[x.region], x.city);
      }
      bucketMap[budgetBucket(x.budgetFen)]++;
      if (x.budgetFen > 0) rates.push((x.budgetFen - x.winFen) / x.budgetFen);
    });
    const avgRate = rates.length ? rates.reduce(function (a, b) { return a + b; }, 0) / rates.length : 0;

    // 独立 vs 联合体：按「项目」去重统计比例（一个项目既牵头又成员只算 1 个）
    const unionProjects = rows.filter(function (x) { return x.union; }).length;
    const soloProjects = rows.length - unionProjects;
    const unionPct = rows.length ? Math.round(unionProjects * 1000 / rows.length) / 10 : 0;

    // 黄金搭档：目标常当成员则列牵头方，常当牵头则列成员方（按本项目角色总量判断）
    const partners = leadTotal >= memberTotal
      ? distribution(partnerMemberMap, 0, 5).map(function (x) { return { name: x.name, value: x.value, role: '成员方' }; })
      : distribution(partnerLeadMap, 0, 5).map(function (x) { return { name: x.name, value: x.value, role: '牵头方' }; });

    // 前 4 项为新看板卡片；leadRatio 为兼容旧测试的派生值
    summary = [
      { key: 'projectCount', label: '累计中标项目数', value: rows.length, unit: '个' },
      { key: 'totalAward', label: '累计中标总金额', value: fenToWan(totalWinFen), unit: '万元' },
      { key: 'avgSaving', label: '平均让利 / 节约率', value: (Math.round(avgRate * 1000) / 10).toFixed(1), unit: '%' },
      { key: 'roleStyle', label: '独立 vs 联合体', value: soloProjects + ' : ' + unionProjects, unit: '个' },
      { key: 'leadRatio', label: '牵头 / 成员次数', value: leadTotal + ' : ' + memberTotal, unit: '' }
    ];

    const echarts = {
      type: distribution(typeMap, 0).map(function (x) { return { name: x.name, value: x.value }; }),
      regionTop: distribution(regionMap, 0, 5).map(function (x) { return { name: x.name, value: x.value }; }),
      awardBucket: bucketOrder.map(function (b) { return { name: b, value: bucketMap[b] }; }),
      method: distribution(methodMap, 0).map(function (x) { return { name: x.name, value: x.value }; }),
      // 地图数据：省级 + 按省分组的市级（供下钻）
      regionGeo: distribution(regionMap, 0).map(function (x) { return { name: x.name, value: x.value }; }),
      regionCity: regionCityMap
    };
    const rankings = {
      buyers: ranking(buyerMap, null, 5),
      agencies: ranking(agencyMap, null, 5),
      partners: partners
    };

    charts = [
      { key: 'type', label: '擅长项目类型分布', items: distribution(typeMap, rows.length) },
      { key: 'region', label: '活跃地区分布', items: distribution(regionMap, rows.length) },
      { key: 'role', label: '牵头方 vs 联合体成员', items: [
        { name: '牵头方', value: leadTotal, pct: (function () { const t = leadTotal + memberTotal; return t ? Math.round(leadTotal * 1000 / t) / 10 : 0; })() },
        { name: '联合体成员', value: memberTotal, pct: (function () { const t = leadTotal + memberTotal; return t ? Math.round(memberTotal * 1000 / t) / 10 : 0; })() }
      ] }
    ];
    projects = rows.map(function (x) {
      x.project.awardWan = fenToWan(x.winFen);
      return x.project;
    });

    return { profile: { id: profile.id, name: name, type: type, attribute: profile.attribute }, summary: summary, charts: charts, projects: projects, echarts: echarts, rankings: rankings, unionPct: unionPct, years: years, year: (year == null || year === '' ? null : yearNum) };
  }

  return { profile: { id: profile.id, name: name, type: type, attribute: profile.attribute }, summary: summary, charts: charts, projects: projects, years: years, year: (year == null || year === '' ? null : yearNum) };
}

module.exports = { computeStats, TABLES, normName, fenToWan };
