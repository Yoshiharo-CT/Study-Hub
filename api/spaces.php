<?php
declare(strict_types=1);
require __DIR__ . '/connection-pdo.php';
$who = require_login();

$op = get_operation();
if ($who['type'] === 'customer' && $op !== 'checkAvailability') {
    json_response(['success' => false, 'message' => 'This operation is for staff only.'], 403);
}

switch ($op) {
    // ---------------- Phase 2.1 — browse spaces ----------------
    case 'listTypes': {
        $rows = $pdo->query('SELECT * FROM space_types ORDER BY base_rate')->fetchAll();
        json_response(['success' => true, 'data' => $rows]);
    }

    case 'listSpaces': {
        $where = [];
        $params = [];
        if ($type = input('space_type_id')) { $where[] = 'ss.space_type_id = :t'; $params[':t'] = (int)$type; }
        if ($status = input('status')) { $where[] = 'ss.status = :s'; $params[':s'] = $status; }
        if ($cap = input('capacity')) { $where[] = 'ss.capacity >= :c'; $params[':c'] = (int)$cap; }
        $sql = "SELECT ss.*, st.type_name, st.base_rate
                FROM study_spaces ss JOIN space_types st ON ss.space_type_id = st.space_type_id";
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= ' ORDER BY ss.space_id';
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        json_response(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // ---------------- Phase 2.2 — availability for a date/time window ----------------
    case 'checkAvailability': {
        $date = (string) input('date');
        $start = (string) input('start_time');
        $end = (string) input('end_time');
        if ($date === '' || $start === '' || $end === '') {
            json_response(['success' => false, 'message' => 'Date, start time, and end time are required.']);
        }
        $reservationDate = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        $startTime = DateTimeImmutable::createFromFormat('!H:i', $start);
        $endTime = DateTimeImmutable::createFromFormat('!H:i', $end);
        if (!$reservationDate || $reservationDate->format('Y-m-d') !== $date
            || !$startTime || $startTime->format('H:i') !== $start
            || !$endTime || $endTime->format('H:i') !== $end) {
            json_response(['success' => false, 'message' => 'Enter a valid reservation date and time.']);
        }
        $startDateTime = new DateTimeImmutable("$date $start");
        $endDateTime = new DateTimeImmutable("$date $end");
        if ($endDateTime <= $startDateTime) {
            json_response(['success' => false, 'message' => 'End time must be after start time.']);
        }
        if ($who['type'] === 'customer' && !is_customer_reservation_slot($date, $start, $end)) {
            json_response(['success' => false, 'message' => 'Choose a one-hour reservation slot between 8:00 AM and 5:00 PM.']);
        }
        if ($startDateTime <= new DateTimeImmutable()) {
            json_response(['success' => false, 'message' => 'Availability can only be checked for a future time.']);
        }
        $sql = "SELECT ss.*, st.type_name, st.base_rate
                FROM study_spaces ss
                JOIN space_types st ON ss.space_type_id = st.space_type_id
                WHERE ss.status NOT IN ('maintenance','inactive')
                  AND ss.space_id NOT IN (
                      SELECT space_id FROM reservations
                      WHERE reservation_date = :d
                        AND status IN ('pending','confirmed')
                        AND start_time < :end AND end_time > :start
                  )
                  AND ss.space_id NOT IN (
                      SELECT space_id FROM space_maintenance
                      WHERE status IN ('scheduled','active')
                        AND start_datetime < :end2 AND end_datetime > :start2
                  )
                ORDER BY ss.space_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':d' => $date, ':start' => $start, ':end' => $end,
            ':start2' => "$date $start:00", ':end2' => "$date $end:00",
        ]);
        json_response(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // ---------------- Phase 0.3 / 10.3 — manage spaces ----------------
    case 'addType': {
        require_permission('spaces');
        $name = trim((string) input('type_name', ''));
        $rate = (float) input('base_rate', 0);
        $cap = (int) input('default_capacity', 1);
        $desc = trim((string) input('description', ''));
        if ($name === '') json_response(['success' => false, 'message' => 'Type name is required.']);
        $stmt = $pdo->prepare('INSERT INTO space_types (type_name, base_rate, default_capacity, description) VALUES (:n,:r,:c,:d)');
        $stmt->execute([':n' => $name, ':r' => $rate, ':c' => $cap, ':d' => $desc]);
        log_audit($pdo, 'create', 'space_types', (int)$pdo->lastInsertId(), "Added space type $name");
        json_response(['success' => true]);
    }

    case 'addSpace': {
        require_permission('spaces');
        $typeId = (int) input('space_type_id');
        $name = trim((string) input('space_name', ''));
        $capacity = (int) input('capacity', 1);
        if ($typeId <= 0 || $name === '') json_response(['success' => false, 'message' => 'Space type and name are required.']);
        $stmt = $pdo->prepare('INSERT INTO study_spaces (space_type_id, space_name, capacity) VALUES (:t,:n,:c)');
        $stmt->execute([':t' => $typeId, ':n' => $name, ':c' => $capacity]);
        log_audit($pdo, 'create', 'study_spaces', (int)$pdo->lastInsertId(), "Added space $name");
        json_response(['success' => true]);
    }

    case 'updateStatus': {
        require_permission('spaces');
        $id = (int) input('space_id');
        $status = (string) input('status');
        if (!in_array($status, ['available', 'occupied', 'reserved', 'maintenance', 'inactive'], true)) {
            json_response(['success' => false, 'message' => 'Invalid status.']);
        }
        $pdo->prepare('UPDATE study_spaces SET status = :s WHERE space_id = :id')
            ->execute([':s' => $status, ':id' => $id]);
        log_audit($pdo, 'update', 'study_spaces', $id, "Status manually set to $status");
        json_response(['success' => true]);
    }

    // ---------------- Phase 10.3 / 11.2 — maintenance scheduling ----------------
    case 'scheduleMaintenance': {
        require_permission('spaces');
        $spaceId = (int) input('space_id');
        $start = (string) input('start_datetime');
        $end = (string) input('end_datetime');
        $reason = trim((string) input('reason', ''));
        if ($spaceId <= 0 || $start === '' || $end === '') {
            json_response(['success' => false, 'message' => 'Space, start, and end are required.']);
        }
        $staff = current_staff();
        try {
            $pdo->beginTransaction();
            $stmt = $pdo->prepare(
                'INSERT INTO space_maintenance (space_id, start_datetime, end_datetime, reason, created_by)
                 VALUES (:s,:st,:e,:r,:c)'
            );
            $stmt->execute([':s' => $spaceId, ':st' => $start, ':e' => $end, ':r' => $reason, ':c' => $staff['staff_id']]);
            $mid = (int) $pdo->lastInsertId();

            // If the window covers "now", flip the space to maintenance immediately.
            if (strtotime($start) <= time() && time() <= strtotime($end)) {
                $pdo->prepare("UPDATE study_spaces SET status = 'maintenance' WHERE space_id = :id")->execute([':id' => $spaceId]);
            }
            log_audit($pdo, 'create', 'space_maintenance', $mid, "Scheduled maintenance for space #$spaceId");
            $pdo->commit();
            json_response(['success' => true, 'maintenance_id' => $mid]);
        } catch (Throwable $e) {
            $pdo->rollBack();
            json_response(['success' => false, 'message' => 'Failed: ' . $e->getMessage()], 500);
        }
    }

    case 'listMaintenance': {
        $rows = $pdo->query(
            "SELECT m.*, s.space_name FROM space_maintenance m
             JOIN study_spaces s ON m.space_id = s.space_id
             ORDER BY m.start_datetime DESC"
        )->fetchAll();
        json_response(['success' => true, 'data' => $rows]);
    }

    case 'completeMaintenance': {
        require_permission('spaces');
        $id = (int) input('maintenance_id');
        $stmt = $pdo->prepare('SELECT space_id FROM space_maintenance WHERE maintenance_id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) json_response(['success' => false, 'message' => 'Maintenance record not found.']);
        $pdo->prepare("UPDATE space_maintenance SET status = 'completed' WHERE maintenance_id = :id")->execute([':id' => $id]);
        $pdo->prepare("UPDATE study_spaces SET status = 'available' WHERE space_id = :id")->execute([':id' => $row['space_id']]);
        log_audit($pdo, 'update', 'space_maintenance', $id, 'Maintenance completed, space freed');
        json_response(['success' => true]);
    }

    default:
        json_response(['success' => false, 'message' => 'Unknown operation.'], 400);
}
