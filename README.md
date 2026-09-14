# 2027 校招核查 · 个人投递工作台

保留原推荐算法页和国企 / 金融科技页的视觉、筛选、来源、完整历史记录与时间线，接入 Supabase PostgreSQL、Auth 和自动生成的 REST API。

## 工程质量与验收

本项目保留原生 JavaScript + Vite 多页结构，采用本地快照先展示、云端异步刷新、用户状态独立同步的加载方式。页面不依赖外部字体服务。卡片按稳定 ID 复用节点，搜索支持输入法组合输入；缓存、超时、有限重试、过期响应和账号切换均有回归测试。

执行 `npm run verify` 可以完成规范、格式、单元测试、数据校验、构建安全与体积预算，以及桌面/手机浏览器验收。首次安装浏览器环境执行 `npx playwright install chromium`；Windows 已安装 Chrome 时测试默认使用独立的无头 Chrome，不读取个人浏览器配置。

边界、架构、测试与发布流程见 [工程维护指南](docs/engineering.md)，本轮实测记录见 [工程验收记录](docs/enterprise-validation.md)。这是代码和测试层的工程加固，不代表生产系统已取得企业级认证或可用性承诺。

## 招聘收录标准

央国企页按“应用统计有机会、单位与岗位值得考虑”收录，不再限制为算法或 AI。经营分析、银行综合/管培、保险精算、风险审计、运营市场、供应链等均可纳入；有专业依据不等于资格通过。维护前先读 [招聘收录规范](docs/recruitment-policy.md) 和根目录 `AGENTS.md`。`data/soe-screening.json` 与招聘事实一起维护、校验和发布。

## 本地维护与自动发布（新入口）

招聘事实维护在 `data/rec.json` 和 `data/soe.json`；央国企专业/批次评估与地区证据分别维护在 `data/soe-screening.json`、`data/soe-locations.json`，一起通过校验后再按发布流程 push `main`。GitHub Actions 会校验数据与稳定 ID、测试、构建、事务同步 Supabase、完整比对云端并发布 Pages。个人投递状态和 Auth 不参与资料发布。

完整使用、一次性 Secret 配置、归档与恢复说明见 [本地数据自动发布指南](docs/data-publishing.md)。旧 seed.sql 仅用于新实例初始化，不再是日常更新方式。

## 个人时间线：测评、笔试、面试

两页顶部目录下方首先展示「我的时间线」，随后是投递与同步面板，再进入招聘概览和其他资料；两页共享当前用户的全部安排。可从「新增日程」手动录入，也可从公司卡片的「安排日程」带入公司和卡片关联；支持编辑、删除、完成/恢复、取消状态、今天/未来七天/逾期筛选、关键词搜索和私人 JSON 导出。所有时间按北京时间填写和显示。

无需登录即可本机保存。账号日程接入原有身份与独立同步队列，不改动招聘事实和投递标记；云端需先单独执行 `supabase/migrations/202609140004_user_timeline_events.sql`，仅 push 前端不会自动安装新表。未安装时仍可本机使用，并明确提示待安装/待同步。默认 Supabase 项目已于 2026-09-14（UTC）通过 Dashboard 安装该迁移，并核对 RLS 与 Realtime 配置；新实例仍需单独安装。

两页新增吸顶目录，手机可横向滑动，点击即可跳转各板块。推荐页公开的「2027 届时间线」默认收起，点击标题展开或收起，并记住本机偏好；从目录或时间线锚点进入时会自动展开，原节点与筛选仍保留。

使用方法、字段、权限、同步边界和数据库验收见 [个人时间线说明](docs/personal-timeline.md)。当前不包含关闭网页后的后台提醒。

## 已接入的功能

每张卡片顶部有「已投递」「不感兴趣」操作。两种状态都会以独立分组、标签和虚线边框区分（保持文字可读对比度），并统一移入页面末尾的「已处理的卡片」区域，不占据前面的待处理列表。点击「恢复」会回到原来的截止日期 / 优先级排序位置，操作后也可以「撤销」。

「我的状态」筛选可选择全部、未处理、已投递、不感兴趣，并与原来的关键词、招聘分类和排序一起工作。推荐页核心与补充公司中的已处理卡片会统一置后；国企页的近期行动推荐也会排除已处理卡片。

不用登录也能标记：状态先保存在当前浏览器。点击「启用云端同步」后创建匿名设备账号，并将本机标记同步到数据库。网络失败会保留待同步标记，显示明确提示，联网后自动重试，也可手动点击「重试同步」。不同账号的本地缓存和数据库记录相互隔离。

