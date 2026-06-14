




-- Схема применяется к уже созданной БД trafficflow (см. database/init.sql и docker-compose.yml)

CREATE TABLE IF NOT EXISTS "Users" (
    "Id" SERIAL PRIMARY KEY,
    "Username" VARCHAR(50) UNIQUE NOT NULL,
    "PasswordHash" VARCHAR(255) NOT NULL,
    "FullName" VARCHAR(100) NOT NULL,
    "Email" VARCHAR(100) UNIQUE NOT NULL,
    "Role" VARCHAR(20) DEFAULT 'analyst' CHECK ("Role" IN ('analyst', 'admin')),
    "IsActive" BOOLEAN DEFAULT TRUE,
    "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "LastLoginAt" TIMESTAMP,
    "AvatarUrl" TEXT
);

CREATE INDEX idx_users_username ON "Users"("Username");
CREATE INDEX idx_users_email ON "Users"("Email");
CREATE INDEX idx_users_role ON "Users"("Role");
CREATE INDEX idx_users_active ON "Users"("IsActive");

CREATE TABLE IF NOT EXISTS "Videos" (
    "Id" SERIAL PRIMARY KEY,
    "Name" VARCHAR(255) NOT NULL,
    "FilePath" TEXT NOT NULL,
    "FileSizeBytes" BIGINT NOT NULL,
    "Duration" VARCHAR(20) DEFAULT '00:00:00',
    "Fps" INT DEFAULT 30,
    "Width" INT,
    "Height" INT,
    "Status" VARCHAR(20) DEFAULT 'Queued' CHECK ("Status" IN ('Queued', 'Processing', 'Done', 'Error')),
    "UploadedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "ProcessedAt" TIMESTAMP,
    "OwnerId" INT NOT NULL REFERENCES "Users"("Id") ON DELETE CASCADE,
    "TotalPedestrians" INT DEFAULT 0,
    "TotalCars" INT DEFAULT 0,
    "TotalTrucks" INT DEFAULT 0,
    "TotalBicycles" INT DEFAULT 0,
    "TotalMotorcycles" INT DEFAULT 0,
    "TotalConflicts" INT DEFAULT 0,
    "CriticalConflicts" INT DEFAULT 0,
    "WarningConflicts" INT DEFAULT 0,
    "Description" TEXT,
    "Tags" TEXT[],
    "Location" TEXT,
    "Weather" VARCHAR(50),
    "LightCondition" VARCHAR(50),
    "IsDeleted" BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_videos_owner ON "Videos"("OwnerId");
CREATE INDEX idx_videos_status ON "Videos"("Status");
CREATE INDEX idx_videos_uploaded ON "Videos"("UploadedAt");
CREATE INDEX idx_videos_name ON "Videos" USING GIN (to_tsvector('russian', "Name"));
CREATE INDEX idx_videos_tags ON "Videos" USING GIN ("Tags");
CREATE INDEX idx_videos_location ON "Videos"("Location");

CREATE TABLE IF NOT EXISTS "Zones" (
    "Id" SERIAL PRIMARY KEY,
    "Name" VARCHAR(100) NOT NULL,
    "Color" VARCHAR(20) DEFAULT '#2563eb',
    "PointsJson" TEXT DEFAULT '[]',
    "Type" VARCHAR(30) DEFAULT 'polygon' CHECK ("Type" IN ('polygon', 'line', 'circle')),
    "Radius" FLOAT,
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_zones_video ON "Zones"("VideoId");

CREATE TABLE IF NOT EXISTS "Detections" (
    "Id" BIGSERIAL PRIMARY KEY,
    "FrameNumber" INT NOT NULL,
    "TimeSeconds" DOUBLE PRECISION NOT NULL,
    "Class" VARCHAR(20) NOT NULL CHECK ("Class" IN ('Pedestrian', 'Car', 'Truck', 'Bicycle', 'Motorcycle')),
    "Confidence" FLOAT NOT NULL,
    "X" FLOAT NOT NULL,
    "Y" FLOAT NOT NULL,
    "Width" FLOAT NOT NULL,
    "Height" FLOAT NOT NULL,
    "TrackId" INT,
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "VelocityX" FLOAT,
    "VelocityY" FLOAT,
    "Acceleration" FLOAT,
    "Heading" FLOAT
);

CREATE INDEX idx_detections_video_frame ON "Detections"("VideoId", "FrameNumber");
CREATE INDEX idx_detections_track ON "Detections"("VideoId", "TrackId");
CREATE INDEX idx_detections_class ON "Detections"("Class");
CREATE INDEX idx_detections_time ON "Detections"("VideoId", "TimeSeconds");

CREATE TABLE IF NOT EXISTS "Tracks" (
    "Id" SERIAL PRIMARY KEY,
    "TrackId" INT NOT NULL,
    "Class" VARCHAR(20) NOT NULL,
    "StartFrame" INT NOT NULL,
    "EndFrame" INT NOT NULL,
    "Length" INT NOT NULL,
    "Status" VARCHAR(20) DEFAULT 'normal' CHECK ("Status" IN ('normal', 'warning', 'conflict', 'critical')),
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "AvgConfidence" FLOAT,
    "MaxConfidence" FLOAT,
    "TotalDistance" FLOAT,
    "AvgSpeed" FLOAT,
    "MaxSpeed" FLOAT,
    "EntryZone" VARCHAR(100),
    "ExitZone" VARCHAR(100),
    "StartTime" DOUBLE PRECISION,
    "EndTime" DOUBLE PRECISION
);

CREATE UNIQUE INDEX idx_tracks_video_track ON "Tracks"("VideoId", "TrackId");
CREATE INDEX idx_tracks_class ON "Tracks"("Class");
CREATE INDEX idx_tracks_status ON "Tracks"("Status");

CREATE TABLE IF NOT EXISTS "ConflictEvents" (
    "Id" SERIAL PRIMARY KEY,
    "FrameNumber" INT NOT NULL,
    "TimeSeconds" DOUBLE PRECISION NOT NULL,
    "TimeFormatted" VARCHAR(20) NOT NULL,
    "PedestrianTrackId" INT NOT NULL,
    "CarTrackId" INT NOT NULL,
    "Distance" FLOAT NOT NULL,
    "TimeToCollision" FLOAT NOT NULL,
    "Severity" VARCHAR(20) NOT NULL CHECK ("Severity" IN ('Warning', 'Conflict', 'Critical')),
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "PedestrianX" FLOAT,
    "PedestrianY" FLOAT,
    "CarX" FLOAT,
    "CarY" FLOAT,
    "RelativeVelocity" FLOAT,
    "Angle" FLOAT,
    "IsResolved" BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_conflicts_video_frame ON "ConflictEvents"("VideoId", "FrameNumber");
CREATE INDEX idx_conflicts_severity ON "ConflictEvents"("Severity");
CREATE INDEX idx_conflicts_time ON "ConflictEvents"("VideoId", "TimeSeconds");

CREATE TABLE IF NOT EXISTS "AlgorithmSettings" (
    "Id" SERIAL PRIMARY KEY,
    "Confidence" FLOAT DEFAULT 0.45,
    "Iou" FLOAT DEFAULT 0.5,
    "TtcThreshold" FLOAT DEFAULT 3.0,
    "DistThreshold" FLOAT DEFAULT 2.5,
    "MinTrackLength" INT DEFAULT 8,
    "MaxMissedFrames" INT DEFAULT 15,
    "UseGpu" BOOLEAN DEFAULT FALSE,
    "ModelPath" VARCHAR(255),
    "BatchSize" INT DEFAULT 1,
    "UpdatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "UpdatedBy" INT REFERENCES "Users"("Id")
);

CREATE TABLE IF NOT EXISTS "ProcessingLogs" (
    "Id" BIGSERIAL PRIMARY KEY,
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "Stage" VARCHAR(50) NOT NULL,
    "ProgressPct" INT,
    "FrameProcessed" INT,
    "Fps" FLOAT,
    "Message" TEXT,
    "IsError" BOOLEAN DEFAULT FALSE,
    "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_logs_video ON "ProcessingLogs"("VideoId");
CREATE INDEX idx_logs_created ON "ProcessingLogs"("CreatedAt");

CREATE TABLE IF NOT EXISTS "Reports" (
    "Id" SERIAL PRIMARY KEY,
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "UserId" INT NOT NULL REFERENCES "Users"("Id"),
    "ReportType" VARCHAR(20) CHECK ("ReportType" IN ('pdf', 'excel', 'json')),
    "FilePath" TEXT,
    "FileSize" BIGINT,
    "GeneratedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "Parameters" JSONB
);

CREATE INDEX idx_reports_video ON "Reports"("VideoId");
CREATE INDEX idx_reports_user ON "Reports"("UserId");

CREATE TABLE IF NOT EXISTS "UserSessions" (
    "Id" BIGSERIAL PRIMARY KEY,
    "UserId" INT NOT NULL REFERENCES "Users"("Id") ON DELETE CASCADE,
    "Token" TEXT,
    "IpAddress" INET,
    "UserAgent" TEXT,
    "StartedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "EndedAt" TIMESTAMP,
    "IsActive" BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_sessions_user ON "UserSessions"("UserId");
CREATE INDEX idx_sessions_active ON "UserSessions"("IsActive");

CREATE TABLE IF NOT EXISTS "Heatmaps" (
    "Id" SERIAL PRIMARY KEY,
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "LayerName" VARCHAR(50) NOT NULL,
    "Data" JSONB NOT NULL,
    "CreatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "UpdatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_heatmaps_video_layer ON "Heatmaps"("VideoId", "LayerName");

CREATE TABLE IF NOT EXISTS "TimeSeriesStats" (
    "Id" BIGSERIAL PRIMARY KEY,
    "VideoId" INT NOT NULL REFERENCES "Videos"("Id") ON DELETE CASCADE,
    "TimeBucket" TIMESTAMP NOT NULL,
    "IntervalSeconds" INT DEFAULT 60,
    "PedestrianCount" INT DEFAULT 0,
    "CarCount" INT DEFAULT 0,
    "TruckCount" INT DEFAULT 0,
    "BicycleCount" INT DEFAULT 0,
    "MotorcycleCount" INT DEFAULT 0,
    "ConflictCount" INT DEFAULT 0,
    "AvgSpeed" FLOAT
);

CREATE INDEX idx_timeseries_video_time ON "TimeSeriesStats"("VideoId", "TimeBucket");

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."UpdatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_heatmaps_updatedat 
    BEFORE UPDATE ON "Heatmaps" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION update_video_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "Videos" 
    SET 
        "TotalPedestrians" = (SELECT COUNT(*) FROM "Detections" WHERE "VideoId" = NEW."VideoId" AND "Class" = 'Pedestrian'),
        "TotalCars" = (SELECT COUNT(*) FROM "Detections" WHERE "VideoId" = NEW."VideoId" AND "Class" = 'Car')
    WHERE "Id" = NEW."VideoId";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stats
    AFTER INSERT ON "Detections"
    FOR EACH ROW
    EXECUTE FUNCTION update_video_stats();

INSERT INTO "Users" ("Username", "PasswordHash", "FullName", "Email", "Role", "IsActive") VALUES
('admin', '$2a$11$K8Q8X8Q8X8Q8X8Q8X8Q8X8O8X8Q8X8Q8X8Q8X8Q8', 'Системный Администратор', 'admin@trafficflow.local', 'admin', true),
('analyst', '$2a$11$K8Q8X8Q8X8Q8X8Q8X8Q8X8O8X8Q8X8Q8X8Q8X8Q8', 'Транспортный Аналитик', 'analyst@trafficflow.local', 'analyst', true),
('engineer', '$2a$11$K8Q8X8Q8X8Q8X8Q8X8Q8X8O8X8Q8X8Q8X8Q8X8Q8', 'Инженер рабочий', 'engineer@trafficflow.local', 'analyst', true);

INSERT INTO "AlgorithmSettings" ("Id", "Confidence", "Iou", "TtcThreshold", "DistThreshold", "MinTrackLength", "MaxMissedFrames", "UseGpu", "UpdatedAt") VALUES
(1, 0.45, 0.5, 3.0, 2.5, 8, 15, false, CURRENT_TIMESTAMP);

INSERT INTO "Videos" ("Id", "Name", "FilePath", "FileSizeBytes", "Duration", "Fps", "Status", "OwnerId", "TotalPedestrians", "TotalCars", "TotalConflicts", "CriticalConflicts", "Location", "Weather", "LightCondition") VALUES
(1, 'Перекрёсток ул. Ленина и пр. Мира', '/uploads/video1.mp4', 883123456, '00:18:32', 30, 'Done', 2, 412, 198, 27, 8, 'г. Москва, ул. Ленина', 'Ясно', 'День'),
(2, 'ул. Гагарина — ул. Садовая', '/uploads/video2.mp4', 1156789123, '00:22:15', 25, 'Done', 2, 318, 244, 14, 3, 'г. Москва, ул. Гагарина', 'Облачно', 'День'),
(3, 'Светофор Центральная площадь', '/uploads/video3.mp4', 409876543, '00:09:48', 30, 'Processing', 2, 0, 0, 0, 0, 'г. Москва, Центральная пл.', 'Дождь', 'Вечер');

INSERT INTO "Zones" ("Name", "Color", "PointsJson", "VideoId") VALUES
('Пешеходный переход', '#2563eb', '[{"x":0.35,"y":0.48},{"x":0.65,"y":0.48},{"x":0.65,"y":0.52},{"x":0.35,"y":0.52}]', 1),
('Перекрёсток', '#ef4444', '[{"x":0.45,"y":0.45},{"x":0.55,"y":0.45},{"x":0.55,"y":0.55},{"x":0.45,"y":0.55}]', 1),
('Остановка', '#22c55e', '[{"x":0.15,"y":0.70},{"x":0.25,"y":0.70},{"x":0.25,"y":0.80},{"x":0.15,"y":0.80}]', 1);

INSERT INTO "ConflictEvents" ("FrameNumber", "TimeSeconds", "TimeFormatted", "PedestrianTrackId", "CarTrackId", "Distance", "TimeToCollision", "Severity", "VideoId") VALUES
(3960, 132.0, '00:02:14', 101, 1001, 1.2, 2.1, 'Conflict', 1),
(8310, 277.0, '00:04:37', 102, 1002, 2.8, 4.3, 'Warning', 1),
(10860, 362.0, '00:06:02', 103, 1003, 0.9, 1.7, 'Critical', 1),
(15750, 525.0, '00:08:45', 104, 1004, 0.4, 0.8, 'Critical', 1),
(20340, 678.0, '00:11:18', 105, 1005, 3.1, 5.2, 'Warning', 1),
(23490, 783.0, '00:13:05', 106, 1006, 1.5, 2.8, 'Conflict', 1),
(27900, 930.0, '00:15:30', 107, 1007, 0.6, 1.2, 'Critical', 1),
(30960, 1032.0, '00:17:12', 108, 1008, 2.3, 3.9, 'Warning', 1);

INSERT INTO "Tracks" ("TrackId", "Class", "StartFrame", "EndFrame", "Length", "Status", "VideoId", "AvgSpeed") VALUES
(101, 'Pedestrian', 100, 450, 351, 'warning', 1, 1.2),
(102, 'Pedestrian', 200, 600, 401, 'normal', 1, 1.4),
(103, 'Pedestrian', 300, 700, 401, 'critical', 1, 1.1),
(1001, 'Car', 50, 800, 751, 'warning', 1, 12.5),
(1002, 'Car', 150, 750, 601, 'normal', 1, 14.2),
(1003, 'Car', 250, 900, 651, 'critical', 1, 11.8);

CREATE OR REPLACE VIEW "VideoSummary" AS
SELECT 
    v."Id",
    v."Name",
    u."FullName" as "OwnerName",
    v."Duration",
    v."Fps",
    v."Status",
    v."UploadedAt",
    v."TotalPedestrians",
    v."TotalCars",
    v."TotalConflicts",
    v."CriticalConflicts",
    (SELECT COUNT(*) FROM "Zones" z WHERE z."VideoId" = v."Id") as "ZoneCount",
    (v."TotalConflicts"::FLOAT / NULLIF(v."TotalCars" + v."TotalPedestrians", 0) * 100) as "ConflictRate"
FROM "Videos" v
JOIN "Users" u ON v."OwnerId" = u."Id"
WHERE v."IsDeleted" = FALSE;

CREATE OR REPLACE VIEW "ConflictsByHour" AS
SELECT 
    "VideoId",
    DATE_TRUNC('hour', "TimeBucket") as "Hour",
    SUM("ConflictCount") as "Conflicts"
FROM "TimeSeriesStats"
GROUP BY "VideoId", DATE_TRUNC('hour', "TimeBucket");

CREATE OR REPLACE PROCEDURE archive_old_videos(days_old INT)
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE "Videos" 
    SET "IsDeleted" = TRUE
    WHERE "UploadedAt" < NOW() - (days_old || ' days')::INTERVAL
    AND "Status" = 'Done';
    
    RAISE NOTICE 'Archived % videos older than % days', 
        (SELECT COUNT(*) FROM "Videos" WHERE "IsDeleted" = TRUE AND "UploadedAt" < NOW() - (days_old || ' days')::INTERVAL),
        days_old;
END;
$$;

CREATE OR REPLACE PROCEDURE cleanup_old_logs(days_to_keep INT DEFAULT 30)
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM "ProcessingLogs" 
    WHERE "CreatedAt" < NOW() - (days_to_keep || ' days')::INTERVAL;
    
    RAISE NOTICE 'Cleaned up processing logs older than % days', days_to_keep;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD 'trafficflow123';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_admin') THEN
        CREATE ROLE app_admin WITH LOGIN PASSWORD 'admin456';
    END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin;

SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

SELECT 
    'Users' as "Table", COUNT(*) as "Count" FROM "Users"
UNION ALL
SELECT 'Videos', COUNT(*) FROM "Videos"
UNION ALL
SELECT 'Zones', COUNT(*) FROM "Zones"
UNION ALL
SELECT 'Detections', COUNT(*) FROM "Detections"
UNION ALL
SELECT 'Tracks', COUNT(*) FROM "Tracks"
UNION ALL
SELECT 'ConflictEvents', COUNT(*) FROM "ConflictEvents";


TRUNCATE TABLE "Users" RESTART IDENTITY CASCADE;
SELECT * FROM "Users";
SELECT COUNT(*) FROM "Users";