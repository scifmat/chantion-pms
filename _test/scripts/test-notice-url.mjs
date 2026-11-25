/**
 * 公告网址自测：
 *  - deriveFromDetail 按状态映射四类公告 URL（纯函数）
 *  - 新增 / 编辑保存后，首页列表立即返回最新 notice_url（不依赖整份 detail）
 * 运行：node _test/scripts/test-notice-url.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SERVER = path.join(ROOT, 'server')
const REAL_DB = path.join(SERVER, 'data/chantion.db')
const TEST_DB = path.join(SERVER, 'data/chantion-notice-test.db')
const BASE = 'http://127.0.0.1:3122'
const require = createRequire(path.join(SERVER, 'app.js'))
const Database = require('better-sqlite3')
const { deriveFromDetail } = require(path.join(SERVER, 'derive.js'))
const { mergeDetail } = require(path.join(SERVER, 'detail.js'))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  →  ' + detail : '')) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function api(urlPath, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {})
  const res = await fetch(BASE + urlPath, { method: options.method || 'GET', headers, body: options.body })
  let json = {}
  try { json = await res.json() } catch (e) {}
  return { status: res.status, data: json }
}
function auth(token) { return { Authorization: 'Bearer ' + token } }
async function waitReady() {
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    try { if ((await api('/api/projects')).status === 200) return } catch (e) {}
    await sleep(150)
  }
  throw new Error('后端启动超时')
}

function deriveNotice(urls, status) {
  const detail = {
    public: { status: status, region: '湖北省-武汉市', project_no: 'N-' + status, project_name: '公告测试', budget_yuan: '100' },
    buyer: { name: '测试甲方' }, agency: { name: '测试代理' },
    intention: { url: urls.intention }, bidding: { url: urls.bidding },
    terminated: { url: urls.terminated }, completed: { url: urls.completed }
  }
  const r = deriveFromDetail(mergeDetail(detail))
  if (r.error) throw new Error(r.error)
  return r.values.notice_url
}

async function main() {
  console.log('\n[A] 状态 -> 公告网址映射（纯函数）')
  const urls = {
    intention: 'https://example.com/intention',
    bidding: 'https://example.com/bidding',
    terminated: 'https://example.com/terminated',
    completed: 'https://example.com/completed'
  }
  check('意向公示取意向公告', deriveNotice(urls, '意向公示') === urls.intention)
  check('正在招标取招标公告', deriveNotice(urls, '正在招标') === urls.bidding)
  check('终止招标取终止公告', deriveNotice(urls, '终止招标') === urls.terminated)
  check('完成招标取中标公告', deriveNotice(urls, '完成招标') === urls.completed)
  check('无网址时为空', deriveNotice({ intention: '', bidding: '', terminated: '', completed: '' }, '完成招标') === '')

  ;[TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm'].forEach(f => { try { fs.unlinkSync(f) } catch (e) {} })
  const src = new Database(REAL_DB, { readonly: true })
  await src.backup(TEST_DB)
  src.close()

  const child = spawn(process.execPath, [path.join(SERVER, 'app.js')], {
    cwd: SERVER, env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3122', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  try {
    await waitReady()
    const admin = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' })
    })
    const token = admin.data.data.token
    check('管理员登录', !!token, JSON.stringify(admin.data))

    console.log('\n[B] 新增 / 编辑保存后列表立即生效')
    const base = (await api('/api/projects/1', { headers: auth(token) })).data.data
    const detail = JSON.parse(JSON.stringify(base.detail))
    const no = 'NOTICE-' + Date.now()
    const name = '公告测试项目-' + Date.now()
    detail.public.status = '意向公示'
    detail.public.project_no = no
    detail.public.project_name = name
    detail.intention = Object.assign({}, detail.intention, { url: 'https://example.com/intention-online' })
    const created = await api('/api/projects', {
      method: 'POST', headers: auth(token), body: JSON.stringify({ detail: detail })
    })
    check('新增项目成功', created.status === 201, JSON.stringify(created.data && created.data.message))

    let list = (await api('/api/projects?name=' + encodeURIComponent(name), { headers: auth(token) })).data.data
    const row = list.find(function (r) { return r.project_no === no })
    check('新增后列表返回意向公告网址', !!row && row.notice_url === 'https://example.com/intention-online',
      JSON.stringify(row && row.notice_url))

    detail.public.status = '完成招标'
    detail.completed = Object.assign({}, detail.completed, { url: 'https://example.com/completed-online' })
    const updated = await api('/api/projects/' + created.data.data.row_id, {
      method: 'PUT', headers: auth(token),
      body: JSON.stringify({ version: created.data.data.version, detail: detail })
    })
    check('编辑保存成功', updated.status === 200, JSON.stringify(updated.data && updated.data.message))

    list = (await api('/api/projects?name=' + encodeURIComponent(name), { headers: auth(token) })).data.data
    const row2 = list.find(function (r) { return r.project_no === no })
    check('编辑后列表立即切换到中标公告网址', !!row2 && row2.notice_url === 'https://example.com/completed-online',
      JSON.stringify(row2 && row2.notice_url))
  } finally {
    child.kill()
  }
  console.log('\n公告网址自测：' + pass + ' 通过，' + fail + ' 失败')
  if (fail) process.exitCode = 1
}
main().catch(function (e) { console.error(e); process.exitCode = 1 })
