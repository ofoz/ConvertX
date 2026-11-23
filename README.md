# ConvertX · 大肥鱼格式工坊

<div align="center">

自托管在线文件转换服务，使用 TypeScript、Bun 与 Elysia 编写。
界面是一间虚构的「格式工坊」营业厅，转换任务以柜台业务的形式办理。

</div>

## 这是什么

ConvertX 把一批开源转换引擎（LibreOffice、ImageMagick、FFmpeg、Pandoc、Calibre 等）包装成一个自托管的网页服务：选一个目标格式，交付文件，等柜台处理完再把结果取走。

与上游项目相比，这份实现做了三件事：

1. **格式目录经过收敛。** 只暴露常用的办公文档、图片、音视频、电子书、数据/通讯录、矢量与 3D 模型格式，并按方向（输入 → 输出）列出真实可用路径，不再罗列引擎的完整能力矩阵。
2. **资源限制是硬约束。** 并发、队列、单文件大小、每单累计上传与累计产物、图片像素、PDF 页数、超时、归档大小都可配置，超限会被拒绝而不是悄悄拖垮实例。
3. **转换产物先隔离再发布。** 每份输入在作业目录之外的私有临时目录里转换，通过配额检查后才原子发布到可下载目录。

## 功能

- 一次提交多个文件，同一单内可分批追加
- 账户体系：多用户、可选注册、密码保护
- 历史记录与结果页，转换进度实时轮询
- 整单打包下载（tar）或单文件下载
- 格式目录页，按用途分组展示每个引擎的真实输入/输出方向
- 移动端：营业厅一次只显示一位角色，左右滑动切换
- 自定义品牌名、站点根路径、隐藏历史页等部署开关

## 常用格式

目录是**有方向的**：不是每个列出的格式都能互相转换，界面的格式选择器与 `/converters` 支持格式页展示的是当前实例真实可用的路径。

| 类别         | 格式                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| 文档与表格   | PDF、DOC/DOCX、ODT、RTF、TXT、HTML、Markdown、CSV/TSV、XLS/XLSX、ODS、PPT/PPTX、ODP |
| 图片与矢量   | JPEG、PNG、GIF、WebP、BMP、TIFF、ICO、SVG、HEIC/HEIF、AVIF                          |
| 音频与视频   | MP3、M4A、AAC、WAV、FLAC、OGG、Opus、MP4、MOV、MKV、WebM、AVI                       |
| 电子书       | EPUB、MOBI、AZW3                                                                    |
| 数据与通讯录 | JSON、YAML、XML、TOML、VCF、EML、MSG                                                |
| 3D 模型      | OBJ、STL、GLB、GLTF、FBX、DAE、PLY                                                  |

底层引擎支持的其它格式（如 EXR、JXL、设备相关格式、FFmpeg 的内部 muxer 名）不会出现在公开目录中。

### 关于 PDF 转 Word

PDF 没有「表格」这个概念，只有画在页面上的线段，所以转换质量取决于引擎如何还原版面：

- **PDF → DOCX** 默认使用 `pdf2docx`，它会重建段落、图片和**带框线的表格**，适合带表格的报表与扫描件。
- 需要保留严格的页面布局（例如排版稿）时，可以在转换器列表里改选 LibreOffice。它的 PDF 导入会把整页拆成浮动文本框，视觉位置贴近原稿，但**表格会变成零散文本框、框线丢失**。

`pdf2docx` 通过 pipx 安装，官方镜像已内置；Windows 本地部署见 [scripts/WINDOWS.md](scripts/WINDOWS.md)。

## 快速开始

### Docker Compose（推荐）

```bash
git clone <this-repo> convertx
cd convertx
# 建议先设置一个固定的 JWT 密钥，否则每次重建都会让所有会话失效
export JWT_SECRET="$(openssl rand -hex 32)"
docker compose up -d --build
```

打开 `http://localhost:3000`，创建第一个账号。**第一个账号不受注册开关限制**，所以不要在未配置的情况下把服务暴露到公网。

### Docker Run

```bash
docker run -d \
  --name convertx \
  --restart unless-stopped \
  -p 3000:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e PUID=1000 -e PGID=1000 \
  -v ./data:/app/data \
  convertx
```

`PUID`/`PGID` 应与宿主机上拥有 `./data` 的用户一致（`id -u`、`id -g`），否则会写入失败。若出现 `unable to open database file`，先检查目录权限。

### 本地开发

