# 2027 校招核查 · 个人投递工作台

保留原推荐算法页和国企 / 金融科技页的视觉、筛选、来源、完整历史记录与时间线，接入 Supabase PostgreSQL、Auth 和自动生成的 REST API。

## 已接入的功能

每张卡片顶部有「已投递」「不感兴趣」操作。两种状态都会置灰，并统一移入页面末尾的「已处理的卡片」区域，不占据前面的待处理列表。点击「恢复」会回到原来的截止日期 / 优先级排序位置，操作后也可以「撤销」。

「我的状态」筛选可选择全部、未处理、已投递、不感兴趣，并与原来的关键词、招聘分类和排序一起工作。推荐页核心与补充公司中的已处理卡片会统一置后；国企页的近期行动推荐也会排除已处理卡片。

不用登录也能标记：状态先保存在当前浏览器。点击「启用云端同步」后创建匿名设备账号，并将本机标记同步到数据库。网络失败会保留待同步标记，显示明确提示，联网后自动重试，也可手动点击「重试同步」。不同账号的本地缓存和数据库记录相互隔离。

**匿名账号不是可恢复的永久账号。** 刷新页面不会丢失身份，但清除浏览器数据、换浏览器、换域名 / 端口、退出匿名账号后，不能仅凭原浏览器重新找到账号。跨设备使用前请绑定邮箱。

## 本地运行

使用 Node.js 22.12+（开发时使用 22.20.0）。本项目已转换为 Vite 多页项目，不再通过双击 HTML 文件运行。

```powershell
cd "C:\Users\25759\Desktop\github项目管理\recsys-2027-check"
npm ci
npm run dev
```

开发入口：`http://127.0.0.1:5173/`；第二页：`http://127.0.0.1:5173/soe.html`。

生产构建和本地预览：

```powershell
npm run build
npm run preview
```

预览入口：`http://127.0.0.1:4173/`。开发端口与预览端口是两个不同的浏览器存储来源，匿名身份不共享；邮箱账号可以在两个入口登录同一账号。

## Supabase 配置

当前已经连接的免费项目：

| 项目 | 值 |
| --- | --- |
| Organization | `recsys-2027`（Free） |
| Project | `recsys-2027-check` |
| Project ref | `npqrixancnwbmzcyqafx` |
| Region | Singapore / `ap-southeast-1` |
| API URL | `https://npqrixancnwbmzcyqafx.supabase.co` |

`src/backend.js` 已包含此项目的 **publishable key**，可以直接运行。它不是数据库密码，也不是 `service_role` / secret key。权限由数据库授权和 RLS 决定。不要把特权密钥、数据库连接密码或访问令牌放进 `VITE_*` 变量、前端代码、README 或 Git。

`.env.example` 只用于换成其他 Supabase 项目时参考。当前项目不需要复制该模板；直接复制占位符会覆盖已经有效的默认配置。

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

已配置本地 4173 / 5173 两个端口以及本仓库 GitHub Pages 路径的登录回调允许列表。Site URL 暂为本地预览地址；正式部署后需要改成实际的前端根地址，并补充该部署的回调允许列表。新增前端域名不会自动继承原浏览器的匿名身份。

### 邮箱绑定 / 登录

1. 匿名账号打开「邮箱登录 / 绑定」，填写邮箱后点击「注册 / 绑定当前标记」。绑定阶段不提交密码。
2. 在同一个浏览器打开确认邮件中的链接。
3. 重新打开账号窗口，使用「设置 / 修改登录密码」。完成后可在其他设备用邮箱和密码登录，同一用户 ID 的标记会保留。

没有匿名账号时也可直接注册邮箱账号。登录已有邮箱账号不会自动混入访客标记，需要导入时点击「同步本机标记」并确认。已有账号与匿名账号的合并不是自动覆盖操作。

**邮件限制：** Supabase 默认发信服务仅向项目团队邮箱发送邮件，存在严格频率限制，不适合作为公共注册邮件服务。面向其他邮箱开放注册、密码恢复等流程前，需要配置自有 SMTP。不要通过关闭邮箱验证来掩盖邮件配置问题。此仓库不包含 SMTP 凭据，也没有替用户完成邮箱确认。

匿名登录已启用，邮箱确认保持启用，手动身份绑定已启用。向公众开放匿名登录前，应在 Supabase 配置 CAPTCHA，并在客户端接入对应 token，防止批量注册滥用；目前没有配置 CAPTCHA。当前无需短信或付费身份服务。

## 数据库设计与权限

当前资料包括 **86 张卡片**（推荐页 57、国企页 29）、85 个公司实体、83 张历史卡片快照、26 个来源、49 个固定时间线节点和 4 组更新日志。动态「今天」标记在浏览器按北京时间生成，不写入固定时间线。

