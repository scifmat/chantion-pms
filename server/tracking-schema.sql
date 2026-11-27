-- 第 18 步：项目跟进（bid_trackings）
-- 单一定义源，由 migrate.js 的 013 幂等执行，CREATE TABLE IF NOT EXISTS。
-- 关联键用 projects.row_id：project_no 在编辑编号 / 软删除时会变（__DEL_<id>），不可作为稳定外键。
-- 关闭开关不删行，只置 is_tracking=0 + 清空 owner，保留历史且释放删除限制。
-- 复盘归档（review_history）与跟进记录（follow_log）以 JSON 数组存放，仅作展示，不参与查询条件。

CREATE TABLE IF NOT EXISTS bid_trackings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL UNIQUE REFERENCES projects(row_id) ON DELETE CASCADE,
  is_tracking       INTEGER NOT NULL DEFAULT 1,
  owner_user_id     INTEGER NOT NULL DEFAULT 0,
  owner_username    TEXT    NOT NULL DEFAULT '',
  follow_stage      TEXT    NOT NULL DEFAULT '跟进中',
  internal_status   TEXT    NOT NULL DEFAULT '评估中',
  derived_key       TEXT    NOT NULL DEFAULT '',
  review_required   INTEGER NOT NULL DEFAULT 0,
  review_category   TEXT    NOT NULL DEFAULT '',
  review_reason     TEXT    NOT NULL DEFAULT '',
  review_history    TEXT    NOT NULL DEFAULT '[]',
  follow_log        TEXT    NOT NULL DEFAULT '[]',
  status_snapshot   TEXT    NOT NULL DEFAULT '',
  deadline_snapshot TEXT    NOT NULL DEFAULT '',
  last_reset_at     TEXT    NOT NULL DEFAULT '',
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bt_owner ON bid_trackings(owner_user_id, is_tracking);
CREATE INDEX IF NOT EXISTS idx_bt_active ON bid_trackings(is_tracking, follow_stage, internal_status);