**跨设备同步以同一个 Supabase 用户 ID 为准。** 绑定并确认邮箱、设置密码后，可在另一台设备登录同一邮箱账号；页面启动时会自动拉取 `user_card_states`，在线设备同时通过 Supabase Realtime 监听该账号的状态变化并自动刷新。若 Realtime 暂时断开，页面聚焦、恢复前台或重新联网时仍会补拉一次云端状态。

**匿名账号不是可恢复的永久账号。** 刷新页面不会丢失身份，但清除浏览器数据、换浏览器、换域名 / 端口、退出匿名账号后，不能仅凭原浏览器重新找到账号。跨设备使用前必须绑定邮箱并设置密码。

## 本地运行

使用 Node.js 22.13+ 的 22.x 系列或 Node.js 24+（本轮本机验证使用 22.20.0）。本项目已转换为 Vite 多页项目，不再通过双击 HTML 文件运行。

```powershell
cd "C:\Users\25759\Desktop\github项目管理\recsys-2027-check"
npm ci
npm run dev
```

开发入口：`http://127.0.0.1:5173/recsys-2027-check/`；第二页：`http://127.0.0.1:5173/recsys-2027-check/soe.html`。

生产构建和本地预览：

```powershell
npm run build
npm run preview
```

预览入口：`http://127.0.0.1:4173/recsys-2027-check/`。开发端口与预览端口是两个不同的浏览器存储来源，匿名身份不共享；邮箱账号可以在两个入口登录同一账号。

## Supabase 配置

仓库原有默认连接目标如下。本轮工程优化未重新检查或修改线上套餐、Auth 开关、回调、SMTP 或 CAPTCHA 配置：

| 项目         | 值                                         |
| ------------ | ------------------------------------------ |
| Organization | `recsys-2027`（Free）                      |
| Project      | `recsys-2027-check`                        |
| Project ref  | `npqrixancnwbmzcyqafx`                     |
| Region       | Singapore / `ap-southeast-1`               |
| API URL      | `https://npqrixancnwbmzcyqafx.supabase.co` |

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

当前资料包括 **111 张卡片**（推荐页 57、国企页 54）、110 个公司实体、83 张历史卡片快照、56 个来源、49 个固定时间线节点和 4 组更新日志。动态「今天」标记在浏览器按北京时间生成，不写入固定时间线。

- `companies`、`job_entries`：公司及当前招聘事实；状态、城市、方向、日期、评分等均为独立 SQL 列。
- `sources`、`entry_links`、`entry_audits`、`job_sources`、`entry_deadlines`：链接、复核与日期证据。
- `catalog_archives`、`timeline_events`、`change_logs`：历史快照、时间线与更新记录。JSONB 只用于完整历史记录和日志的可变明细，不替代当前卡片字段。
- `user_card_states`：`user_id + entry_id` 联合主键，状态为 `active / applied / uninterested`，服务器更新时间；该表已加入 `supabase_realtime` publication，用于同账号在线设备的实时状态通知。

所有业务表均启用 RLS。公共招聘资料只允许前端读取，不允许匿名或普通登录用户修改。个人状态不授予未登录访客数据库访问权限；登录用户（包括匿名设备账号）只能读写 `auth.uid() = user_id` 的记录。写入策略同时检查旧行与新行归属，防止把状态写到别人的用户 ID 下。

数据库自带的 API 就是本项目的后端。当前功能不需要额外部署 Express、Python 服务或 Edge Function；复杂私密业务后续可单独加入。前端不会接触管理员密钥。

## 数据维护与回退

日常请修改本地 `data/*.json` 并 push main，由 Actions 自动同步数据库；不要把 Supabase Table Editor 当作另一个日常维护源。请保留公司 / 卡片 ID，避免导致个人标记失去关联。页面先同步展示 24 小时内且不早于内置核查版本的有效缓存，否则展示 `data/*.json` 内置只读快照；随后异步检查云端并刷新资料。公共资料不等待账号初始化，云端失败不清空已显示内容。页面明确标识数据来源，并提供「刷新招聘资料」按钮。

`data/rec.json` 和 `data/soe.json` 是招聘事实的唯一日常维护源，用于云端同步和前端离线备份。专业及地区评估 JSON 随前端构建发布，不写入个人状态表；事实改变后，评估必须重新核验。Dashboard 的手工修改不会反向写回 Git，并可能被下一次发布覆盖。招聘网站本身不会被此项目自动爬取或核查，原核查日期和证据范围均保留。

