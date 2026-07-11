# 文件怪透明视频桌宠桌面整理插件
## 项目说明
- 本项目是基于你上传的“文件怪”MP4 处理生成的 Electron 桌宠插件，已将原始视频拆分为 13 个动作 WebM 素材，并接入桌面整理交互。
- 原始文件为 H.264 MP4，编码不含 Alpha 通道；项目中已通过色彩遮罩方式生成 `WebM VP9 Alpha` 透明视频，适合 Electron 透明窗口嵌入。
- 当前透明处理属于工程可用版本：角色主体、UI 图标、光效已尽量保留；若要商用极致边缘质量，建议后续由三维/视频工具重新导出原生透明通道。
- 默认整理箱路径为桌面下的 `文件怪整理箱`，所有整理动作默认移动到该目录并按类型归档。
## 运行方式
```bash
npm install
npm start
```
## 核心功能
- 透明视频桌宠：待机、拖拽、整理、成功、失败、睡眠、唤醒、扫描、AI 命名、提醒、思考、吞入文件等动作。
- 文件整理：拖文件到文件怪身上即可整理；也可以点击“整理桌面”。
- 截图整理：识别 `screenshot / screen shot / 截屏 / 截图 / 屏幕快照 / スクリーンショット` 等命名。
- 命名建议：本地启发式“AI 命名建议”，不会上传文件内容。
- 规则编辑：可在面板内修改分类规则 JSON、整理箱路径、安全模式、是否移动文件夹、日期前缀、开机自启、置顶。
- 右键菜单：整理桌面、整理截图、命名建议、打开整理箱、撤销、置顶、开机自启、退出。
## 目录结构
```txt
file-monster-video-desktop-pet/
  package.json
  README.md
  assets/
    source/
      filemonster_source.mp4
    videos/
      filemonster_idle.webm
      filemonster_drag.webm
      filemonster_work.webm
      filemonster_success.webm
      filemonster_error.webm
      filemonster_sleep.webm
      filemonster_wake.webm
      filemonster_scan.webm
      filemonster_magic.webm
      filemonster_hover.webm
      filemonster_notify.webm
      filemonster_thinking.webm
      filemonster_ingest.webm
      filemonster_master.webm
      manifest.json
  scripts/
    process-video.py
  src/
    main.js
    preload.js
    index.html
    styles.css
    renderer.js
```
## 视频处理说明
- `assets/source/filemonster_source.mp4`：原始上传视频，保留作为源素材。
- `assets/videos/filemonster_*.webm`：已处理后的透明动作视频，Electron 运行时直接播放这些素材。
- `scripts/process-video.py`：视频处理脚本，可重新从 MP4 生成透明 WebM。
- 重新处理命令：
```bash
npm run process-video
```
## 默认分类规则
- Images：png、jpg、jpeg、gif、webp、bmp、svg、heic
- Screenshots：根据图片后缀和截图关键词识别
- Videos：mp4、mov、avi、mkv、webm、m4v
- Audio：mp3、wav、flac、aac、m4a、ogg
- PDFs：pdf
- Documents：doc、docx、txt、md、rtf、pages
- Spreadsheets：xls、xlsx、csv、numbers
- Presentations：ppt、pptx、key
- Archives：zip、rar、7z、tar、gz
- Code：js、ts、tsx、jsx、html、css、json、py 等
- Design：psd、ai、fig、sketch、xd、blend、c4d
## 安全策略
- 安全模式默认开启，会跳过 `.exe / .app / .dmg / .pkg / .msi / .bat / .cmd / .sh / .ps1 / .vbs / .scr / .com / .jar`。
- 默认不移动文件夹，避免误移动项目目录；可在面板里手动打开。
- 撤销整理只支持本次运行期间最近一次整理批次。
## 开发建议
- 商用版本建议让视频/三维同学重新导出原生透明背景 WebM 或 PNG 序列帧，这样边缘和光效会更干净。
- 当前代码已预留动作状态机，后续只要替换 `assets/videos/filemonster_*.webm` 即可升级视觉资产。
- 若要做 AI 真实命名，可在主进程添加 OpenAI-compatible 调用，但建议默认只发送文件元数据，不读取文件内容。
