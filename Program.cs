using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using TrafficFlow.API.Data;
using TrafficFlow.API.Hubs;
using TrafficFlow.API.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Database ──────────────────────────────────────────────────────
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// ── JWT Authentication ────────────────────────────────────────────
var jwtSection = builder.Configuration.GetSection("Jwt");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidateAudience         = true,
            ValidateLifetime         = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer    = jwtSection["Issuer"],
            ValidAudience  = jwtSection["Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtSection["Key"]!)),
        };

        // Allow JWT via SignalR query string
        opt.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                var path  = ctx.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(token) &&
                    (path.StartsWithSegments("/hubs") || path.StartsWithSegments("/api/videos")))
                    ctx.Token = token;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// ── SignalR ───────────────────────────────────────────────────────
builder.Services.AddSignalR();

// ── Application Services ──────────────────────────────────────────
builder.Services.AddScoped<IJwtService,    JwtService>();
builder.Services.AddScoped<IReportService, ReportService>();
builder.Services.AddSingleton<VideoProcessingService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<VideoProcessingService>());

// ── Controllers + Swagger ─────────────────────────────────────────
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "TrafficFlow API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        In = ParameterLocation.Header,
        Description = "Введите: Bearer {token}",
        Name = "Authorization",
        Type = SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        { new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }, [] }
    });
});

// ── CORS (для фронтенда) ──────────────────────────────────────────
builder.Services.AddCors(opt =>
    opt.AddPolicy("Frontend", p =>
        p.WithOrigins(builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? ["http://localhost:3000", "http://localhost:5500", "http://127.0.0.1:5500"])
         .AllowAnyHeader()
         .AllowAnyMethod()
         .AllowCredentials()));

var app = builder.Build();

// ── Database: migrations или схема из database/init.sql ───────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
    var applyMigrations = config.GetValue("Database:ApplyEfMigrations", true);
    var fromScript = config.GetValue("Database:InitializedFromScript", false);

    if (applyMigrations)
        db.Database.Migrate();
    else if (!db.Database.CanConnect())
        throw new InvalidOperationException(
            "Не удалось подключиться к PostgreSQL. Запустите: docker compose up -d db " +
            "или scripts/init-database.ps1");

    if (fromScript)
        await FixSeedUserPasswordsAsync(db);

    // Seed через EF, если БД пустая и не загружена из init.sql
    if (!db.Users.Any())
    {
        db.Users.Add(new TrafficFlow.API.Models.AppUser
        {
            Username     = "admin",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("admin123"),
            FullName     = "Системный администратор",
            Email        = "admin@trafficflow.local",
            Role         = "admin",
            IsActive     = true,
        });
        db.Users.Add(new TrafficFlow.API.Models.AppUser
        {
            Username     = "analyst",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("analyst123"),
            FullName     = "Транспортный аналитик",
            Email        = "analyst@trafficflow.local",
            Role         = "analyst",
            IsActive     = true,
        });
        db.SaveChanges();
    }
}

static async Task FixSeedUserPasswordsAsync(AppDbContext db)
{
    var passwords = new Dictionary<string, string>
    {
        ["admin"]    = "admin123",
        ["analyst"]  = "analyst123",
        ["engineer"] = "engineer123",
    };

    var users = await db.Users.Where(u => passwords.Keys.Contains(u.Username)).ToListAsync();
    var changed = false;
    foreach (var user in users)
    {
        var plain = passwords[user.Username];
        if (!BCrypt.Net.BCrypt.Verify(plain, user.PasswordHash))
        {
            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(plain);
            changed = true;
        }
    }
    if (changed) await db.SaveChangesAsync();
}

// ── Middleware pipeline ───────────────────────────────────────────
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "TrafficFlow API v1"));
}

app.UseCors("Frontend");

// Serve frontend static files from wwwroot
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<ProcessingHub>("/hubs/processing");

// SPA fallback
app.MapFallbackToFile("index.html");

app.Run();
