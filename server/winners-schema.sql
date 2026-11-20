-- 第 17 步：项目-中标单位规范化映射（全局看板 SQL 聚合用）
-- 由 migrate.js 的 010 幂等执行；把 projects.detail 里的单包/分包/联合体拆解成一行一个「项目×单位×包」。
-- 纯派生表：写入由 POST/PUT/DELETE /api/projects 同事务维护，查询只 join projects(deleted=0)。

CREATE TABLE IF NOT EXISTS project_winners (
  project_no   TEXT    NOT NULL,
  winner_name  TEXT    NOT NULL,
  winner_norm  TEXT    NOT NULL,
  award_fen    INTEGER NOT NULL DEFAULT 0,
  src          TEXT    NOT NULL,
  PRIMARY KEY (project_no, winner_norm, src)
);

CREATE INDEX IF NOT EXISTS idx_pw_norm ON project_winners(winner_norm);
CREATE INDEX IF NOT EXISTS idx_pw_project ON project_winners(project_no);
