/**
 * 演示数据种子：
 *  第一批 DEMO-2026-xxx（60 条，2026 年，原样保留）；
 *  第二批 MORE-YYYY-xxx（60 条，跨 2024/2025/2026，扩充省份、档案与年份维度）。
 * 覆盖各状态 / 预算区间 / 采购方式 / 月份 / 项目类型 / 单包与分包 / 联合体，
 * 并自动沉淀采购单位、代理机构、竞争对手、评委档案。
 *
 * 设计原则：
 *  - 幂等：项目编号固定，已存在则跳过；档案靠 name_norm + INSERT OR IGNORE 去重。
 *  - 口径一致：复用 mergeDetail / normalizeDetailAmounts / deriveFromDetail / upsertArchives，
 *    与前端 POST /api/projects 走同一条派生与建档链路，绝不做手写 SQL 的脏数据。
 *  - 金额用「元」文本进入 detail，由 derive 精确换算整数分。
 *
 * 运行：node scripts/seed-demo-data.mjs   （会写真实库 server/data/chantion.db；已提前备份）
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SERVER = path.join(ROOT, 'server')
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
// 默认写真实库；可用 SEED_DB_PATH 指向副本做试跑验证
const dbPath = process.env.SEED_DB_PATH || path.join(SERVER, 'data/chantion.db')
const db = new Database(dbPath)

const { mergeDetail } = require(path.join(SERVER, 'detail.js'))
const { normalizeDetailAmounts, deriveFromDetail } = require(path.join(SERVER, 'derive.js'))
const { upsertArchives } = require(path.join(SERVER, 'archive.js'))
const { writeLog } = require(path.join(SERVER, 'operation.js'))

/* ---------- 确定性伪随机（固定种子，结果可复现） ---------- */
let _seed = 20261118
function rand() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff }
function pick(arr) { return arr[Math.floor(rand() * arr.length)] }
function pickN(arr, n) {
  const pool = arr.slice(); const out = []
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
  return out
}

/* ---------- 主数据字典 ---------- */
const BUYERS = [
  { name: '武汉市卫生健康委员会', attr: '政府机关' },
  { name: '浙江大学', attr: '事业单位' },
  { name: '国网湖北省电力有限公司', attr: '国有企业' },
  { name: '上海市浦东新区教育局', attr: '政府机关' },
  { name: '深圳市第二人民医院', attr: '事业单位' },
  { name: '湖北省交通投资集团有限公司', attr: '国有企业' },
  { name: '杭州数字经济产业园管委会', attr: '政府机关' },
  { name: '苏州工业园区职业技术学院', attr: '事业单位' }
]
const AGENCIES = [
  { name: '中招国际招标有限公司', attr: '民营企业' },
  { name: '湖北省招标股份有限公司', attr: '国有企业' },
  { name: '国信招标集团股份有限公司', attr: '民营企业' },
  { name: '上海机电设备招标有限公司', attr: '国有企业' },
  { name: '深圳市国际招标有限公司', attr: '民营企业' },
  { name: '浙江远大工程咨询有限公司', attr: '民营企业' }
]
const SUPPLIERS = [
  { name: '华为技术有限公司', attr: '民营企业' },
  { name: '中国建筑第五工程局有限公司', attr: '国有企业' },
  { name: '浪潮集团有限公司', attr: '国有企业' },
  { name: '浙江大华技术股份有限公司', attr: '民营企业' },
  { name: '中铁十一局集团有限公司', attr: '国有企业' },
  { name: '湖北兴发化工集团股份有限公司', attr: '民营企业' },
  { name: '上海电气集团股份有限公司', attr: '国有企业' },
  { name: '深圳市腾讯计算机系统有限公司', attr: '民营企业' },
  { name: '中移系统集成有限公司', attr: '国有企业' },
  { name: '武汉光谷金信科技有限公司', attr: '民营企业' },
  { name: '江苏中天科技股份有限公司', attr: '民营企业' },
  { name: '中国软件与技术服务股份有限公司', attr: '国有企业' }
]
const JUDGES = [
  { name: '陈建国', owner: true }, { name: '李晓明', owner: true }, { name: '王海燕', owner: true },
  { name: '赵志强', owner: true }, { name: '刘芳', owner: true }, { name: '周文斌', owner: false, leader: true },
  { name: '吴敏', owner: false, leader: true }, { name: '徐国强', owner: false }, { name: '孙丽', owner: false },
  { name: '马跃', owner: false, leader: true }
]
const REGIONS = ['湖北省-武汉市', '北京市-海淀区', '浙江省-杭州市-西湖区', '上海市-浦东新区',
  '广东省-深圳市-南山区', '江苏省-苏州市', '湖北省-宜昌市', '浙江省-宁波市']
