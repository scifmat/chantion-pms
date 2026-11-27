/**
 * 项目跟进模块自测（第 18 步）。
 * 在真实数据库副本上启动独立后端（127.0.0.1:3104），所有写操作只落副本。
 * 覆盖：迁移 013、双人权限、顺流转、逆流重置与复盘归档、已流标回填、
 *       复盘强制校验、两处删除拦截、无变更零 UPDATE、认领释放再认领。
 * 运行：node _test/scripts/test-tracking.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SERVER = path.join(ROOT, 'server')
const REAL_DB = path.join(SERVER, 'data/chantion.db')
const TEST_DB = path.join(SERVER, 'data/chantion-tracking-test.db')
const BASE = 'http://127.0.0.1:3104'

const serverRequire = createRequire(path.join(SERVER, 'app.js'))
const Database = serverRequire('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}

async function api(method, urlPath, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(BASE + urlPath, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data = {}
  try { data = await res.json() } catch (e) { data = {} }
  return { status: res.status, data }
}

async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try {
      const r = await fetch(BASE + '/api/projects', { signal: AbortSignal.timeout(1000) })
      if (r.ok) return
    } catch (e) { /* 继续等 */ }
    await new Promise(function (resolve) { setTimeout(resolve, 150) })
  }
  throw new Error('测试服务启动超时（检查 3104 端口是否被占用）')
}

function detailOf(no, name, status, opts) {
  const o = opts || {}
  return {
    public: {
      status: status, region: '北京市', project_no: no, project_name: name,
      budget_yuan: '100', ceiling_yuan: '90'
    },
    buyer: { name: '跟进测试采购单位' },
    agency: { name: '跟进测试代理机构' },
    intention: { startDate: '2026-01-01', endDate: '2026-01-02' },
    bidding: {
      method: '公开招标', docStart: '2027-01-01', docEnd: '2027-01-01',
      bidStart: '2027-02-01', bidEnd: '2027-02-01'
    },
    terminated: { reason: o.terminatedReason || '' },
    completed: { amount_yuan: '0', winDate: '' }
  }
}

function setBidding(d, docDay, bidDay) {
  d.bidding.docStart = docDay
  d.bidding.docEnd = docDay
  d.bidding.bidStart = bidDay
  d.bidding.bidEnd = bidDay
}

async function createProject(token, no, name, opts) {
  return api('POST', '/api/projects', { detail: detailOf(no, name, '意向公示', opts) }, token)
}

async function patchProject(token, id, mutate) {
  const cur = await api('GET', '/api/projects/' + id, undefined, token)
  const d = cur.data.data.detail
  mutate(d)
  return api('PUT', '/api/projects/' + id, { detail: d, version: cur.data.data.version }, token)
}

async function myTrack(token) {
  const r = await api('GET', '/api/trackings?owner=mine', undefined, token)
  return r.data.data[0] || null
}

