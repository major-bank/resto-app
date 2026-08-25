# 云味小馆 · 点餐小程序

移动端点餐小程序（H5 单页应用）：使用端点菜下单、点评历史；管理端维护菜谱、处理订单。

**核心能力**
- 多台手机实时同步（SSE 秒级推送 + 12s 轮询兜底，双保险）
- 菜品真实图片（管理端拍照/相册上传）
- 使用端「我的足迹」：已吃到的订单历史 + 星级/文字点评
- 双存储引擎：本地文件（local）/ Supabase 云端（supabase），环境变量一键切换

---

## 一、本地运行（局域网）

```bash
cd resto-app
node server.js
```

- 本机访问：http://localhost:3000
- 手机同 WiFi 访问：http://<电脑局域网IP>:3000（如 http://192.168.43.4:3000）
- 管理端入口：右上角 🔐，默认密码 `123456`（可在设置中修改）

## 二、云端部署（电脑关机也能公网访问，7×24 在线）

架构：**Render**（免费 Node 托管，永续在线）+ **Supabase**（免费数据库 + 图片存储，数据永久保留）+ **Gitee**（国内代码托管，GitHub 打不开时的替代）+ **UptimeRobot**（免费保活防休眠）。

### 第 1 步：注册 Gitee 并创建公开仓库
1. 打开 https://gitee.com/signup 注册账号（邮箱注册即可，国内访问稳定）
2. 登录后点右上角 **`+` → 新建仓库**
3. 填写：
   - 仓库名称：`resto-app`
   - 归属：选自己的用户名
   - 仓库介绍：随便填，如「云味小馆点餐小程序」
   - **开源 / 公开**：一定要选 **公开**（Render 需要能读取）
   - **不要勾选**「使用 Readme 文件初始化这个仓库」「使用 Issue 和 Pull Request 模板」等任何选项
4. 点 **创建**
5. 创建后进入仓库页面，把地址栏的仓库地址记下来，形如：`https://gitee.com/你的用户名/resto-app`

### 第 2 步：上传代码到 Gitee

#### 方式 A：git 命令行（推荐，保留目录结构最稳）
1. 确认电脑已安装 git：右键菜单有「Git Bash Here」即已安装；没有则去 https://git-scm.com/download/win 下载安装
2. 在本地文件夹 `C:\Users\86183\WorkBuddy\2026-08-25-10-39-57\resto-app` 里空白处右键 → **Git Bash Here**
3. 依次执行下面命令（把 `你的用户名` 换成真实的 Gitee 用户名）：
   ```bash
   git init
   git add .
   git commit -m "init"
   git remote add origin https://gitee.com/你的用户名/resto-app.git
   git push -u origin master
   ```
4. 首次 push 会弹出窗口让你输入 Gitee 账号和密码

#### 方式 B：Gitee 网页上传（不会 git 也能用）
1. 在 Gitee 仓库页面，点 **「+ → 上传文件」**
2. 把本地 `resto-app` 文件夹里的文件逐个或批量拖拽上传；注意要保留 `public/` 子目录（先创建文件夹再传里面的 index.html）
3. 刷新仓库，确认根目录有 `server.js`、`package.json`，并且 `public/index.html` 路径正确

### 第 3 步：注册 Supabase 并初始化
1. 注册 https://supabase.com （邮箱即可）
2. 登录后点 **New project**，填项目名（如 resto），设置数据库密码（随意），Region 选 **Southeast Asia (Singapore)**（离国内最近）
3. 等 1-2 分钟项目创建完成
4. 左侧 **SQL Editor** → New query → 把仓库里 `supabase-init.sql` 的内容整个粘贴进去 → **Run**
5. 左侧 **Project Settings → API**，记下两个值：
   - **Project URL**（形如 `https://xxxx.supabase.co`）
   - **anon public key**（一长串 JWT）

### 第 4 步：注册 Render 并部署
1. 打开 https://render.com 注册账号（邮箱注册即可，国内可打开）
2. 登录后点 **New + → Web Service**
3. 选择 **Public Git repository**，粘贴你的 Gitee 仓库地址：
   ```
   https://gitee.com/你的用户名/resto-app
   ```
4. Render 自动识别为 Node 项目，填写：
   - **Name**：`resto-app`
   - **Branch**：`master`（Gitee 默认分支通常是 master）
   - **Runtime**：选 **Node**
   - **Build Command**：留空
   - **Start Command**：`node server.js`
   - **Instance Type**：选 **Free**（免费）
5. 展开 **Advanced → Environment Variables**，点 **Add Environment Variable**，添加 4 项：
   | 键 | 值 |
   |---|---|
   | `RESTO_STORAGE` | `supabase` |
   | `SUPABASE_URL` | 第 3 步记下的 Project URL |
   | `SUPABASE_KEY` | 第 3 步记下的 anon key |
   | `SUPABASE_BUCKET` | `resto` |
6. 点页面底部 **Create Web Service**，等待 2-5 分钟构建部署完成
7. 部署成功后，Render 会给一个地址 `https://resto-app.onrender.com` —— **这就是永久公网链接**，手机浏览器打开即可使用

### 第 5 步：注册 UptimeRobot 保活（防止免费实例休眠）
1. 注册 https://uptimerobot.com
2. **Add New Monitor**：
   - Monitor Type：**HTTP(s)**
   - URL：`https://resto-app.onrender.com/api/state`
   - Interval：5 分钟（免费版默认）
   - 点 Create Monitor
3. 之后每 5 分钟自动访问一次，免费实例永不休眠，手机随时打开都是秒开

### 完成 🎉
- 永久链接：`https://resto-app.onrender.com`
- 多台手机打开同一链接，数据实时互通
- 数据存在 Supabase 云端：数据库 + 图片永久保留
- 电脑关机、重启、断网都不影响

---

## 三、环境变量说明

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 监听端口（Render 等平台自动注入） |
| `RESTO_STORAGE` | `local` | `local`=本地文件；`supabase`=云端 |
| `SUPABASE_URL` | - | Supabase Project URL |
| `SUPABASE_KEY` | - | Supabase anon key |
| `SUPABASE_BUCKET` | `resto` | 图片存储桶名 |

## 四、目录结构

```
resto-app/
├── server.js          # 后端（零依赖，http + SSE + 双存储引擎）
├── package.json       # 启动脚本
├── supabase-init.sql  # 云端初始化 SQL（执行一次）
├── public/index.html  # 前端（双模式：online 实时同步 / offline 本机演示）
├── data/db.json       # 本地模式数据（运行时生成）
├── uploads/           # 本地模式图片（运行时生成）
└── dist/index.html    # 静态演示部署副本
```

## 五、常见问题

- **首次打开慢？** 免费实例休眠后唤醒约需 30-60 秒；配置 UptimeRobot 保活后基本不会休眠。
- **数据会丢吗？** 云端模式数据在 Supabase，永久保留；本地模式重启电脑不丢，但清浏览器数据会丢。
- **如何管理云端数据？** 登录 Supabase 控制台可查看/导出；Render 控制台可看日志。
- **费用？** Render 免费（750 小时/月，单实例足够）、Supabase 免费（500MB 数据库 + 1GB 存储）、Gitee/UptimeRobot 免费。无信用卡要求。