const METHODS = ['公开招标', '邀请招标', '竞争性谈判', '竞争性磋商', '询价采购', '单一来源']
const TYPES = ['货物类', '工程类', '服务类']
const STATUSES = ['完成招标', '完成招标', '完成招标', '完成招标', '完成招标', '完成招标',
  '完成招标', '完成招标', '完成招标', '完成招标', '完成招标', '正在招标', '正在招标',
  '正在招标', '正在招标', '意向公示', '意向公示', '意向公示', '终止招标', '终止招标']
const PROJ_WORDS = ['智慧校园信息化建设', '医疗设备和耗材采购', '城市道路改造工程', '数据中心机房建设',
  '物业服务外包', '电梯采购及安装', '医院信息系统升级', '配电网自动化改造', '实验室仪器设备采购',
  '园区安防监控系统', '轨道交通车辆采购', '园林绿化养护服务', '档案馆数字化加工', '新能源充电桩建设',
  '应急指挥平台建设', '食堂食材配送服务', '污水处理厂设备更新', '办公家具采购', '5G 基站建设',
  '公路桥梁检测服务']
const BUDGETS = [60, 90, 120, 180, 260, 380, 450, 560, 720, 850, 1200, 1800, 2500, 3200, 4800] // 万元

/* 第二批专用扩展字典：让地图省份、年份筛选、各档案榜单有更多可观察维度 */
const MORE_BUYERS = [
  { name: '四川省农业农村厅', attr: '政府机关' },
  { name: '山东大学', attr: '事业单位' },
  { name: '河南省人民医院', attr: '事业单位' },
  { name: '湖南广播电视大学', attr: '事业单位' }
]
const MORE_AGENCIES = [
  { name: '四川省政府采购中心', attr: '事业单位' },
  { name: '山东天成招标有限公司', attr: '民营企业' }
]
const MORE_SUPPLIERS = [
  { name: '四川长虹电器股份有限公司', attr: '国有企业' },
  { name: '山东浪潮齐鲁软件产业有限公司', attr: '国有企业' },
  { name: '河南许继电气股份有限公司', attr: '国有企业' },
  { name: '湖南中兴通讯设备有限公司', attr: '民营企业' }
]
const MORE_JUDGES = [
  { name: '郑文杰', owner: true }, { name: '何秀兰', owner: false, leader: true }, { name: '高远', owner: false }
]
const MORE_REGIONS = [
  '四川省-成都市', '四川省-绵阳市', '山东省-济南市', '山东省-青岛市',
  '河南省-郑州市', '湖南省-长沙市', '安徽省-合肥市', '福建省-福州市',
  '陕西省-西安市', '辽宁省-沈阳市', '湖北省-黄石市', '浙江省-温州市',
  '江苏省-南京市', '广东省-广州市'
]