async function main() {
  [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) {
    try { fs.unlinkSync(f) } catch (e) { /* 文件不存在则忽略 */ }
  })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3104', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', function (buf) { stderr += buf.toString() })

  try {
    await waitReady()

    console.log('\n[A] 迁移 013 与访客隔离')
    const probe = new Database(TEST_DB, { readonly: true })
    const table = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bid_trackings'").get()
    const cols = probe.prepare('PRAGMA table_info(bid_trackings)').all().map(function (c) { return c.name })
    const stageTable = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bid_tracking_stages'").get()
    const stageCols = probe.prepare('PRAGMA table_info(bid_tracking_stages)').all().map(function (c) { return c.name })
    probe.close()
    check('bid_trackings 表已建立', !!table)
    check('关键字段齐全', ['project_id', 'derived_key', 'review_history', 'follow_log', 'version'].every(function (k) {
      return cols.indexOf(k) >= 0
    }), cols.join(','))
    check('迁移014建立阶段记录表', !!stageTable)
    check('阶段表字段齐全', ['tracking_id', 'stage_key', 'internal_status', 'review_category', 'review_reason', 'reviewed_at']
      .every(function (k) { return stageCols.indexOf(k) >= 0 }), stageCols.join(','))
    check('访客 GET 跟进列表被拦 401', (await api('GET', '/api/trackings')).status === 401)
    check('访客 GET 跟进看板被拦 401', (await api('GET', '/api/trackings/summary')).status === 401)

    console.log('\n[B] 两位普通用户与项目准备')
    const adminLogin = await api('POST', '/api/auth/login', {
      username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD || 'admin123'
    })
    check('管理员登录成功', adminLogin.status === 200, JSON.stringify(adminLogin.data))
    const adminToken = adminLogin.data.data.token
    const ua = await api('POST', '/api/users', { username: 'tracker_a', password: 'pass123', role: 'user' }, adminToken)
    const ub = await api('POST', '/api/users', { username: 'tracker_b', password: 'pass123', role: 'user' }, adminToken)
    check('创建两位跟进用户', ua.status === 201 && ub.status === 201, JSON.stringify([ua.data, ub.data]))
    const la = await api('POST', '/api/auth/login', { username: 'tracker_a', password: 'pass123' })
    const lb = await api('POST', '/api/auth/login', { username: 'tracker_b', password: 'pass123' })
    const tokenA = la.data.data.token
    const tokenB = lb.data.data.token
    const created = await createProject(tokenA, 'TRACK-001', '跟进测试项目')
    check('创建测试项目成功', created.status === 201, JSON.stringify(created.data))
    const pid = created.data.data.row_id

    console.log('\n[C] 认领与负责人隔离')
    const claim = await api('POST', '/api/trackings/project/' + pid + '/claim', undefined, tokenA)
    check('负责人认领成功', claim.status === 201 && claim.data.data.internal_status === '评估中', JSON.stringify(claim.data))
    const trackingId = claim.data.data.id
    const dup = await api('POST', '/api/trackings/project/' + pid + '/claim', undefined, tokenB)
    check('他人重复认领被拦 409', dup.status === 409 && dup.data.message.indexOf('tracker_a') >= 0, JSON.stringify(dup.data))
    const bList = await api('GET', '/api/trackings', undefined, tokenB)
    check('其他用户可查看跟进信息', bList.status === 200 && bList.data.data.some(function (r) { return r.id === trackingId }))
    const bEdit = await api('PUT', '/api/trackings/' + trackingId + '/internal', {
      internal_status: '已报名', version: claim.data.data.version
    }, tokenB)
    check('非负责人维护被拦 403', bEdit.status === 403 && bList.data.data.find(function (r) { return r.id === trackingId }).can_edit === false)
    check('非负责人关闭被拦 403',
      (await api('POST', '/api/trackings/project/' + pid + '/release', undefined, tokenB)).status === 403)

    console.log('\n[D] 顺流：意向公示 → 招标报名前 → 投标前 → 完成招标')
    let p = await patchProject(tokenA, pid, function (d) { d.public.status = '正在招标' })
    check('项目改为正在招标', p.status === 200, JSON.stringify(p.data))
    let r = await myTrack(tokenA)
    check('自动流转为未报名', r && r.internal_status === '未报名' && r.derived_key === '正在招标|bidding-doc', JSON.stringify(r))
    let upd = await api('PUT', '/api/trackings/' + trackingId + '/internal', {
      internal_status: '已报名', note: '已拿到文件', version: r.version
    }, tokenA)
    check('手选已报名成功', upd.status === 200, JSON.stringify(upd.data))
    await patchProject(tokenA, pid, function (d) { setBidding(d, '2020-01-01', '2027-02-01') })
    r = await myTrack(tokenA)
    check('过获取文件截止后自动变为未投标', r.internal_status === '未投标' && r.derived_key === '正在招标|bidding-bid', JSON.stringify(r))
    const noReview = await api('PUT', '/api/trackings/' + trackingId + '/internal', {
      internal_status: '未投标', review_category: '价格劣势', review_reason: '试图夹带复盘字段', version: r.version
    }, tokenA)
    check('/internal 忽略复盘字段并允许切失败态', noReview.status === 200, JSON.stringify(noReview.data))
    const pending = await myTrack(tokenA)
    check('失败态只置待复盘、不写复盘内容',
      pending.review_required === true && pending.review_category === '' && pending.review_reason === '',
      JSON.stringify({ required: pending.review_required, category: pending.review_category, reason: pending.review_reason }))
    const filled = await api('PUT', '/api/trackings/' + trackingId + '/review', {
      internal_status: '未投标', review_category: '内部主动放弃', review_reason: '产品不匹配', version: pending.version
    }, tokenA)
    check('复盘接口写入失败原因成功', filled.status === 200, JSON.stringify(filled.data))
    const withReview = await myTrack(tokenA)
    check('复盘数据已落库', withReview.review_required === true && withReview.review_reason === '产品不匹配')
    await api('PUT', '/api/trackings/' + trackingId + '/internal', {
      internal_status: '已投标', version: withReview.version
    }, tokenA)
    await patchProject(tokenA, pid, function (d) { d.public.status = '完成招标' })
    r = await myTrack(tokenA)
    check('完成招标默认未中标且待复盘', r.internal_status === '未中标' && r.review_required === true, JSON.stringify(r))
    check('动态变更时旧复盘已归档', r.review_history.length >= 1, JSON.stringify(r.review_history))
    const rev = await api('PUT', '/api/trackings/' + trackingId + '/review', {
      review_category: '价格劣势', review_reason: '报价高于中标方', version: r.version
    }, tokenA)
    check('单独填写复盘成功', rev.status === 200, JSON.stringify(rev.data))
    await api('PUT', '/api/trackings/' + trackingId + '/internal', {
      internal_status: '已中标', version: rev.data.data.version
    }, tokenA)
    r = await myTrack(tokenA)
    check('手选已中标后不再要求复盘', r.internal_status === '已中标' && r.review_required === false)
    // 造一份活跃复盘，用于验证逆流时确实归档而不是直接丢弃（维护与复盘分两步）
    await api('PUT', '/api/trackings/' + trackingId + '/internal', {
      internal_status: '未中标', version: r.version
    }, tokenA)
    r = await myTrack(tokenA)
    const refill = await api('PUT', '/api/trackings/' + trackingId + '/review', {
      internal_status: '未中标', review_category: '内部主动放弃', review_reason: '再次评估后决定落标', version: r.version
    }, tokenA)
    check('补填活跃复盘成功', refill.status === 200, JSON.stringify(refill.data))
    r = await myTrack(tokenA)
    check('重置前存在活跃复盘', !!r.review_reason, JSON.stringify(r.review_reason))

    console.log('\n[E] 逆流重置：完成招标 → 正在招标')
    const beforeReset = r
    await patchProject(tokenA, pid, function (d) { d.public.status = '正在招标' })
    r = await myTrack(tokenA)
    check('退回跟进中并按当前时间重算', r.follow_stage === '跟进中' && r.internal_status === '未投标', JSON.stringify(r))
    check('复盘字段清空且旧复盘归档', !r.review_reason && r.review_history.length >= beforeReset.review_history.length + 1,
      JSON.stringify(r.review_history))
    check('重置时间已记录', !!r.last_reset_at, r.last_reset_at)
    const logs = await api('GET', '/api/operation-logs?no=TRACK-001', undefined, adminToken)
    check('逆流重置已写操作日志', logs.data.data.some(function (x) { return x.op_type === '跟进状态重置' }))

    console.log('\n[F] 已流标：自动回填终止原因')
    await patchProject(tokenA, pid, function (d) {
      d.public.status = '终止招标'
      d.terminated.reason = '资金不足，项目取消'
    })
    r = await myTrack(tokenA)
    check('终止招标默认已流标', r.internal_status === '已流标' && r.follow_stage === '已结束', JSON.stringify(r))
    check('复盘自动回填终止原因', r.review_category === '项目终止' && r.review_reason.indexOf('资金不足') >= 0,
      JSON.stringify({ category: r.review_category, reason: r.review_reason }))
    const editAuto = await api('PUT', '/api/trackings/' + trackingId + '/review', {
      review_category: '项目终止', review_reason: '资金不足，已确认取消', version: r.version
    }, tokenA)
    check('自动回填允许负责人编辑', editAuto.status === 200, JSON.stringify(editAuto.data))

    console.log('\n[G] 无变更零 UPDATE')
    const t1 = (await myTrack(tokenA)).updated_at
    const logCount1 = (await api('GET', '/api/operation-logs?no=TRACK-001', undefined, adminToken)).data.data.length
    await api('GET', '/api/trackings', undefined, tokenA)
    await api('GET', '/api/trackings', undefined, tokenA)
    const t2 = (await myTrack(tokenA)).updated_at
    const logCount2 = (await api('GET', '/api/operation-logs?no=TRACK-001', undefined, adminToken)).data.data.length
    check('derived_key 未变时不写库', t1 === t2 && logCount1 === logCount2, t1 + ' / ' + t2)

    console.log('\n[H] 删除拦截与所有权流转')
    const del2 = await api('DELETE', '/api/projects/' + pid, {
      version: (await api('GET', '/api/projects/' + pid)).data.data.version
    }, tokenA)
    check('已跟进项目软删除被拦 409', del2.status === 409 && del2.data.message.indexOf('跟进') >= 0, JSON.stringify(del2.data))
    check('关闭跟进仅负责人可操作',
      (await api('POST', '/api/trackings/project/' + pid + '/release', undefined, tokenB)).status === 403)
    const released = await api('POST', '/api/trackings/project/' + pid + '/release', undefined, tokenA)
    check('负责人关闭跟进成功', released.status === 200, JSON.stringify(released.data))
    const reClaim = await api('POST', '/api/trackings/project/' + pid + '/claim', undefined, tokenB)
    check('关闭后他人可重新认领', reClaim.status === 201 && reClaim.data.data.owner_username === 'tracker_b', JSON.stringify(reClaim.data))
    await api('POST', '/api/trackings/project/' + pid + '/release', undefined, tokenB)
    const soft = await api('DELETE', '/api/projects/' + pid, {
      version: (await api('GET', '/api/projects/' + pid)).data.data.version
    }, tokenA)
    check('关闭后项目可软删除', soft.status === 200, JSON.stringify(soft.data))

    console.log('\n[I] 回收站彻底删除拦截')
    const live = new Database(TEST_DB)
    const bt = live.prepare('SELECT id FROM bid_trackings WHERE project_id = ?').get(pid)
    live.prepare('UPDATE bid_trackings SET is_tracking = 1, owner_user_id = ?, owner_username = ? WHERE id = ?')
      .run(ua.data.data.id, 'tracker_a', bt.id)
    live.close()
    const purgeBlocked = await api('DELETE', '/api/recycle/project/' + pid, undefined, adminToken)
    check('已跟进项目彻底删除被拦 409',
      purgeBlocked.status === 409 && purgeBlocked.data.message.indexOf('跟进') >= 0, JSON.stringify(purgeBlocked.data))
    const live2 = new Database(TEST_DB)
    live2.prepare('UPDATE bid_trackings SET is_tracking = 0 WHERE project_id = ?').run(pid)
    const countBefore = live2.prepare('SELECT COUNT(*) n FROM bid_trackings WHERE project_id = ?').get(pid).n
    live2.close()
    const purge = await api('DELETE', '/api/recycle/project/' + pid, undefined, adminToken)
    check('关闭后彻底删除成功', purge.status === 200, JSON.stringify(purge.data))
    const after = new Database(TEST_DB, { readonly: true })
    const countAfter = after.prepare('SELECT COUNT(*) n FROM bid_trackings WHERE project_id = ?').get(pid).n
    after.close()
    check('彻底删除同步清理跟进行（FK 级联）', countBefore === 1 && countAfter === 0, countBefore + ' → ' + countAfter)

    console.log('\n[J] 迁移幂等')
    const migrate = serverRequire(path.join(SERVER, 'migrate.js'))
    const repeated = new Database(TEST_DB)
    const beforeRows = repeated.prepare('SELECT COUNT(*) n FROM bid_trackings').get().n
    migrate.runMigrations(repeated)
    const afterRows = repeated.prepare('SELECT COUNT(*) n FROM bid_trackings').get().n
    repeated.close()
    check('重复执行迁移不重建表、不丢数据', beforeRows === afterRows, beforeRows + ' → ' + afterRows)

    console.log('\n[K] 复盘编辑器：分类联动 / 历史补录 / 防呆')
    const cfg = await api('GET', '/api/config/options')
    const reasonOptions = cfg.data.data.groups.review_reason || []
    check('review_reason 分组下发到前端',
      ['价格劣势', '价格优势', '技术领先', '项目终止'].every(function (x) { return reasonOptions.indexOf(x) >= 0 }),
      JSON.stringify(reasonOptions))

    const second = await createProject(tokenA, 'TRACK-002', '复盘补录测试项目')
    check('创建第二个测试项目', second.status === 201, JSON.stringify(second.data))
    const pid2 = second.data.data.row_id
    const claim2 = await api('POST', '/api/trackings/project/' + pid2 + '/claim', undefined, tokenA)
    check('认领第二个项目', claim2.status === 201, JSON.stringify(claim2.data))
    await patchProject(tokenA, pid2, function (d) { setBidding(d, '2020-01-01', '2027-02-01'); d.public.status = '正在招标' })
    const row2 = (await api('GET', '/api/trackings', undefined, tokenA)).data.data.find(function (x) {
      return x.project_id === pid2
    })
    check('正在招标不允许选「已结束」', row2.allowed_stages.indexOf('已结束') < 0, JSON.stringify(row2.allowed_stages))
    check('正在招标不能补录未来动态',
      ['未中标', '已中标', '已流标'].every(function (s) { return row2.history_allowed.indexOf(s) < 0 }),
      JSON.stringify(row2.history_allowed))
    check('正在招标可回溯到已投标', row2.history_allowed.indexOf('已投标') >= 0)
    check('时间线返回四个节点', row2.stages.length === 4 &&
      ['evaluation', 'registration', 'bidding', 'result'].every(function (k) {
        return row2.stages.some(function (s) { return s.key === k })
      }), JSON.stringify(row2.stages.map(function (s) { return s.key })))
    check('未到的结果节点置灰', row2.stages.find(function (s) { return s.key === 'result' }).reached === false)
    const saveEval = await api('PUT', '/api/trackings/' + row2.id + '/stages/evaluation', {
      internal_status: '评估中', review_category: '内部主动放弃', review_reason: '初步评估不适配', version: row2.version
    }, tokenA)
    check('评估节点复盘成功', saveEval.status === 200, JSON.stringify(saveEval.data))
    const afterEval = saveEval.data.data
    const evalStage = afterEval.stages.find(function (s) { return s.key === 'evaluation' })
    check('评估节点显示已复盘', evalStage.reviewed && evalStage.review_reason === '初步评估不适配', JSON.stringify(evalStage))
    check('历史节点复盘不改变当前动态', afterEval.internal_status === row2.internal_status,
      row2.internal_status + ' → ' + afterEval.internal_status)
    const saveCurrent = await api('PUT', '/api/trackings/' + row2.id + '/stages/bidding', {
      internal_status: '已投标', review_category: '价格优势', review_reason: '方案匹配度高', version: afterEval.version
    }, tokenA)
    check('当前节点复盘并改动态成功', saveCurrent.status === 200, JSON.stringify(saveCurrent.data))
    const afterCurrent = saveCurrent.data.data
    check('当前节点复盘同步全局动态',
      afterCurrent.internal_status === '已投标' && afterCurrent.review_category === '价格优势',
      JSON.stringify({ internal: afterCurrent.internal_status, category: afterCurrent.review_category }))
    const futureNode = await api('PUT', '/api/trackings/' + row2.id + '/stages/result', {
      internal_status: '已中标', review_category: '价格优势', review_reason: '尚未发生', version: afterCurrent.version
    }, tokenA)
    check('后端拒绝未到达节点的补录', futureNode.status === 400 && futureNode.data.message.indexOf('尚未发生') >= 0,
      JSON.stringify(futureNode.data))
    const future = await api('PUT', '/api/trackings/' + row2.id + '/review', {
      internal_status: '已中标', review_category: '价格优势', review_reason: '不能穿越', version: afterCurrent.version
    }, tokenA)
    check('后端拒绝补录未发生的已中标', future.status === 400 &&
      (future.data.message.indexOf('尚未发生') >= 0 || future.data.message.indexOf('不允许') >= 0),
      JSON.stringify(future.data))

    const utilUrl = pathToFileURL(path.join(ROOT, 'client/src/utils/tracking.js')).href
    const U = await import(utilUrl)
    check('已投标 → 成功经验分类', U.reviewKind('已投标') === 'positive' && U.categoryLabel('已投标') === '成功经验分类')
    check('未中标 → 失败原因分类', U.reviewKind('未中标') === 'negative' && U.categoryLabel('未中标') === '失败原因分类')
    check('已流标 → 流标原因分类', U.reviewKind('已流标') === 'float' && U.categoryLabel('已流标') === '流标原因分类')
    const positiveCats = U.categoriesFor('已投标', reasonOptions)
    check('成功经验选项来自配置且排除负面项',
      positiveCats.indexOf('价格优势') >= 0 && positiveCats.indexOf('价格劣势') < 0, JSON.stringify(positiveCats))
    check('内部动态自动推导跟进状态',
      U.stageForInternal('已投标') === '跟进中' && U.stageForInternal('已中标') === '已结束')

    const backfill = await api('PUT', '/api/trackings/' + row2.id + '/review', {
      follow_stage: '已结束', internal_status: '已投标',
      review_category: '价格优势', review_reason: '报价具有竞争力，方案匹配度高', version: afterCurrent.version
    }, tokenA)
    check('历史补录已投标成功', backfill.status === 200, JSON.stringify(backfill.data))
    const afterBackfill = (await api('GET', '/api/trackings', undefined, tokenA)).data.data.find(function (x) {
      return x.project_id === pid2
    })
    check('补录后动态与成功经验已保存',
      afterBackfill.internal_status === '已投标' && afterBackfill.review_category === '价格优势',
      JSON.stringify({ internal: afterBackfill.internal_status, category: afterBackfill.review_category }))
    check('/review 忽略手选跟进状态，仍由动态推导', afterBackfill.follow_stage === '跟进中', afterBackfill.follow_stage)
    check('补录已写入跟进时间线',
      afterBackfill.follow_log.some(function (x) { return x.text.indexOf('复盘补录') >= 0 }),
      JSON.stringify(afterBackfill.follow_log.slice(-2)))

    console.log('\n[K2] 历史节点补录不得改写全局当前动态')
    const third = await createProject(tokenA, 'TRACK-003', '历史补录不改全局测试')
    check('创建第三个测试项目', third.status === 201, JSON.stringify(third.data))
    const pid3 = third.data.data.row_id
    await api('POST', '/api/trackings/project/' + pid3 + '/claim', undefined, tokenA)
    await patchProject(tokenA, pid3, function (d) { d.public.status = '完成招标' })
    const findThird = async function () {
      return (await api('GET', '/api/trackings', undefined, tokenA)).data.data.find(function (x) {
        return x.project_id === pid3
      })
    }
    const beforeEval3 = await findThird()
    check('完成招标默认未中标', beforeEval3.internal_status === '未中标', beforeEval3.internal_status)
    const saveEval3 = await api('PUT', '/api/trackings/' + beforeEval3.id + '/stages/evaluation', {
      internal_status: '评估中', review_category: '内部主动放弃', review_reason: '早期评估不适配', version: beforeEval3.version
    }, tokenA)
    check('完成招标项目可补录评估节点', saveEval3.status === 200, JSON.stringify(saveEval3.data))
    const afterEval3 = await findThird()
    check('历史节点补录后全局动态仍为未中标', afterEval3.internal_status === '未中标', afterEval3.internal_status)
    check('复盘标记仍基于当前节点', !afterEval3.review_reason && afterEval3.review_required === true,
      JSON.stringify({ reason: afterEval3.review_reason, required: afterEval3.review_required }))
    const evalNode3 = afterEval3.stages.find(function (s) { return s.key === 'evaluation' })
    check('评估节点自身已记录复盘', evalNode3.reviewed && evalNode3.review_reason === '早期评估不适配', JSON.stringify(evalNode3))

    console.log('\n[K3] 项目详情接口下发跟进阶段')
    const detail3 = await api('GET', '/api/projects/' + pid3, undefined, tokenA)
    check('详情接口返回跟进数据', detail3.status === 200 && detail3.data.data.tracking && detail3.data.data.tracking.active === true,
      JSON.stringify(detail3.data.data.tracking && detail3.data.data.tracking.active))
    const detailStages = detail3.data.data.tracking.stages || []
    check('详情阶段数据为四节点', detailStages.length === 4, JSON.stringify(detailStages.map(function (s) { return s.key })))
    const detailCurrent = detailStages.find(function (s) { return s.current })
    check('详情当前节点为结果阶段且显示未中标',
      detailCurrent && detailCurrent.key === 'result' && detailCurrent.internal_status === '未中标',
      JSON.stringify(detailCurrent))

    console.log('\n[L] 前端修复静态检查')
    const projectListSrc = fs.readFileSync(path.join(ROOT, 'client/src/views/ProjectList.vue'), 'utf8')
    const trackingListSrc = fs.readFileSync(path.join(ROOT, 'client/src/views/TrackingList.vue'), 'utf8')
    const timelineSrc = fs.readFileSync(path.join(ROOT, 'client/src/components/tracking/TrackingTimelineDialog.vue'), 'utf8')
    const detailSrc = fs.readFileSync(path.join(ROOT, 'client/src/views/ProjectDetail.vue'), 'utf8')
    const stepsSrc = fs.readFileSync(path.join(ROOT, 'client/src/components/tracking/TrackingSteps.vue'), 'utf8')
    const projectsRouteSrc = fs.readFileSync(path.join(SERVER, 'routes/projects.js'), 'utf8')
    const routesSrc = fs.readFileSync(path.join(SERVER, 'routes/trackings.js'), 'utf8')
    check('访客不渲染跟进开关', projectListSrc.indexOf('class="track-cell" v-if="canWrite"') >= 0)
    check('认领/关闭后显式 bumpDataVersion', projectListSrc.indexOf('bumpDataVersion()') >= 0)
    check('查询/恢复按钮独立右对齐行',
      /<div class="query-actions">\s*<span class="spacer"><\/span>[\s\S]*?查询[\s\S]*?恢复/.test(trackingListSrc))
    check('操作列只保留跟进详情',
      trackingListSrc.indexOf('跟进详情') >= 0 && trackingListSrc.indexOf('>复盘/补录</button>') < 0 &&
      trackingListSrc.indexOf('>跟进维护</button>') < 0)
    check('时间线弹窗按节点渲染', timelineSrc.indexOf('timeline-item') >= 0 &&
      timelineSrc.indexOf('saveStageReview') >= 0 && timelineSrc.indexOf('去复盘') >= 0)
    check('旧弹窗组件已移除',
      !fs.existsSync(path.join(ROOT, 'client/src/components/tracking/TrackingEditDialog.vue')) &&
      !fs.existsSync(path.join(ROOT, 'client/src/components/tracking/ReviewDialog.vue')))
    check('新阶段接口已注册', routesSrc.indexOf("router.put('/:id/stages/:stageKey'") >= 0)
    const internalBlock = routesSrc.split("router.put('/:id/internal'")[1].split("router.put('/:id/stages/:stageKey'")[0]
    check('/internal 路由不接收复盘字段',
      internalBlock.indexOf('review_category') < 0 && internalBlock.indexOf('review_reason') < 0)
    check('/review 路由不接收 follow_stage',
      routesSrc.indexOf('follow_stage: body.follow_stage') < 0)
    check('跟进页监听账号切换并清空数据',
      trackingListSrc.indexOf('auth.user ? auth.user.id : 0') >= 0 &&
      trackingListSrc.indexOf('rows.value = []') >= 0)
    check('详情接口下发 tracking.stages', projectsRouteSrc.indexOf('stages: T.getStages') >= 0)
    check('详情页顶部渲染横向步骤条',
      detailSrc.indexOf('<TrackingSteps :stages="trackingStages"') >= 0 &&
      detailSrc.indexOf('<!-- 公共信息 -->') > detailSrc.indexOf('<TrackingSteps'))
    check('步骤条使用 Tooltip 展示复盘', stepsSrc.indexOf('ElTooltip') >= 0 && stepsSrc.indexOf('s.review_reason') >= 0)

    if (stderr && stderr.indexOf('[ERROR]') >= 0) {
      console.log('\n[服务端错误输出]\n' + stderr.slice(-2000))
    }
  } finally {
    if (fail > 0 && stderr) console.log('\n[服务端错误输出]\n' + stderr.slice(-3000))
    child.kill('SIGTERM')
    await new Promise(function (resolve) { child.once('exit', resolve); setTimeout(resolve, 2000) })
    ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) {
      try { fs.unlinkSync(f) } catch (e) { /* 忽略清理失败 */ }
    })
  }

  console.log('\n========================================')
  console.log('  PASS: ' + pass + '   FAIL: ' + fail)
  console.log('========================================')
  if (fail > 0) process.exitCode = 1
}

main().catch(function (e) {
  console.error('测试执行异常:', e)
  process.exitCode = 1
})
