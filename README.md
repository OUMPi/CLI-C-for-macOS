# CLI-C for macOS

一个让终端命令按钮化的悬浮面板工具，随 Terminal 启动，快速执行常用命令。


https://github.com/user-attachments/assets/b3e0a1d6-9b33-4cbe-8997-693e52b2b8f0



## 功能亮点
- **悬浮窗口**：固定尺寸、始终置顶（当前 305×420）
- **命令/路径按钮化**：自定义命令/路径并成为可持续使用的按钮，单击加入队列（不用担心，队列元素间自动留空），点击确认即可在终端执行；拖拽按钮可排序或删除
- **手搓命令兜底**：支持手动输入命令
- **路径存档**：读取并保存当前路径（作为一个按钮）

## 安装方式
1. 下载最新 Release 的 `CLI-C.app`
2. 拖入 `/Applications/` 文件夹
3. 首次启动可能需执行 `xattr -dr com.apple.quarantine /Applications/CLI-C.app`

