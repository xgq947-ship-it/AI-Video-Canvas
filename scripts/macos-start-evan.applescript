set homePath to POSIX path of (path to home folder)
set desktopPath to POSIX path of (path to desktop folder)
set projectPath to desktopPath & "AI-Video-Canvas"
set launcherPath to projectPath & "/scripts/desktop-launcher.mjs"
set commandPath to "PATH=" & quoted form of (homePath & ".local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin") & " node " & quoted form of launcherPath & " start"

try
	set resultText to do shell script commandPath
	if resultText contains "\"already_running\"" then
		display notification "项目已经在运行，不会重复启动。" with title "Evan"
	else
		display notification "Evan 已启动，窗口即将打开。" with title "Evan"
	end if
on error errorText
	display dialog "Evan 启动失败：" & return & errorText buttons {"好"} default button "好" with icon stop
end try
