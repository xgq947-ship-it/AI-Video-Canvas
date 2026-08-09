set homePath to POSIX path of (path to home folder)
set desktopPath to POSIX path of (path to desktop folder)
set projectPath to desktopPath & "AI-Video-Canvas"
set launcherPath to projectPath & "/scripts/desktop-launcher.mjs"
set shellPath to homePath & ".local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
set logsPath to homePath & "Library/Logs/Evan"
set stdoutPath to logsPath & "/desktop-stop.out.log"
set stderrPath to logsPath & "/desktop-stop.err.log"
set jobLabel to "com.evan.desktop-launcher.stop"

try
	do shell script "/bin/test -f " & quoted form of launcherPath
	set nodePath to do shell script "PATH=" & quoted form of shellPath & " command -v node"
	if nodePath is "" then error "找不到 Node.js，请先完成项目开发环境安装。"
	do shell script "/bin/mkdir -p " & quoted form of logsPath
	set workerCommand to "PATH=" & quoted form of shellPath & " " & quoted form of nodePath & " " & quoted form of launcherPath & " stop; result=$?; /bin/launchctl remove " & quoted form of jobLabel & "; exit $result"
	set commandPath to "/bin/launchctl submit -l " & quoted form of jobLabel & " -o " & quoted form of stdoutPath & " -e " & quoted form of stderrPath & " -- /bin/sh -c " & quoted form of workerCommand
	with timeout of 30 seconds
		do shell script commandPath
	end timeout
on error errorText
	activate
	display dialog "Evan 关闭失败：" & return & errorText buttons {"好"} default button "好" with icon stop
	return
end try

-- 由用户级 launchd 执行实际关闭，避免 AppleScript Applet 访问桌面项目时死锁。
-- 任务结束后会自行注销；共享 Chrome 仍由 Hub 在所有 App 空闲后回收。