function pad(n) { return String(n).padStart(3, '0') }
// 必须显式带「万元」单位：系统对纯数字默认按「元」处理，写 '60' 会变成 60 元而非 60 万元
function yuan(wan) { return String(wan) + '万元' }
function shortdate(month, year) {
  const day = 1 + Math.floor(rand() * 27)
  return `${year || 2026}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function datetime(month, year) {
  return `${shortdate(month, year)} ${String(8 + Math.floor(rand() * 10)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00`
}
function contact() { return '138' + String(Math.floor(rand() * 1e8)).padStart(8, '0') }

/* ---------- 构造单条项目的 detail ---------- */
function makeDetail(i, status, month, buyer, agency, year, expanded) {
  const regionPool = expanded ? REGIONS.concat(MORE_REGIONS) : REGIONS
  const supplierPool = expanded ? SUPPLIERS.concat(MORE_SUPPLIERS) : SUPPLIERS
  const judgePool = expanded ? JUDGES.concat(MORE_JUDGES) : JUDGES
  const budgetWan = pick(BUDGETS)
  const method = pick(METHODS)
  const type = pick(TYPES)
  const isSplit = rand() < 0.3 && status === '完成招标'
  const isUnion = rand() < 0.35
  const winners = pickN(supplierPool, isUnion ? 2 : 1)
  const lead = winners[0]
  const members = winners.slice(1).map(function (w) { return w.name })
  const judgeSet = pickN(judgePool, 3)
  const title = pick(PROJ_WORDS)
  const ceilingWan = yuan((budgetWan * (0.96 + rand() * 0.03)).toFixed(2))

  const d = {
    public: {
      status: status,
      region: pick(regionPool),
      project_no: '', // 由外层填
      project_name: `${buyer.name.slice(0, 6)}·${title}（第${i}批）`,
      budget_yuan: yuan(budgetWan),
      ceiling_yuan: ceilingWan
    },
    buyer: { name: buyer.name, phone: contact(), email: `buyer${i}@example.com`, address: buyer.name + '办公地址' },
    agency: { name: agency.name, phone: contact(), email: `agency${i}@example.com`, address: agency.name + '办公地址' },
    correctionsOn: false,
    corrections: [],
    intention: { startDate: shortdate(month, year), endDate: shortdate(Math.min(12, month + 1), year), url: `https://www.example.com/intention/${i}` },
    bidding: {
      method: method, periodDays: String(30 + Math.floor(rand() * 150)),
      docStart: shortdate(month, year), docEnd: shortdate(Math.min(12, month + 1), year),
      docWay: pick(['线上', '现场']), docNote: '详见采购文件', demand: title + '相关需求',
      bidStart: shortdate(Math.min(12, month + 1), year), bidEnd: datetime(Math.min(12, month + 1), year),
      url: `https://www.example.com/bid/${i}`
    },
    terminated: { reason: status === '终止招标' ? pick(['采购计划调整', '投标人不足三家', '项目取消']) : '', note: '', url: '' },
    completed: {
      type: type,
      amount_yuan: '', winDate: '', url: '',
      winner: { lead: '', members: [''], isUnion: false },
      isSplit: isSplit, packages: [], judges: [], operationLog: []
    }
  }

  if (status === '完成招标') {
    const saving = 0.04 + rand() * 0.18  // 节约率 4%~22%
    const awardNum = Number((budgetWan * (1 - saving)).toFixed(2))
    d.completed.amount_yuan = yuan(awardNum)
    d.completed.winDate = shortdate(Math.min(12, month + 1), year)
    d.completed.url = `https://www.example.com/award/${i}`
    if (isSplit) {
      const n = 2 + Math.floor(rand() * 3)
      let remain = awardNum
      for (let p = 0; p < n; p++) {
        const amtNum = p === n - 1 ? remain : Number((remain * (0.25 + rand() * 0.2)).toFixed(2))
        remain = Number((remain - amtNum).toFixed(2))
        const amt = yuan(amtNum)
        const pkgLead = pick(supplierPool)
        const union = rand() < 0.3
        d.completed.packages.push({
          name: `第${p + 1}包`, type: pick(TYPES), amount_yuan: amt,
          winner: { lead: pkgLead.name, members: union ? [pick(supplierPool).name] : [''], isUnion: union }
        })
      }
    } else {
      d.completed.winner = { lead: lead.name, members: isUnion ? members : [''], isUnion: isUnion }
    }
    d.completed.judges = judgeSet.map(function (j) { return { name: j.name, leader: !!j.leader, owner: !!j.owner } })
  } else if (status === '正在招标') {
    d.completed.type = ''
  }
  return d
}

/* ---------- 主流程 ---------- */
const existing = new Set(db.prepare("SELECT project_no FROM projects WHERE project_no LIKE 'DEMO-2026-%'").all().map(function (r) { return r.project_no }))
const existingMore = new Set(db.prepare("SELECT project_no FROM projects WHERE project_no LIKE 'MORE-%'").all().map(function (r) { return r.project_no }))
let created = 0, skipped = 0
const t0 = Date.now()
const insertProject = db.prepare(`INSERT INTO projects
  (project_no, project_name, budget_yuan, budget_fen, ceiling_yuan, ceiling_fen,
   award_amount_yuan, award_amount_fen, award_time, region, status, method, period_days, bid_end,
   winner_names, project_types, buyer_name, agency_name, detail, created_at, updated_at, version, deleted)
  VALUES (@project_no, @project_name, @budget_yuan, @budget_fen, @ceiling_yuan, @ceiling_fen,
   @award_amount_yuan, @award_amount_fen, @award_time, @region, @status, @method, @period_days, @bid_end,
   @winner_names, @project_types, @buyer_name, @agency_name, @detail, @created_at, @updated_at, 1, 0)`)

function saveProject(raw, projectNo, month, year, batch) {
  const d = mergeDetail(raw)
  normalizeDetailAmounts(d)
  const r = deriveFromDetail(d)
  if (r.error) throw new Error(projectNo + ' 派生失败: ' + r.error)
  const v = r.values
  const t = datetime(month, year)
  insertProject.run({
    project_no: v.project_no, project_name: v.project_name,
    budget_yuan: v.budget_yuan, budget_fen: v.budget_fen,
    ceiling_yuan: v.ceiling_yuan, ceiling_fen: v.ceiling_fen,
    award_amount_yuan: v.award_amount_yuan, award_amount_fen: v.award_amount_fen,
    award_time: v.award_time, region: v.region, status: v.status, method: v.method,
    period_days: v.period_days, bid_end: v.bid_end, winner_names: v.winner_names,
    project_types: v.project_types, buyer_name: v.buyer_name, agency_name: v.agency_name,
    detail: JSON.stringify(d), created_at: t, updated_at: t
  })
  upsertArchives(db, d, projectNo)
  writeLog(db, {
    project_no: projectNo, project_name: v.project_name, op_type: '新增项目',
    summary: batch + '：' + v.project_name + '（' + projectNo + '）',
    operator: 'admin', created_at: t
  })
  created++
}

const run = db.transaction(function () {
  // 第一批：原 60 条 2026 年数据，保持原有行为不变
  for (let i = 1; i <= 60; i++) {
    const projectNo = 'DEMO-2026-' + pad(i)
    if (existing.has(projectNo)) { skipped++; continue }
    const status = STATUSES[(i - 1) % STATUSES.length]
    const month = ((i * 7) % 12) + 1  // 打散到 1-12 月
    const buyer = BUYERS[i % BUYERS.length]
    const agency = AGENCIES[(i * 3 + 1) % AGENCIES.length]
    const raw = makeDetail(i, status, month, buyer, agency)
    raw.public.project_no = projectNo
    saveProject(raw, projectNo, month, 2026, '种子数据初始化')
  }

  // 第二批：跨 2024/2025/2026 三年，扩充省份与新档案，年份筛选/地图分布可观察
  const YEARS = [2024, 2025, 2026]
  const MORE_COUNT = 60
  for (let k = 0; k < MORE_COUNT; k++) {
    const year = YEARS[k % YEARS.length]
    const seq = Math.floor(k / YEARS.length) + 1
    const projectNo = 'MORE-' + year + '-' + pad(seq)
    if (existingMore.has(projectNo)) { skipped++; continue }
    const status = STATUSES[(k + 3) % STATUSES.length]
    const month = ((k * 5) % 12) + 1
    const buyer = k % 3 === 0 ? MORE_BUYERS[k % MORE_BUYERS.length] : BUYERS[(k * 3) % BUYERS.length]
    const agency = k % 2 === 0 ? MORE_AGENCIES[k % MORE_AGENCIES.length] : AGENCIES[(k * 5 + 2) % AGENCIES.length]
    const raw = makeDetail(k + 61, status, month, buyer, agency, year, true)
    raw.public.project_no = projectNo
    saveProject(raw, projectNo, month, year, '跨年度种子扩充')
  }
})
run()
db.close()
console.log(' ========================================')
console.log('  演示数据种子完成')
console.log('  新增项目: ' + created + '  跳过(已存在): ' + skipped)
console.log('  耗时: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
console.log('  档案由 upsertArchives 自动沉淀；金额/派生列走系统统一口径')
console.log(' ========================================')
