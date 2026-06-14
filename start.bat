@echo off
title TrafficFlow
echo Starting Backend...
cd backend\TrafficFlow.API
start cmd /k "dotnet run"
cd ..\..
timeout /t 5
cd frontend
start cmd /k "live-server --port=5500"
cd ..
echo Done!
