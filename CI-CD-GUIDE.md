# CI/CD 配置指南

本仓库已包含两条工作流：

| 工作流 | 文件 | 触发方式 | 说明 |
| --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | push/PR 到 `main`，也可手动 | Node 20 + 双端 `npm ci` + 前端构建 + 受控 fixture 种子 + 单测/集成测试串行 |
| CD | `.github/workflows/cd.yml` | **仅 `workflow_dispatch` 手动触发** | SSH 到 Ubuntu，在线备份 SQLite，拉代码、装依赖、构建、PM2 reload、健康检查 |

CD 未挂接任何自动监听；并且绑定 GitHub Environment `production`，可在 Settings → Environments 中配置 required reviewers，实现发布审批。

## 一、CI 说明

CI 不依赖开发者本机的 `server/data/chantion.db`。它先运行 `_test/scripts/seed-ci-db.mjs`，从受控快照 `_test/scripts/fixture-ci.json` 生成全新测试库，因此结果可复现。

CI 跑：

- 纯 Node 单测：金额、评委、日期解析、导出字段、高级查询构造器。
- 集成测试：鉴权、档案、默认排序、导出、统计、情报看板、系统设置、年份筛选等。它们各自复制 fixture 到独立测试库并起独立后端，因端口固定所以串行执行。

CI 不跑（保留在本地手动执行）：

- `test-auth-ui.mjs`、`test-date-ui.mjs`：依赖 Windows 本机 Chrome 路径和 CDP 端口。

所有工作流和脚本均为 LF 换行（`.gitattributes` 已统一），YAML 中无 Windows 路径。

## 二、服务器一次性准备（Ubuntu 24.04）

```bash
# 1. 创建部署用户与目录
sudo adduser --disabled-password deploy
sudo mkdir -p /opt/chantion-pms /var/backups/chantion
sudo chown -R deploy:deploy /opt/chantion-pms /var/backups/chantion

# 2. 以 deploy 用户克隆仓库
sudo -u deploy git clone https://github.com/scifmat/chantion-pms.git /opt/chantion-pms

# 3. 安装 Node 20 与 PM2（建议使用 nvm 或 NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 4. 配置开机自启：按 pm2 startup 输出提示再执行一次 sudo 命令，最后 pm2 save
sudo -u deploy pm2 startup
sudo -u deploy pm2 save

# 5. Nginx 反向代理（/CD 脚本默认同源托管前端，Nginx 只做反代）
sudo apt-get install -y nginx
sudo ln -s /etc/nginx/sites-available/chantion-pms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Nginx 站点示例（`server_name` 按实际域名修改）：

```nginx
server {
    listen 80;
    server_name your.domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 三、GitHub Secrets 配置

路径：仓库 → Settings → Secrets and variables → Actions → New repository secret。

| Secret | 说明 | 示例/获取方式 |
| --- | --- | --- |
| `SSH_HOST` | 服务器 IP 或域名 | `1.2.3.4` |
| `SSH_USER` | SSH 用户名 | `deploy` |
| `SSH_PRIVATE_KEY` | SSH 私钥（ed25519） | `ssh-keygen -t ed25519 -C github-actions` 生成私钥内容；公钥加到服务器 `~/.ssh/authorized_keys` |
| `SSH_KNOWN_HOSTS` | 服务器主机公钥指纹 | `ssh-keyscan -H <host>` 输出，用于防止中间人 |
| `SERVER_ENV` | 服务器 `server/.env` 的完整多行内容 | 见下方模板；CD 会用 `printf` 写入并设 `chmod 600` |

`SERVER_ENV` 模板（请替换敏感值，不要沿用默认值）：

```dotenv
PORT=3000
HOST=127.0.0.1
DB_PATH=./data/chantion.db
TZ=Asia/Shanghai
LOG_LEVEL=info
JWT_SECRET=<随机长字符串>
ADMIN_USER=admin
ADMIN_PASSWORD=<强密码>
BACKUP_DIR=/var/backups/chantion
```

注意：CD 每次部署都会用 `SERVER_ENV` **覆盖**服务器上的 `server/.env`，请始终在 Secret 中维护唯一真源。修改 `JWT_SECRET` 会使所有用户重新登录。

## 四、GitHub Variables 配置

路径：仓库 → Settings → Secrets and variables → Actions → Variables → New repository variable。

| Variable | 说明 | 默认值（工作流中的兜底） |
| --- | --- | --- |
| `DEPLOY_PATH` | 部署目录 | 建议显式设置 `/opt/chantion-pms` |
| `PM2_APP_NAME` | PM2 进程名 | 建议显式设置 `chantion-pms` |
| `DB_PATH` | 数据库路径，相对 `server/` 或绝对路径 | `./data/chantion.db` |
| `BACKUP_DIR` | SQLite 备份目录 | `/var/backups/chantion` |
| `BACKUP_RETENTION_DAYS` | 备份保留天数 | `30` |
| `HEALTHCHECK_URL` | 健康检查地址 | `http://127.0.0.1:3000/api/projects` |
| `SSH_PORT` | SSH 端口 | `22` |

## 五、创建 Environment 与审批

1. Settings → Environments → New environment，名称填 `production`。
2. 可添加 Required reviewers（建议至少 1 人），这样每次 CD 都需要审批。
3. 可限制 Deployment branches 为 `main`。
4. 若配置了 Environment secrets/variables，会覆盖仓库级同名项。

## 六、触发部署

Actions → CD → Run workflow → 选择 `ref`（默认 `main`）→ 确认审批。

CD 顺序：拉代码 → 写 `.env` → **在线备份数据库** → `npm ci --omit=dev`（server）→ `npm ci && npm run build`（client）→ `pm2 reload` 或首次 `pm2 start` → `pm2 save` → 健康检查。任一步失败会尝试回滚到上一个 commit，并打印数据库快照路径以便人工恢复。

首次部署时数据库不存在，备份步骤会跳过；后端启动会按 schema 自动建库并生成管理员。

## 七、数据库备份与恢复

CD 使用 `better-sqlite3` 的在线备份 API 生成一致快照，路径形如 `/var/backups/chantion/chantion-<UTC时间戳>.db`，并按修改时间清理超过保留期的快照。路径也会写入部署目录的 `.last-backup` 文件。

手动恢复示例（先停 PM2）：

```bash
cd /opt/chantion-pms/server
pm2 stop chantion-pms
cp "$(cat /opt/chantion-pms/.last-backup)" ./data/chantion.db
pm2 start app.js --name chantion-pms
```

## 八、注意事项

- `server/data/*.db`、`server/data/*.db-wal`、`server/data/*.db-shm`、`_test/data/`、截图等均被 `.gitignore` 忽略；`_test/scripts/*.mjs` 与 `fixture-ci.json` 是例外，已放行入库。
- 根目录 `scripts/` 仍被忽略（本地辅助脚本）；CI 种子脚本在 `_test/scripts/` 下，不受影响。
- CI 使用 `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/` 覆盖仓库 `.npmrc` 的国内镜像，避免在 GitHub Runner 上出现镜像不可达。
- 集成测试占固定端口且全部串行；不要在 CI 中并行化它们。
