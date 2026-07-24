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
- 鼠标交互：拖动文件怪窗口时播放“追赶鼠标”，鼠标靠近时播放“害羞”，两者与现有动作保持同一主体高度。
- 文件整理：拖文件到文件怪身上即可整理；也可以点击“整理桌面”。
- 截图整理：识别 `screenshot / screen shot / 截屏 / 截图 / 屏幕快照 / スクリーンショット` 等命名。
- 通用 AI 助手 + 文件怪代理：Ctrl + 左键打开 AI 对话窗口，普通问题可以直接回答；涉及桌面、文件、规则、整理、清理时才切换成文件代理。
- 主动观察：监听桌面新增文件，在气泡里主动提示是否需要判断怎么处理。
- 对话式展示：大模型回复直接显示在 AI 窗口聊天记录里，支持流式/打字式输出、自动滚动和选中文字复制，桌宠气泡保持原来的状态文案。
- 聊天输入：AI 窗口只保留文本输入框，按 `Enter` 发送，按 `Shift+Enter` 换行，不再显示底部发送/图片按钮。
- 确认式执行：AI 先在对话窗口里给整理/清理计划，用户输入“确认”才执行；清理只移动到 `_回收站`，不会永久删除。
- 规则编辑：可在面板内修改分类规则 JSON、整理箱路径、安全模式、是否移动文件夹、日期前缀、开机自启、置顶。
- 右键菜单：整理桌面、整理截图、命名建议、打开整理箱、撤销、置顶、开机自启、退出。

## AI 接入说明
- 默认接口：`https://apihub.agnes-ai.com/v1/chat/completions`
- 默认模型：`agnes-2.5-flash`
- 灰度不可用时回退：`agnes-2.0-flash`
- API Key 可在设置面板填写，也可设置环境变量 `AGNES_API_KEY` 或 `AGNES_AI_API_KEY`。
- 普通对话默认不上传桌面文件列表；只有问题涉及桌面/文件/规则/整理/清理时，才上传文件元数据：完整路径、文件名、扩展名、文件/文件夹类型、大小、修改时间、当前分类；不会读取文件内容。
- 会改动文件的 AI 操作都会先生成对话计划，用户输入“确认”后才执行，执行时仍走现有安全校验和撤销记录。
- 当前 AI 对话窗口只开放文本输入；图像理解接口保留在主进程中，但界面不再展示图片 URL 输入。本地截图/OCR 需要后续接入本机 OCR 或显式上传流程。
## 目录结构
```txt
file-monster-video-desktop-pet/
  package.json
  README.md
  assets/
    videos/
      filemonster_chase_mouse.webp
      filemonster_dizzy.webp
      filemonster_idle.webp
      filemonster_shy.webp
      filemonster_silly.webp
      filemonster_sleep.webp
      filemonster_wave.webp
      manifest.json
  scripts/
    process-video.py
  src/
    ai-client.js
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
- AI 功能已通过 Agnes 兼容接口接入，普通问题走通用助手模式；文件相关问题只发送文件元数据。若后续要分析本地文件内容或截图，需要单独增加用户确认和本地 OCR/上传流程。
