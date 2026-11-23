/**
 * CI 专用数据库种子：从受控快照 fixture-ci.json 生成可复现的测试库。
 * 不依赖开发者本机的 server/data/chantion.db，也不写入真实开发库。
 *
 * 运行：node _test/scripts/seed-ci-db.mjs
 * 可用 CI_DB_PATH 指定输出路径（默认 server/data/chantion.db）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SERVER = path.join(ROOT, 'server')
const FIXTURE = path.join(HERE, 'fixture-ci.json')
const DB_PATH = process.env.CI_DB_PATH || path.join(SERVER, 'data', 'chantion.db')

// db.js / migrate.js 会读取这些环境变量；dotenv 不覆盖已存在的 env
process.env.DB_PATH = DB_PATH
process.env.ADMIN_USER = process.env.ADMIN_USER || 'admin'
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'
process.env.TZ = process.env.TZ || 'Asia/Shanghai'

for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
  try { fs.rmSync(f, { force: true }) } catch (e) {}
}
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

// require db.js 即建表 + 幂等迁移 + 生成默认管理员/配置（不依赖任何外部库）
const require = (await import('node:module')).createRequire(path.join(SERVER, 'app.js'))
const { db } = require(path.join(SERVER, 'db.js'))
const { replaceProjectWinners } = require(path.join(SERVER, 'winners.js'))

const snapshot = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
const counts = {}

function insertRows(table, rows) {
  if (!rows || !rows.length) return
  const cols = Object.keys(rows[0])
  const sql = 'INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')'
  const stmt = db.prepare(sql)
  db.transaction(function () {
    rows.forEach(function (row) { stmt.run(...cols.map(c => row[c] === undefined ? null : row[c])) })
  })()
  counts[table] = rows.length
}

insertRows('projects', snapshot.tables.projects)
insertRows('buyers', snapshot.tables.buyers)
insertRows('agencies', snapshot.tables.agencies)
insertRows('competitors', snapshot.tables.competitors)
insertRows('judges', snapshot.tables.judges)
insertRows('operation_logs', snapshot.tables.operation_logs)

// system_settings 由迁移预置默认值，这里按 key 覆盖为快照值（含本企业配置，供看板测试使用）
;(snapshot.tables.system_settings || []).forEach(function (row) {
  db.prepare('INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(row.key, row.value, row.updated_at)
})

// 防御：若快照被改动导致 XM-2026-002 仍是软删除状态，这里恢复为标准测试数据
db.prepare("UPDATE projects SET project_no = 'XM-2026-002', deleted = 0 WHERE row_id = 23 AND project_no LIKE 'XM-2026-002__DEL_%'").run()

// 派生列映射与 detail 同源，避免统计类测试读到旧映射
db.prepare('DELETE FROM project_winners').run()
db.prepare("SELECT row_id, project_no, detail, award_amount_fen FROM projects WHERE deleted = 0").all().forEach(function (row) {
  let detail = {}
  try { detail = JSON.parse(row.detail || '{}') } catch (e) { detail = {} }
  replaceProjectWinners(db, row.project_no, detail, row.award_amount_fen || 0)
})

const summary = Object.keys(counts).map(k => k + '=' + counts[k]).join(', ')
console.log('[CI SEED] ' + DB_PATH)
console.log('[CI SEED] ' + summary + ', users/config_options 由迁移自动生成, system_settings 由快照覆盖')
db.close()
