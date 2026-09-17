# 家庭回忆录网站

## Cloudflare 自动部署

2026-09-17：按用户要求新增 Cloudflare Pages GitHub 联动配置，项目名 `grandma-memoir`，部署成功后使用其 `pages.dev` 免费网址。网站默认打开 Bibi 翻页阅读。下方正文直出为 GitHub 旧站历史行为，不能当作 Cloudflare 默认体验。

- 连接本仓库 `main`，框架选择 None，构建命令 `npm run build:cloudflare`，输出目录 `cloudflare-dist`，Node.js 22。
- 后续将**获准发布**的成品更新到 `docs/` 后推送，Cloudflare 自动重建；无需手工上传部署包。完整资料库和未获准的草稿不进入仓库。
- 文字、字体和图片由 Cloudflare 提供；视频仍通过现有 GitHub Pages 地址播放，不消耗 Cloudflare Pages 单文件25 MiB限额。图片保持原文件，超过25 MiB会中止构建；视频超过50 MiB会中止构建，不自动压缩。
- `scripts/build-cloudflare.mjs` 从 `docs/` 创建独立产物、外置视频链接、重建缓存清单；不会修改 `docs/`。缓存源码和回归测试随仓库保存。外链视频点击保存时使用浏览器 IndexedDB；跨站 Range 响应仍须通过长度和SHA256校验才标记保存。
- 新视频在 GitHub Pages 部署成功后才可访问。两个平台构建完成时间可能不同，发布新视频后应核对 GitHub Pages 的工作流成功。
- 本地验证：`npm ci && npm run build:cloudflare`；本地预览 `python3 -m http.server 8883 --bind 127.0.0.1 --directory cloudflare-dist`。
- 国内和微信实际加载速度由网络决定；换域名后浏览器缓存独立，需要首次重新加载。部署成功不等于微信真机验收通过。

《姥姥的那些年》网页试读版，使用 Bibi 阅读器，包含正文、九张照片及一段家庭视频。

阅读地址：https://424197379.github.io/family-memoir/

默认直接阅读：https://424197379.github.io/family-memoir/read.html?v=wechat2 。正文和基本样式内嵌在约30KB的HTML中；即使缓存脚本、字体和媒体失败也能阅读文字。向下滚动，顶部可选翻页版。普通浏览器和微信进入Bibi时默认转到简洁版，显式 `flip=1` 可保留翻页模式。图片及视频的缓存作为可选增强；首屏不等待缓存初始化。根网址直接返回正文HTML，不再跳转加载框架；显式进入翻页版时，缓存预加载推迟到正文打开之后。

2026-09-17用户微信实测旧版停在“正在连接，准备正文”，旧版微信首屏验收失败。新入口已完成桌面手机尺寸及依赖失败注入测试，真实微信复测仍待确认，不把模拟视口称作微信真机通过。

2026-09-17 按用户认可版本发布。正文源稿 SHA256：`8b41fe54039bab834b56bca4f6fc8e4995effbee34710d5f69957c57cb1a6933`。本次授权仅覆盖该版读者正文和既有十项媒体；后续素材及修订不自动发布。

- 网页文件放在 `docs/`；GitHub Pages 仅部署这个目录。
- `main` 更新后，GitHub Actions 检查视频大小并发布网站。
- 每个视频上限为 50 MiB（52,428,800 字节）；超过即停止部署，不自动压缩。
- 上传前也要在本地运行 `python3 scripts/check_video_sizes.py docs`。云端检查在推送之后执行，不能代替上传前检查。
- 当前仓库只负责网页展示与维护，不作为原始资料备份。不要放入原始采集、编辑说明、本机构建记录或凭据。
- 使用 Bibi 1.2.0（MIT）及思源宋体本书用字子集（OFL，更名 Memoir Serif）；许可证与来源说明随网页资源保留。图片及视频保持原件字节，不自动压缩。
- 正文先打开；照片按阅读位置请求原图，显示已下载字节与百分比，失败或30秒无数据时可单独重试。视频使用 `preload="none"`，点击播放后加载。加载实现位于 `docs/bibi/extensions/memoir-loading.js`，正文图片通过 `data-memoir-src` 接入，不能直接恢复为普通 `src` 而重新阻塞首开。

本地预览：`python3 -m http.server 8875 --bind 127.0.0.1 --directory docs`。

媒体缓存：图片按可见位置自动保存，视频提供“保存视频到本机／暂停／继续”按钮。使用 idb-keyval 6.3.0 将 SHA256 校验后的 256 KiB 分片写入 IndexedDB；中断后复用完整分片，同一文件更新正文时不必重新下载。保存失败会提示，不能将当次能播放当作已保存。

Workbox 7.4.1 额外缓存正文与阅读器，并处理视频 Range 播放。媒体保存不依赖 Service Worker；微信等不支持时仍尝试 IndexedDB 兼容路径。库已打包进网站，不请求第三方 CDN，许可证位于 `docs/licenses/cache/`。本机缓存可能被微信、系统清理或因空间不足而无法保存，不能保证永久离线；未做微信／鸿蒙真机验收。

维护注意：`docs/bibi/memoir-cache.js` 和 `docs/sw.js` 是构建产物，包含媒体分片哈希与网页修订信息。替换正文或媒体时必须从本机构建源执行 `build_book.py`（包含缓存构建），不可只替换静态文件。新版缓存等待用户点击“有新版，点击更新”后切换。不要把本机构建记录和资料库上传。

部署采用 [GitHub 官方 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。国内各网络及微信中的访问效果需真机确认，不能保证始终可用。
