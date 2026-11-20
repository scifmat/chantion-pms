# ChanTion PMS

![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white) ![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodejs&logoColor=white) ![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

一款面向企业招投标与项目协作的轻量级、全流程数字化工作台。集招采项目全生命周期管理、竞争对手情报挖掘与甲方采购偏好分析于一体，助您在激烈的市场竞争中脱颖而出。

## 核心特性

- **敏捷项目管理** — 覆盖从意向到中标的各阶段流转。
- **独立档案沉淀** — 多维度的业务主体信息资产库。
- **数据洞察看板** — 基于 ECharts 的可视化业务驾驶舱。
- **灵活数据导出** — 支持自定义字段的 Excel 便捷导出。
- **严密安全管控** — 内置双层权限与全链路操作留痕。

## 技术栈

- **前端**：Vue 3 · Vite · Element Plus · ECharts
- **后端**：Express · Better-SQLite3
- **数据库**：SQLite（零配置、单文件、易备份）

## 快速启动（本地开发）

环境要求：Node.js 20+。依赖安装默认走国内镜像（见各目录 `.npmrc`）。

```bash
# 1. 生成环境配置（两个服务各一份）
cp server/.env.example server/.env
cp client/.env.example client/.env

# 2. 安装依赖
cd server && npm install
cd ../client && npm install

# 3. 启动服务：在两个终端分别执行
cd server && npm start        # 后端 http://localhost:3000
cd client && npm run dev      # 前端 http://localhost:5173
```

浏览器访问 `http://localhost:5173`。首次启动会自动创建数据库与默认管理员。

## 生产部署指南（Ubuntu）

生产模式下，前端打包为静态文件后由 Express 进程统一托管，页面与接口同源，无需单独启动前端服务。

### 1. 安装依赖并构建前端

```bash
cd server && npm install --omit=dev
cd ../client && npm install && npm run build   # 产物在 client/dist，后端会自动托管
```

### 2. 配置环境变量

```bash
cp server/.env.example server/.env
# 编辑 server/.env：务必修改 JWT_SECRET 与 ADMIN_PASSWORD
```

### 3. 使用 PM2 守护后端

```bash
sudo npm install -g pm2
cd server
pm2 start app.js --name chantion-pms
pm2 save
```

如需开机自启，执行 `pm2 startup`，它会输出一条 `sudo env PATH=... pm2 startup systemd ...` 命令——**复制该命令再手动执行一次**才会真正生效，随后再运行 `pm2 save`。

### 4. 配置 Nginx 反向代理

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

```bash
sudo ln -s /etc/nginx/sites-available/chantion-pms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. 配置 Cron 每日数据库备份

```bash
# 编辑当前用户的 crontab
crontab -e

# 每天 02:30 备份数据库到 backup 目录，保留最近 30 天
30 2 * * * cp /opt/chantion-pms/server/data/chantion.db /opt/chantion-pms/server/backup/chantion-$(date +\%F).db && find /opt/chantion-pms/server/backup -name 'chantion-*.db' -mtime +30 -delete
```

> 数据库文件 `server/data/chantion.db` 不纳入版本库，请依赖上述备份策略保障数据安全。

## License

[MIT](./LICENSE) © 2026 ChanTion
