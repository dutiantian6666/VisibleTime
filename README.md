# VisibleTime · 看见时间

个人时间管理工具：任务清单、专注计时和今日统计。

当前版本 **1.1.0**，新增 Windows 桌面版、独立本地数据库、系统托盘和备份恢复。时间流计划在 1.2.0 发布，日历排程计划在 1.3.0 发布。

## 下载与安装

- [下载 Windows x64 安装程序](https://github.com/dutiantian6666/VisibleTime/releases/download/v1.1.0/VisibleTime-Setup-1.1.0-x64.exe)
- [v1.1.0 版本说明与校验文件](https://github.com/dutiantian6666/VisibleTime/releases/tag/v1.1.0)
- [所有历史版本](https://github.com/dutiantian6666/VisibleTime/releases)

运行安装程序，按向导安装。通过桌面或开始菜单的 VisibleTime 快捷方式启动，无需安装 Node.js 或单独启动服务。当前提供 Windows x64 版本，安装包未做代码签名。

## 桌面版使用

- 输入任务名称，按 Enter 或点击加号添加。
- 点击任务右侧播放按钮开始计时；切换任务时自动停止并保存上一段。
- 点击暂停结束本段计时；再次开始同一任务会累计今日耗时。
- 点击左侧圆圈完成任务；在“已完成”中可以恢复。
- 关闭窗口会隐藏到系统托盘，**后台继续计时**。点击托盘图标重新打开窗口。
- 需要结束程序时，右键托盘选择“退出并暂停计时”，或在“数据与备份”中退出。
- 电脑休眠时自动暂停；唤醒后由你手动开始下一段。系统会话结束时也会尽力保存并暂停。
- 如果断电或异常终止，重新启动时将上一次计时恢复到最后心跳时刻并暂停，正常保存时可能少记最多约 5 秒；以实际最后成功保存的心跳为准。

耗时根据开始和结束时间计算，不依赖页面刷新的次数。待办包含以前尚未完成的任务，右侧耗时和下方统计只显示今天。跨午夜记录按设备本地时区拆分。

## 数据保存与备份

桌面版数据固定保存在：

```text
%APPDATA%\VisibleTime\data\
  visible-time.db
  backups\
```

清理浏览器历史、Cookie 或网站数据不会删除这里的数据库。升级安装会沿用该目录，默认卸载不删除个人记录。软件代码上传 GitHub，个人数据库和备份文件不会上传。

右上角“数据与备份”提供：

- **导出全部数据**：生成 JSON 文件，可保存到其他磁盘。
- **导入数据 / 恢复备份**：先验证文件，再确认替换；替换前自动保存原有数据。
- **立即创建本地备份**：保存当前数据快照。
- **打开数据文件夹**：查看数据库和备份。

软件启动和运行期间会检查每日备份，正常退出也会备份。本机自动备份与原数据库在同一磁盘，建议定期导出一份到其他位置。

正在运行的计时会在导出文件中保留原始开始时间；导入时停止在文件的导出时刻，避免累计传输和等待期间的时间。也支持直接导入 v1 格式的原始数据。

## 从第一版网页版迁移

1. 在原来使用的浏览器中，通过原地址打开当前项目的网页版，通常为 `http://127.0.0.1:4173`；刷新后可看到“数据与备份”按钮。
2. 选择“数据与备份 → 导出全部数据”，保留生成的 JSON 文件。
3. 打开桌面版，选择“数据与备份 → 导入数据 / 恢复备份”，选中该文件。
4. 确认导入，核对任务和累计用时。

迁移必须在原浏览器、原地址和原端口进行。桌面版不会自动读取其他浏览器的数据。已经被清理的第一版浏览器记录无法凭空恢复。

## 开发与测试

使用 Node.js 24.22 或兼容版本、pnpm 11.25。应用依赖已锁定在 `pnpm-lock.yaml`。

```powershell
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm desktop
```

网页兼容模式：双击 `start.cmd`，或运行 `node server.mjs`，访问 `http://127.0.0.1:4173`。网页版仍使用浏览器存储。

```powershell
node --test tests/*.test.mjs
pnpm run build:win
```

安装包输出在 `release/`，不会提交到 Git。安装程序作为对应 GitHub Release 的附件保存。

可选浏览器和 Electron 集成测试依赖 Playwright，支持通过 `PLAYWRIGHT_MODULE` 指定已有安装的绝对路径：

```powershell
node tests/browser.mjs
node tests/desktop.mjs
```

桌面测试使用独立的 `desktop-test-data/` 目录，不接触真实个人数据。休眠测试模拟系统 `suspend` 事件，未实际让开发电脑休眠。通过 `VISIBLE_TIME_EXECUTABLE` 可指定打包后的 EXE 进行相同验证。

## 版本历史

每次发布的变化记录在 [CHANGELOG.md](CHANGELOG.md)，迭代遵循 [VERSIONING.md](VERSIONING.md)。`v1.0.0` 标签保留原始网页版；每个新版本拥有独立标签、Release 和适用的安装包。
