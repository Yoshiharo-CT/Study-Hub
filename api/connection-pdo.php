<?php
/**
 * connection-pdo.php
 * Shared DB connection + session/auth/audit/notification helpers.
 * Every other api/*.php file starts with: require 'connection-pdo.php';
 */

declare(strict_types=1);

// ---- CORS (same-origin by default; loosen only if you split hosts) ----
header('Content-Type: application/json');
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// ---- DB CONFIG — edit to match your XAMPP/MySQL setup ----
const DB_HOST = '127.0.0.1';
const DB_NAME = 'hub_study';
const DB_USER = 'root';
const DB_PASS = '';

// Store operating hours for customer reservations.
const RESERVATION_OPEN_HOUR = 9;
const RESERVATION_CLOSE_HOUR = 21;

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (PDOException $e) {
    json_response(['success' => false, 'message' => 'Database connection failed: ' . $e->getMessage()], 500);
}

// ---- Response helper ----
function json_response(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

// ---- Input helper: works whether the client sent multipart FormData or JSON ----
function input(string $key, $default = null)
{
    if (isset($_POST[$key])) return $_POST[$key];
    if (isset($_GET[$key])) return $_GET[$key];
    static $json = null;
    if ($json === null) {
        $raw = file_get_contents('php://input');
        $json = $raw ? (json_decode($raw, true) ?: []) : [];
    }
    return $json[$key] ?? $default;
}

// ---- Auth helpers ----
function current_staff(): ?array
{
    return $_SESSION['staff'] ?? null;
}

function current_customer(): ?array
{
    return $_SESSION['customer'] ?? null;
}

function require_staff_login(): array
{
    $staff = current_staff();
    if (!$staff) {
        json_response(['success' => false, 'message' => 'Staff login required.'], 401);
    }
    return $staff;
}

function require_login(): array
{
    $staff = current_staff();
    if ($staff) return ['type' => 'staff'] + $staff;
    $cust = current_customer();
    if ($cust) return ['type' => 'customer'] + $cust;
    json_response(['success' => false, 'message' => 'Login required.'], 401);
}

/** Returns true if the logged-in staff member's role includes $perm. */
function staff_has_permission(string $perm): bool
{
    $staff = current_staff();
    if (!$staff) return false;
    $perms = array_map('trim', explode(',', $staff['permissions'] ?? ''));
    return in_array($perm, $perms, true);
}

function require_permission(string $perm): array
{
    $staff = require_staff_login();
    if (!staff_has_permission($perm)) {
        json_response(['success' => false, 'message' => 'You do not have permission to do that.'], 403);
    }
    return $staff;
}

function is_customer_reservation_slot(string $date, string $start, string $end): bool
{
    $reservationDate = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    $startTime = DateTimeImmutable::createFromFormat('!H:i', $start);
    $endTime = DateTimeImmutable::createFromFormat('!H:i', $end);
    if (!$reservationDate || $reservationDate->format('Y-m-d') !== $date
        || !$startTime || $startTime->format('H:i') !== $start
        || !$endTime || $endTime->format('H:i') !== $end) {
        return false;
    }

    $startHour = (int) $startTime->format('G');
    return $startTime->format('i') === '00'
        && $startHour >= RESERVATION_OPEN_HOUR
        && $startHour < RESERVATION_CLOSE_HOUR
        && $endTime->format('H:i') === sprintf('%02d:00', $startHour + 1);
}

// ---- Audit log (Phase 10.5) ----
function log_audit(PDO $pdo, string $action, string $table_name, ?int $record_id = null, ?string $details = null): void
{
    $staff = current_staff();
    $cust = current_customer();
    $user_id = $staff['user_id'] ?? $cust['user_id'] ?? null;
    $label = $staff ? ($staff['first_name'] . ' ' . $staff['last_name'] . ' (staff)')
        : ($cust ? ($cust['first_name'] . ' ' . $cust['last_name'] . ' (customer)') : 'system');
    $stmt = $pdo->prepare(
        'INSERT INTO audit_log (user_id, actor_label, action, table_name, record_id, details)
         VALUES (:user_id, :label, :action, :table_name, :record_id, :details)'
    );
    $stmt->execute([
        ':user_id' => $user_id,
        ':label' => $label,
        ':action' => $action,
        ':table_name' => $table_name,
        ':record_id' => $record_id,
        ':details' => $details,
    ]);
}

// ---- Notifications (Phase 3.1, 3.2, 4.2, 7.1) ----
function create_notification(PDO $pdo, string $recipient_type, int $recipient_id, string $message): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO notifications (recipient_type, recipient_id, message) VALUES (:t, :id, :m)'
    );
    $stmt->execute([':t' => $recipient_type, ':id' => $recipient_id, ':m' => $message]);
}

/** Notify every on-duty / all staff (simple version: all active staff). */
function notify_all_staff(PDO $pdo, string $message): void
{
    $ids = $pdo->query('SELECT staff_id FROM staff')->fetchAll(PDO::FETCH_COLUMN);
    foreach ($ids as $id) {
        create_notification($pdo, 'staff', (int)$id, $message);
    }
}

function get_operation(): string
{
    return (string) input('operation', '');
}
