const customerApi = {
  auth: `${baseApiUrl}/auth.php`,
  reservations: `${baseApiUrl}/reservations.php`,
  spaces: `${baseApiUrl}/spaces.php`,
};

let customer = null;
let selectedSpace = null;
let availableSpaces = [];
let availabilityRequestId = 0;

const BOOKING_START_HOUR = 9;
const BOOKING_END_HOUR = 21;

function customerCall(url, operation, params = {}) {
  return apiClient.post(url, toFormData({ operation, ...params }));
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function setCustomerMessage(id, text, ok = false) {
  const element = document.getElementById(id);
  element.textContent = text;
  element.style.color = ok ? "var(--ok)" : "var(--err)";
}

function showPanel(target) {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.target === target);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === target);
  });
  document.getElementById("page-title").textContent =
    target === "panel-home" ? "GEMINILE STUDY HUB" : "Reservations";
}

function reservationRows(reservations) {
  if (!reservations.length) {
    return '<p class="hint">You do not have any reservations yet.</p>';
  }
  return `<table>
    <thead><tr><th>Space</th><th>Date</th><th>Time</th><th>People</th><th>Status</th></tr></thead>
    <tbody>${reservations
      .map(
        (reservation) => `<tr>
          <td>${escapeHTML(reservation.space_name)}</td>
          <td>${escapeHTML(reservation.reservation_date)}</td>
          <td>${escapeHTML(reservation.start_time)}–${escapeHTML(reservation.end_time)}</td>
          <td>${escapeHTML(reservation.number_of_people)}</td>
          <td>${escapeHTML(reservation.status)}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

async function loadReservations() {
  const response = await customerCall(customerApi.reservations, "list");
  if (!response.data.success) {
    const message = response.data.message || "Could not load your reservations.";
    document.getElementById("home-reservations").textContent = message;
    document.getElementById("customer-reservations").textContent = message;
    return;
  }

  const reservations = response.data.data || [];
  document.getElementById("customer-reservation-count").textContent =
    String(reservations.length);
  document.getElementById("customer-pending-count").textContent = String(
    reservations.filter((reservation) => reservation.status === "pending").length,
  );
  document.getElementById("home-reservations").innerHTML = reservationRows(
    reservations.slice(0, 5),
  );
  document.getElementById("customer-reservations").innerHTML =
    reservationRows(reservations);
}

function clearSelectedSpace() {
  selectedSpace = null;
  document.getElementById("selected-space").textContent =
    "Check availability and select a space above.";
  document.getElementById("submit-reservation").disabled = true;
}

function showAvailableSpaces(spaces) {
  const container = document.getElementById("available-spaces");
  if (!spaces.length) {
    container.innerHTML = '<p class="hint">No spaces are available for that time.</p>';
    return;
  }
  container.innerHTML = `<table>
    <thead><tr><th>Space</th><th>Type</th><th>Capacity</th><th>Rate / hour</th><th></th></tr></thead>
    <tbody>${spaces
      .map(
        (space) => `<tr>
          <td>${escapeHTML(space.space_name)}</td>
          <td>${escapeHTML(space.type_name)}</td>
          <td>${escapeHTML(space.capacity)}</td>
          <td>₱${Number(space.base_rate).toFixed(2)}</td>
          <td><button class="primary" type="button" data-space-id="${escapeHTML(space.space_id)}">Select</button></td>
        </tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function setTodayAsMinimum() {
  const today = new Date();
  const localToday = new Date(
    today.getTime() - today.getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 10);
  const dateInput = document.getElementById("booking-date");
  dateInput.min = localToday;
  dateInput.value = localToday;
  updateBookingSlots();
}

function formatHour(hour) {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:00 ${period}`;
}

function updateBookingSlots() {
  const date = document.getElementById("booking-date").value;
  const slotSelect = document.getElementById("booking-slot");
  const previousValue = slotSelect.value;
  const now = new Date();
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  slotSelect.innerHTML = '<option value="">Select an hourly slot…</option>';

  if (!date) return;

  for (let hour = BOOKING_START_HOUR; hour < BOOKING_END_HOUR; hour += 1) {
    const start = `${String(hour).padStart(2, "0")}:00`;
    const slotStart = new Date(`${date}T${start}:00`);
    if (date === localToday && slotStart <= now) continue;
    const option = document.createElement("option");
    option.value = start;
    option.textContent = `${formatHour(hour)} – ${formatHour(hour + 1)}`;
    slotSelect.append(option);
  }

  if ([...slotSelect.options].some((option) => option.value === previousValue)) {
    slotSelect.value = previousValue;
  } else if (slotSelect.options.length === 1) {
    slotSelect.options[0].textContent = "No remaining slots today — choose another date";
  }
}

function getSelectedSlot() {
  const start = document.getElementById("booking-slot").value;
  if (!start) return null;
  const endHour = Number(start.slice(0, 2)) + 1;
  return {
    start,
    end: `${String(endHour).padStart(2, "0")}:00`,
  };
}

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => showPanel(button.dataset.target));
});
document.querySelectorAll("[data-open-panel]").forEach((button) => {
  button.addEventListener("click", () => showPanel(button.dataset.openPanel));
});
document.getElementById("btn-logout").addEventListener("click", async () => {
  await customerCall(customerApi.auth, "logout");
  window.location.href = "login.html";
});

function clearAvailabilityResults() {
  clearSelectedSpace();
  availableSpaces = [];
  availabilityRequestId += 1;
  document.getElementById("available-spaces").replaceChildren();
}

document.getElementById("booking-date").addEventListener("input", () => {
  updateBookingSlots();
  clearAvailabilityResults();
});
document.getElementById("booking-slot").addEventListener("change", clearAvailabilityResults);
document.getElementById("booking-people").addEventListener("input", clearAvailabilityResults);

document
  .getElementById("availability-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSelectedSpace();
    const slot = getSelectedSlot();
    if (!slot) {
      setCustomerMessage("availability-message", "Choose an available time slot.");
      return;
    }
    const search = {
      date: document.getElementById("booking-date").value,
      start: slot.start,
      end: slot.end,
      people: document.getElementById("booking-people").value,
    };
    const requestId = ++availabilityRequestId;
    const response = await customerCall(customerApi.spaces, "checkAvailability", {
      date: search.date,
      start_time: search.start,
      end_time: search.end,
    });
    if (
      requestId !== availabilityRequestId ||
      search.date !== document.getElementById("booking-date").value ||
      search.start !== getSelectedSlot()?.start ||
      search.end !== getSelectedSlot()?.end ||
      search.people !== document.getElementById("booking-people").value
    ) {
      return;
    }
    if (!response.data.success) {
      setCustomerMessage(
        "availability-message",
        response.data.message || "Could not check availability.",
      );
      document.getElementById("available-spaces").replaceChildren();
      return;
    }

    const people = Number(document.getElementById("booking-people").value);
    availableSpaces = (response.data.data || []).filter(
      (space) => Number(space.capacity) >= people,
    );
    showAvailableSpaces(availableSpaces);
    setCustomerMessage(
      "availability-message",
      `${availableSpaces.length} available space${availableSpaces.length === 1 ? "" : "s"} found.`,
      true,
    );
  });

document
  .getElementById("available-spaces")
  .addEventListener("click", (event) => {
    const button = event.target.closest("[data-space-id]");
    if (!button) return;
    const space = availableSpaces.find(
      (item) => String(item.space_id) === button.dataset.spaceId,
    );
    if (!space) return;
    selectedSpace = {
      id: space.space_id,
      name: space.space_name,
      date: document.getElementById("booking-date").value,
      start: getSelectedSlot().start,
      end: getSelectedSlot().end,
      people: document.getElementById("booking-people").value,
    };
    document.getElementById("selected-space").textContent =
      `${space.space_name} — ${selectedSpace.date}, ${selectedSpace.start}–${selectedSpace.end}; ${selectedSpace.people} people.`;
    document.getElementById("submit-reservation").disabled = false;
  });

document
  .getElementById("customer-reservation-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      !selectedSpace ||
      selectedSpace.date !== document.getElementById("booking-date").value ||
      selectedSpace.start !== getSelectedSlot()?.start ||
      selectedSpace.end !== getSelectedSlot()?.end ||
      selectedSpace.people !== document.getElementById("booking-people").value
    ) {
      setCustomerMessage(
        "reservation-message",
        "Check availability and select a space before submitting.",
      );
      return;
    }

    const response = await customerCall(customerApi.reservations, "create", {
      space_id: selectedSpace.id,
      reservation_date: selectedSpace.date,
      start_time: selectedSpace.start,
      end_time: selectedSpace.end,
      number_of_people: selectedSpace.people,
    });
    if (!response.data.success) {
      setCustomerMessage(
        "reservation-message",
        response.data.message || "Reservation could not be submitted.",
      );
      return;
    }

    setCustomerMessage(
      "reservation-message",
      response.data.message ||
        `Reservation request #${response.data.reservation_id} submitted.`,
      response.data.email_sent === true,
    );
    clearSelectedSpace();
    await loadReservations();
  });

(async function initializeCustomerDashboard() {
  const response = await customerCall(customerApi.auth, "me");
  if (!response.data.success || response.data.account_type !== "customer") {
    window.location.href = "login.html";
    return;
  }
  customer = response.data.customer;
  const fullName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
  document.getElementById("customer-name").textContent = fullName || "Customer";
  document.getElementById("welcome-heading").textContent =
    `Welcome${fullName ? `, ${fullName}` : ""} to GEMINILE STUDY HUB!`;
  document.getElementById("customer-avatar").textContent =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "C";
  setTodayAsMinimum();
  await loadReservations();
})();
