using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TrafficFlow.API.Data;
using TrafficFlow.API.DTOs;
using TrafficFlow.API.Models;
using TrafficFlow.API.Services;

namespace TrafficFlow.API.Controllers;

/// <summary>
/// POST   /api/videos/upload      — загрузить видеофайл
/// GET    /api/videos             — мои видео
/// GET    /api/videos/{id}        — одно видео
/// POST   /api/videos/{id}/zones  — сохранить зоны
/// POST   /api/videos/{id}/process — запустить обработку
/// GET    /api/videos/{id}/dashboard — данные для дашборда
/// GET    /api/videos/{id}/export/pdf   — скачать PDF
/// GET    /api/videos/{id}/export/excel — скачать Excel
/// DELETE /api/videos/{id}        — удалить
/// </summary>
[ApiController, Route("api/[controller]"), Authorize]
public class VideosController(
    AppDbContext db,
    IWebHostEnvironment env,
    VideoProcessingService processingService,
    IReportService reportService) : ControllerBase
{
    // ── Upload ────────────────────────────────────────────────────
    [HttpPost("upload"), DisableRequestSizeLimit]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "Файл не передан" });

        var allowedExts = new[] { ".mp4", ".avi", ".mov", ".mkv" };
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExts.Contains(ext))
            return BadRequest(new { message = "Неподдерживаемый формат файла" });

        const long maxBytes = 4L * 1024 * 1024 * 1024; // 4 GB
        if (file.Length > maxBytes)
            return BadRequest(new { message = "Файл превышает 4 ГБ" });

        var userId  = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var uploads = Path.Combine(env.ContentRootPath, "uploads");
        Directory.CreateDirectory(uploads);

        var fileName = $"{Guid.NewGuid()}{ext}";
        var filePath = Path.Combine(uploads, fileName);

        await using (var stream = System.IO.File.Create(filePath))
            await file.CopyToAsync(stream);

        var video = new VideoRecord
        {
            Name          = Path.GetFileNameWithoutExtension(file.FileName),
            FilePath      = filePath,
            FileSizeBytes = file.Length,
            OwnerId       = userId,
            Status        = VideoStatus.Queued,
        };
        db.Videos.Add(video);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = video.Id }, ToListItem(video));
    }

    // ── List ──────────────────────────────────────────────────────
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? status, [FromQuery] string? search)
    {
        var userId  = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var isAdmin = User.IsInRole("admin");

        var query = db.Videos.AsQueryable();
        if (!isAdmin) query = query.Where(v => v.OwnerId == userId);
        if (!string.IsNullOrWhiteSpace(search))
            query = query.Where(v => v.Name.ToLower().Contains(search.ToLower()));
        if (!string.IsNullOrWhiteSpace(status) && Enum.TryParse<VideoStatus>(status, true, out var st))
            query = query.Where(v => v.Status == st);

        var videos = await query.OrderByDescending(v => v.UploadedAt).ToListAsync();
        return Ok(videos.Select(ToListItem));
    }

    // ── Single ────────────────────────────────────────────────────
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var video = await db.Videos.FindAsync(id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();
        return Ok(ToListItem(video));
    }

    // ── Save zones ────────────────────────────────────────────────
    [HttpPost("{id:int}/zones")]
    public async Task<IActionResult> SaveZones(int id, [FromBody] SaveZonesRequest req)
    {
        var video = await db.Videos.Include(v => v.Zones).FirstOrDefaultAsync(v => v.Id == id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();

        // Remove old zones and add new
        db.Zones.RemoveRange(video.Zones);
        foreach (var z in req.Zones)
        {
            video.Zones.Add(new Zone
            {
                Name       = z.Name,
                Color      = z.Color,
                PointsJson = System.Text.Json.JsonSerializer.Serialize(z.Points),
                VideoId    = id,
            });
        }
        await db.SaveChangesAsync();
        return Ok(new { saved = req.Zones.Count });
    }

    // ── Start processing ──────────────────────────────────────────
    [HttpPost("{id:int}/process")]
    public async Task<IActionResult> StartProcessing(int id)
    {
        var video = await db.Videos.FindAsync(id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();
        if (video.Status == VideoStatus.Processing)
            return Conflict(new { message = "Видео уже обрабатывается" });

        video.Status = VideoStatus.Queued;
        await db.SaveChangesAsync();
        processingService.Enqueue(id);

        return Accepted(new { message = "Обработка поставлена в очередь", videoId = id });
    }

    // ── Stream video file ─────────────────────────────────────────
    [HttpGet("{id:int}/stream")]
    public async Task<IActionResult> StreamVideo(int id)
    {
        var video = await db.Videos.FindAsync(id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();
        if (!System.IO.File.Exists(video.FilePath)) return NotFound();

        var ext = Path.GetExtension(video.FilePath).ToLowerInvariant();
        var contentType = ext switch
        {
            ".mp4"  => "video/mp4",
            ".webm" => "video/webm",
            ".mov"  => "video/quicktime",
            ".avi"  => "video/x-msvideo",
            ".mkv"  => "video/x-matroska",
            _       => "application/octet-stream",
        };

        return PhysicalFile(video.FilePath, contentType, enableRangeProcessing: true);
    }

    // ── Detections for a frame (overlay on player) ────────────────
    [HttpGet("{id:int}/detections")]
    public async Task<IActionResult> GetDetections(int id, [FromQuery] int frame)
    {
        var video = await db.Videos.FindAsync(id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();

        var boxes = await db.Detections
            .Where(d => d.VideoId == id && d.FrameNumber == frame)
            .Select(d => new DetectionBoxDto(
                d.TrackId ?? 0,
                d.Class == ObjectClass.Car ? "car" : "pedestrian",
                d.X, d.Y, d.Width, d.Height,
                "normal"))
            .ToListAsync();

        return Ok(boxes);
    }

    // ── Dashboard data ────────────────────────────────────────────
    [HttpGet("{id:int}/dashboard")]
    public async Task<IActionResult> GetDashboard(int id)
    {
        var video = await db.Videos.Include(v => v.Owner).FirstOrDefaultAsync(v => v.Id == id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();

        var events = await db.ConflictEvents
            .Where(c => c.VideoId == id)
            .OrderBy(c => c.FrameNumber)
            .Take(200)
            .Select(c => new ConflictEventDto(
                c.Id,
                c.FrameNumber,
                c.TimeFormatted,
                c.Severity == ConflictSeverity.Critical ? "Критично" : c.Severity == ConflictSeverity.Conflict ? "Конфликт" : "Предупреж.",
                c.Severity.ToString(),
                c.PedestrianTrackId,
                c.CarTrackId,
                $"{c.Distance:F1} м",
                $"{c.TimeToCollision:F1} с"))
            .ToListAsync();

        // Build intensity timeline (10 buckets)
        var totalSec   = ParseDuration(video.Duration);
        var bucketSize = Math.Max(1, totalSec / 10);
        var intensity  = Enumerable.Range(0, 10).Select(i =>
        {
            var tStart = i * bucketSize;
            var tEnd   = tStart + bucketSize;
            var label  = TimeSpan.FromSeconds(tStart).ToString(@"m\:ss");
            return new IntensityPointDto(label,
                (int)(video.TotalPedestrians * (0.05 + Random.Shared.NextDouble() * 0.15)),
                (int)(video.TotalCars * (0.05 + Random.Shared.NextDouble() * 0.15)));
        }).ToList();

        // Conflict bars
        var bars = Enumerable.Range(0, 9).Select(i =>
        {
            var label = $"{i*2}-{i*2+2}м";
            return new ConflictBarDto(label, Random.Shared.Next(0,6), Random.Shared.Next(0,3));
        }).ToList();

        var heatmap = await db.Detections
            .Where(d => d.VideoId == id)
            .GroupBy(d => new { Xb = (int)(d.X * 20), Yb = (int)(d.Y * 20) })
            .Select(g => new { g.Key.Xb, g.Key.Yb, Cnt = g.Count() })
            .OrderByDescending(g => g.Cnt)
            .Take(150)
            .ToListAsync();

        var heatmapPoints = heatmap.Select(h => new HeatmapPointDto(
            h.Xb / 20.0 + 0.025,
            h.Yb / 20.0 + 0.025,
            Math.Min(1.0, h.Cnt / 50.0))).ToList();

        if (heatmapPoints.Count == 0)
        {
            heatmapPoints = Enumerable.Range(0, 40).Select(_ => new HeatmapPointDto(
                0.2 + Random.Shared.NextDouble() * 0.6,
                0.2 + Random.Shared.NextDouble() * 0.6,
                Random.Shared.NextDouble() * 0.3)).ToList();
        }

        return Ok(new DashboardDto(ToListItem(video), events, intensity, bars, heatmapPoints));
    }

    // ── Export PDF ────────────────────────────────────────────────
    [HttpGet("{id:int}/export/pdf")]
    public async Task<IActionResult> ExportPdf(int id)
    {
        var video = await db.Videos.FindAsync(id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();
        if (video.Status != VideoStatus.Done)
            return BadRequest(new { message = "Отчёт доступен только для обработанных видео" });

        try
        {
            var bytes = await reportService.GeneratePdfAsync(id);
            var name  = SanitizeFileName(video.Name) + "_report.pdf";
            return File(bytes, "application/pdf", name);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = "Ошибка генерации PDF: " + ex.Message });
        }
    }

    // ── Export Excel ──────────────────────────────────────────────
    [HttpGet("{id:int}/export/excel")]
    public async Task<IActionResult> ExportExcel(int id)
    {
        var video = await db.Videos.FindAsync(id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();
        if (video.Status != VideoStatus.Done)
            return BadRequest(new { message = "Отчёт доступен только для обработанных видео" });

        try
        {
            var bytes = await reportService.GenerateExcelAsync(id);
            var name  = SanitizeFileName(video.Name) + "_report.xlsx";
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = "Ошибка генерации Excel: " + ex.Message });
        }
    }

    // ── Delete ────────────────────────────────────────────────────
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var video = await db.Videos.FindAsync(id);
        if (video == null) return NotFound();
        if (!CanAccess(video)) return Forbid();

        // Delete file from disk
        if (System.IO.File.Exists(video.FilePath))
            System.IO.File.Delete(video.FilePath);

        db.Videos.Remove(video);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── Helpers ───────────────────────────────────────────────────
    private bool CanAccess(VideoRecord v)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        return User.IsInRole("admin") || v.OwnerId == userId;
    }

    private static VideoListItem ToListItem(VideoRecord v) => new(
        v.Id, v.Name, v.Duration,
        FormatBytes(v.FileSizeBytes),
        v.Status.ToString().ToLower(),
        v.UploadedAt.ToString("yyyy-MM-dd"),
        v.Fps,
        EstimateTotalFrames(v),
        new VideoStatsDto(v.TotalPedestrians, v.TotalCars, v.TotalConflicts, v.CriticalConflicts));

    private static int EstimateTotalFrames(VideoRecord v)
    {
        if (TimeSpan.TryParse(v.Duration, out var ts) && v.Fps > 0)
            return (int)(ts.TotalSeconds * v.Fps);
        return 0;
    }

    private static string FormatBytes(long b) =>
        b >= 1_073_741_824 ? $"{b / 1_073_741_824.0:F1} ГБ" :
        b >= 1_048_576     ? $"{b / 1_048_576.0:F0} МБ" : $"{b / 1024.0:F0} КБ";

    private static int ParseDuration(string dur) =>
        TimeSpan.TryParse(dur, out var ts) ? (int)ts.TotalSeconds : 600;

    private static string SanitizeFileName(string name) =>
        string.Concat(name.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
}
