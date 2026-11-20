-- 全新安装时的完整表定义（已有数据库不会重跑 CREATE TABLE，缺列由 migrate.js 幂等补齐）
-- 001：中标金额双字段 + 中标时间；002：detail 全量表单 JSON + 最高限价双字段
-- 003：高级查询 7 个派生列（由 derive.js 的 deriveFromDetail 统一生成，与 detail 同源）
-- 第 6 步的 4 张独立信息档案表定义在 archive-schema.sql，由 migrate.js 的 004 幂等建立
-- budget_* / ceiling_* / award_* 均为「原始元值 + 整数分」双字段（防坑 K-1）
-- award_time 与 detail 内的日期只存 年-月-日 字符串（防坑 K-5）
-- version / updated_at 用于多人编辑防覆盖（防坑 K-3）

CREATE TABLE IF NOT EXISTS projects (
  row_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_no        TEXT    NOT NULL UNIQUE,
  project_name      TEXT    NOT NULL,
  budget_yuan       TEXT    NOT NULL DEFAULT '0',
  budget_fen        INTEGER NOT NULL DEFAULT 0,
  region            TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT '意向公示',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  award_amount_yuan TEXT    NOT NULL DEFAULT '0',
  award_amount_fen  INTEGER NOT NULL DEFAULT 0,
  award_time        TEXT    NOT NULL DEFAULT '',
  detail            TEXT    NOT NULL DEFAULT '{}',
  ceiling_yuan      TEXT    NOT NULL DEFAULT '0',
  ceiling_fen       INTEGER NOT NULL DEFAULT 0,
  bid_end           TEXT    NOT NULL DEFAULT '',
  method            TEXT    NOT NULL DEFAULT '',
  period_days       TEXT    NOT NULL DEFAULT '',
  winner_names      TEXT    NOT NULL DEFAULT '',
  project_types     TEXT    NOT NULL DEFAULT '',
  buyer_name        TEXT    NOT NULL DEFAULT '',
  agency_name       TEXT    NOT NULL DEFAULT ''
);
