property projectPath : "/Users/dasheng/Desktop/AI漫剧电影/05_TwitCanva视频工作流"
property sourcePlist : projectPath & "/launcher/com.dasheng.twitcanva.plist"
property installedPlist : "/Users/dasheng/Library/LaunchAgents/com.dasheng.twitcanva.plist"
property logDir : "/Users/dasheng/Library/Logs/TwitCanva"
property serviceLabel : "com.dasheng.twitcanva"
property canvasURL : "http://localhost:5173"
property backendURL : "http://localhost:3001/api/library"

on frontendRunning()
	try
		set pageText to do shell script "curl -fsS --max-time 2 " & quoted form of canvasURL
		return pageText contains "<title>TwitCanva</title>"
	on error
		return false
	end try
end frontendRunning

on backendRunning()
	try
		set code to do shell script "curl -s -o /dev/null -w '%{http_code}' --max-time 2 " & quoted form of backendURL
		return code is "200"
	on error
		return false
	end try
end backendRunning

on serviceLoaded()
	try
		do shell script "launchctl print gui/$(id -u)/" & serviceLabel & " >/dev/null 2>&1"
		return true
	on error
		return false
	end try
end serviceLoaded

on ensureAgentInstalled()
	do shell script "mkdir -p " & quoted form of logDir & " /Users/dasheng/Library/LaunchAgents"
	if not (do shell script "test -f " & quoted form of sourcePlist & " && echo yes || echo no") is "yes" then error "找不到启动配置：" & sourcePlist
	do shell script "cp " & quoted form of sourcePlist & " " & quoted form of installedPlist & " && chmod 644 " & quoted form of installedPlist
end ensureAgentInstalled

on startService()
	if frontendRunning() and backendRunning() then return true
	my ensureAgentInstalled()
	if not serviceLoaded() then
		try
			do shell script "launchctl bootstrap gui/$(id -u) " & quoted form of installedPlist
		on error
			-- 已加载等非致命情况交给 kickstart 处理。
		end try
	end if
	try
		do shell script "launchctl kickstart -k gui/$(id -u)/" & serviceLabel
	on error errorMessage
		display dialog ("启动失败：" & errorMessage & return & return & "请查看日志：" & logDir) with title "TwitCanva工作台" buttons {"好"} default button "好"
		return false
	end try
	repeat 30 times
		delay 0.5
		if frontendRunning() and backendRunning() then return true
	end repeat
	return false
end startService

on stopService()
	if serviceLoaded() then
		try
			do shell script "launchctl bootout gui/$(id -u)/" & serviceLabel
		on error
			try
				do shell script "launchctl bootout gui/$(id -u) " & quoted form of installedPlist
			end try
		end try
	end if
	-- 兼容从终端手动启动的实例，只清理本项目固定端口的监听进程。
	do shell script "for port in 5173 3001; do for pid in $(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do kill $pid 2>/dev/null || true; done; done"
	delay 1
	return not (frontendRunning() or backendRunning())
end stopService

on openCanvas()
	if not (frontendRunning() and backendRunning()) then
		set ok to startService()
		if not ok then
			display dialog ("服务未能在15秒内完全启动。" & return & "请打开日志查看原因：" & logDir) with title "TwitCanva工作台" buttons {"打开日志", "好"} default button "好"
			if button returned of result is "打开日志" then do shell script "open " & quoted form of logDir
			return
		end if
	end if
	do shell script "open " & quoted form of canvasURL
end openCanvas

on showStatus()
	if frontendRunning() then
		set frontStatus to "正常 · localhost:5173"
	else
		set frontStatus to "未运行"
	end if
	if backendRunning() then
		set backStatus to "正常 · localhost:3001"
	else
		set backStatus to "未运行"
	end if
	if serviceLoaded() then
		set agentStatus to "已加载"
	else
		set agentStatus to "未加载"
	end if
	display dialog ("前端：" & frontStatus & return & "后端：" & backStatus & return & "服务托管：" & agentStatus & return & return & "项目：" & projectPath) with title "TwitCanva工作台 · 状态" buttons {"打开画布", "好"} default button "好"
	if button returned of result is "打开画布" then my openCanvas()
end showStatus

on run
	repeat
		if frontendRunning() and backendRunning() then
			set statusLine to "● 运行中"
		else
			set statusLine to "○ 已停止"
		end if
		set optionsList to {"打开画布", "启动服务", "停止服务", "重启服务", "查看状态", "打开日志", "打开项目文件夹", "退出"}
		set selectedItem to choose from list optionsList with title ("TwitCanva工作台  " & statusLine) with prompt ("当前状态：" & statusLine & return & return & "请选择操作：") default items {"打开画布"} without empty selection allowed
		if selectedItem is false then return
		set actionName to item 1 of selectedItem

		if actionName is "打开画布" then
			my openCanvas()
			return
		else if actionName is "启动服务" then
			if startService() then
				display notification "服务已启动" with title "TwitCanva工作台"
			else
				display notification "启动未完成，请查看日志" with title "TwitCanva工作台"
			end if
		else if actionName is "停止服务" then
			if stopService() then
				display notification "服务已停止" with title "TwitCanva工作台"
			else
				display notification "部分进程仍在运行，请查看状态" with title "TwitCanva工作台"
			end if
		else if actionName is "重启服务" then
			my stopService()
			if startService() then
				display notification "服务已重启" with title "TwitCanva工作台"
			else
				display notification "重启未完成，请查看日志" with title "TwitCanva工作台"
			end if
		else if actionName is "查看状态" then
			my showStatus()
		else if actionName is "打开日志" then
			do shell script "mkdir -p " & quoted form of logDir & " && open " & quoted form of logDir
		else if actionName is "打开项目文件夹" then
			do shell script "open " & quoted form of projectPath
		else if actionName is "退出" then
			return
		end if
	end repeat
end run
