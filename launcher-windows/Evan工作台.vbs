' ============================================================
'  Evan Workbench - Windows launcher (no console window)
'
'  IMPORTANT: This file MUST stay pure ASCII.
'  wscript.exe reads .vbs using the system ANSI codepage (GBK on
'  Chinese Windows), NOT UTF-8. Any UTF-8 Chinese character here gets
'  mis-decoded and breaks string literals with a confusing
'  "unterminated string constant" error. All user-facing Chinese text
'  lives in the Node GUI (scripts/launcher-gui.mjs) instead.
'
'  Usage: right-click this file -> Send to -> Desktop (create shortcut).
'  Do NOT copy this file elsewhere; it locates the project by its own path.
' ============================================================

Option Explicit

Dim fso, shell, hereDir, projectDir, cmdLine
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

hereDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(hereDir)

If Not fso.FileExists(fso.BuildPath(projectDir, "package.json")) Then
    MsgBox "package.json not found." & vbCrLf & vbCrLf & _
           "Looked in: " & projectDir & vbCrLf & vbCrLf & _
           "Keep this file inside the project's launcher-windows folder." & vbCrLf & _
           "To put it on the Desktop, use 'Send to -> Desktop (create shortcut)'," & vbCrLf & _
           "do not copy the file itself.", vbCritical, "Evan Workbench"
    WScript.Quit 1
End If

' Hidden window (0) so no console flashes. Node prints nothing useful here
' anyway - the GUI panel reports all errors.
cmdLine = "cmd /c cd /d """ & projectDir & """ && node scripts\launcher-gui.mjs"

On Error Resume Next
shell.Run cmdLine, 0, False
If Err.Number <> 0 Then
    MsgBox "Failed to start: " & Err.Description & vbCrLf & vbCrLf & _
           "Make sure Node.js 22+ is installed (https://nodejs.org/)." & vbCrLf & _
           "For detailed errors, double-click the .bat file in this folder.", _
           vbCritical, "Evan Workbench"
    WScript.Quit 1
End If
