<?php
declare(strict_types=1);
require __DIR__ . '/connection-pdo.php';
$who = require_login();

$op = get_operation();

switch ($op) {
    case 'list': {
        if ($who['type'] === 'customer') {
            $stmt = $pdo->prepare(
                'SELECT r.*, s.space_name, st.type_name
                 FROM reservations r
                 JOIN study_spaces s ON r.space_id = s.space_id
                 JOIN space_types st ON s.space_type_id = st.space_type_id
                 WHERE r.customer_id = :customer_id
                 ORDER BY r.reservation_date DESC, r.start_time DESC'
            );
            $stmt->execute([':customer_id' => $who['customer_id']]);
        } else {
            $status = input('status');
            $sql = 'SELECT * FROM v_customer_reservations';
            $params = [];
            if ($status) { $sql .= ' WHERE status = :s'; $params[':s'] = $status; }
            $sql .= ' ORDER BY reservation_date DESC, start_time DESC';
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
        }
        json_response(['success' => true, 'data' => $stmt->fetchAll()]);
    }

    // ---------------- Phase 3.1 — Customer submits reservation ----------------
    case 'create': {
        $customerId = $who['type'] === 'customer'
            ? (int) $who['customer_id']
            : (int) input('customer_id');
        $spaceId = (int) input('space_id');
        $date = (string) input('reservation_date');
        $start = (string) input('start_time');
        $end = (string) input('end_time');
        $people = (int) input('number_of_people', 1);

        if (!$customerId || !$spaceId || !$date || !$start || !$end) {
            json_response(['success' => false, 'message' => 'All reservation fields are required.']);
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
            json_response(['success' => false, 'message' => 'Choose a one-hour reservation slot between 9:00 AM and 9:00 PM.']);
        }
        if ($startDateTime <= new DateTimeImmutable()) {
            json_response(['success' => false, 'message' => 'Reservations must be for a future time.']);
        }
        if ($people <= 0) {
            json_response(['success' => false, 'message' => 'Number of people must be greater than zero.']);
        }

        try {
            $pdo->beginTransaction();

            // Space must not be in maintenance / inactive.
            $stmt = $pdo->prepare('SELECT status, capacity FROM study_spaces WHERE space_id = :id FOR UPDATE');
            $stmt->execute([':id' => $spaceId]);
            $space = $stmt->fetch();
            if (!$space) { $pdo->rollBack(); json_response(['success' => false, 'message' => 'Space not found.']); }
            if (in_array($space['status'], ['maintenance', 'inactive'], true)) {
                $pdo->rollBack();
                json_response(['success' => false, 'message' => 'That space is not bookable right now (' . $space['status'] . ').']);
            }
            if ($people > (int) $space['capacity']) {
                $pdo->rollBack();
                json_response(['success' => false, 'message' => 'That space only fits ' . $space['capacity'] . ' people.']);
            }

            // No overlapping reservation for the same space.
            $stmt = $pdo->prepare(
                "SELECT reservation_id FROM reservations
                 WHERE space_id = :space AND reservation_date = :date
                   AND status IN ('pending','confirmed')
                   AND start_time < :end AND end_time > :start
                 FOR UPDATE"
            );
            $stmt->execute([':space' => $spaceId, ':date' => $date, ':start' => $start, ':end' => $end]);
            if ($stmt->fetch()) {
                $pdo->rollBack();
                json_response(['success' => false, 'message' => 'That space is already booked for an overlapping time.']);
            }

            // Not under scheduled maintenance for that window.
            $stmt = $pdo->prepare(
                "SELECT maintenance_id FROM space_maintenance
                 WHERE space_id = :space AND status IN ('scheduled','active')
                   AND start_datetime < :end AND end_datetime > :start"
            );
            $stmt->execute([':space' => $spaceId, ':start' => "$date $start:00", ':end' => "$date $end:00"]);
            if ($stmt->fetch()) {
                $pdo->rollBack();
                json_response(['success' => false, 'message' => 'That space is scheduled for maintenance during that window.']);
            }

            $stmt = $pdo->prepare(
                "INSERT INTO reservations (customer_id, space_id, reservation_date, start_time, end_time, number_of_people, status)
                 VALUES (:c, :s, :d, :st, :en, :p, 'pending')"
            );
            $stmt->execute([':c' => $customerId, ':s' => $spaceId, ':d' => $date, ':st' => $start, ':en' => $end, ':p' => $people]);
            $resId = (int) $pdo->lastInsertId();

            $stmt = $pdo->prepare(
                'SELECT c.first_name, c.last_name, c.email, s.space_name
                 FROM customers c JOIN study_spaces s ON s.space_id = :space_id
                 WHERE c.customer_id = :customer_id'
            );
            $stmt->execute([':space_id' => $spaceId, ':customer_id' => $customerId]);
            $emailDetails = $stmt->fetch();
            if (!$emailDetails) {
                throw new RuntimeException('Customer or reservation space not found.');
            }

            notify_all_staff($pdo, "New reservation #$resId is pending review.");
            log_audit($pdo, 'create', 'reservations', $resId, 'Reservation created (pending)');
            $pdo->commit();

            $customerName = $emailDetails['first_name'] . ' ' . $emailDetails['last_name'];
            $subject = "Study Hub reservation request #$resId";
            $message = "Hello $customerName,\n\n"
                . "We received your reservation request. It is awaiting staff approval.\n\n"
                . "Space: {$emailDetails['space_name']}\n"
                . "Date: $date\n"
                . "Time: $start–$end\n"
                . "Guests: $people\n"
                . "Status: Pending\n\n"
                . "We will send another email when the reservation is confirmed.";
            $emailSent = @mail(
                $emailDetails['email'],
                $subject,
                $message,
                "From: Study Hub <no-reply@studyhub.local>\r\nContent-Type: text/plain; charset=UTF-8"
            );
            json_response([
                'success' => true,
                'reservation_id' => $resId,
                'email_sent' => $emailSent,
                'message' => $emailSent
                    ? 'Reservation request submitted. A confirmation email has been sent.'
                    : 'Reservation request submitted, but the confirmation email could not be sent. Please contact staff.',
            ]);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            json_response(['success' => false, 'message' => 'Failed to create reservation: ' . $e->getMessage()], 500);
        }
    }

    // ---------------- Phase 3.2 — Staff confirms ----------------
    case 'confirm': {
        require_permission('reservations');
        $id = (int) input('reservation_id');
        $stmt = $pdo->prepare('SELECT * FROM reservations WHERE reservation_id = :id');
        $stmt->execute([':id' => $id]);
        $res = $stmt->fetch();
        if (!$res) json_response(['success' => false, 'message' => 'Reservation not found.']);
        if ($res['status'] !== 'pending') json_response(['success' => false, 'message' => 'Only pending reservations can be confirmed.']);

        $pdo->prepare("UPDATE reservations SET status = 'confirmed' WHERE reservation_id = :id")->execute([':id' => $id]);
        // Flip the space to 'reserved' as a heads-up (check-in will flip it to 'occupied').
        $pdo->prepare("UPDATE study_spaces SET status = 'reserved' WHERE space_id = :sid AND status = 'available'")
            ->execute([':sid' => $res['space_id']]);

        $stmt = $pdo->prepare(
            'SELECT c.first_name, c.last_name, c.email, s.space_name
             FROM reservations r
             JOIN customers c ON c.customer_id = r.customer_id
             JOIN study_spaces s ON s.space_id = r.space_id
             WHERE r.reservation_id = :id'
        );
        $stmt->execute([':id' => $id]);
        $details = $stmt->fetch();
        $emailSent = false;
        if ($details) {
            $customerName = $details['first_name'] . ' ' . $details['last_name'];
            $emailSent = @mail(
                $details['email'],
                "Study Hub reservation confirmed #$id",
                "Hello $customerName,\n\n"
                    . "Your reservation has been confirmed.\n\n"
                    . "Space: {$details['space_name']}\n"
                    . "Date: {$res['reservation_date']}\n"
                    . "Time: {$res['start_time']}–{$res['end_time']}\n"
                    . "Guests: {$res['number_of_people']}\n"
                    . "Status: Confirmed\n",
                "From: Study Hub <no-reply@studyhub.local>\r\nContent-Type: text/plain; charset=UTF-8"
            );
        }
        create_notification($pdo, 'customer', (int)$res['customer_id'], "Your reservation #$id has been confirmed.");
        log_audit($pdo, 'update', 'reservations', $id, 'Reservation confirmed');
        json_response([
            'success' => true,
            'email_sent' => $emailSent,
            'message' => $emailSent
                ? 'Reservation confirmed and email sent.'
                : 'Reservation confirmed, but the confirmation email could not be sent.',
        ]);
    }

    // ---------------- Phase 3.3 — Cancel / no-show ----------------
    case 'cancel': {
        require_permission('reservations');
        $id = (int) input('reservation_id');
        $stmt = $pdo->prepare('SELECT * FROM reservations WHERE reservation_id = :id');
        $stmt->execute([':id' => $id]);
        $res = $stmt->fetch();
        if (!$res) json_response(['success' => false, 'message' => 'Reservation not found.']);

        $pdo->prepare("UPDATE reservations SET status = 'cancelled' WHERE reservation_id = :id")->execute([':id' => $id]);
        $pdo->prepare("UPDATE study_spaces SET status = 'available' WHERE space_id = :sid AND status = 'reserved'")
            ->execute([':sid' => $res['space_id']]);
        create_notification($pdo, 'customer', (int)$res['customer_id'], "Your reservation #$id was cancelled.");
        log_audit($pdo, 'update', 'reservations', $id, 'Reservation cancelled');
        json_response(['success' => true]);
    }

    case 'noShow': {
        require_permission('reservations');
        $id = (int) input('reservation_id');
        $stmt = $pdo->prepare('SELECT * FROM reservations WHERE reservation_id = :id');
        $stmt->execute([':id' => $id]);
        $res = $stmt->fetch();
        if (!$res) json_response(['success' => false, 'message' => 'Reservation not found.']);

        $pdo->prepare("UPDATE reservations SET status = 'no_show' WHERE reservation_id = :id")->execute([':id' => $id]);
        $pdo->prepare("UPDATE study_spaces SET status = 'available' WHERE space_id = :sid AND status = 'reserved'")
            ->execute([':sid' => $res['space_id']]);
        log_audit($pdo, 'update', 'reservations', $id, 'Marked as no-show, space freed');
        json_response(['success' => true]);
    }

    default:
        json_response(['success' => false, 'message' => 'Unknown operation.'], 400);
}
