set homePath to POSIX path of (path to home folder)
set desktopPath to POSIX path of (path to desktop folder)
set projectPath to desktopPath & "AI-Video-Canvas"
set launcherPath to projectPath & "/scripts/desktop-launcher.mjs"
set commandPath to "PATH=" & quoted form of (homePath & ".local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin") & " node " & quoted form of launcherPath & " stop"

try
	set resultText to do shell script commandPath
	if resultText contains "\"not_running\"" then
		display notification "项目当前没有运行。" with title "Evan"
	else
		display notification "项目、后端和 Evan 专属 Chrome 已关闭。" with title "Evan"
	end if
on error errorText
	display dialog "Evan 关闭失败：" & return & errorText buttons {"好"} default button "好" with icon stop
end try
