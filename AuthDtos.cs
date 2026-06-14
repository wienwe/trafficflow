namespace TrafficFlow.API.DTOs;

public record LoginRequest(string Username, string Password);

public record LoginResponse(
    string Token,
    string Username,
    string FullName,
    string Role,
    int UserId);

public record RegisterRequest(
    string Username,
    string Password,
    string FullName,
    string Email,
    string Role = "analyst");

public record SignupRequest(
    string Username,
    string Password,
    string FullName,
    string Email);

public record UserDto(
    int Id,
    string Username,
    string FullName,
    string Email,
    string Role,
    bool IsActive,
    DateTime CreatedAt);

public record UpdateRoleRequest(string Role);
