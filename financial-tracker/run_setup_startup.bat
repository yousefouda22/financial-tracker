@echo off
chcp 65001 > NUL
echo جاري تفعيل التشغيل التلقائي للسيرفر والبوت مع بدء تشغيل الويندوز...
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_PATH=%~dp0start_background.vbs

echo Set oWS = WScript.CreateObject("WScript.Shell") > CreateShortcut.vbs
echo sLinkFile = "%STARTUP_FOLDER%\FinancialTrackerServer.lnk" >> CreateShortcut.vbs
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> CreateShortcut.vbs
echo oLink.TargetPath = "wscript.exe" >> CreateShortcut.vbs
echo oLink.Arguments = """%VBS_PATH%""" >> CreateShortcut.vbs
echo oLink.WorkingDirectory = "%~dp0" >> CreateShortcut.vbs
echo oLink.Save >> CreateShortcut.vbs
cscript //nologo CreateShortcut.vbs
del CreateShortcut.vbs

echo.
echo ✅ تم تفعيل التشغيل التلقائي بنجاح! سيعمل السيرفر والبوت صامتاً في الخلفية مع كل تشغيل للويندوز.
pause
