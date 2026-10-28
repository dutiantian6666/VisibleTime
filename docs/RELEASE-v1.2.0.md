# VisibleTime v1.2.0

轻量 Windows 桌面版与时间流。安装包控制在 30 MB 以内。

- 改用 Windows 原生窗口 + 系统 WebView2，保留现有界面。
- 直接沿用第一版 SQLite 数据库，清理浏览器数据不会删除记录。
- 关闭窗口后隐藏到托盘继续计时；明确退出和休眠时保存并暂停。
- 新增时间流，查看每段记录的日期、起止时间、耗时和事项。
- 支持秒级补录、备注和修正，避免重叠或未来实际记录。
- 保留导入导出、每日备份、退出备份和导入前备份。

[下载 Windows x64 安装包](https://github.com/dutiantian6666/VisibleTime/releases/download/v1.2.0/VisibleTime-Setup-1.2.0-x64.exe)

适用于 Windows 10/11 x64、.NET Framework 4.6.2+。依赖 Microsoft Edge WebView2 Runtime；已有时可以离线安装和使用，缺少时安装程序提示联网补装。小包包含官方安装引导程序，不包含完整离线运行环境。

升级前请从托盘退出旧版。可以先卸载 1.1.0 再安装轻量版，默认卸载保留个人数据。数据库仍在 `%APPDATA%\VisibleTime\data`，建议升级前导出一份备份。

安装包未做代码签名。自动化休眠测试通过 Windows 电源消息验证，未实际让开发电脑休眠。
