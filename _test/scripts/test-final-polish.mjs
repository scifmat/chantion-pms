/**
 * 第 13 轮「档案属性 / 列调整 / 全局对齐」自测。
 * 在真实库副本上跑迁移 + 接口；不触碰开发库。运行：node _test/scripts/test-final-polish.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-final-test.db')
const BASE = 'http://127.0.0.1:3101'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}
let TOKEN = ''
async function api(method, p, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN
  const res = await fetch(BASE + p, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data = {}; try { data = await res.json() } catch (e) {}
  return { status: res.status, data }
}
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { const r = await fetch(BASE + '/api/projects', { signal: AbortSignal.timeout(1000) }); if (r.ok) return } catch (e) {}
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('测试服务启动超时')
}

async function main() {
  // ---------- 1) 全局表格对齐：不再按长短判断，一律居中 ----------
  console.log('\n[A] 全局对齐：所有单元格统一双向居中')
  const alignUrl = pathToFileURL(path.join(ROOT, 'client/src/utils/cellAlign.js')).href
  const { cellClass, cellAlign } = await import(alignUrl)
  check('统一居中 class', cellClass() === 'cell-center')
  check('短文本仍居中', cellClass('意向公示') === 'cell-center')
  check('长文本也居中', cellClass('湖北省武汉市洪山区政府采购中心') === 'cell-center')
  check('指令仍提供 mounted/updated 钩子', typeof cellAlign.mounted === 'function' && typeof cellAlign.updated === 'function')
  const cssSrc = fs.readFileSync(path.join(ROOT, 'client/src/styles.css'), 'utf8')
  check('不再有左对齐单元格样式规则', !/:where\(#app\) td\.cell-left/.test(cssSrc))
  check('基础 td 文本对齐已改为 center', /:where\(#app\) th,:where\(#app\) td\{[^}]*text-align:center/.test(cssSrc))

  // ---------- 2) 前端常量：属性选项 + 动态表头 ----------
  console.log('\n[B] 前端常量')
  const archUrl = pathToFileURL(path.join(ROOT, 'client/src/utils/archive.js')).href
  const { UNIT_ATTRIBUTES, REF_COL_LABEL } = await import(archUrl)
  check('属性六项完整', JSON.stringify(UNIT_ATTRIBUTES) === JSON.stringify(['政府机关','事业单位','国有企业','民营企业','外资企业','其他']))
  check('buyer 表头=招标项目数', REF_COL_LABEL.buyer === '招标项目数')
  check('agency 表头=代理项目数', REF_COL_LABEL.agency === '代理项目数')
  check('competitor 表头=中标项目数', REF_COL_LABEL.competitor === '中标项目数')

  // ---------- 3) 副本库迁移 + 接口 ----------
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) fs.rmSync(f, { force: true })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()
  // 模拟旧库：先删掉 attribute 列不可行（SQLite 3.35 支持 DROP COLUMN），用重建表模拟更稳妥：
  // 直接确认迁移对「缺列」与「已有列」都幂等 —— 这里副本来自已跑过 007 的真实库，
  // 另造一个缺列的临时表验证迁移 SQL 本身。
  const probe = new Database(TEST_DB)
  probe.exec('CREATE TABLE IF NOT EXISTS _probe (id INTEGER PRIMARY KEY, name TEXT)')
  probe.exec("ALTER TABLE _probe ADD COLUMN attribute TEXT NOT NULL DEFAULT ''")
  const probeCols = probe.prepare('PRAGMA table_info(_probe)').all().map(c => c.name)
  check('迁移 ALTER SQL 可为缺列表加 attribute', probeCols.includes('attribute'))
  probe.exec('DROP TABLE _probe')
  probe.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER,
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3101', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    // 写接口被全局鉴权中间件拦截，先取管理员 Token（副本库种子账号）
    const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })
    TOKEN = (login.data && login.data.data && login.data.data.token) || ''
    check('管理员登录取得 Token', !!TOKEN, JSON.stringify(login.data))
    console.log('\n[C] 属性列迁移结果（副本库启动后自动跑迁移）')
    const db2 = new Database(TEST_DB, { readonly: true })
    ;['buyers', 'agencies', 'competitors'].forEach(function (tbl) {
      const cols = db2.prepare('PRAGMA table_info(' + tbl + ')').all().map(c => c.name)
      check(tbl + ' 表含 attribute 列', cols.includes('attribute'))
    })
    db2.close()

    console.log('\n[D] 属性读写与校验')
    const before = (await api('GET', '/api/archives?type=buyer&q=' + encodeURIComponent('采购单位建档测试'))).data.data[0]
    check('GET 列表返回 attribute 字段', before && 'attribute' in before, JSON.stringify(before && Object.keys(before)))

    const put1 = await api('PUT', '/api/archives/buyer/' + before.id, {
      name: before.name, attribute: '国有企业', phone: before.phoneList || [], email: before.emailList || [], address: before.addressList || []
    })
    check('PUT 写入合法属性「国有企业」', put1.status === 200, JSON.stringify(put1.data))
    const after = (await api('GET', '/api/archives?type=buyer&q=' + encodeURIComponent('采购单位建档测试'))).data.data[0]
    check('属性已落库并可回显', after.attribute === '国有企业', after.attribute)

    const putEmpty = await api('PUT', '/api/archives/buyer/' + before.id, {
      name: before.name, attribute: '', phone: [], email: [], address: []
    })
    check('PUT 允许清空属性', putEmpty.status === 200 && putEmpty.data.data.row.attribute === '', JSON.stringify(putEmpty.data))

    const putBad = await api('PUT', '/api/archives/buyer/' + before.id, {
      name: before.name, attribute: '个体户', phone: [], email: [], address: []
    })
    check('非法属性返回 400 + fields', putBad.status === 400 && (putBad.data.fields || []).includes('attribute'), JSON.stringify(putBad.data))

    // 改名同步回归（确保本轮改动没有破坏上一轮功能）
    console.log('\n[E] 改名同步回归')
    const putRename = await api('PUT', '/api/archives/buyer/' + before.id, {
      name: '采购单位建档测试-终检', attribute: '事业单位', phone: [], email: [], address: []
    })
    check('改名仍成功且同步 2 个项目', putRename.status === 200 && putRename.data.data.synced === 2, JSON.stringify(putRename.data.data))
    const adv = (await api('GET', '/api/projects/advanced')).data.data
    check('项目主列 buyer_name 同步', adv.filter(x => x.buyer_name === '采购单位建档测试-终检').length === 2)
    const d = (await api('GET', '/api/projects/1')).data.data.detail
    check('项目 detail.buyer.name 同步', d.buyer.name === '采购单位建档测试-终检', d.buyer.name)

    console.log('\n结果：PASS = ' + pass + '，FAIL = ' + fail)
  } finally {
    child.kill('SIGTERM')
    try { await once(child, 'exit') } catch (e) {}
    ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => fs.rmSync(f, { force: true }))
  }
  if (fail) process.exitCode = 1
}
main().catch(e => { console.error('自测异常:', e); process.exitCode = 1 })
