' ============================================================
'  Evan 工作台 —— Windows 双击入口（无黑框）
'
'  .bat 双击时一定会带出一个 cmd 黑框。VBScript 由 wscript.exe
'  执行，Run 的第 2 个参数传 0 表示"隐藏窗口"，因此全程无控制台。
'
'  它只负责静默调起 scripts\launcher-gui.mjs，后者会弹出图形控制面板。
'
'  用法：右键本文件 → 发送到 → 桌面快捷方式，以后双击那个快捷方式。
'  （不要直接复制本文件到别处，它靠自身位置定位项目根目录。）
' ============================================================

Option Explicit

Dim fso, shell, hereDir, projectDir, nodeExe, cmdLine
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' 本文件所在目录的上一级 = 项目根目录
hereDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(hereDir)

If Not fso.FileExists(fso.BuildPath(projectDir, "package.json")) Then
    MsgBox "找不到 package.json。" & vbCrLf & vbCrLf & _
           "当前推断的项目目录：" & vbCrLf & projectDir & vbCrLf & vbCrLf & _
           "请确认本文件仍在项目的 launcher-windows\ 目录下。" & vbCrLf & _
           "如果想放到桌面，请用「发送到 → 桌面快捷方式」，不要直接复制文件。", _
           vbCritical, "Evan 工作台"
    WScript.Quit 1
End If

If Not fso.FolderExists(fso.BuildPath(projectDir, "node_modules")) Then
    MsgBox "还没有安装依赖（node_modules 不存在）。" & vbCrLf & vbCrLf & _
           "请先在项目目录执行一次：" & vbCrLf & vbCrLf & "    npm install" & vbCrLf & vbCrLf & _
           "这一步会下载 Remotion 的 Chromium，需要 5-15 分钟。" & vbCrLf & _
           "装完再双击本文件。", vbExclamation, "Evan 工作台"
    WScript.Quit 1
End If

' 用 cmd /c 调 node，这样能走 PATH 找到 node；窗口模式 0 = 完全隐藏
cmdLine = "cmd /c cd /d """ & projectDir & """ && node scripts\launcher-gui.mjs"

On Error Resume Next
shell.Run cmdLine, 0, False
If Err.Number <> 0 Then
    MsgBox "启动失败：" & Err.Description & vbCrLf & vbCrLf & _
           "请确认已安装 Node.js 22+（https://nodejs.org/）。" & vbCrLf & _
           "若要查看详细报错，改为双击同目录下的 Evan工作台.bat。", _
           vbCritical, "Evan 工作台"
    WScript.Quit 1
End If