数据库初始化文件：

```text
supabase/migrations/202609120001_recsys.sql
supabase/seed.sql
```

当前云端已经执行过，不必再次运行。`npm run seed:sql` 仅重新生成本地 SQL 文件，不会连接或修改云端。`seed.sql` 可重复导入，但会把当前招聘事实重置为本地种子内容；已有线上维护记录应先备份，不要把重新导入当日常同步。种子导入不会修改 `user_card_states`。

本次迁移前的原 HTML 与一次性迁移工具保存在本机 `.migration-backup/`，该目录已加入 `.gitignore`。原始文件也可以从 Git 历史提交 `3f079fb` 中恢复。不要把备份目录、`node_modules`、本地凭据或 `.env` 提交到仓库。

## 检查与测试

```powershell
npm run verify
npm run audit:prod
# 以下为可选的真实云端只读检查，不属于隔离浏览器测试
npm run test:cloud
```

单元测试覆盖状态持久化、置后排序、恢复、快速连点、网络失败与重试、不同用户 / 标签页缓存隔离、两台设备同账号的云端收敛、Realtime 订阅按 `user_id` 过滤与清理、完整资料的数据库往返校验，以及邮箱绑定的先验证后设密码流程。

`test:cloud` 是只读的真实 Supabase 集成检查，核对两页全部卡片、历史和时间线，并确认未登录请求不能读个人状态。若有意修改了云端招聘事实但未更新离线快照，此校验会指出差异，而不是静默成功。

`supabase/tests/rls.sql` 可在 SQL Editor 运行，验证匿名、本人和其他账号的读写权限、伪造所有者、更新归属及非法状态。它在单个事务中创建临时测试用户，结束时全部回滚，不留下测试记录。

## 部署前端（不需要购买域名）

执行 `npm run build` 后，将 **`dist/` 目录**部署到 GitHub Pages、Cloudflare Pages、Vercel 或其他静态托管。不要直接发布包含裸 npm 模块导入的源码 HTML。Vite 当前固定使用 `/recsys-2027-check/` 资源基路径；部署到其他路径时必须同步调整 Vite、构建策略、Pages 验证器和浏览器测试的路径约定。

GitHub Pages 的原静态分支发布方式需要调整为构建后发布 `dist/`，或者使用 GitHub Actions 构建上传。其他静态平台通常设置构建命令 `npm ci && npm run build`、产物目录 `dist` 即可。部署属于单独的发布操作；本次代码开发不会自动 `git push` 或修改现有线上站点。

Supabase Free 不是无限容量，也不保证永不暂停。正式长期使用前应检查当前配额、闲置暂停规则、邮件服务和备份方案；本次未启用任何付费套餐或附加项。

## 主要目录

```text
src/pages/rec.js, soe.js   原页面渲染与查询衔接
src/styles/              原版视觉样式
src/personal.js, .css    个人工作台和卡片操作
src/state-store.js       持久化与待同步操作
src/backend.js          公共资料与用户 Auth 分离的 Supabase 连接
src/catalog-cache.js    有界有效期缓存与运行时数据校验
src/bootstrap.js        分页加载、主题初始化与失败重试入口
src/shared/             日期、搜索、渲染、分页和重试等共享基础模块
src/catalog-model.js    数据映射和状态规则
src/auth-actions.js     邮箱绑定和密码设置
supabase/               表结构、种子资料与权限测试
tests/                  无外部网络单元测试
e2e/                    隔离数据的桌面/手机浏览器和无障碍测试
scripts/                种子生成与只读云端校验
```

参考官方文档：[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[匿名身份与绑定](https://supabase.com/docs/guides/auth/auth-anonymous)、[SMTP 限制](https://supabase.com/docs/guides/auth/auth-smtp)。

### 地区偏好与组合筛选

央国企页支持杭州、成都、重庆、西安及浙江全省筛选；默认不限地区。按实际岗位地点或本届招聘范围加分，不使用总部或考试城市。一个入口的地点与岗位方向取证据交集，未完成地区核验的卡片仍保留。维护规则见 [地区偏好与证据维护](docs/location-preferences.md)，配套数据为 data/soe-locations.json。

本轮扩展的实现与验收记录见 [应用统计机会池扩展记录](docs/recruitment-policy-review.md)。