- `companies`、`job_entries`：公司及当前招聘事实；状态、城市、方向、日期、评分等均为独立 SQL 列。
- `sources`、`entry_links`、`entry_audits`、`job_sources`、`entry_deadlines`：链接、复核与日期证据。
- `catalog_archives`、`timeline_events`、`change_logs`：历史快照、时间线与更新记录。JSONB 只用于完整历史记录和日志的可变明细，不替代当前卡片字段。
- `user_card_states`：`user_id + entry_id` 联合主键，状态为 `active / applied / uninterested`，服务器更新时间。

所有业务表均启用 RLS。公共招聘资料只允许前端读取，不允许匿名或普通登录用户修改。个人状态不授予未登录访客数据库访问权限；登录用户（包括匿名设备账号）只能读写 `auth.uid() = user_id` 的记录。写入策略同时检查旧行与新行归属，防止把状态写到别人的用户 ID 下。

数据库自带的 API 就是本项目的后端。当前功能不需要额外部署 Express、Python 服务或 Edge Function；复杂私密业务后续可单独加入。前端不会接触管理员密钥。

## 数据维护与回退

日常可在 Supabase Table Editor 修改对应招聘字段、来源和时间线。请保留公司 / 卡片 ID，避免导致个人标记失去关联。前端刷新时优先读取云端；云端不可用时，优先显示上次成功读取的缓存，其次显示 `data/*.json` 内置只读快照，页面会明确标识数据来源。

`data/*.json` 是迁移时的完整保底资料，不会随着在 Dashboard 中的修改自动更新。正式维护时应同时维护用于发布的离线快照，以免离线时显示过旧资料。招聘网站本身不会被此项目自动爬取或核查，原核查日期和证据范围均保留。

数据库初始化文件：

```text
supabase/migrations/202609120001_recsys.sql
supabase/seed.sql
```

当前云端已经执行过，不必再次运行。`npm run seed:sql` 仅重新生成本地 SQL 文件，不会连接或修改云端。`seed.sql` 可重复导入，但会把当前招聘事实重置为本地种子内容；已有线上维护记录应先备份，不要把重新导入当日常同步。种子导入不会修改 `user_card_states`。

本次迁移前的原 HTML 与一次性迁移工具保存在本机 `.migration-backup/`，该目录已加入 `.gitignore`。原始文件也可以从 Git 历史提交 `3f079fb` 中恢复。不要把备份目录、`node_modules`、本地凭据或 `.env` 提交到仓库。

## 检查与测试

```powershell
npm test
npm run test:cloud
npm run build
```

单元测试覆盖状态持久化、置后排序、恢复、快速连点、网络失败与重试、不同用户 / 标签页缓存隔离、完整资料的数据库往返校验，以及邮箱绑定的先验证后设密码流程。

`test:cloud` 是只读的真实 Supabase 集成检查，核对两页全部卡片、历史和时间线，并确认未登录请求不能读个人状态。若有意修改了云端招聘事实但未更新离线快照，此校验会指出差异，而不是静默成功。

`supabase/tests/rls.sql` 可在 SQL Editor 运行，验证匿名、本人和其他账号的读写权限、伪造所有者、更新归属及非法状态。它在单个事务中创建临时测试用户，结束时全部回滚，不留下测试记录。

## 部署前端（不需要购买域名）

执行 `npm run build` 后，将 **`dist/` 目录**部署到 GitHub Pages、Cloudflare Pages、Vercel 或其他静态托管。不要直接发布包含裸 npm 模块导入的源码 HTML。Vite 使用相对资源路径，支持本仓库这样的子路径部署。

GitHub Pages 的原静态分支发布方式需要调整为构建后发布 `dist/`，或者使用 GitHub Actions 构建上传。其他静态平台通常设置构建命令 `npm ci && npm run build`、产物目录 `dist` 即可。部署属于单独的发布操作；本次代码开发不会自动 `git push` 或修改现有线上站点。

Supabase Free 不是无限容量，也不保证永不暂停。正式长期使用前应检查当前配额、闲置暂停规则、邮件服务和备份方案；本次未启用任何付费套餐或附加项。

## 主要目录

```text
src/pages/rec.js, soe.js   原页面渲染与查询衔接
src/styles/              原版视觉样式
src/personal.js, .css    个人工作台和卡片操作
src/state-store.js       持久化与待同步操作
src/backend.js          Supabase 连接和缓存回退
src/catalog-model.js    数据映射和状态规则
src/auth-actions.js     邮箱绑定和密码设置
supabase/               表结构、种子资料与权限测试
tests/                  无网络单元测试
scripts/                种子生成与只读云端校验
```

参考官方文档：[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[匿名身份与绑定](https://supabase.com/docs/guides/auth/auth-anonymous)、[SMTP 限制](https://supabase.com/docs/guides/auth/auth-smtp)。
