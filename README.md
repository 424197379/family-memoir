# 家庭回忆录网站

《姥姥的那些年》网页试读版，使用 Bibi 翻页阅读器，包含十二章正文、九张照片及一段家庭视频。

## 阅读与发布

- GitHub Pages：https://424197379.github.io/family-memoir/
- Cloudflare Pages：https://grandma-memoir.pages.dev/
- 两站默认均打开 Bibi 翻页版，保留目录、照片、音视频能力。根网址和历史 `read.html` 链接统一进入 `bibi/`，不再默认显示纵向纯文字版。
- 分享使用固定网址；后续不自动发送飞书，除非用户再次明确要求。
- 当前授权正文源稿 SHA256：`8b41fe54039bab834b56bca4f6fc8e4995effbee34710d5f69957c57cb1a6933`。后续素材和修订不自动发布，完整资料库、原始采集、编辑说明、本机构建记录和凭据不进入仓库。

## 共用构建

`docs/` 是已获准发布的输入，两个平台都经 `scripts/build-cloudflare.mjs` 构建独立产物，不再直接部署旧目录。

| 平台 | 命令 | 输出目录 | 视频来源 |
| --- | --- | --- | --- |
| GitHub Pages | `npm run build:github` | `github-dist` | 本站原视频，路径保持不变 |
| Cloudflare Pages | `npm run build:cloudflare` | `cloudflare-dist` | 原 GitHub Pages 视频地址 |

- Node.js 22，先运行 `npm ci`。GitHub Actions 与 Cloudflare GitHub 集成都监听 `main`；推送获准成品后自动构建部署。Cloudflare 项目名 `grandma-memoir`，框架 None。
- 两个构建均执行15项缓存/导航测试，并校验章节与媒体字节。构建不压缩照片或视频，不改写正文；Cloudflare仅将视频URL改为GitHub地址。
- 上传前运行 `python3 scripts/check_video_sizes.py docs`。每个视频上限50 MiB（52,428,800字节），超过即中止；GitHub Actions和构建也检查。Cloudflare输出另受单文件25 MiB限制，因此视频不打入Cloudflare产物。
- 新视频需要等GitHub Pages部署成功；两个平台完成时间可能不同。
- 本地预览GitHub：`python3 -m http.server 8886 --bind 127.0.0.1 --directory github-dist`；Cloudflare替换为 `cloudflare-dist`。排查GitHub子路径问题时另以 `/family-memoir/` 前缀预览。
- 更新获准正文/媒体时，先由本地书稿构建生成输入，再执行这里的托管构建。`docs/`内的旧缓存bundle会被托管构建覆盖；维护缓存请修改 `scripts/cache/`，维护合并首屏请修改 `scripts/pack-reader.mjs`。

## 首屏、媒体与自动更新

- Bibi核心、配置、扩展、兼容补丁、15份书籍结构/章节文件、正文样式与思源宋体子集合并到首个阅读HTML。图片、视频及可选缓存脚本不阻塞首屏；出错或超时显示明确提示。
- 照片按阅读位置请求，显示下载进度，失败或30秒无数据时可重试。视频 `preload="none"`，点击播放才加载；不预先下载全书媒体。
- idb-keyval 6.3.0将SHA256校验后的256 KiB分片保存到IndexedDB，提供中断续传及视频保存/暂停/继续。文件内容不变时复用缓存。服务器若忽略Range而返回全文件，只能完整接收校验，不能保证按字节续传。跨站视频保存不借同源SW分支虚报成功。
- Workbox 7.4.1预存入口、合并阅读页和哈希缓存客户端，共3项，并处理视频Range播放。页面导航先联网重新验证，失败或6秒超时回退完整已缓存网页；不以半截响应覆盖旧页面。
- Service Worker安装完成自动激活；历史无握手页面自动重开同一网址一次，新版阅读页不被强制打断。页面缓存分版本，升级不删除媒体分片；无需更换链接或点击更新按钮。GitHub的HTTP缓存头由平台控制，不能通过Cloudflare `_headers` 配置改变；无SW浏览器依靠平台HTTP缓存策略。
- 浏览器/微信可能清理本地缓存或限制SW、IndexedDB，不能保证永久离线。首次HTML和未缓存媒体仍取决于网络；部署成功不代表国内或微信真机验收成功。原HEVC/HDR视频跨设备播放仍需验证。
- 使用Bibi 1.2.0（MIT）、思源宋体子集（OFL，更名Memoir Serif），缓存库随站打包，无第三方CDN脚本依赖，许可证随资源保留。

## 验证边界

2026-09-17已通过缓存/断点续传/自动更新的15项回归及双平台构建字节校验。此前已在Chrome手机尺寸、外部依赖失败、旧缓存迁移和离线回退场景验证翻页首屏；微信/鸿蒙真机、国内不同线路、全媒体连续播放须另外验证。用户已反馈Cloudflare国内连接困难，不将桌面环境的成功当作已解决该问题。