需要 [Bun](https://bun.sh/) 1.4+ 与 Git，转换功能还需要系统里装好对应的外部命令。

```bash
bun install
bun run dev        # 监听文件变化
# 或
bun run hot        # 热重载
```

默认监听 `http://localhost:3000`。开发模式下 Tailwind 在**启动时生成一次** `generated.css`，改动了样式后需要重启进程才会生效。

Windows 本地部署请参考 [scripts/WINDOWS.md](scripts/WINDOWS.md)，其中包含依赖检查脚本、安装日志与启动器。

## 环境变量

全部可选，`JWT_SECRET` 强烈建议设置。

> **警告**
> 不要把 `ALLOW_UNAUTHENTICATED` 或 `ACCOUNT_REGISTRATION` 为 `true` 的实例暴露到公网。只允许你信任的用户访问。

| 名称                           | 默认值                | 说明                                                                                            |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                   | 随机 UUID             | 签发登录令牌的密钥。未设置时每次重启都会变，导致所有会话失效                                    |
| `PUID`                         | `0`（root）           | 运行应用进程的用户 ID，入口脚本会先以 root 修正数据目录属主                                     |
| `PGID`                         | 同 `PUID`             | 运行应用进程的用户组 ID                                                                         |
| `UMASK`                        | `002`（设置 PUID 时） | 新建文件与进程的权限掩码                                                                        |
| `ACCOUNT_REGISTRATION`         | `false`               | 是否允许自助注册新账号                                                                          |
| `HTTP_ALLOWED`                 | `false`               | 是否允许纯 HTTP 访问。局域网 IP + HTTP 必须开启，否则登录 Cookie 带 `Secure` 标记会被浏览器丢弃 |
| `ALLOW_UNAUTHENTICATED`        | `false`               | 允许未登录用户直接使用服务                                                                      |
| `UNAUTHENTICATED_USER_SHARING` | `false`               | 未登录用户之间共享历史记录，仅与 `ALLOW_UNAUTHENTICATED` 配合                                   |
| `AUTO_DELETE_EVERY_N_HOURS`    | `24`                  | 清理早于该小时数的文件，`0` 表示不清理                                                          |
| `WEBROOT`                      | 空                    | 站点根路径。设为 `/convert` 后服务在 `example.com/convert/` 下运行                              |
| `BRANDING`                     | `大肥鱼格式工坊`      | 站点显示名（页头、标题、无障碍标签）                                                            |
| `LANGUAGE`                     | `en`                  | 历史记录日期格式化所用的 BCP 47 语言标签                                                        |
| `HIDE_HISTORY`                 | `false`               | 隐藏历史记录页                                                                                  |
| `MAX_CONVERT_PROCESS`          | `0`                   | 单作业内并发转换数，`0` 表示沿用全局上限                                                        |
| `FFMPEG_ARGS`                  | 空                    | 追加到 FFmpeg 输入参数，例如 `-hwaccel vaapi`                                                   |
| `FFMPEG_OUTPUT_ARGS`           | 空                    | 追加到 FFmpeg 输出参数，例如 `-preset veryfast`                                                 |
| `PORT`                         | `3000`                | 监听端口                                                                                        |
| `TZ`                           | `UTC`                 | 进程时区，影响历史记录时间显示                                                                  |

## 资源限制

以下设置**在启动时读取一次**，之后不再变化。并发与队列是进程级共享的，队列满时转换请求返回 `429` 并带 `Retry-After`，可以稍后重试。

| 名称                         | 默认值                  | 说明                                             |
| ---------------------------- | ----------------------- | ------------------------------------------------ |
| `GLOBAL_CONVERT_CONCURRENCY` | `2`                     | 同时进行的转换文件数                             |
| `MAX_QUEUED_FILES`           | `64`                    | 等待转换空位的文件数                             |
| `MAX_FILES_PER_JOB`          | `20`                    | 单个作业接收的文件数                             |
| `MAX_FILE_SIZE_MB`           | `256`                   | 单个源文件大小上限                               |
| `MAX_JOB_UPLOAD_SIZE_MB`     | `1024`                  | 单个作业保留的源文件累计大小上限                 |
| `MAX_JOB_OUTPUT_SIZE_MB`     | `1024`                  | 单个作业保留的转换产物累计大小上限（含附属文件） |
| `MAX_REQUEST_SIZE_MB`        | `MAX_FILE_SIZE_MB + 16` | 单个 HTTP 请求体上限，包含 multipart 开销        |
| `MAX_IMAGE_PIXELS`           | `40000000`              | 单张图片或单个画布的像素上限                     |
| `MAX_IMAGE_FRAME_PIXELS`     | `200000000`             | 动图全部帧的累计像素上限                         |
| `MAX_PDF_PAGES`              | `200`                   | PDF 输入页数上限                                 |
| `METADATA_TIMEOUT_SECONDS`   | `10`                    | 元数据探测超时                                   |
| `CONVERT_TIMEOUT_SECONDS`    | `600`                   | 单次外部转换命令超时                             |
| `FFMPEG_THREADS`             | `2`                     | 施加给 FFmpeg 的线程上限                         |
| `MAGICK_MEMORY_MB`           | `256`                   | ImageMagick 内存缓存上限                         |
| `MAGICK_DISK_MB`             | `1024`                  | ImageMagick 磁盘缓存上限                         |
| `MAX_ARCHIVE_SIZE_MB`        | `1024`                  | 打包下载归档大小上限                             |
| `ARCHIVE_TIMEOUT_SECONDS`    | `300`                   | 生成归档的超时                                   |
| `HISTORY_PAGE_SIZE`          | `20`                    | 历史记录每页条数                                 |

### 配额是怎么生效的

- **上传**：累计大小按作业目录中**已存在文件的真实大小**计算。同名重传只按替换后的新大小计一次；超限返回 `413` 且保留原文件。写入采用临时文件 + 原子替换，多文件请求优先提交能释放空间的替换。
- **认领**：上传、单文件删除与转换认领共用同一把每作业锁。转换开始前会重新累计所选输入的大小，任务进入 `pending` / `completed` 后单文件删除返回 `409`。
- **产物**：每份输入在作业目录**之外**的 `.convertx-work-*` 私有目录中转换，完成后串行校验累计字节（包含子目录与附属文件、拒绝符号链接）、先检查全部目标名再原子移动。超额或写入失败只回滚自己的产物，不影响同批已发布的结果。
- 产物配额限制的是**最终保留**大小，不封顶转换进程运行中的临时磁盘峰值。需要硬性上限时请给容器卷配置配额。
- 进程被强制终止时可能残留 `.convertx-work-*` 目录，属于停机后的手工清理项。

元数据检查依赖 Poppler 的 `pdfinfo`（PDF）与 ImageMagick 的 `magick`（图片）。官方镜像已包含这些命令。

## 部署说明

### 端口与访问

- 容器内监听 `3000`，用 `-p` 或 compose 的 `ports` 映射。
- **HTTPS 或 localhost 之外必须设置 `HTTP_ALLOWED=true`**，否则登录无法保持。
- 放在反向代理后面时，记得转发 `Host`、`X-Forwarded-*`，并按需设置 `WEBROOT`。

### 局域网共享

局域网直接用 IP 访问时：

```bash
docker run -d -p 3000:3000 \
  -e HTTP_ALLOWED=true \
  -e ACCOUNT_REGISTRATION=true \
  -v ./data:/app/data convertx
```

`ACCOUNT_REGISTRATION=true` 让同事可以自行注册；只想共享一个账号时保持 `false`，用第一个账号登录即可。

### 数据目录

`/app/data` 保存 SQLite 数据库、上传文件与转换产物，**必须挂载到持久卷**。目录结构：

```
data/
├── mydb.sqlite          # 账号、作业、文件状态
├── uploads/<user>/<job>/ # 上传的源文件
└── output/<user>/<job>/  # 转换产物（可直接下载的部分）
```

`AUTO_DELETE_EVERY_N_HOURS` 会按作业创建时间清理整单数据；单文件删除、整单删除也可以在界面里操作。

### 反向代理要点

- 请求体上限（如 nginx `client_max_body_size`）不能低于 `MAX_REQUEST_SIZE_MB`，否则大文件在到达应用前就被拒绝。
- 归档下载是流式的，代理不要缓冲整个响应（nginx 关闭 `proxy_buffering` 更稳妥）。
- SSE/轮询接口不要加缓存，应用已设置 `ETag`，条件请求返回 `304`。

## 开发

```bash
bun install
bun run dev          # 开发服务器
bun run test         # 单元与路由测试（不含需要 Docker 的集成测试）
bun run build        # 生成 CSS + TypeScript 构建
bun run lint         # tsc + eslint + knip
bun run format       # eslint --fix + prettier
```

### 目录结构

```
src/
├── index.tsx           # 服务入口、静态资源、自动清理
├── converters/         # 各引擎封装 + 引擎注册表（含格式收敛逻辑）
├── helpers/            # 资源限制、上传/产物配额、队列、进程管控、归档等
├── pages/              # 路由：工作区、上传、转换、下载、账号、历史、结果、API
└── components/         # 页面骨架、营业厅、格式目录、认证插画
public/                 # 前端脚本、样式产物、图标、角色素材
tests/                  # bun:test 单元测试与路由测试
scripts/                # Windows 部署脚本、素材处理、浏览器回归
```

### 测试

- `bun run test`：单元测试与真实 Elysia 路由测试，使用临时数据库，不触碰 `./data`。
- `tests/integration`：需要 Docker 镜像内的转换器二进制，因此被默认排除；用 `bun run test:integration` 在镜像内运行。
- `bun scripts/test-partial-results.mjs`：浏览器级回归，验证「先领取部分结果、其余仍在处理」的交互。需要本地 Edge 或 Playwright 浏览器。

## 素材与许可

界面角色为第三方二次创作作品，随仓库本地分发，来源与许可见：

- [public/characters/ATTRIBUTION.md](public/characters/ATTRIBUTION.md) — 来源仓库、固定提交、逐项署名
- [public/characters/assets.json](public/characters/assets.json) — 每个素材的来源 URL、SHA-256、尺寸、作者与许可
- 站内 `/credits` 页面同样提供上述文件下载

角色素材采用 **CC BY-NC-SA 4.0**，与软件本身的许可相互独立：软件许可见 [LICENSE](LICENSE)，安全策略见 [SECURITY.md](SECURITY.md)。

## 致谢

本项目源自 [C4illin/ConvertX](https://github.com/C4illin/ConvertX)，在其页面骨架与转换器封装的基础上重做了格式目录、界面与资源治理。角色插画来自 [JAdpp/dsh-whale-galgame](https://github.com/JAdpp/dsh-whale-galgame)。
