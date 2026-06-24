// =========================
// Load backend JSON
// =========================

async function loadBackend() {
  try {
    const response = await fetch("backend.json");
    const backend = await response.json();
    console.log("STEP 1: Loaded backend.recurringPayments:", backend.recurringPayments);
    return backend.recurringPayments;
  } catch (err) {
    console.error("ERROR loading backend:", err);
    return [];
  }
}

// =========================
// Format date helper
// =========================

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// =========================
// Predict next date based on history
// =========================

function predictNextDate(historyDates) {
  console.log("STEP 2: Predicting next date for history:", historyDates);

  if (!historyDates || historyDates.length < 2) {
    console.log("  -> Not enough history, returning null");
    return null;
  }

  // Parse and sort dates safely
  const dates = historyDates
    .map(function (d) {
      const parsed = new Date(d + "T00:00:00Z");
      console.log("  Parsed:", d, "=>", parsed.toISOString());
      return parsed;
    })
    .filter(function (d) {
      return !isNaN(d.getTime());
    })
    .sort(function (a, b) {
      return a.getTime() - b.getTime();
    });

  if (dates.length < 2) {
    console.log("  -> Not enough valid dates after parsing");
    return null;
  }

  // Calculate gaps
  var gaps = [];
  for (var i = 1; i < dates.length; i++) {
    var diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
    gaps.push(Math.round(diff));
  }

  console.log("  Gaps:", gaps);

  // Frequency map
  var freq = {};
  gaps.forEach(function (g) {
    freq[g] = (freq[g] || 0) + 1;
  });

  console.log("  Gap frequency:", freq);

  // Most common gap
  var entries = Object.entries(freq).sort(function (a, b) {
    return b[1] - a[1];
  });

  var mostCommonGap = parseInt(entries[0][0], 10);
  console.log("  Most common gap:", mostCommonGap);

  // Predict next date
  var lastDate = dates[dates.length - 1];
  var next = new Date(lastDate.getTime());
  next.setUTCDate(next.getUTCDate() + mostCommonGap);

  var nextDateStr = next.toISOString().split("T")[0];
  console.log("  Initial predicted next date:", nextDateStr);

  // =========================
  // FIX: Always push into the future
  // =========================
  var today = new Date();
  while (new Date(nextDateStr + "T00:00:00Z") < today) {
    console.log("  Predicted date is in the past, adding gap again...");
    next.setUTCDate(next.getUTCDate() + mostCommonGap);
    nextDateStr = next.toISOString().split("T")[0];
  }

  console.log("  FINAL future-safe next date:", nextDateStr);

  return nextDateStr;
}

// =========================
// Days between two dates
// =========================

function daysBetween(dateStr) {
  if (!dateStr) {
    console.log("STEP 3: daysBetween called with NULL date");
    return 9999;
  }

  var today = new Date();
  var target = new Date(dateStr + "T00:00:00Z");

  console.log("STEP 3: daysBetween:", {
    dateStr: dateStr,
    today: today.toISOString(),
    target: target.toISOString()
  });

  var diff = target - today;
  var days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  console.log("  -> Days difference:", days);

  return days;
}

// =========================
// Render today's date
// =========================

function updateTodayDate() {
  var el = document.getElementById("today");
  var today = new Date();
  el.textContent = today.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// =========================
// Render upcoming payments + MINIMUM BALANCE
// =========================

function renderUpcoming(payments) {
  console.log("STEP 4: Rendering upcoming payments:", payments);

  var list = document.getElementById("upcoming-list");
  var totalEl = document.getElementById("total");

  list.innerHTML = "";
  var found = false;
  var total = 0;

  payments.sort(function (a, b) {
    return new Date(a.nextDate + "T00:00:00Z") - new Date(b.nextDate + "T00:00:00Z");
  });

  payments.forEach(function (p) {
    var days = daysBetween(p.nextDate);

    console.log("STEP 5: Payment check:", {
      name: p.name,
      nextDate: p.nextDate,
      daysBetween: days
    });

    if (days >= 0 && days <= 4) {
      console.log("  -> INCLUDED in total");
      found = true;
      total += p.amount;

      var li = document.createElement("li");
      li.innerHTML =
        '<span class="name">' + p.name + '</span>' +
        '<span class="amount">$' + p.amount.toFixed(2) + '</span><br>' +
        '<span style="font-size:0.8rem;color:#777;">' + formatDate(p.nextDate) + '</span>';
      list.appendChild(li);
    } else {
      console.log("  -> SKIPPED (not in 0-4 day window)");
    }
  });

  console.log("STEP 6: Final total:", total);

  totalEl.textContent = "$" + total.toFixed(2);

  if (!found) {
    list.innerHTML = "<li>No payments detected in the next 4 days.</li>";
    totalEl.textContent = "$0.00";
  }
}

// =========================
// MAIN INIT
// =========================

async function init() {
  updateTodayDate();

  var payments = await loadBackend();
  console.log("STEP 0: Raw payments loaded:", payments);

  payments = payments.map(function (p) {
    var next = predictNextDate(p.history);
    console.log("STEP 2B: Final nextDate for", p.name, "=>", next);
    return {
      name: p.name,
      amount: p.amount,
      category: p.category,
      history: p.history,
      nextDate: next
    };
  });

  console.log("STEP 2C: Payments after prediction:", payments);

  renderUpcoming(payments);
}

init();
