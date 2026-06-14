using BCrypt.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TrafficFlow.API.Data;
using TrafficFlow.API.DTOs;
using TrafficFlow.API.Models;
using TrafficFlow.API.Services;

namespace TrafficFlow.API.Controllers;

/// <summary>
/// POST /api/auth/login  — получение JWT токена
/// POST /api/auth/signup    — публичная регистрация (роль analyst)
/// POST /api/auth/register — регистрация (только admin)
/// GET  /api/auth/me     — текущий пользователь
/// </summary>
[ApiController, Route("api/[controller]")]
public class AuthController(AppDbContext db, IJwtService jwt) : ControllerBase
{
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == req.Username);
        if (user == null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { message = "Неверный логин или пароль" });

        if (!user.IsActive)
            return Forbid();

        var token = jwt.GenerateToken(user);
        return Ok(new LoginResponse(token, user.Username, user.FullName, user.Role, user.Id));
    }

    [HttpPost("signup"), AllowAnonymous]
    public async Task<IActionResult> Signup([FromBody] SignupRequest req)
    {
        var err = ValidateNewUser(req.Username, req.Password, req.FullName, req.Email);
        if (err != null) return BadRequest(new { message = err });

        if (await db.Users.AnyAsync(u => u.Username == req.Username))
            return Conflict(new { message = "Логин уже занят" });
        if (await db.Users.AnyAsync(u => u.Email == req.Email))
            return Conflict(new { message = "Email уже используется" });

        var user = new AppUser
        {
            Username     = req.Username.Trim(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            FullName     = req.FullName.Trim(),
            Email        = req.Email.Trim(),
            Role         = "analyst",
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var token = jwt.GenerateToken(user);
        return Ok(new LoginResponse(token, user.Username, user.FullName, user.Role, user.Id));
    }

    [HttpPost("register"), Authorize(Roles = "admin")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        var err = ValidateNewUser(req.Username, req.Password, req.FullName, req.Email);
        if (err != null) return BadRequest(new { message = err });

        if (await db.Users.AnyAsync(u => u.Username == req.Username))
            return Conflict(new { message = "Логин уже занят" });
        if (await db.Users.AnyAsync(u => u.Email == req.Email))
            return Conflict(new { message = "Email уже используется" });

        if (req.Role is not ("analyst" or "admin"))
            return BadRequest(new { message = "Роль должна быть analyst или admin" });

        var user = new AppUser
        {
            Username     = req.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            FullName     = req.FullName,
            Email        = req.Email,
            Role         = req.Role,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetMe), new UserDto(user.Id, user.Username, user.FullName, user.Email, user.Role, user.IsActive, user.CreatedAt));
    }

    [HttpGet("me"), Authorize]
    public async Task<IActionResult> GetMe()
    {
        var id = int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
        var user = await db.Users.FindAsync(id);
        if (user == null) return NotFound();
        return Ok(new UserDto(user.Id, user.Username, user.FullName, user.Email, user.Role, user.IsActive, user.CreatedAt));
    }

    static string? ValidateNewUser(string username, string password, string fullName, string email)
    {
        if (string.IsNullOrWhiteSpace(username) || username.Trim().Length < 3)
            return "Логин должен быть не короче 3 символов";
        if (string.IsNullOrWhiteSpace(password) || password.Length < 6)
            return "Пароль должен быть не короче 6 символов";
        if (string.IsNullOrWhiteSpace(fullName))
            return "Укажите полное имя";
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
            return "Укажите корректный email";
        return null;
    }
}
