ReasonContour's first Windows installer release. / ReasonContour 首个 Windows 安装包版本。

- Windows 10 (2004+) / Windows 11, x64.
- Download `ReasonContour-0.5.2-windows-x64-setup.exe` below and run it. No Node.js installation or source checkout is needed.
- 下载下方安装程序即可使用，无需安装 Node.js 或下载源码。
- The installer includes Node.js and automatically installs WebView2 if missing; internet access is required only for that prerequisite installation.
- 安装包内置 Node.js；系统缺少 WebView2 时会自动安装，此步骤需要联网。
- Discussion data is stored in `%LOCALAPPDATA%\ReasonContour\projects`. Upgrading or uninstalling leaves discussion data intact. Existing source-checkout data is not imported automatically.
- 讨论保存在上述用户目录，升级和卸载不会删除；开发目录里的旧数据不会自动导入。
- Includes the updated orange convergence logo, Chinese / English README, real light-mode screenshots, MCP / CLI integration, and undoable graph editing.
- The installer is unsigned. Windows may identify its publisher as unknown.

Build from source / 从源码构建：

```powershell
npm ci
npm run dist:win
npm run test:installer
```

`SHA256SUMS.txt` contains the installer checksum. / 校验文件列出了安装包的 SHA-256。
