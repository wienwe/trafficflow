# TrafficFlow Analytics 🚦

Полноценное веб-приложение для анализа дорожной обстановки на перекрёстках.

---

## Стек технологий

| Слой       | Технология                    |
|------------|-------------------------------|
| Фронтенд   | Vanilla JS ES6+, Canvas API   |
| Бэкенд     | ASP.NET Core 8, C#            |
| База данных | PostgreSQL 15+               |
| ORM        | Entity Framework Core 8       |
| Авторизация | JWT Bearer Tokens            |
| Real-time  | SignalR (WebSocket)           |
| Детекция   | YOLO (OpenCvSharp + ONNX)     |
| Трекинг    | ByteTrack (симуляция)         |
| PDF        | iText 7                       |
| Excel      | ClosedXML                     |

---

## Структура проекта

```
trafficflow/
├── frontend/
│   ├── index.html          # Точка входа SPA
│   ├── style.css           # Глобальные стили (Dark theme)
│   └── app.js              # SPA-роутер + все страницы
│
└── backend/
    └── TrafficFlow.API/
        ├── Controllers/
        │   ├── AuthController.cs      # POST /api/auth/login, /register, GET /me
        │   ├── UsersController.cs     # CRUD пользователей (admin only)
        │   ├── VideosController.cs    # Загрузка, зоны, обработка, дашборд, экспорт
        │   └── SettingsController.cs  # Настройки алгоритмов, метрики системы
        ├── Data/
        │   └── AppDbContext.cs        # EF Core контекст + конфигурация
        ├── DTOs/
        │   ├── AuthDtos.cs
        │   ├── VideoDtos.cs
        │   └── SettingsDtos.cs
        ├── Hubs/
        │   └── ProcessingHub.cs       # SignalR хаб для прогресса обработки
        ├── Migrations/
        │   └── 20250614000001_InitialCreate.cs
        ├── Models/
        │   ├── AppUser.cs
        │   ├── VideoRecord.cs
        │   ├── Zone.cs
        │   ├── Detection.cs
        │   ├── Track.cs
        │   ├── ConflictEvent.cs
        │   └── AlgorithmSettings.cs
        ├── Services/
        │   ├── JwtService.cs              # Генерация JWT токенов
        │   ├── VideoProcessingService.cs  # Background worker: YOLO + ByteTrack
        │   └── ReportService.cs           # Генерация PDF и Excel отчётов
        ├── Program.cs                     # Конфигурация приложения
        ├── appsettings.json
        └── TrafficFlow.API.csproj
```

---

## Быстрый запуск

### 1. Требования
- .NET 8 SDK
- PostgreSQL 15+
- Node.js (опционально, для live-reload фронта)

### 2. База данных (файл `database/init.sql`, копия `бд.sql`)

**Вариант A — Docker (рекомендуется):**
```bash
docker compose up -d db
# При первом запуске автоматически применяется database/init.sql
```

**Вариант B — локальный PostgreSQL:**
```powershell
.\scripts\init-database.ps1
```

После загрузки SQL в `appsettings.Development.json` уже указано:
- `Database:ApplyEfMigrations` = `false` (схема из файла, не из EF)
- `Database:InitializedFromScript` = `true` (исправление паролей демо-пользователей)

Демо-логины из SQL-файла (пароли задаются при старте API):
| Логин    | Пароль       |
|----------|--------------|
| admin    | admin123     |
| analyst  | analyst123   |
| engineer | engineer123  |

### 3. Настройка подключения
Отредактируйте `backend/TrafficFlow.API/appsettings.json`:
```json
{
  "ConnectionStrings": {
    "Default": "Host=localhost;Port=5432;Database=trafficflow;Username=postgres;Password=ВАШ_ПАРОЛЬ"
  }
}
```

### 4. Запуск сервера
```bash
cd backend/TrafficFlow.API
dotnet run
# API доступно: http://localhost:5000
# Swagger UI:   http://localhost:5000/swagger
```

