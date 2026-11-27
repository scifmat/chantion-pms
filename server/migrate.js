// 幂等迁移：绝不 DROP、绝不重建表，已有真实数据一行不丢。
// 001：第 2 步补「中标金额双字段 / 中标时间」
// 002：第 3 步补「全量表单 JSON / 最高限价双字段」
// 003：第 5 步补「高级查询 7 个派生列」，并对历史行做 backfill 一致性修复
// 004：第 6 步建 4 张独立信息档案表，并回填历史项目（残缺 detail 空值防护）
// 005：第 7 步建业务配置项表
// 006：第 8 步补软删除列、建独立操作记录表并回填 detail.operationLog
// 007：三类档案表补「单位属性」列
// 008：第 9 步建 users 表 + 单管理员唯一索引，并幂等生成默认管理员账号
// 009：第 16 步建 system_settings 键值表 + competitors.is_self（唯一本企业）
// 010：第 17 步建 project_winners 规范化映射表（全局看板 SQL 聚合）并回填历史项目
// 011：回收站 —— projects.deleted_at；三类档案 deleted / deleted_at / original_name
// 012：projects.notice_url —— 当前状态对应公告网址（由 detail 派生，随新增/编辑同事务更新）
// 013：项目跟进 bid_trackings（project_id 关联 projects.row_id；derived_key 驱动状态自检）
// 014：项目跟进阶段记录 bid_tracking_stages（四节点复盘/经验，当前阶段冗余到 bid_trackings）
const fs = require('fs');
const path = require('path');
const { mergeDetail } = require('./detail');
const { deriveFromDetail, DERIVED_COLUMNS } = require('./derive');
const { backfillArchives } = require('./archive');
const { seedDefaults, syncAmountUnits } = require('./config');
const { backfillLogs } = require('./operation');
const { seedAdmin } = require('./users');
const { seedSystemSettings } = require('./settings');
const { backfillWinners } = require('./winners');
const { backfillStages } = require('./tracking');

