using Microsoft.EntityFrameworkCore;
using TrafficFlow.API.Models;

namespace TrafficFlow.API.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser>          Users             { get; set; }
    public DbSet<VideoRecord>      Videos            { get; set; }
    public DbSet<Zone>             Zones             { get; set; }
    public DbSet<Detection>        Detections        { get; set; }
    public DbSet<Track>            Tracks            { get; set; }
    public DbSet<ConflictEvent>    ConflictEvents    { get; set; }
    public DbSet<AlgorithmSettings> AlgorithmSettings { get; set; }

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // AppUser
        mb.Entity<AppUser>(e =>
        {
            e.HasIndex(u => u.Username).IsUnique();
            e.HasIndex(u => u.Email).IsUnique();
            e.HasMany(u => u.Videos)
             .WithOne(v => v.Owner)
             .HasForeignKey(v => v.OwnerId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        // VideoRecord
        mb.Entity<VideoRecord>(e =>
        {
            e.Property(v => v.Status)
             .HasConversion<string>();
            e.HasMany(v => v.Zones)
             .WithOne(z => z.Video)
             .HasForeignKey(z => z.VideoId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(v => v.Detections)
             .WithOne(d => d.Video)
             .HasForeignKey(d => d.VideoId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(v => v.Tracks)
             .WithOne(t => t.Video)
             .HasForeignKey(t => t.VideoId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(v => v.ConflictEvents)
             .WithOne(c => c.Video)
             .HasForeignKey(c => c.VideoId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        // Detection — enum as string
        mb.Entity<Detection>(e =>
        {
            e.Property(d => d.Class).HasConversion<string>();
            e.HasIndex(d => new { d.VideoId, d.FrameNumber });
        });

        // Track
        mb.Entity<Track>(e =>
        {
            e.Property(t => t.Class).HasConversion<string>();
            e.HasIndex(t => new { t.VideoId, t.TrackId }).IsUnique();
        });

        // ConflictEvent
        mb.Entity<ConflictEvent>(e =>
        {
            e.Property(c => c.Severity).HasConversion<string>();
            e.HasIndex(c => new { c.VideoId, c.FrameNumber });
        });

        // Seed default settings
        mb.Entity<AlgorithmSettings>().HasData(new AlgorithmSettings { Id = 1 });
    }
}