- С **Docker / init.sql**: миграции EF **отключены**, используется схема из `database/init.sql`.
- Без SQL-файла: миграции EF применяются **автоматически** (`Database:ApplyEfMigrations` = `true` в `appsettings.json`).

### 5. Фронтенд

**Вариант A** — через встроенный StaticFiles ASP.NET:
```bash
# Скопируйте frontend/* в backend/TrafficFlow.API/wwwroot/
cp -r frontend/* backend/TrafficFlow.API/wwwroot/
# Открыть: http://localhost:5000
```

**Вариант B** — VS Code Live Server или любой HTTP-сервер:
```bash
cd frontend
npx serve .
# Открыть: http://localhost:3000
```

---

## Demo-аккаунты (создаются при первом запуске)

| Логин    | Пароль     | Роль          |
|----------|------------|---------------|
| admin    | admin123   | Администратор |
| analyst  | analyst123 | Аналитик      |

---


## API Endpoints

### Авторизация
| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/auth/login` | Вход, получение JWT |
| POST | `/api/auth/signup` | Публичная регистрация (роль analyst) |
| POST | `/api/auth/register` | Создание пользователя (admin) |
| GET  | `/api/auth/me` | Текущий пользователь |

### Видео
| Метод | URL | Описание |
|-------|-----|----------|
| POST  | `/api/videos/upload` | Загрузить видеофайл |
| GET   | `/api/videos` | Список видео |
| GET   | `/api/videos/{id}` | Одно видео |
| POST  | `/api/videos/{id}/zones` | Сохранить зоны интереса |
| POST  | `/api/videos/{id}/process` | Запустить обработку |
| GET   | `/api/videos/{id}/dashboard` | Данные для дашборда |
| GET   | `/api/videos/{id}/export/pdf` | Скачать PDF-отчёт |
| GET   | `/api/videos/{id}/export/excel` | Скачать Excel-отчёт |
| DELETE| `/api/videos/{id}` | Удалить видео |

### Пользователи (admin)
| Метод | URL | Описание |
|-------|-----|----------|
| GET   | `/api/users` | Список пользователей |
| PUT   | `/api/users/{id}/role` | Сменить роль |
| PUT   | `/api/users/{id}/toggle-active` | Блокировка |
| DELETE| `/api/users/{id}` | Удалить |

### Настройки (admin)
| Метод | URL | Описание |
|-------|-----|----------|
| GET   | `/api/settings/algorithms` | Параметры алгоритмов |
| PUT   | `/api/settings/algorithms` | Обновить параметры |
| GET   | `/api/settings/system` | Метрики сервера |
| POST  | `/api/settings/clear-temp` | Очистить temp |

### SignalR
```
ws://localhost:5000/hubs/processing?access_token=JWT
// Подписка: SubscribeToVideo(videoId)
// Событие: ProgressUpdate
```

---

## Подключение реальной обработки (OpenCvSharp + YOLO)

В файле `VideoProcessingService.cs` замените секцию симуляции:

```csharp
// 1. Установить пакеты:
// dotnet add package OpenCvSharp4.runtime.win  (или linux/osx)
// dotnet add package OpenCvSharp4
// dotnet add package Microsoft.ML.OnnxRuntime

using OpenCvSharp;

// 2. Читать кадры реально:
using var cap = new VideoCapture(video.FilePath);
var totalFrames = (int)cap.Get(VideoCaptureProperties.FrameCount);
var fps = cap.Get(VideoCaptureProperties.Fps);

using var frame = new Mat();
int frameNum = 0;
while (cap.Read(frame) && !ct.IsCancellationRequested)
{
    // 3. Запустить YOLO inference (ONNX)
    var detections = YoloInference.Detect(frame, settings.Confidence, settings.Iou);
    
    // 4. ByteTrack update
    var tracks = byteTracker.Update(detections, frameNum);
    
    frameNum++;
}
```

---

## Схема базы данных

```
AppUser ──< VideoRecord ──< Zone
                        ──< Detection
                        ──< Track
                        ──< ConflictEvent
AlgorithmSettings (singleton)
```
