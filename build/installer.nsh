!macro customInit
  ClearErrors
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${EndIf}
  ${If} $0 == ""
    ${If} ${FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
      StrCpy $0 "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    ${ElseIf} ${FileExists} "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
      StrCpy $0 "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
    ${ElseIf} ${FileExists} "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
      StrCpy $0 "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ${EndIf}
  ${EndIf}
  ${If} $0 == ""
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "Evan 需要 Google Chrome 才能运行。是否现在打开 Chrome 官方下载页？安装完成后请重新运行本安装程序。" \
      IDNO evan_chrome_missing
    ExecShell "open" "https://www.google.com/chrome/"
    evan_chrome_missing:
    Abort
  ${EndIf}
!macroend
