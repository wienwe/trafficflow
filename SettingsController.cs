using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TrafficFlow.API.Data;
using TrafficFlow.API.DTOs;
using TrafficFlow.API.Models;

namespace TrafficFlow.API.Controllers;

/// <summary>
/// GET  /api/settings/algorithms — получить настройки алгоритмов
/// PUT  /api/settings/algorithms — обновить (admin only)
/// GET  /api/settings/system     — метрики сервера (admin only)
/// POST /api/settings/clear-temp — очистить temp (admin only)
/// </summary>
[ApiController, Route("api/[controller]"), Authorize]
public class SettingsController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    [HttpGet("algorithms")]
    public async Task<IActionResult> GetAlgorithmSettings()
    {
        var s = await db.AlgorithmSettings.FirstOrDefaultAsync() ?? new AlgorithmSettings();
        return Ok(new AlgorithmSettingsDto(s.Confidence, s.Iou, s.TtcThreshold, s.DistThreshold, s.MinTrackLength, s.MaxMissedFrames, s.UseGpu));
    }

    [HttpPut("algorithms"), Authorize(Roles = "admin")]
    public async Task<IActionResult> UpdateAlgorithmSettings([FromBody] AlgorithmSettingsDto dto)
    {
        var s = await db.AlgorithmSettings.FirstOrDefaultAsync();
        if (s == null) { s = new AlgorithmSettings(); db.AlgorithmSettings.Add(s); }

        s.Confidence      = dto.Confidence;
        s.Iou             = dto.Iou;
        s.TtcThreshold    = dto.TtcThreshold;
        s.DistThreshold   = dto.DistThreshold;
        s.MinTrackLength  = dto.MinTrackLength;
        s.MaxMissedFrames = dto.MaxMissedFrames;
        s.UseGpu          = dto.UseGpu;
        s.UpdatedAt       = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return Ok(dto);
    }

    [HttpGet("system"), Authorize(Roles = "admin")]
    public IActionResult GetSystemMetrics()
    {
        // In production: use PerformanceCounter / /proc/meminfo / WMI
        var rng = new Random();
        return Ok(new SystemMetricsDto(
            CpuPercent    : 20 + rng.NextDouble() * 60,
            RamPercent    : 45 + rng.NextDouble() * 30,
            DiskPercent   : 30 + rng.NextDouble() * 20,
            RamUsedGb     : 8.2  + rng.NextDouble() * 3,
            RamTotalGb    : 16,
            DiskUsedGb    : 180  + rng.NextDouble() * 40,
            DiskTotalGb   : 500,
            ActiveTasks   : rng.Next(0, 4),
            QueuedTasks   : rng.Next(0, 6),
            ServerVersion : "TrafficFlow v2.0 / ASP.NET Core 8"));
    }

    [HttpPost("clear-temp"), Authorize(Roles = "admin")]
    public IActionResult ClearTemp()
    {
        var tempDir = Path.Combine(env.ContentRootPath, "temp");
        if (Directory.Exists(tempDir))
        {
            var files = Directory.GetFiles(tempDir);
            foreach (var f in files) System.IO.File.Delete(f);
            return Ok(new { message = $"Очищено файлов: {files.Length}" });
        }
        return Ok(new { message = "Temp-директория пуста" });
    }
}
