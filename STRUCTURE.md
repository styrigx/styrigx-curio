# 仓库结构

按用途分层，根目录只放入口文件和顶层目录（与 styrigx-space、styrigx-daymark 同一套约定）。改页面只动 `web/`，改接口只动 `workers/core/`。

```
styrigx-curio/
├─ web/          网站本体（Hugo），Cloudflare Pages 发布，只放静态文件
├─ workers/
│  └─ core/      Worker styrigx-curio-core：收藏的存、读、导入导出、图标缓存
├─ data/         初始收藏 seed.json（迁自主站书签）
├─ scripts/      生成脚本（种子迁移 SQL）、主站共享外壳同步
├─ tests/        全部测试，按测试对象分目录
├─ .github/      CI 工作流
├─ package.json  npm 依赖（npm 只认根目录）
└─ README / STRUCTURE / LICENSE
```

## web/

| 位置 | 是什么 |
|---|---|
| `hugo.yaml` | Hugo 配置（`params.version` 是版本号，README 徽章读它） |
| `wrangler.toml` | Pages 项目 `styrigx-curio`：不带变量、钥匙和绑定 |
| `layouts/_default/baseof.html` | 沉浸式 app 顶栏（九宫格 · 发现 / 设备 / 游戏 分段滑块 · 头像）、导航抽屉（主站共享外壳 `assets/sgx-shell/nav.json`） |
| `layouts/index.html` | 首页三个面板：发现（分类条、格子、收藏 / 编辑弹层、管理分类、导入、确认框）、设备、游戏（列表、详情、编辑弹层） |
| `assets/js/curio.js` | 「发现」页签；纯函数导出给 `tests/web/curio.test.mjs`；确认框 / 提示条 / 弹层开关给另两个页签用（`SgxCurioUI`） |
| `assets/js/curio-items.js` | 「设备」「游戏」页签（列表、详情、编辑、照片缩图上传）；纯函数同上 |
| `assets/js/curio-tabs.js` | 三个页签的切换（hash、滑块、左右滑、右下角按钮） |
| `assets/js/topbar.js` | 导航抽屉开关 |
| `assets/js/sgx/` | 外观和语言继承主站（`sgx-ui` cookie）；`shell/palette-scheme.js` 是主站共享外壳的自定义主题色引擎 |
| `assets/sgx-shell/` | 主站共享外壳的抽屉项 + 图标、预设种子，`scripts/sync-shell.mjs` 同步，勿手改 |
| `assets/css/input.css` | 样式；`@sgx-shell:begin … end` 之间是主站共享外壳（勿手改），本站自己的在文件末尾（`cu-` 前缀；`bk-` 是沿用的共用弹层组件） |
| `assets/js/sgx-lock-sync.js` | 切回前台复查会话，401 → 刷新去主站锁屏 |
| `static/_worker.js` | 只把 `*.pages.dev` 跳回 `curio.styrigx.com`（不经网关的地址不能直接开页面） |

## workers/core/

| 位置 | 是什么 |
|---|---|
| `wrangler.toml` | 路由 `curio.styrigx.com/api/*`、D1 绑定 `DB`、R2 绑定 `FILES`、网关服务绑定 `AUTH` |
| `src/index.js` | 入口：全部 `/api/*` 先问网关会话（没有公开接口） |
| `src/routes.js` | 路由表（与 `src/api/` 一一对应，测试核对） |
| `src/api/links.js` | `GET` 列表（访客只有公开的），`POST {op}` 增删改排序（主人 + 同源） |
| `src/api/import.js` | 导入浏览器书签：先备份原文到 R2，再 `json_each` 批量写入 |
| `src/api/export.js` | 导出书签文件 |
| `src/api/preview.js` | 抓网页标题、简介、图标 |
| `src/api/items.js` | 设备和游戏：`GET` 列表，`POST {op}` 增删改排序（主人 + 同源；删条目连照片删） |
| `src/api/photo.js` | 设备照片 / 游戏封面：读、传、删（R2 `photos/`） |
| `src/api/icon.js` | 图标：R2 缓存，没有就现抓（只抓公网地址），抓不到记「没有」7 天 |
| `src/api/_store.js` | 收藏的表结构、校验、读写 |
| `src/api/_items.js` | 设备、游戏的表结构、校验、读写 |
| `src/api/_netscape.js` | 书签文件的解析和生成 |
| `src/api/_preview.js` | 抓网页 + 地址安全检查（不抓内网 / 本机 / 自家域名） |
| `src/api/_auth.js` `_lib.js` `_write.js` | 问网关、JSON 响应、同源 / 同站检查、读 body |
| `migrations/` | D1 迁移：`0001_init`（cats、links、imports）、`0002_seed`（初始收藏，由 `scripts/gen-seed-sql.mjs` 生成）、`0003_devices_games`（devices、games） |

## 部署顺序（CI）

1. 主站网关先登记 `curio.styrigx.com`（styrigx-space 仓库，`workers/auth-gateway/wrangler.toml` 和 `src/subsites.js`）
2. 本仓库 CI：测试 → 构建 → 网关检查 → D1 迁移 → 部署 core → 冒烟 → 部署 Pages → 冒烟
3. 首次部署后在 Pages 绑定自定义域名 `curio.styrigx.com`（域名没解析前，CI 跳过网关检查和冒烟）
