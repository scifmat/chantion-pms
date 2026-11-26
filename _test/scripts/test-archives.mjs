/**
 * 档案「改 / 删」接口自测（第 11 轮）。
 *
 * 在真实数据库的副本上启动独立后端（默认 127.0.0.1:3100），全部写操作只落在副本上，
 * 不触碰正在运行的开发库。运行：node _test/scripts/test-archives.mjs
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SERVER = path.join(ROOT, 'server')
const REAL_DB = path.join(SERVER, 'data/chantion.db')
const TEST_DB = path.join(SERVER, 'data/chantion-archive-test.db')
const BASE = 'http://127.0.0.1:3100'

const serverRequire = createRequire(path.join(SERVER, 'app.js'))
const Database = serverRequire('better-sqlite3')
const { ensureSeedProject } = await import('./ensure-seed.mjs')

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}

let TOKEN = ''
async function api(method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
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
  throw new Error('测试服务启动超时（检查 3100 端口是否被占用）')
}

async function main() {
  // 1) 一致性备份：用 SQLite backup API，包含 WAL 中的最新提交
  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) { fs.rmSync(f, { force: true }) })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()
  ensureSeedProject(Database, TEST_DB)   // 副本里恢复可能被软删的 XM-2026-002（不动真实库）

  // 2) 用副本启动独立服务
  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3100', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', function (buf) { stderr += buf.toString() })
  try {
    await waitReady()
    // 写接口被全局鉴权中间件拦截，先取管理员 Token（副本库种子账号）
    const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })
    TOKEN = (login.data && login.data.data && login.data.data.token) || ''
    check('管理员登录取得 Token', !!TOKEN, JSON.stringify(login.data))

    console.log('\n[A] 采购单位改名 → 项目主列 + detail 同步')
    const newBuyer = '采购单位建档测试-改名验证'
    const putBuyer = await api('PUT', '/api/archives/buyer/7', {
      name: newBuyer,
      attribute: ['政府机关'],
      phone: ['027-88492351-1', '027-11111111'],
      email: ['test001@bdg.com'],
      address: ['采购单位建档测试地址']
    })
    check('PUT /api/archives/buyer/7 成功', putBuyer.status === 200, JSON.stringify(putBuyer.data))
    check('同步项目数 = 2', putBuyer.data.data && putBuyer.data.data.synced === 2, JSON.stringify(putBuyer.data.data))
    check('返回 renamed 标记', putBuyer.data.data && putBuyer.data.data.renamed === true)
    const adv = (await api('GET', '/api/projects/advanced')).data.data
    const p1 = adv.find(function (x) { return x.project_no === 'XM-2026-001' })
    const p2 = adv.find(function (x) { return x.project_no === 'XM-2026-002' })
    check('项目列表主列 buyer_name 已更新（两个项目）',
      p1 && p2 && p1.buyer_name === newBuyer && p2.buyer_name === newBuyer,
      (p1 && p1.buyer_name) + ' / ' + (p2 && p2.buyer_name))
    const d1 = (await api('GET', '/api/projects/1')).data.data.detail
    const d2 = (await api('GET', '/api/projects/23')).data.data.detail
    check('项目详情 detail.buyer.name 已更新（两个项目）',
      d1.buyer.name === newBuyer && d2.buyer.name === newBuyer,
      d1.buyer.name + ' / ' + d2.buyer.name)
    const buyerRow = (await api('GET', '/api/archives?type=buyer&q=' + encodeURIComponent('改名验证'))).data.data[0]
    check('联系方式按多值保存（2 个电话）', buyerRow && buyerRow.phoneList.length === 2,
      buyerRow ? JSON.stringify(buyerRow.phoneList) : '未命中')

    console.log('\n[A2] 属性查询（兼容纯文本与 JSON 数组）')
    const govRows = (await api('GET', '/api/archives?type=buyer&attribute=' + encodeURIComponent('政府机关'))).data.data
    check('属性过滤命中 JSON 数组格式', govRows.some(function (r) { return r.id === 7; }) &&
      govRows.every(function (r) { return String(r.attribute).indexOf('政府机关') >= 0; }),
      JSON.stringify(govRows.map(function (r) { return r.id + ':' + r.attribute; })))
    const entRows = (await api('GET', '/api/archives?type=buyer&attribute=' + encodeURIComponent('事业单位'))).data.data
    check('属性过滤命中历史纯文本格式', entRows.length > 0 &&
      entRows.every(function (r) { return String(r.attribute).indexOf('事业单位') >= 0; }) &&
      !entRows.some(function (r) { return r.id === 7; }),
      JSON.stringify(entRows.map(function (r) { return r.id + ':' + r.attribute; })))
    const combined = (await api('GET', '/api/archives?type=buyer&q=' + encodeURIComponent(newBuyer) +
      '&attribute=' + encodeURIComponent('政府机关'))).data.data
    check('名称 + 属性组合查询', combined.length === 1 && combined[0].id === 7,
      JSON.stringify(combined.map(function (r) { return r.id + ':' + r.name; })))
    const invalid = (await api('GET', '/api/archives?type=buyer&attribute=' + encodeURIComponent('非法属性'))).data.data
    check('非法属性不影响结果（白名单忽略）', invalid.length > 0)

    console.log('\n[B] 竞争对手（分包中标单位）改名 → winner_names + detail 分包同步')
    const newWinner = '分三包测试录入第二包中标单位-改名验证'
    // 档案 ID 会随历史数据漂移，按名称解析，避免写死 36
    const winnerRows = (await api('GET', '/api/archives?type=competitor&q=' + encodeURIComponent('分三包测试录入第二包中标单位'))).data.data
    const winnerId = winnerRows.length && winnerRows[0].id
    check('找到分包中标单位档案', !!winnerId, JSON.stringify(winnerRows.map(function (r) { return r.id + ':' + r.name })))
    const putWinner = await api('PUT', '/api/archives/competitor/' + winnerId, { name: newWinner })
    check('PUT /api/archives/competitor/' + winnerId + ' 成功', putWinner.status === 200, JSON.stringify(putWinner.data))
    check('同步项目数 = 1', putWinner.data.data && putWinner.data.data.synced === 1, JSON.stringify(putWinner.data.data))
    const adv2 = (await api('GET', '/api/projects/advanced')).data.data.find(function (x) { return x.project_no === 'XM-2026-002' })
    check('项目列表 winner_names 已更新', adv2 && adv2.winner_names.indexOf(newWinner) >= 0, adv2 && adv2.winner_names)
    const d3 = (await api('GET', '/api/projects/23')).data.data.detail
    check('项目详情分包 winner.lead 已更新',
      d3.completed.packages.some(function (p) { return p.winner.lead === newWinner }),
      JSON.stringify(d3.completed.packages.map(function (p) { return p.winner.lead })))

    console.log('\n[C] 代理机构改名 + 联系方式更新')
    const newAgency = '意向公示代理机构-改名验证'
    const putAgency = await api('PUT', '/api/archives/agency/34', {
      name: newAgency, phone: ['027-22536531', '027-99999999'], email: ['test0023@qq.com'], address: ['意向公示代理机构测试地址']
    })
    check('PUT /api/archives/agency/34 成功', putAgency.status === 200, JSON.stringify(putAgency.data))
    const adv3 = (await api('GET', '/api/projects/advanced')).data.data.find(function (x) { return x.project_no === 'HBZC-20261113-001（二）' })
    const d4 = (await api('GET', '/api/projects/24')).data.data.detail
    check('项目列表与主列 agency_name 已更新', adv3 && adv3.agency_name === newAgency, adv3 && adv3.agency_name)
    check('项目详情 detail.agency.name 已更新', d4.agency.name === newAgency, d4.agency.name)

    console.log('\n[D] 删除校验：被引用拦截 / 零引用放行')
    const delReferenced = await api('DELETE', '/api/archives/buyer/7')
    check('被 2 个项目引用的档案删除返回 409', delReferenced.status === 409, JSON.stringify(delReferenced.data))
    check('拦截文案与需求一致',
      delReferenced.data.message === '该单位正在被 2 个项目引用，无法删除，请先修改关联项目',
      delReferenced.data.message)
    check('档案仍在（未被删除）',
      (await api('GET', '/api/archives?type=buyer&q=' + encodeURIComponent('改名验证'))).data.data.length === 1)

    const tdb = new Database(TEST_DB)
    tdb.prepare('INSERT INTO buyers (name, name_norm, phone, email, address, source_project_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('零引用测试单位', '零引用测试单位', '', '', '', 'TEST-000', '2026-01-01 00:00:00', '2026-01-01 00:00:00')
    const zeroId = tdb.prepare('SELECT id FROM buyers WHERE name_norm = ?').get('零引用测试单位').id
    tdb.close()
    const delZero = await api('DELETE', '/api/archives/buyer/' + zeroId)
    check('零引用档案删除成功', delZero.status === 200 && delZero.data.data.deleted === true, JSON.stringify(delZero.data))
    check('删除后查询不到该档案',
      (await api('GET', '/api/archives?type=buyer&q=' + encodeURIComponent('零引用测试单位'))).data.data.length === 0)

    console.log('\n[E] 名称冲突与关键字搜索')
    // 用副本库内新造的同名档案做冲突目标，避免依赖真实库里某个固定名称恰好存在
    const dupName = '重复名称验证单位'
    const tdb2 = new Database(TEST_DB)
    tdb2.prepare('INSERT INTO buyers (name, name_norm, phone, email, address, source_project_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(dupName, dupName, '', '', '', 'TEST-DUP', '2026-01-01 00:00:00', '2026-01-01 00:00:00')
    tdb2.close()
    const dup = await api('PUT', '/api/archives/buyer/7', { name: dupName })
    check('改成已存在的档案名返回 409', dup.status === 409, JSON.stringify(dup.data))
    const searched = (await api('GET', '/api/archives?type=buyer&q=' + encodeURIComponent('改名验证'))).data.data
    check('关键字模糊搜索命中改名后的档案', searched.length === 1 && searched[0].name === newBuyer,
      JSON.stringify(searched.map(function (x) { return x.name })))

    console.log('\n[F] 原有功能回归')
    const bad = await api('POST', '/api/projects', { detail: {} })
    check('项目必填校验仍返回 400 + fields', bad.status === 400 && bad.data.fields && bad.data.fields.length >= 4,
      JSON.stringify(bad.data))
    const { filterRegion } = await import(pathToFileURL(path.join(ROOT, 'client/src/utils/regions.js')).href)
    const node = { data: { n: '北京市', p: 'bjs', s: 'beijingshi' }, text: '北京市' }
    check('行政区划拼音首字母搜索回归（bj）', filterRegion(node, 'bj') === true)
    check('行政区划全拼搜索回归（beijing）', filterRegion(node, 'beijing') === true)
    check('行政区划汉字搜索回归（北京）', filterRegion(node, '北京') === true)

    console.log('\n结果：PASS = ' + pass + '，FAIL = ' + fail)
    if (fail) console.log('后端 stderr：\n' + stderr.slice(-2000))
  } finally {
    child.kill('SIGTERM')
    try { await once(child, 'exit') } catch (e) { /* 已退出 */ }
    ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(function (f) { fs.rmSync(f, { force: true }) })
  }
  if (fail) process.exitCode = 1
}

main().catch(function (e) {
  console.error('自测执行失败：', e)
  process.exitCode = 1
})
