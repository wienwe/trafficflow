using BCrypt.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TrafficFlow.API.Data;
using TrafficFlow.API.DTOs;
using TrafficFlow.API.Models;

namespace TrafficFlow.API.Controllers;

/// <summary>
/// GET    /api/users            — список (admin only)
/// GET    /api/users/{id}       — один пользователь
/// PUT    /api/users/{id}/role  — сменить роль
/// PUT    /api/users/{id}/toggle-active — блокировка/разблокировка
/// DELETE /api/users/{id}       — удалить (admin only)
/// </summary>
[ApiController, Route("api/[controller]"), Authorize(Roles = "admin")]
public class UsersController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var users = await db.Users
            .Select(u => new UserDto(u.Id, u.Username, u.FullName, u.Email, u.Role, u.IsActive, u.CreatedAt))
            .ToListAsync();
        return Ok(users);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var u = await db.Users.FindAsync(id);
        if (u == null) return NotFound();
        return Ok(new UserDto(u.Id, u.Username, u.FullName, u.Email, u.Role, u.IsActive, u.CreatedAt));
    }

    [HttpPut("{id:int}/role")]
    public async Task<IActionResult> UpdateRole(int id, [FromBody] UpdateRoleRequest req)
    {
        var u = await db.Users.FindAsync(id);
        if (u == null) return NotFound();
        if (req.Role is not ("analyst" or "admin"))
            return BadRequest(new { message = "Роль должна быть analyst или admin" });
        u.Role = req.Role;
        await db.SaveChangesAsync();
        return Ok(new UserDto(u.Id, u.Username, u.FullName, u.Email, u.Role, u.IsActive, u.CreatedAt));
    }

    [HttpPut("{id:int}/toggle-active")]
    public async Task<IActionResult> ToggleActive(int id)
    {
        var currentUserId = int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
        if (id == currentUserId) return BadRequest(new { message = "Нельзя заблокировать себя" });

        var u = await db.Users.FindAsync(id);
        if (u == null) return NotFound();
        u.IsActive = !u.IsActive;
        await db.SaveChangesAsync();
        return Ok(new UserDto(u.Id, u.Username, u.FullName, u.Email, u.Role, u.IsActive, u.CreatedAt));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var u = await db.Users.FindAsync(id);
        if (u == null) return NotFound();
        db.Users.Remove(u);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