const MIGRATIONS = [
  {
    id: '001',
    columns: [
      { name: 'award_amount_yuan', sql: "ALTER TABLE projects ADD COLUMN award_amount_yuan TEXT NOT NULL DEFAULT '0'" },
      { name: 'award_amount_fen',  sql: 'ALTER TABLE projects ADD COLUMN award_amount_fen INTEGER NOT NULL DEFAULT 0' },
      { name: 'award_time',        sql: "ALTER TABLE projects ADD COLUMN award_time TEXT NOT NULL DEFAULT ''" }
    ]
  },
  {
    id: '002',
    columns: [
      { name: 'detail',       sql: "ALTER TABLE projects ADD COLUMN detail TEXT NOT NULL DEFAULT '{}'" },
      { name: 'ceiling_yuan', sql: "ALTER TABLE projects ADD COLUMN ceiling_yuan TEXT NOT NULL DEFAULT '0'" },
      { name: 'ceiling_fen',  sql: 'ALTER TABLE projects ADD COLUMN ceiling_fen INTEGER NOT NULL DEFAULT 0' }
    ]
  },
  {
    id: '003',
    columns: [
      { name: 'bid_end',        sql: "ALTER TABLE projects ADD COLUMN bid_end TEXT NOT NULL DEFAULT ''" },
      { name: 'method',         sql: "ALTER TABLE projects ADD COLUMN method TEXT NOT NULL DEFAULT ''" },
      { name: 'period_days',    sql: "ALTER TABLE projects ADD COLUMN period_days TEXT NOT NULL DEFAULT ''" },
      { name: 'winner_names',   sql: "ALTER TABLE projects ADD COLUMN winner_names TEXT NOT NULL DEFAULT ''" },
      { name: 'project_types',  sql: "ALTER TABLE projects ADD COLUMN project_types TEXT NOT NULL DEFAULT ''" },
      { name: 'buyer_name',     sql: "ALTER TABLE projects ADD COLUMN buyer_name TEXT NOT NULL DEFAULT ''" },
      { name: 'agency_name',    sql: "ALTER TABLE projects ADD COLUMN agency_name TEXT NOT NULL DEFAULT ''" }
    ]
  },
  {
    // 004 是「建表型」迁移：DDL 单一来源 archive-schema.sql，全部 IF NOT EXISTS，重复执行安全
    id: '004',
    tables: ['buyers', 'agencies', 'competitors', 'judges'],
    ddl: 'archive-schema.sql'
  },
  {
    // 005：业务配置项表，DDL 单一来源 config-schema.sql
    id: '005',
    tables: ['config_options'],
    ddl: 'config-schema.sql'
  },
  {
    // 006 同时含「补列」与「建表」：projects.deleted 软删除 + operation_logs 独立留痕
    id: '006',
    columns: [
      { name: 'deleted', sql: 'ALTER TABLE projects ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0' }
    ],
    tables: ['operation_logs'],
    ddl: 'operation-schema.sql'
  },
  {
    // 007：三类档案表补「单位属性」列（档案页编辑维护，录入项目时不录入）
    id: '007',
    tableColumns: ['buyers', 'agencies', 'competitors'],
    column: { name: 'attribute', sql: "ALTER TABLE {table} ADD COLUMN attribute TEXT NOT NULL DEFAULT ''" }
  },
  {
    // 008：用户表 + 单管理员唯一索引，DDL 单一来源 users-schema.sql
    id: '008',
    tables: ['users'],
    ddl: 'users-schema.sql'
  },
  {
    // 009：系统设置表 + competitors 唯一本企业标记，DDL 单一来源 system-schema.sql
    id: '009',
    tables: ['system_settings'],
    ddl: 'system-schema.sql',
    tableColumns: ['competitors'],
    column: { name: 'is_self', sql: 'ALTER TABLE competitors ADD COLUMN is_self INTEGER NOT NULL DEFAULT 0' }
  },
  {
    // 010：全局看板用的中标单位映射表，DDL 单一来源 winners-schema.sql
    id: '010',
    tables: ['project_winners'],
    ddl: 'winners-schema.sql'
  },
  {
    // 011：回收站。档案三类表各补 3 列；原唯一键靠软删除时改名释放，不改索引结构
    id: '011',
    columns: [
      { name: 'deleted_at', sql: "ALTER TABLE projects ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''" }
    ],
    archiveTables: ['buyers', 'agencies', 'competitors'],
    archiveColumns: [
      { name: 'deleted',      sql: 'ALTER TABLE {table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0' },
      { name: 'deleted_at',   sql: "ALTER TABLE {table} ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''" },
      { name: 'original_name', sql: "ALTER TABLE {table} ADD COLUMN original_name TEXT NOT NULL DEFAULT ''" }
    ],
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted, deleted_at)',
      'CREATE INDEX IF NOT EXISTS idx_buyers_deleted_at ON buyers(deleted, deleted_at)',
      'CREATE INDEX IF NOT EXISTS idx_agencies_deleted_at ON agencies(deleted, deleted_at)',
      'CREATE INDEX IF NOT EXISTS idx_competitors_deleted_at ON competitors(deleted, deleted_at)'
    ]
  },
  {
    // 012：列表直出公告网址，避免为了取 URL 把整份 detail 下发到前端
    id: '012',
    columns: [
      { name: 'notice_url', sql: "ALTER TABLE projects ADD COLUMN notice_url TEXT NOT NULL DEFAULT ''" }
    ]
  },
  {
    // 013：项目跟进主表。DDL 单一来源 tracking-schema.sql，全部 IF NOT EXISTS，重复执行安全
    id: '013',
    tables: ['bid_trackings'],
    ddl: 'tracking-schema.sql'
  },
  {
    // 014：跟进阶段记录表。DDL 单一来源 tracking-stages-schema.sql
    id: '014',
    tables: ['bid_tracking_stages'],
    ddl: 'tracking-stages-schema.sql'
  }
];

/**
 * 历史数据回填：与 POST / PUT 共用同一个 deriveFromDetail，保证旧数据也能被高级查询搜到。
 * 只 UPDATE 7 个派生列 —— 不动 updated_at / version（不破坏 409 乐观锁），
 * 也不动任何主表金额列（第 1/2 步的老数据 detail 可能为空，覆盖会抹掉已有值）。
 */
function backfillDerived(db) {
  const rows = db.prepare('SELECT row_id, detail, ' + DERIVED_COLUMNS.join(', ') + ' FROM projects').all();
  if (!rows.length) return 0;
  const upd = db.prepare(
    'UPDATE projects SET ' + DERIVED_COLUMNS.map(function (c) { return c + ' = ?'; }).join(', ') + ' WHERE row_id = ?'
  );
  let fixed = 0;
  const run = db.transaction(function () {
    rows.forEach(function (row) {
      let parsed = {};
      try { parsed = JSON.parse(row.detail || '{}'); } catch (e) { parsed = {}; }
      const r = deriveFromDetail(mergeDetail(parsed));
      if (r.error) {
        console.log('[MIGRATION 003] backfill skipped row ' + row.row_id + ': ' + r.error);
        return;
      }
      const next = DERIVED_COLUMNS.map(function (c) { return r.values[c]; });
      const changed = DERIVED_COLUMNS.some(function (c, i) {
        return String(row[c] == null ? '' : row[c]) !== String(next[i]);
      });
      if (!changed) return;
      upd.run(...next, row.row_id);
      fixed++;
    });
  });
  run();
  return fixed;
}

