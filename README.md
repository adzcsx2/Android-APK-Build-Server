# Android APK Build Server

一个基于 Node.js 的 Android APK 在线编译打包平台。通过 Web 界面选择项目、分支、模块和变体，一键构建并下载 APK，无需安装 Android Studio。

## 功能特性

- **项目自动发现** - 扫描工作目录，自动识别 Android 原生项目和 Flutter 项目
- **Git 集成** - 分支管理、代码同步、最近提交记录查看
- **Gradle 构建引擎** - 解析模块和变体，支持多维度 Product Flavors，JDK 8/11/17/21 切换
- **实时日志** - 通过 SSE（Server-Sent Events）流式输出构建日志
- **并发构建队列** - 支持最多 3 个任务并行构建，可取消进行中的任务
- **APK 管理** - 自动归档、标准化命名、定时清理（默认保留 3 天）
- **配置持久化** - 自动保存每个项目的构建配置，下次切换回来时恢复
- **构建历史** - 记录所有构建状态（成功/失败/取消），支持 3 天自动清理

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express 4.18 |
| 前端 | HTML + CSS + JavaScript（原生，无框架） |
| 实时通信 | Server-Sent Events (SSE) |
| 数据持久化 | JSON 文件 |
| 构建工具 | Gradle (gradlew.bat) |
| 运行平台 | Windows |

## 环境要求

- Node.js 16+
- Git
- JDK 11 / 17 / 21（至少一个）
- Android SDK

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务器
npm start

# 访问
# http://localhost:3000/build
```

停止服务器：

```bash
npm stop
```

### PM2 管理（生产环境推荐）

```bash
npm install -g pm2
pm2 start server.js --name build-server   # 启动
pm2 restart build-server                   # 重启
pm2 stop build-server                      # 停止
pm2 logs build-server                      # 查看日志
pm2 startup && pm2 save                    # 开机自启
```

## 配置说明

配置文件：`config.json`

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "basePath": "/build"
  },
  "workplace": {
    "path": "D:\\AndroidWorkplace"
  },
  "jdk": {
    "jdk11": "C:\\path\\to\\jdk11",
    "jdk17": "C:\\path\\to\\jdk17",
    "jdk21": "C:\\path\\to\\jdk21"
  },
  "apk": {
    "outputDir": "D:\\WebWorkplace\\apk",
    "retentionDays": 3,
    "cleanupTime": "02:00"
  },
  "build": {
    "maxConcurrent": 3,
    "timeout": 1800000
  },
  "projectJdk": {
    "my-project": 17
  }
}
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `server.port` | 服务端口 | 3000 |
| `server.host` | 监听地址，`0.0.0.0` 允许局域网访问 | `0.0.0.0` |
| `server.basePath` | URL 路径前缀 | `/build` |
| `workplace.path` | Android 项目所在目录 | - |
| `jdk.*` | 各版本 JDK 安装路径 | - |
| `apk.retentionDays` | APK 自动清理保留天数 | 3 |
| `apk.cleanupTime` | 每日清理时间 | `02:00` |
| `build.maxConcurrent` | 最大并发构建数 | 3 |
| `build.timeout` | 构建超时时间（毫秒） | 1800000 |
| `projectJdk` | 每个项目指定的 JDK 版本（8/11/17/21） | - |

## 使用流程

```
选择项目 → 选择分支 → 同步代码 → 选择模块 → 选择变体 → 配置版本 → 开始构建 → 下载 APK
```

## API 文档

所有接口前缀：`/build`

### 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 获取项目列表 |
| GET | `/api/projects/:name/branches` | 获取分支列表 |
| GET | `/api/projects/:name/branches/cached` | 获取缓存的分支列表 |
| GET | `/api/projects/:name/branch-log` | 获取分支最近提交记录 |
| POST | `/api/projects/:name/git/sync` | 同步代码 |
| GET | `/api/projects/:name/modules` | 获取模块列表 |
| GET | `/api/projects/:name/modules/:module/variants` | 获取变体列表 |
| GET | `/api/projects/:name/modules/:module/version` | 获取版本信息 |

### 构建

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/build` | 开始构建 |
| GET | `/api/build/:id/logs` | SSE 实时构建日志 |
| GET | `/api/build/:id/status` | 构建状态 |
| DELETE | `/api/build/:id` | 取消构建 |
| GET | `/api/builds` | 所有构建 |
| GET | `/api/builds/active` | 进行中的构建 |
| GET | `/api/builds/history` | 构建历史 |

### APK

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/apks` | APK 列表 |
| DELETE | `/api/apks/:filename` | 删除 APK |
| GET | `/apk/:filename` | 下载 APK |

### 配置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config/:projectName` | 获取项目配置 |
| POST | `/api/config/:projectName` | 保存项目配置 |
| DELETE | `/api/config/:projectName` | 删除项目配置 |
| GET | `/api/jdk-versions` | 可用 JDK 版本 |

### 构建日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/build-logs/:projectName` | 读取构建日志 |
| GET | `/api/build-logs/:projectName/poll` | 轮询新增日志 |
| DELETE | `/api/build-logs/:projectName` | 清除项目日志 |

## 项目结构

```
├── server.js                # 服务入口
├── config.json              # 配置文件
├── package.json             # 依赖配置
│
├── src/
│   ├── routes/
│   │   ├── index.js         # 路由聚合 + 静态文件
│   │   ├── projects.js      # 项目相关 API
│   │   ├── build.js         # 构建 + APK API
│   │   └── config.js        # 配置 CRUD API
│   │
│   ├── services/
│   │   ├── projectService.js      # 项目发现
│   │   ├── gitService.js          # Git 操作
│   │   ├── gradleService.js       # Gradle 解析与构建
│   │   ├── buildQueue.js          # 并发构建队列
│   │   ├── apkService.js          # APK 管理与清理
│   │   ├── configService.js       # 项目配置持久化
│   │   ├── branchCacheService.js  # 分支缓存
│   │   ├── buildHistoryService.js # 构建历史
│   │   └── buildLogService.js     # 构建日志管理
│   │
│   └── utils/
│       └── sse.js           # SSE 工具函数
│
├── public/                  # 前端静态文件
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
│
├── apk/                     # APK 输出目录
└── data/                    # 持久化数据
    ├── build-history.json
    ├── project-configs.json
    ├── project-branches.json
    └── build-logs/
```

## License

MIT
