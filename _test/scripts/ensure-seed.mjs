/**
 * 测试副本数据就绪：确保测试强依赖的 XM-2026-002（多包+联合体场景）可见。
 * 用户可能已在真实库软删除该项目（编号变 XM-2026-002__DEL_23、deleted=1）。
 * 本模块只在「测试副本」里恢复它，绝不碰真实库；恢复时同步重建 project_winners 映射。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const require = createRequire(path.join(ROOT, 'server/app.js'))

export function ensureSeedProject(Database, dbPath) {
  const db = new Database(dbPath)
  try {
    const exists = db.prepare("SELECT row_id FROM projects WHERE project_no='XM-2026-002' AND deleted=0").get()
    if (exists) return { restored: false }
    const soft = db.prepare("SELECT row_id, detail, award_amount_fen FROM projects WHERE project_no LIKE 'XM-2026-002__DEL_%' AND deleted=1 LIMIT 1").get()
    if (!soft) return { restored: false, missing: true }
    const { replaceProjectWinners } = require(path.join(ROOT, 'server/winners.js'))
    db.transaction(function () {
      db.prepare("UPDATE projects SET project_no='XM-2026-002', deleted=0 WHERE row_id=?").run(soft.row_id)
      let detail = {}
      try { detail = JSON.parse(soft.detail || '{}') } catch (e) { detail = {} }
      replaceProjectWinners(db, 'XM-2026-002', detail, soft.award_amount_fen || 0)
    })()
    return { restored: true }
  } finally {
    db.close()
  }
}
