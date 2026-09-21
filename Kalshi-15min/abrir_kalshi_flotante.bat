@echo off
rem Abre la ventana flotante de Kalshi (cripto 15 min).
rem pythonw = sin ventana negra de consola. Los errores quedan en kalshi_flotante.log
cd /d "%~dp0"

rem Este .bat necesita sus tres archivos al lado. Si lo copiaste solo al
rem Escritorio, mejor crea un acceso directo (clic derecho -> Enviar a -> Escritorio).
if not exist "%~dp0kalshi_flotante.py" goto :faltan
if not exist "%~dp0server.py" goto :faltan
if not exist "%~dp0indicators.py" goto :faltan

where pythonw >nul 2>nul
if not errorlevel 1 (
    start "" pythonw "%~dp0kalshi_flotante.py" %*
    exit /b 0
)

where python >nul 2>nul
if not errorlevel 1 (
    start "" /min python "%~dp0kalshi_flotante.py" %*
    exit /b 0
)

echo No se encontro Python en el PATH.
echo Instalalo desde https://www.python.org/downloads/ y marca "Add python.exe to PATH".
pause
exit /b 1

:faltan
echo Faltan archivos junto a este .bat. Deben estar en la misma carpeta:
echo     kalshi_flotante.py
echo     server.py
echo     indicators.py
echo.
echo Si quieres abrirlo desde el Escritorio, crea un ACCESO DIRECTO a este .bat
echo en vez de copiarlo.
pause
exit /b 1
