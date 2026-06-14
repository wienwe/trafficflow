namespace TrafficFlow.API.DTOs;

public record VideoListItem(
    int Id,
    string Name,
    string Duration,
    string Size,
    string Status,
    string Date,
    int Fps,
    int TotalFrames,
    VideoStatsDto Stats);

public record DetectionBoxDto(
    int TrackId,
    string Class,
    float X,
    float Y,
    float Width,
    float Height,
    string Status);

public record VideoStatsDto(
    int Pedestrians,
    int Cars,
    int Conflicts,
    int Critical);

public record ZoneDto(
    int? Id,
    string Name,
    string Color,
    List<PointDto> Points);

public record PointDto(double X, double Y);

public record SaveZonesRequest(List<ZoneDto> Zones);

public record ProcessingProgressDto(
    int VideoId,
    int ProgressPct,
    int CurrentFrame,
    int TotalFrames,
    string Stage,
    double Fps,
    int Pedestrians,
    int Cars,
    int Conflicts,
    int Critical,
    bool IsCompleted);

public record DashboardDto(
    VideoListItem Video,
    List<ConflictEventDto> Events,
    List<IntensityPointDto> IntensityData,
    List<ConflictBarDto> ConflictBars,
    List<HeatmapPointDto> HeatmapPoints);

public record ConflictEventDto(
    int Id,
    int FrameNumber,
    string TimeFormatted,
    string Type,
    string Severity,
    int PedestrianTrackId,
    int CarTrackId,
    string Distance,
    string Ttc);

public record IntensityPointDto(string Label, int Pedestrians, int Cars);

public record ConflictBarDto(string Label, int Warnings, int Conflicts);

public record HeatmapPointDto(double X, double Y, double Intensity);
