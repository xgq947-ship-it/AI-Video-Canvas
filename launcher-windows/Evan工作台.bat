@echo off
chcp 65001 >nul
title Evan 工作台

rem ============================================================
rem  双击即可启动 / 管理 Evan 工作台（Windows）
rem
rem  本文件只做三件事：切到项目根目录、确认 Node 可用、把活交给
rem  scripts\launcher.mjs。真正的逻辑都在那个 Node 脚本里——
rem  一份代码三平台通用，也便于在 Mac 上测试。
rem
rem  可以把这个 .bat 发送到桌面快捷方式，之后双击就能用。
rem ============================================================

rem 切到本文件所在目录的上一级（= 项目根目录）
cd /d "%~dp0.."

if not exist "package.json" (
    echo.
    echo [错误] 没有找到 package.json
    echo        当前目录：%CD%
    echo        请确认这个 .bat 仍在项目的 launcher-windows\ 目录下，
    echo        不要把它单独复制到别处（可以创建快捷方式）。
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [错误] 找不到 Node.js
    echo        请先安装 Node 22 或更高版本：https://nodejs.org/
    echo        安装后请**新开**一个窗口再运行本文件。
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo.
    echo [提示] 还没有安装依赖，先执行 npm install
    echo        这一步会下载 Remotion 的 Chromium，可能需要 5-15 分钟。
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [错误] npm install 失败，请把上面的报错反馈给开发者。
        echo.
        pause
        exit /b 1
    )
)

node scripts\launcher.mjs
if errorlevel 1 pause