function runMigrations(db) {
  const applied = [];
  MIGRATIONS.forEach(function (migration) {
    // 补列型（001 / 002 / 003 / 006）：先补列再建表，009 的索引依赖 competitors.is_self
    if (migration.columns && migration.columns.length) {
      const existing = new Set(db.prepare('PRAGMA table_info(projects)').all().map(function (c) { return c.name; }));
      const added = [];
      migration.columns.forEach(function (col) {
        if (!existing.has(col.name)) {
          db.exec(col.sql);
          added.push(col.name);
        }
      });
      console.log('[MIGRATION ' + migration.id + '] ' + (added.length ? 'added: ' + added.join(', ') : 'columns already up to date'));
      if (added.length) applied.push(migration.id + ':columns');
    }
    // 档案表补列型（007 / 009）：对多张档案表逐一检查并补同一列
    if (migration.tableColumns && migration.column) {
      const addedTables = [];
      migration.tableColumns.forEach(function (table) {
        const existing = new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(function (c) { return c.name; }));
        if (!existing.has(migration.column.name)) {
          db.exec(migration.column.sql.replace('{table}', table));
          addedTables.push(table);
        }
      });
      console.log('[MIGRATION ' + migration.id + '] ' + (addedTables.length
        ? 'added ' + migration.column.name + ' to: ' + addedTables.join(', ')
        : 'columns already up to date'));
      if (addedTables.length) applied.push(migration.id + ':columns');
    }
    // 档案多列型（011）：对多张档案表逐一补多列
    if (migration.archiveTables && migration.archiveColumns) {
      const addedTables = [];
      migration.archiveTables.forEach(function (table) {
        const existing = new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(function (c) { return c.name; }));
        let changed = false;
        migration.archiveColumns.forEach(function (col) {
          if (!existing.has(col.name)) { db.exec(col.sql.replace('{table}', table)); changed = true; }
        });
        if (changed) addedTables.push(table);
      });
      console.log('[MIGRATION ' + migration.id + '] ' + (addedTables.length
        ? 'recycle columns added to: ' + addedTables.join(', ')
        : 'recycle columns already up to date'));
      if (addedTables.length) applied.push(migration.id + ':archive-columns');
    }
    // 索引型（011）：IF NOT EXISTS，重复执行安全
    if (migration.indexes) {
      migration.indexes.forEach(function (sql) { db.exec(sql); });
    }
    // 建表型（004 / 005 / 006 / 008 / 009）：放在补列之后，允许 DDL 内建依赖新列的索引
    if (migration.tables) {
      const before = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(function (r) { return r.name; }));
      db.exec(fs.readFileSync(path.join(__dirname, migration.ddl), 'utf8'));
      const tableAdded = migration.tables.filter(function (t) { return !before.has(t); });
      console.log('[MIGRATION ' + migration.id + '] ' + (tableAdded.length ? 'created: ' + tableAdded.join(', ') : 'tables already up to date'));
      if (tableAdded.length) applied.push(migration.id + ':tables');
    }
  });

  const fixed = backfillDerived(db);
  console.log('[MIGRATION 003] backfill rows fixed: ' + fixed);
  const stat = backfillArchives(db);
  console.log('[MIGRATION 004] archives backfill: ' + stat.rows + ' projects checked, ' + stat.inserted + ' added, ' + stat.skipped + ' skipped');
  const added = seedDefaults(db);               // 只补缺失项，不覆盖用户调整
  const units = syncAmountUnits(db);            // 让 money.js 使用配置里的金额单位倍率
  console.log('[MIGRATION 005] config options seeded: ' + added + ', amount units: ' + Object.keys(units).join('/'));
  const logs = backfillLogs(db);
  console.log('[MIGRATION 006] operation logs backfill: ' + logs.rows + ' projects checked, ' + logs.inserted + ' added, ' + logs.skipped + ' skipped');
  const winners = backfillWinners(db);
  console.log('[MIGRATION 010] project winners backfill: ' + winners.written + ' projects rebuilt');
  const stages = backfillStages(db);
  console.log('[MIGRATION 014] tracking stages backfill: ' + stages.rows + ' checked, ' + stages.written + ' written');
  const seeded = seedAdmin(db);            // 仅无任何管理员时生成一次，绝不覆盖已改密码
  console.log('[MIGRATION 008] admin seeded: ' + seeded);
  const systemSeeded = seedSystemSettings(db);  // 只补缺失的系统设置，不覆盖已有值
  console.log('[MIGRATION 009] system settings seeded: ' + systemSeeded);
  return applied;
}

module.exports = { runMigrations, backfillDerived, backfillArchives };
