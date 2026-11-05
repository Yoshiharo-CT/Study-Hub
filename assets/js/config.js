// Resolves the API folder relative to wherever this project is served from,
// so it works whether it's at http://localhost/Study%20Hub/ or a subfolder.
const baseApiUrl = (() => {
  const path = window.location.pathname;
  const dir = path.substring(0, path.lastIndexOf("/"));
  return `${dir}/api`;
})();

const themeStorageKey = "study-hub-theme";

function applyTheme() {
  document.documentElement.dataset.theme = "light";
  try {
    localStorage.setItem(themeStorageKey, "light");
  } catch {}
}

applyTheme();

const writeOperationMessages = {
  "auth.php": {
    login: "Login successful.",
    memberRegister:
      "Your account has been created successfully. Please sign in to continue.",
    logout: "You have been logged out.",
  },
  "customers.php": { add: "Customer created successfully." },
  "spaces.php": {
    addType: "Space type created successfully.",
    addSpace: "Study space created successfully.",
    scheduleMaintenance: "Maintenance scheduled successfully.",
    completeMaintenance: "Maintenance completed successfully.",
    updateStatus: "Space status updated successfully.",
  },
  "reservations.php": {
    create: "Reservation request submitted.",
    confirm: "Reservation confirmed.",
    cancel: "Reservation cancelled.",
    noShow: "Reservation marked as a no-show.",
  },
  "walkin.php": {
    add: "Customer added to the walk-in queue.",
    cancel: "Walk-in entry cancelled.",
  },
  "sessions.php": {
    checkIn: "Customer checked in successfully.",
    extendSession: "Session extended successfully.",
  },
  "orders.php": { create: "Order placed successfully." },
  "promotions.php": { add: "Promotion created successfully." },
  "billing.php": { create: "Bill created successfully." },
  "payments.php": {
    record: "Payment recorded and is awaiting verification.",
    verify: "Payment verified successfully.",
    reject: "Payment rejected.",
  },
  "staff.php": {
    add: "Staff account created successfully.",
    setStatus: "Staff account status updated.",
  },
  "notifications.php": {
    markRead: "Notification marked as read.",
    markAllRead: "All notifications marked as read.",
  },
  "reports.php": {
    markOverdueNoShows: "Overdue reservations checked successfully.",
  },
};

const readOperations = new Set([
  "me",
  "list",
  "get",
  "roles",
  "listTypes",
  "listSpaces",
  "listMaintenance",
  "listActive",
  "listCategories",
  "listProducts",
  "listPaperSizes",
  "listPrintTypes",
  "activeSession",
  "checkInReservation",
  "options",
  "transactions",
  "methods",
  "checkAvailability",
  "dashboard",
  "spaceAvailability",
  "dailyRevenue",
  "activeSessionsView",
  "auditLog",
  "endOfDay",
]);

let systemMessageTimer;

function showSystemMessage(message, success) {
  let region = document.getElementById("system-message-region");
  if (!region) {
    region = document.createElement("div");
    region.id = "system-message-region";
    region.className = "system-message-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-relevant", "additions text");
    document.body.append(region);
  }

  const notice = document.createElement("div");
  notice.className = `system-message ${success ? "success" : "error"}`;
  notice.setAttribute("role", success ? "status" : "alert");
  const text = document.createElement("span");
  text.textContent = message;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "system-message-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss message");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => notice.remove());
  notice.append(text, dismiss);
  region.replaceChildren(notice);

  window.clearTimeout(systemMessageTimer);
  systemMessageTimer = window.setTimeout(
    () => notice.remove(),
    success ? 6000 : 10000,
  );
}

function reportWriteResponse(url, formData, data) {
  const operation = formData.get("operation");
  if (!operation || (readOperations.has(operation) && data.success)) return;

  const endpoint = new URL(url, window.location.href).pathname.split("/").pop();
  let defaultMessage = data.success
    ? writeOperationMessages[endpoint]?.[operation] ||
      "The action completed successfully."
    : "The action could not be completed.";
  if (endpoint === "sessions.php" && operation === "checkOut" && data.success) {
    defaultMessage = `Checked out. Study fee: ₱${Number(data.study_fee || 0).toFixed(2)}. Remember to bill and collect payment before the customer leaves.`;
  }
  showSystemMessage(
    data.message || defaultMessage,
    Boolean(data.success && data.email_sent !== false),
  );
}

const apiClient = {
  async post(url, formData) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
      const data = await res
        .json()
        .catch(() => ({ success: false, message: "Invalid server response." }));
      reportWriteResponse(url, formData, data);
      return { status: res.status, data };
    } catch (err) {
      const operation = formData.get("operation");
      if (operation) {
        showSystemMessage(`Network error: ${err.message}`, false);
      }
      return {
        status: 0,
        data: { success: false, message: "Network error: " + err.message },
      };
    }
  },

  async get(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
      });
      const data = await res
        .json()
        .catch(() => ({ success: false, message: "Invalid server response." }));
      return { status: res.status, data };
    } catch (err) {
      return {
        status: 0,
        data: { success: false, message: "Network error: " + err.message },
      };
    }
  },
};

// Small helper: build a FormData from a plain object, used all over app.js.
function toFormData(obj) {
  const fd = new FormData();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, v);
  });
  return fd;
}
