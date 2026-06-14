namespace TrafficFlow.API.DTOs;

public record AlgorithmSettingsDto(
    float Confidence,
    float Iou,
    float TtcThreshold,
    float DistThreshold,
    int MinTrackLength,
    int MaxMissedFrames,
    bool UseGpu);

public record SystemMetricsDto(
    double CpuPercent,
    double RamPercent,
    double DiskPercent,
    double RamUsedGb,
    double RamTotalGb,
    double DiskUsedGb,
    double DiskTotalGb,
    int ActiveTasks,
    int QueuedTasks,
    string ServerVersion);
