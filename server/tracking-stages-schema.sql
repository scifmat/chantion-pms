-- 第 19 步：项目跟进「阶段记录」——每个阶段一条复盘/经验记录。
-- 由 migrate.js 的 014 幂等执行，CREATE TABLE IF NOT EXISTS。
-- 四个阶段由 trackingState.STAGES 静态定义：评估 / 报名 / 投标 / 结果。
-- 未发生、且未被补录的阶段不落行，前端按静态定义渲染成置灰节点。
-- 当前阶段的记录同时冗余到 bid_trackings 的 review_* 列，兼容首页看板/列表。

CREATE TABLE IF NOT EXISTS bid_tracking_stages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id     INTEGER NOT NULL REFERENCES bid_trackings(id) ON DELETE CASCADE,
  stage_key       TEXT    NOT NULL,
  internal_status TEXT    NOT NULL DEFAULT '',
  review_category TEXT    NOT NULL DEFAULT '',
  review_reason   TEXT    NOT NULL DEFAULT '',
  reviewed_at     TEXT    NOT NULL DEFAULT '',
  updated_at      TEXT    NOT NULL,
  UNIQUE (tracking_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_bts_tracking ON bid_tracking_stages(tracking_id);
