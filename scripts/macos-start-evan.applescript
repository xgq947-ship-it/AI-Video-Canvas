set homePath to POSIX path of (path to home folder)
set desktopPath to POSIX path of (path to desktop folder)
set projectPath to desktopPath & "AI-Video-Canvas"
set launcherPath to projectPath & "/scripts/desktop-launcher.mjs"
set shellPath to homePath & ".local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
set logsPath to homePath & "Library/Logs/Evan"
set stdoutPath to logsPath & "/desktop-start.out.log"
set stderrPath to logsPath & "/desktop-start.err.log"
set jobLabel to "com.evan.desktop-launcher.start"

try
	do shell script "/bin/test -f " & quoted form of launcherPath
	set nodePath to do shell script "PATH=" & quoted form of shellPath & " command -v node"
	if nodePath is "" then error "找不到 Node.js，请先完成项目开发环境安装。"
	do shell script "/bin/mkdir -p " & quoted form of logsPath
	set workerCommand to "PATH=" & quoted form of shellPath & " " & quoted form of nodePath & " " & quoted form of launcherPath & " start; result=$?; /bin/launchctl remove " & quoted form of jobLabel & "; exit $result"
	set commandPath to "/bin/launchctl submit -l " & quoted form of jobLabel & " -o " & quoted form of stdoutPath & " -e " & quoted form of stderrPath & " -- /bin/sh -c " & quoted form of workerCommand
	with timeout of 30 seconds
		do shell script commandPath
	end timeout
on error errorText
	activate
	display dialog "Evan 启动失败：" & return & errorText buttons {"好"} default button "好" with icon stop
	return
end try

-- 由用户级 launchd 执行实际启动，避免 AppleScript Applet 访问桌面项目时死锁。
-- 任务结束后会自行注销；成功时不调用系统通知，也不会重复创建 Evan 进程。
