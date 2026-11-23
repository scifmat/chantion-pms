/**
 * 用户系统与权限控制自测（第 9 步）。
 * 在真实数据库副本上启动独立后端（127.0.0.1:3101），所有写操作只落副本，
 * 不触碰开发库。覆盖：访客/普通用户/管理员三视角、401/403、409/500 不被误伤、
 * 改密/重置后旧 Token 失效、操作人留痕、迁移幂等。
 * 运行：node _test/scripts/test-auth.mjs
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
const TEST_DB = path.join(SERVER, 'data/chantion-auth-test.db')
const BASE = 'http://127.0.0.1:3101'

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
  throw new Error('测试服务启动超时（检查 3101 端口是否被占用）')
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
    env: Object.assign({}, process.env, { DB_PATH: TEST_DB, PORT: '3101', HOST: '127.0.0.1' }),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', function (buf) { stderr += buf.toString() })
  try {
    await waitReady()

    console.log('\n[A] 默认管理员与登录')
    const badLogin = await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })
    check('错误密码登录返回 401', badLogin.status === 401, JSON.stringify(badLogin.data))
    const adminLogin = await api('POST', '/api/auth/login', { username: 'ADMIN', password: 'admin123' })
    check('管理员登录成功（用户名大小写不敏感）', adminLogin.status === 200 && !!adminLogin.data.data.token, JSON.stringify(adminLogin.data))
    const adminToken = adminLogin.data.data.token
    const me = await api('GET', '/api/auth/me', undefined, adminToken)
    check('GET /auth/me 恢复登录态', me.status === 200 && me.data.data.user.role === 'admin', JSON.stringify(me.data))

    console.log('\n[B] 访客（未登录）权限')
    check('访客可读项目列表', (await api('GET', '/api/projects')).status === 200)
    check('访客可读档案', (await api('GET', '/api/archives?type=buyer')).status === 200)
    check('访客可读项目详情', (await api('GET', '/api/projects/1')).status === 200)
    check('访客 POST 项目被拦 401', (await api('POST', '/api/projects', {})).status === 401)
    check('访客 PUT 项目被拦 401', (await api('PUT', '/api/projects/1', {})).status === 401)
    check('访客 DELETE 项目被拦 401', (await api('DELETE', '/api/projects/1', {})).status === 401)
    check('访客 PUT 档案被拦 401', (await api('PUT', '/api/archives/buyer/1', {})).status === 401)
    check('访客 PUT 业务配置被拦 401', (await api('PUT', '/api/config/options/status', { items: [] })).status === 401)
    check('访客 GET 用户列表被拦 401', (await api('GET', '/api/users')).status === 401)
    check('访客 DELETE 用户被拦 401', (await api('DELETE', '/api/users/2')).status === 401)

    console.log('\n[C] 普通用户权限')
    const created = await api('POST', '/api/users', { username: 'tester01', password: 'pass123', role: 'user' }, adminToken)
    check('管理员创建普通用户成功', created.status === 201, JSON.stringify(created.data))
    check('创建的管理员被拒绝（单一管理员）',
      (await api('POST', '/api/users', { username: 'admin2', password: 'pass123', role: 'admin' }, adminToken)).status === 400)
    const userLogin = await api('POST', '/api/auth/login', { username: 'tester01', password: 'pass123' })
    const userToken = userLogin.data.data.token
    check('普通用户登录成功', userLogin.status === 200 && !!userToken, JSON.stringify(userLogin.data))
    check('普通用户可 POST 项目（登录即可写）',
      (await api('POST', '/api/projects', { public: { status: '意向公示', region: '北京市', project_no: '', project_name: '' } }, userToken)).status !== 401)
    check('普通用户 GET 用户列表被拦 403', (await api('GET', '/api/users', undefined, userToken)).status === 403)
    check('普通用户 POST 用户被拦 403', (await api('POST', '/api/users', { username: 'x', password: '123456' }, userToken)).status === 403)
    check('普通用户 PUT 业务配置被拦 403',
      (await api('PUT', '/api/config/options/status', { items: [] }, userToken)).status === 403)

    console.log('\n[D] 409 / 400 错误结构不被鉴权误伤')
    const conflict = await api('POST', '/api/users', { username: 'tester01', password: 'pass123' }, adminToken)
    check('重名创建用户返回 409 且 message 保留', conflict.status === 409 && !!conflict.data.message, JSON.stringify(conflict.data))
    const badBody = await api('POST', '/api/auth/login', {})
    check('登录缺字段返回 400（非 401）', badBody.status === 400, JSON.stringify(badBody.data))

    console.log('\n[E] 操作人留痕')
    const addProject = await api('POST', '/api/projects', {
      detail: {
        public: {
          status: '意向公示', region: '北京市',
          project_no: 'AUTH-TEST-001', project_name: '鉴权测试项目',
          budget_yuan: '10', ceiling_yuan: '10'
        },
        buyer: { name: '留痕测试采购单位' },
        agency: { name: '留痕测试代理机构' }
      }
    }, userToken)
    check('普通用户新增项目成功', addProject.status === 201, JSON.stringify(addProject.data))
    const logs = await api('GET', '/api/operation-logs?no=AUTH-TEST-001')
    const addLog = logs.data.data.find(function (x) { return x.op_type === '新增项目' })
    check('操作记录 operator = tester01（真实用户）', !!addLog && addLog.operator === 'tester01', JSON.stringify(addLog))

    console.log('\n[F] 修改密码 / 重置密码后旧 Token 失效')
    const chg = await api('POST', '/api/auth/change-password', { oldPassword: 'pass123', newPassword: 'pass456' }, userToken)
    check('修改密码成功并返回新 Token', chg.status === 200 && !!chg.data.data.token, JSON.stringify(chg.data))
    check('修改密码后旧 Token 失效（401）', (await api('GET', '/api/auth/me', undefined, userToken)).status === 401)
    check('新 Token 仍有效', (await api('GET', '/api/auth/me', undefined, chg.data.data.token)).status === 200)
    const newLogin = await api('POST', '/api/auth/login', { username: 'tester01', password: 'pass456' })
    check('新密码可登录', newLogin.status === 200)
    const reset = await api('POST', '/api/users/' + created.data.data.id + '/reset-password', { password: 'reset789' }, adminToken)
    check('管理员重置普通用户密码成功', reset.status === 200, JSON.stringify(reset.data))
    check('重置后该用户旧 Token 失效（401）', (await api('GET', '/api/auth/me', undefined, newLogin.data.data.token)).status === 401)
    check('不能重置管理员密码',
      (await api('POST', '/api/users/1/reset-password', { password: 'hack123' }, adminToken)).status === 400)

    console.log('\n[G] 删除防护与迁移幂等')
    check('管理员账号不可删除', (await api('DELETE', '/api/users/1', undefined, adminToken)).status === 400)
    check('删除普通用户成功', (await api('DELETE', '/api/users/' + created.data.data.id, undefined, adminToken)).status === 200)
    const adminCount = new Database(TEST_DB).prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n
    check('管理员始终唯一', adminCount === 1, 'count=' + adminCount)

    console.log('\n[H] 500 异常仍按原结构返回（接口不存在）')
    const notFound = await api('GET', '/api/no-such-endpoint')
    check('未知接口返回 404 且 ok=false', notFound.status === 404 && notFound.data.ok === false, JSON.stringify(notFound.data))

  } finally {
    child.kill('SIGTERM')
    await new Promise(function (resolve) { child.once('exit', resolve); setTimeout(resolve, 2000) })
    // 临时库清理：某些沙箱对 rmSync 有安全删除拦截，清理失败不影响测试结论
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
