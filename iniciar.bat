@echo off
title Gestor de Repostería - Node.js
color 0A

echo ========================================
echo    🧁 Gestor de Repostería
echo    Iniciando servidor...
echo ========================================
echo.

cd /d "%~dp0"

REM Verificar si node está instalado
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js no está instalado!
    echo Por favor, instala Node.js desde https://nodejs.org/
    pause
    exit /b 1
)

REM Verificar si las dependencias están instaladas
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: No se pudieron instalar las dependencias
        pause
        exit /b 1
    )
)

echo.
echo ✅ Servidor listo!
echo Abriendo navegador en http://localhost:3000
echo.
echo Presiona Ctrl+C para detener el servidor
echo ========================================
echo.

REM Abrir navegador automáticamente
start http://localhost:3000

REM Iniciar el servidor
call npm start

pause
