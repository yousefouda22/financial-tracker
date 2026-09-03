Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & WshShell.CurrentDirectory & "\server.js""", 0, False
