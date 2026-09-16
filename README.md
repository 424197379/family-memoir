# 家庭回忆录网站

《姥姥的那些年》网页试读版，使用 Bibi 阅读器，包含正文、九张照片及一段家庭视频。

阅读地址：https://424197379.github.io/family-memoir/

2026-09-17 按用户认可版本发布。正文源稿 SHA256：`8b41fe54039bab834b56bca4f6fc8e4995effbee34710d5f69957c57cb1a6933`。本次授权仅覆盖该版读者正文和既有十项媒体；后续素材及修订不自动发布。

- 网页文件放在 `docs/`；GitHub Pages 仅部署这个目录。
- `main` 更新后，GitHub Actions 检查视频大小并发布网站。
- 每个视频上限为 50 MiB（52,428,800 字节）；超过即停止部署，不自动压缩。
- 上传前也要在本地运行 `python3 scripts/check_video_sizes.py docs`。云端检查在推送之后执行，不能代替上传前检查。
- 当前仓库只负责网页展示与维护，不作为原始资料备份。不要放入原始采集、编辑说明、本机构建记录或凭据。
- 使用 Bibi 1.2.0（MIT）及思源宋体本书用字子集（OFL，更名 Memoir Serif）；许可证与来源说明随网页资源保留。图片及视频保持原件字节，不自动压缩。

本地预览：`python3 -m http.server 8875 --bind 127.0.0.1 --directory docs`。

部署采用 [GitHub 官方 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。国内各网络及微信中的访问效果需真机确认，不能保证始终可用。
