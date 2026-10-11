/* =============================================================
   Social Media Usage & Student Well-being — script.js
   Data source : data.json  (4,500 anonymised student records)
   All values  : derived from actual dataset — nothing fabricated
   ============================================================= */

'use strict';

// ═══════════════════════════════════════════════════════════════
//  §1  CHART.JS GLOBAL DEFAULTS
// ═══════════════════════════════════════════════════════════════
Chart.defaults.font.family                    = "-apple-system, 'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size                      = 11.5;
Chart.defaults.color                          = "#6b7280";
Chart.defaults.plugins.legend.labels.boxWidth = 11;
Chart.defaults.plugins.legend.labels.padding  = 16;
Chart.defaults.plugins.legend.labels.color    = "#374151";
Chart.defaults.plugins.tooltip.backgroundColor = "rgba(17,24,39,0.92)";
Chart.defaults.plugins.tooltip.padding         = 10;
Chart.defaults.plugins.tooltip.titleFont       = { size: 12, weight: "600" };
Chart.defaults.plugins.tooltip.bodyFont        = { size: 11.5 };
Chart.defaults.plugins.tooltip.cornerRadius    = 6;
Chart.defaults.plugins.tooltip.titleColor      = "#fff";
Chart.defaults.plugins.tooltip.bodyColor       = "#d1d5db";
Chart.defaults.plugins.tooltip.borderColor     = "rgba(255,255,255,0.08)";
Chart.defaults.plugins.tooltip.borderWidth     = 1;

// ═══════════════════════════════════════════════════════════════
//  §2  CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════

/** Brand colours per social media platform. */
const PALETTE_PLATFORMS = {
  Instagram:    "#e1306c",
  TikTok:       "#69c9d0",
  YouTube:      "#cc0000",
  Snapchat:     "#f5c800",   // darkened for contrast on white
  "X (Twitter)":"#1d9bf0",
  Reddit:       "#ff4500",
  LinkedIn:     "#0a66c2",
};

/** Colours for Overall_Impact categories. */
const PALETTE_IMPACT = {
  Beneficial: "#22c55e",
  Neutral:    "#f59e0b",
  Negative:   "#ef4444",
};

/** Colour for Low / Moderate / High screen-time groups. */
const PALETTE_SCREENTIME = {
  low:      "#22c55e",
  moderate: "#f59e0b",
  high:     "#ef4444",
};

/**
 * Numeric variables included in the correlation heatmap.
 * Student_ID is intentionally excluded as it is an identifier,
 * not an analytical predictor.
 */
const HEATMAP_VARS = [
  { key: "Age",                      label: "Age" },
  { key: "Daily_Usage_Hours",        label: "Daily Usage" },
  { key: "Weekend_Extra_Hours",      label: "Weekend Extra" },
  { key: "Sleep_Duration_Hours",     label: "Sleep Duration" },
  { key: "Sleep_Quality_Score",      label: "Sleep Quality" },
  { key: "Perceived_Stress_Score",   label: "Stress Score" },
  { key: "Mental_Health_Index",      label: "Mental Health" },
  { key: "Academic_Performance_GPA", label: "GPA" },
];

/** Single source of truth for all filter element IDs. */
const FILTER_IDS = [
  "filter-level",
  "filter-agegroup",
  "filter-gender",
  "filter-platform",
  "filter-latenight",
  "filter-screentime",
  "filter-impact",
];

// ═══════════════════════════════════════════════════════════════
//  §3  APPLICATION STATE
// ═══════════════════════════════════════════════════════════════

/** Original full dataset — never mutated after load. */
let allData = [];

/** Currently visible subset after all active filters. */
let filtered = [];

/**
 * Live Chart.js instances, keyed by a stable chart ID string.
 * Reusing instances (update-in-place) avoids canvas blinking and
 * is more efficient than destroy + recreate on every filter change.
 */
const charts = {};

// ═══════════════════════════════════════════════════════════════
//  §4  DATA LOADING & VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate a single raw record from data.json.
 * Returns true only if the row contains the minimum required fields.
 * Rows that fail are logged and dropped; they are never silently zero-filled.
 *
 * @param {Object} d   - Raw record
 * @param {number} idx - Row index (for diagnostics)
 * @returns {boolean}
 */
function validateRecord(d, idx) {
  if (!d || typeof d !== "object") {
    console.warn(`Row ${idx}: not an object, skipped.`);
    return false;
  }
  // Student_ID must exist but is used only for deduplication, never as a predictor
  if (!d.Student_ID || typeof d.Student_ID !== "string") {
    console.warn(`Row ${idx}: missing Student_ID, skipped.`);
    return false;
  }
  // Daily_Usage_Hours must be a finite number (it drives screen-time grouping)
  if (d.Daily_Usage_Hours == null || !isFinite(d.Daily_Usage_Hours)) {
    console.warn(`Row ${idx} (${d.Student_ID}): invalid Daily_Usage_Hours, skipped.`);
    return false;
  }
  return true;
}

/**
 * Attach derived fields to every record once at load time.
 * Derived fields are prefixed with "_" to distinguish them from source columns.
 *
 * Age_Group boundaries (inclusive, no overlap):
 *   15–17 → "15-17"
 *   18–21 → "18-21"
 *   22–26 → "22-26"
 *
 * _screenTime: "low" | "moderate" | "high"
 *   Low      : 0 ≤ h ≤ 3
 *   Moderate : 3 < h ≤ 6
 *   High     : h > 6
 *
 * @param {Object} d - Validated record
 */
function attachDerivedFields(d) {
  const age = d.Age;
  if      (age >= 15 && age <= 17) d._ageGroup = "15-17";
  else if (age >= 18 && age <= 21) d._ageGroup = "18-21";
  else if (age >= 22 && age <= 26) d._ageGroup = "22-26";
  else                              d._ageGroup = "other";

  const h = d.Daily_Usage_Hours;
  if      (h <= 3)             d._screenTime = "low";
  else if (h > 3 && h <= 6)   d._screenTime = "moderate";
  else                          d._screenTime = "high";
}

/**
 * Load data.json, validate, attach derived fields, then initialise the dashboard.
 * Displays the error banner if the fetch fails (e.g., file:// restriction).
 */
fetch("data.json")
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${r.statusText}`);
    return r.json();
  })
  .then(raw => {
    // Validate every row; drop malformed ones without modifying survivors
    const valid = raw.filter((d, i) => validateRecord(d, i));
    const dropped = raw.length - valid.length;
    if (dropped > 0) console.warn(`${dropped} row(s) dropped during validation.`);

    valid.forEach(attachDerivedFields);

    allData  = valid;
    filtered = valid;

    // Update header counters
    const n = valid.length.toLocaleString();
    setText("total-count",        n);
    setText("total-count-filter", n);

    // Update header status indicator
    const dot  = document.getElementById("status-dot");
    const lbl  = document.getElementById("status-label");
    const wrap = document.getElementById("header-count-wrap");
    if (dot)  dot.className      = "status-dot is-loaded";
    if (lbl)  lbl.textContent    = "Dataset loaded";
    if (wrap) wrap.classList.remove("hidden");

    buildFilterOptions(valid);
    bindFilters();
    renderAll(valid);

    document.getElementById("loading-overlay").classList.add("hidden");
    document.getElementById("main-content").classList.remove("hidden");
  })
  .catch(err => {
    console.error("Dashboard data load failed:", err);
    const dot = document.getElementById("status-dot");
    const lbl = document.getElementById("status-label");
    if (dot) dot.className   = "status-dot is-error";
    if (lbl) lbl.textContent = "Failed to load";
    document.getElementById("loading-overlay").classList.add("hidden");
    document.getElementById("error-banner").classList.remove("hidden");
  });

// ═══════════════════════════════════════════════════════════════
//  §5  FILTER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Populate dynamic <select> elements from the actual dataset values.
 * Only Academic_Level, Gender, Primary_Platform, and Overall_Impact are
 * populated dynamically. Age Group and Screen Time use static HTML options.
 *
 * @param {Object[]} data - Full validated dataset
 */
function buildFilterOptions(data) {
  const uniq = key =>
    [...new Set(data.map(d => d[key]))].filter(Boolean).sort();

  populateSelect("filter-level",    uniq("Academic_Level"));
  populateSelect("filter-gender",   uniq("Gender"));
  populateSelect("filter-platform", uniq("Primary_Platform"));
  populateSelect("filter-impact",   uniq("Overall_Impact"));
}

/**
 * Append <option> elements to a <select>.
 * Skips population if the element is not found.
 *
 * @param {string}   id     - Element ID
 * @param {string[]} values - Option values / labels
 */
function populateSelect(id, values) {
  const sel = document.getElementById(id);
  if (!sel) return;
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = opt.textContent = v;
    sel.appendChild(opt);
  });
}

/**
 * Attach 'change' listeners to all filter controls using FILTER_IDS.
 * The Reset button restores every control to "" then calls applyFilters().
 * A single shared function (applyFilters) handles all filter logic.
 */
function bindFilters() {
  FILTER_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", applyFilters);
  });
  const reset = document.getElementById("reset-filters");
  if (reset) {
    reset.addEventListener("click", () => {
      FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      applyFilters();
    });
  }
}

/**
 * Read all active filter values, apply them in a single pass over allData,
 * update the record counter and active-filter chips, then re-render.
 *
 * Late-Night Usage maps:  "yes" → d.Late_Night_Usage === true
 *                         "no"  → d.Late_Night_Usage === false
 * Screen Time Range uses the pre-computed d._screenTime derived field.
 * Age Group         uses the pre-computed d._ageGroup  derived field.
 *
 * Rows are NOT removed globally because a different column has a missing value.
 * Chart-specific missing-value exclusions are handled inside each chart function.
 */
function applyFilters() {
  const level      = val("filter-level");
  const ageGroup   = val("filter-agegroup");
  const gender     = val("filter-gender");
  const platform   = val("filter-platform");
  const latenight  = val("filter-latenight");   // "yes" | "no" | ""
  const screentime = val("filter-screentime");  // "low" | "moderate" | "high" | ""
  const impact     = val("filter-impact");

  filtered = allData.filter(d => {
    if (level      && d.Academic_Level   !== level)     return false;
    if (ageGroup   && d._ageGroup        !== ageGroup)  return false;
    if (gender     && d.Gender           !== gender)    return false;
    if (platform   && d.Primary_Platform !== platform)  return false;
    if (latenight === "yes" && !d.Late_Night_Usage)     return false;
    if (latenight === "no"  &&  d.Late_Night_Usage)     return false;
    if (screentime && d._screenTime      !== screentime) return false;
    if (impact     && d.Overall_Impact   !== impact)    return false;
    return true;
  });

  setText("filtered-count", filtered.length.toLocaleString());
  updateActiveChips({ level, ageGroup, gender, platform, latenight, screentime, impact });
  renderAll(filtered);
}

/** Human-readable labels for each active filter chip. */
const CHIP_LABELS = {
  level:      v => `Level: ${v}`,
  ageGroup:   v => `Age: ${v.replace("-", "–")} yrs`,
  gender:     v => `Gender: ${v}`,
  platform:   v => `Platform: ${v}`,
  latenight:  v => `Late Night: ${v === "yes" ? "Yes" : "No"}`,
  screentime: v => ({ low: "Screen Time: Low", moderate: "Screen Time: Moderate", high: "Screen Time: High" }[v]),
  impact:     v => `Impact: ${v}`,
};

/**
 * Rebuild the filter-chip row to reflect currently active filters.
 * Chips are informational only; they do not need click-to-remove behaviour here.
 *
 * @param {Object} vals - Map of filterKey → current value string
 */
function updateActiveChips(vals) {
  const container = document.getElementById("active-filter-chips");
  if (!container) return;
  container.innerHTML = "";
  Object.entries(vals).forEach(([key, v]) => {
    if (!v) return;
    const chip = document.createElement("span");
    chip.className   = "filter-chip";
    chip.textContent = CHIP_LABELS[key]?.(v) ?? v;
    chip.setAttribute("role", "listitem");
    container.appendChild(chip);
  });
}

// ═══════════════════════════════════════════════════════════════
//  §6  DATA AGGREGATION HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the mean of a numeric field, skipping null, undefined, and NaN.
 * NEVER treats a missing value as zero.
 *
 * @param {Object[]} arr - Array of records
 * @param {string}   key - Field name
 * @returns {number} Mean, or NaN if no valid observations exist
 */
function avg(arr, key) {
  const valid = arr.filter(d => d[key] != null && isFinite(d[key]));
  if (!valid.length) return NaN;
  return valid.reduce((s, d) => s + d[key], 0) / valid.length;
}

/**
 * Count valid (non-null, finite) observations for a field.
 *
 * @param {Object[]} arr - Array of records
 * @param {string}   key - Field name
 * @returns {number}
 */
function countValid(arr, key) {
  return arr.filter(d => d[key] != null && isFinite(d[key])).length;
}

/**
 * Group an array by a categorical field.
 *
 * @param {Object[]} arr - Array of records
 * @param {string}   key - Grouping field name
 * @returns {Object} { value: [records...], ... }
 */
function groupBy(arr, key) {
  return arr.reduce((acc, d) => {
    const k = d[key];
    (acc[k] = acc[k] || []).push(d);
    return acc;
  }, {});
}

/**
 * Format a number to a fixed number of decimals.
 * Returns "—" for null or NaN, maintaining analytical honesty.
 *
 * @param {number} n   - Value
 * @param {number} dec - Decimal places (default 2)
 * @returns {string}
 */
function fmt(n, dec = 2) {
  return n == null || !isFinite(n) ? "—" : n.toFixed(dec);
}

/**
 * Safe avg for Chart.js: returns null (skipped by Chart.js) instead of NaN.
 * Optionally scales the result before returning.
 *
 * @param {Object[]} arr   - Records
 * @param {string}   key   - Field name
 * @param {number}   scale - Multiplier (default 1)
 * @param {number}   dec   - Decimal places (default 2)
 * @returns {number|null}
 */
function safeAvg(arr, key, scale = 1, dec = 2) {
  const v = avg(arr, key);
  return isNaN(v) ? null : +(v * scale).toFixed(dec);
}

// ═══════════════════════════════════════════════════════════════
//  §7  STATISTICAL MATH
// ═══════════════════════════════════════════════════════════════

/**
 * Pearson correlation coefficient using pairwise complete observations.
 * Student_ID is never passed to this function as a variable.
 *
 * Returns NaN when:
 *   - fewer than 2 valid pairs exist
 *   - either variable has zero variance
 *
 * This function computes a descriptive statistic only.
 * The result must not be interpreted as evidence of causation.
 *
 * @param {Object[]} arr  - Records
 * @param {string}   keyX - X-variable field name
 * @param {string}   keyY - Y-variable field name
 * @returns {number}  r ∈ [−1, 1], or NaN
 */
function pearsonR(arr, keyX, keyY) {
  const pairs = arr.filter(d =>
    d[keyX] != null && isFinite(d[keyX]) &&
    d[keyY] != null && isFinite(d[keyY])
  );
  const n = pairs.length;
  if (n < 2) return NaN;

  const mX = pairs.reduce((s, d) => s + d[keyX], 0) / n;
  const mY = pairs.reduce((s, d) => s + d[keyY], 0) / n;

  let num = 0, dX = 0, dY = 0;
  pairs.forEach(d => {
    const dx = d[keyX] - mX;
    const dy = d[keyY] - mY;
    num += dx * dy;
    dX  += dx * dx;
    dY  += dy * dy;
  });

  if (dX === 0 || dY === 0) return NaN;  // zero variance — r undefined
  return num / Math.sqrt(dX * dY);
}

/**
 * Ordinary least-squares linear regression using pairwise complete observations.
 *
 * @param {Object[]} arr  - Records
 * @param {string}   keyX - Predictor field name
 * @param {string}   keyY - Outcome field name
 * @returns {{ slope: number, intercept: number }|null}
 */
function linearRegression(arr, keyX, keyY) {
  const pairs = arr.filter(d =>
    d[keyX] != null && isFinite(d[keyX]) &&
    d[keyY] != null && isFinite(d[keyY])
  );
  const n = pairs.length;
  if (n < 2) return null;

  const mX = pairs.reduce((s, d) => s + d[keyX], 0) / n;
  const mY = pairs.reduce((s, d) => s + d[keyY], 0) / n;

  let num = 0, den = 0;
  pairs.forEach(d => {
    const dx = d[keyX] - mX;
    num += dx * (d[keyY] - mY);
    den += dx * dx;
  });

  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: mY - slope * mX, n };
}

/**
 * Build a 2-point trend-line dataset for Chart.js (type: "line")
 * spanning the observed x-range of valid records.
 *
 * @param {Object[]}                     arr   - Records (for x-range)
 * @param {string}                       keyX  - X field name
 * @param {{ slope:number, intercept:number }|null} reg - Regression result
 * @param {string}                       color - CSS colour
 * @returns {Object|null}  Chart.js dataset or null if reg is null
 */
function trendDataset(arr, keyX, reg, color) {
  if (!reg) return null;
  const xs = arr.map(d => d[keyX]).filter(v => v != null && isFinite(v));
  if (xs.length < 2) return null;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  return {
    type:        "line",
    label:       "Trend line (OLS)",
    data:        [
      { x: xMin, y: reg.slope * xMin + reg.intercept },
      { x: xMax, y: reg.slope * xMax + reg.intercept },
    ],
    borderColor: color,
    borderWidth: 2,
    borderDash:  [5, 4],
    pointRadius: 0,
    fill:        false,
    tension:     0,
    order:       0,   // render behind scatter points
  };
}

// ═══════════════════════════════════════════════════════════════
//  §8  HEATMAP COLOR HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Diverging cell background colour: blue (r=+1) → white (r=0) → red (r=−1).
 * Returns a neutral grey for NaN (insufficient data).
 *
 * @param {number} r - Pearson correlation coefficient
 * @returns {string} CSS rgb() colour
 */
function heatmapColor(r) {
  if (!isFinite(r)) return "#e9ecef";
  const t = Math.max(-1, Math.min(1, r));
  if (t >= 0) {
    const k = t;
    return `rgb(${Math.round(255 + (26  - 255) * k)},${Math.round(255 + (86  - 255) * k)},${Math.round(255 + (160 - 255) * k)})`;
  } else {
    const k = -t;
    return `rgb(${Math.round(255 + (192 - 255) * k)},${Math.round(255 + (57  - 255) * k)},${Math.round(255 + (43  - 255) * k)})`;
  }
}

/**
 * Choose a legible text colour for a heatmap cell.
 * Dark grey for near-zero; white for strongly coloured cells.
 *
 * @param {number} r
 * @returns {string}
 */
function heatmapTextColor(r) {
  return (!isFinite(r) || Math.abs(r) < 0.35) ? "#374151" : "#fff";
}

// ═══════════════════════════════════════════════════════════════
//  §9  CHART INSTANCE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Update an existing Chart.js instance with new data and options.
 * If no instance exists yet, create one.
 * Update-in-place avoids canvas blinking and is more efficient.
 *
 * @param {string} id      - Key in the `charts` registry (also canvas element ID prefix)
 * @param {string} canvasId - DOM id of the <canvas> element
 * @param {Object} config  - Full Chart.js config object { type, data, options }
 */
function upsertChart(id, canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (charts[id]) {
    const ch = charts[id];
    // Determine if the structure is compatible with an in-place update.
    // A safe in-place update is only possible when:
    //   (a) the chart type hasn't changed, AND
    //   (b) the number of labels hasn't changed (avoids stale internal index state)
    const sameType   = ch.config.type === config.type;
    const oldLen     = ch.data.labels ? ch.data.labels.length : ch.data.datasets[0]?.data.length;
    const newLen     = config.data.labels ? config.data.labels.length : config.data.datasets[0]?.data.length;
    const sameLength = oldLen === newLen;

    if (sameType && sameLength) {
      // Safe to update in-place — no canvas flash, no re-animation
      ch.data    = config.data;
      ch.options = config.options;
      ch.update("none");
    } else {
      // Dimension or type changed — destroy and recreate cleanly
      ch.destroy();
      delete charts[id];
      charts[id] = new Chart(canvas, config);
    }
  } else {
    charts[id] = new Chart(canvas, config);
  }
}

// ═══════════════════════════════════════════════════════════════
//  §10  EMPTY-STATE & MISSING-DATA HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Show or hide the per-chart missing-data annotation element.
 * The element id convention is: `<canvasId>-info`
 *
 * @param {string} canvasId - Canvas element ID
 * @param {string} text     - Message to display (empty string = hide)
 */
function setChartInfo(canvasId, text) {
  const el = document.getElementById(`${canvasId}-info`);
  if (!el) return;
  if (text) {
    el.textContent = text;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

/**
 * Show or hide the per-chart empty-state overlay.
 * The element id convention is: `<canvasId>-empty`
 *
 * @param {string}  canvasId - Canvas element ID
 * @param {boolean} isEmpty  - Whether to show the empty state
 */
function setChartEmpty(canvasId, isEmpty) {
  const emptyEl  = document.getElementById(`${canvasId}-empty`);
  const canvas   = document.getElementById(canvasId);
  if (emptyEl) emptyEl.classList.toggle("hidden", !isEmpty);
  if (canvas)  canvas.classList.toggle("invisible", isEmpty);
}

// ═══════════════════════════════════════════════════════════════
//  §11  KPI CARDS
// ═══════════════════════════════════════════════════════════════

/**
 * Toggle between the value/unit display and the empty-state message
 * for a single KPI card.
 *
 * @param {string} valueId  - Element ID of the value <p>
 * @param {string} unitId   - Element ID of the unit <p>
 * @param {string} emptyId  - Element ID of the empty-state <p>
 * @param {number} value    - Computed value (NaN triggers empty state)
 * @param {string} formatted - Pre-formatted display string
 */
function setKPI(valueId, unitId, emptyId, value, formatted) {
  const valEl   = document.getElementById(valueId);
  const unitEl  = document.getElementById(unitId);
  const emptyEl = document.getElementById(emptyId);
  if (!valEl || !unitEl || !emptyEl) return;

  const missing = value == null || !isFinite(value);
  valEl.textContent = missing ? "—" : formatted;
  unitEl.classList.toggle("hidden",  missing);
  emptyEl.classList.toggle("hidden", !missing);
}

/**
 * Recalculate and render all four KPI cards for the given dataset.
 *
 * KPI 1 — Total Respondents: unique Student_ID count.
 * KPI 2 — Avg Daily Screen Time: mean of Daily_Usage_Hours (valid only).
 * KPI 3 — Avg Sleep Duration: mean of Sleep_Duration_Hours (valid only).
 * KPI 4 — Avg Mental Health Index: mean of Mental_Health_Index (valid only).
 *
 * Missing values in any single field do NOT cause the row to be dropped
 * from the other three KPI calculations.
 *
 * @param {Object[]} data - Filtered dataset
 */
function updateKPIs(data) {
  // KPI 1 — Total Respondents (unique Student_IDs)
  const uniqueIds   = new Set(data.map(d => d.Student_ID));
  const respondentEl    = document.getElementById("kpi-respondents");
  const respondentUnit  = document.getElementById("kpi-respondents-unit");
  const respondentEmpty = document.getElementById("kpi-respondents-empty");
  if (respondentEl) {
    if (uniqueIds.size === 0) {
      respondentEl.textContent = "—";
      respondentUnit?.classList.add("hidden");
      respondentEmpty?.classList.remove("hidden");
    } else {
      respondentEl.textContent = uniqueIds.size.toLocaleString();
      respondentUnit?.classList.remove("hidden");
      respondentEmpty?.classList.add("hidden");
    }
  }

  // KPI 2 — Avg Daily Screen Time
  const usageAvg = avg(data, "Daily_Usage_Hours");
  setKPI("kpi-usage", "kpi-usage-unit", "kpi-usage-empty", usageAvg, fmt(usageAvg, 1));

  // KPI 3 — Avg Sleep Duration
  const sleepAvg = avg(data, "Sleep_Duration_Hours");
  setKPI("kpi-sleep", "kpi-sleep-unit", "kpi-sleep-empty", sleepAvg, fmt(sleepAvg, 1));

  // KPI 4 — Avg Mental Health Index
  const mhiAvg = avg(data, "Mental_Health_Index");
  setKPI("kpi-mhi", "kpi-mhi-unit", "kpi-mhi-empty", mhiAvg, fmt(mhiAvg, 1));
}

// ═══════════════════════════════════════════════════════════════
//  §12  RENDER ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Re-render every dashboard component for the given (filtered) dataset.
 * Call order mirrors visual top-to-bottom section order.
 * Each component function receives the same filtered slice so all
 * visualisations are consistent, except for chart-specific missing-value
 * exclusions applied inside individual chart functions.
 *
 * @param {Object[]} data - Filtered dataset
 */
function renderAll(data) {
  setText("filtered-count", data.length.toLocaleString());

  updateKPIs(data);          // §11

  chart1_platform(data);     // Usage Patterns
  chart2_scatterSleep(data); // Sleep & Well-being
  chart3_scatterStress(data);
  chart4_sleepQualityLatenight(data);
  chart5_mhiScreenTime(data);
  chart6_gpaScreenTime(data);    // Academic Outcomes & Overall Impact
  chart7_impact(data);
  chart8_heatmap(data);          // Correlation Explorer
}

// ═══════════════════════════════════════════════════════════════
//  §13  CHART 1 — Daily Screen Time by Platform
//       Horizontal bar · sorted by mean · update-in-place
// ═══════════════════════════════════════════════════════════════
function chart1_platform(data) {
  const grp = groupBy(data, "Primary_Platform");

  // Only keep platforms with at least one valid usage record
  const platforms = Object.keys(grp).filter(p =>
    countValid(grp[p], "Daily_Usage_Hours") > 0
  );

  // Sort descending by mean daily usage
  platforms.sort((a, b) =>
    avg(grp[b], "Daily_Usage_Hours") - avg(grp[a], "Daily_Usage_Hours")
  );

  const avgs   = platforms.map(p => +avg(grp[p], "Daily_Usage_Hours").toFixed(2));
  const ns     = platforms.map(p => countValid(grp[p], "Daily_Usage_Hours"));
  const colors = platforms.map(p => PALETTE_PLATFORMS[p] || "#6366f1");

  const isEmpty = platforms.length === 0;
  setChartEmpty("chart-c1-platform", isEmpty);

  if (!isEmpty) {
    upsertChart("c1-platform", "chart-c1-platform", {
      type: "bar",
      data: {
        labels: platforms,
        datasets: [{
          label: "Mean Daily Usage (hrs)",
          data: avgs,
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => items[0].label,
              label: ctx => {
                const n = ns[ctx.dataIndex];
                return ` Mean: ${ctx.parsed.x} hrs/day  ·  n = ${n.toLocaleString()} respondents`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: "#f3f4f6" },
            title: { display: true, text: "Mean Daily Usage (hours / day)" },
          },
          y: { grid: { display: false } },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §14  CHART 2 — Screen Time vs Sleep Duration
//       Scatter + OLS trend line · Pearson r badge · update-in-place
// ═══════════════════════════════════════════════════════════════
function chart2_scatterSleep(data) {
  // Exclude rows missing either variable for this chart only.
  // Rows with missing values in OTHER columns are still included.
  const valid = data.filter(d =>
    d.Daily_Usage_Hours   != null && isFinite(d.Daily_Usage_Hours) &&
    d.Sleep_Duration_Hours != null && isFinite(d.Sleep_Duration_Hours)
  );
  const nTotal   = data.length;
  const nValid   = valid.length;
  const nMissing = nTotal - nValid;

  const r   = pearsonR(valid, "Daily_Usage_Hours", "Sleep_Duration_Hours");
  const reg = linearRegression(valid, "Daily_Usage_Hours", "Sleep_Duration_Hours");

  // Update Pearson r badge
  const rText = isNaN(r)
    ? "r = insufficient data"
    : `r = ${r.toFixed(3)}  ·  n = ${nValid.toLocaleString()} valid pairs  ·  (correlation ≠ causation)`;
  setText("c2-stat", rText);
  if (nMissing > 0) setChartInfo("chart-c2-scatter-sleep",
    `${nMissing.toLocaleString()} row(s) excluded from this chart (missing Daily_Usage_Hours or Sleep_Duration_Hours).`);
  else setChartInfo("chart-c2-scatter-sleep", "");

  const isEmpty = nValid === 0;
  setChartEmpty("chart-c2-scatter-sleep", isEmpty);

  if (!isEmpty) {
    const scatter = valid.map(d => ({ x: d.Daily_Usage_Hours, y: d.Sleep_Duration_Hours }));
    const trend   = trendDataset(valid, "Daily_Usage_Hours", reg, "rgba(239,68,68,0.85)");

    upsertChart("c2-scatter-sleep", "chart-c2-scatter-sleep", {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Respondents",
            data: scatter,
            backgroundColor: "rgba(79,70,229,0.2)",
            pointRadius: 2.5,
            pointHoverRadius: 5,
            order: 1,
          },
          ...(trend ? [trend] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.datasetIndex === 0,
            callbacks: {
              title: () => "Respondent",
              label: ctx =>
                ` Screen time: ${ctx.parsed.x} hrs/day  ·  Sleep: ${ctx.parsed.y} hrs/night`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Daily Screen Time (hrs / day)" },
            grid: { color: "#f3f4f6" },
          },
          y: {
            title: { display: true, text: "Sleep Duration (hrs / night)" },
            grid: { color: "#f3f4f6" },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §15  CHART 3 — Screen Time vs Perceived Stress
//       Scatter + OLS trend · missing stress rows excluded this chart only
// ═══════════════════════════════════════════════════════════════
function chart3_scatterStress(data) {
  // Rows missing Perceived_Stress_Score are excluded from this chart ONLY.
  // They remain in the global filtered dataset and appear in all other charts.
  // Missing stress values are NEVER replaced with zero.
  const valid = data.filter(d =>
    d.Daily_Usage_Hours     != null && isFinite(d.Daily_Usage_Hours) &&
    d.Perceived_Stress_Score != null && isFinite(d.Perceived_Stress_Score)
  );
  const nTotal   = data.length;
  const nValid   = valid.length;
  const nMissing = nTotal - nValid;

  const r   = pearsonR(valid, "Daily_Usage_Hours", "Perceived_Stress_Score");
  const reg = linearRegression(valid, "Daily_Usage_Hours", "Perceived_Stress_Score");

  const rText = isNaN(r)
    ? "r = insufficient data"
    : `r = ${r.toFixed(3)}  ·  n = ${nValid.toLocaleString()} valid observations  ·  (correlation ≠ causation)`;
  setText("c3-stat", rText);
  if (nMissing > 0) setChartInfo("chart-c3-scatter-stress",
    `${nMissing.toLocaleString()} row(s) excluded from this chart (missing Perceived_Stress_Score).`);
  else setChartInfo("chart-c3-scatter-stress", "");

  const isEmpty = nValid === 0;
  setChartEmpty("chart-c3-scatter-stress", isEmpty);

  if (!isEmpty) {
    const scatter = valid.map(d => ({ x: d.Daily_Usage_Hours, y: d.Perceived_Stress_Score }));
    const trend   = trendDataset(valid, "Daily_Usage_Hours", reg, "rgba(239,68,68,0.85)");

    upsertChart("c3-scatter-stress", "chart-c3-scatter-stress", {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Respondents",
            data: scatter,
            backgroundColor: "rgba(13,148,136,0.2)",
            pointRadius: 2.5,
            pointHoverRadius: 5,
            order: 1,
          },
          ...(trend ? [trend] : []),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.datasetIndex === 0,
            callbacks: {
              title: () => "Respondent",
              label: ctx =>
                ` Screen time: ${ctx.parsed.x} hrs/day  ·  Stress score: ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Daily Screen Time (hrs / day)" },
            grid: { color: "#f3f4f6" },
          },
          y: {
            title: { display: true, text: "Perceived Stress Score (self-reported)" },
            grid: { color: "#f3f4f6" },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §16  CHART 4 — Sleep Quality by Late-Night Usage
//       Grouped bar · valid sleep quality scores only
// ═══════════════════════════════════════════════════════════════
function chart4_sleepQualityLatenight(data) {
  // Split by Late_Night_Usage; filter to valid Sleep_Quality_Score within each group.
  // Rows are split by the Late_Night_Usage boolean, not excluded globally.
  const yes = data.filter(d =>  d.Late_Night_Usage && d.Sleep_Quality_Score != null && isFinite(d.Sleep_Quality_Score));
  const no  = data.filter(d => !d.Late_Night_Usage && d.Sleep_Quality_Score != null && isFinite(d.Sleep_Quality_Score));

  const avgYes = avg(yes, "Sleep_Quality_Score");
  const avgNo  = avg(no,  "Sleep_Quality_Score");

  const labels = ["Yes (Late-Night)", "No (Late-Night)"];
  const values = [isNaN(avgYes) ? null : +avgYes.toFixed(2), isNaN(avgNo) ? null : +avgNo.toFixed(2)];
  const ns     = [yes.length, no.length];

  const isEmpty = ns[0] + ns[1] === 0;
  setChartEmpty("chart-c4-sleepquality", isEmpty);

  if (!isEmpty) {
    upsertChart("c4-sleepquality", "chart-c4-sleepquality", {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Mean Sleep Quality Score",
          data: values,
          backgroundColor: ["rgba(239,68,68,0.75)", "rgba(79,70,229,0.75)"],
          borderRadius: 5,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => items[0].label,
              label: ctx => {
                const n = ns[ctx.dataIndex];
                const v = ctx.parsed.y;
                return ` Mean score: ${v != null ? v : "—"}  ·  n = ${n.toLocaleString()} respondents`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            max: 5,
            title: { display: true, text: "Mean Sleep Quality Score (1 – 5 scale)" },
            grid: { color: "#f3f4f6" },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §17  CHART 5 — Mental Health Index by Screen Time Group
//       Bar · Low → Moderate → High · analytical grouping note
// ═══════════════════════════════════════════════════════════════
function chart5_mhiScreenTime(data) {
  const groups  = ["low", "moderate", "high"];
  const labels  = ["Low (0–3 hrs)", "Moderate (3–6 hrs)", "High (>6 hrs)"];
  const colors  = [PALETTE_SCREENTIME.low, PALETTE_SCREENTIME.moderate, PALETTE_SCREENTIME.high];

  // Within each screen-time group, exclude rows missing Mental_Health_Index.
  // The _screenTime field was computed from Daily_Usage_Hours at load time.
  const subsets = groups.map(g =>
    data.filter(d => d._screenTime === g && d.Mental_Health_Index != null && isFinite(d.Mental_Health_Index))
  );
  const avgs = subsets.map(s => { const v = avg(s, "Mental_Health_Index"); return isNaN(v) ? null : +v.toFixed(1); });
  const ns   = subsets.map(s => s.length);

  const isEmpty = ns.every(n => n === 0);
  setChartEmpty("chart-c5-mhi-screentime", isEmpty);

  if (!isEmpty) {
    upsertChart("c5-mhi-screentime", "chart-c5-mhi-screentime", {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Mean Mental Health Index",
          data: avgs,
          backgroundColor: colors,
          borderRadius: 5,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => items[0].label,
              label: ctx => {
                const n = ns[ctx.dataIndex];
                return ` Mean MHI: ${ctx.parsed.y != null ? ctx.parsed.y : "—"}  ·  n = ${n.toLocaleString()} respondents`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: false,
            title: { display: true, text: "Mean Mental Health Index (0 – 100)" },
            grid: { color: "#f3f4f6" },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §18  CHART 6 — Academic Performance (GPA) by Screen Time
//       Bar of means · missing GPA excluded this chart only
// ═══════════════════════════════════════════════════════════════
function chart6_gpaScreenTime(data) {
  const groups  = ["low", "moderate", "high"];
  const labels  = ["Low (0–3 hrs)", "Moderate (3–6 hrs)", "High (>6 hrs)"];
  const colors  = [PALETTE_SCREENTIME.low, PALETTE_SCREENTIME.moderate, PALETTE_SCREENTIME.high];

  // Missing GPA is excluded from this chart ONLY — rows are NOT dropped globally.
  // Missing GPA is never treated as zero.
  const subsets = groups.map(g =>
    data.filter(d => d._screenTime === g && d.Academic_Performance_GPA != null && isFinite(d.Academic_Performance_GPA))
  );
  const avgs = subsets.map(s => { const v = avg(s, "Academic_Performance_GPA"); return isNaN(v) ? null : +v.toFixed(3); });
  const ns   = subsets.map(s => s.length);

  // Y-axis range derived from actual data values, not assumed to be 0–4
  const validAvgs = avgs.filter(v => v != null);
  const yMin = validAvgs.length
    ? Math.max(0,   Math.floor((Math.min(...validAvgs) - 0.1) * 10) / 10)
    : 0;
  const yMax = validAvgs.length
    ? Math.min(4.0, Math.ceil( (Math.max(...validAvgs) + 0.1) * 10) / 10)
    : 4.0;

  const nMissingGPA = data.filter(d => d.Academic_Performance_GPA == null || !isFinite(d.Academic_Performance_GPA)).length;
  if (nMissingGPA > 0) setChartInfo("chart-c6-gpa-screentime",
    `${nMissingGPA.toLocaleString()} row(s) excluded from this chart (missing Academic_Performance_GPA).`);
  else setChartInfo("chart-c6-gpa-screentime", "");

  const isEmpty = ns.every(n => n === 0);
  setChartEmpty("chart-c6-gpa-screentime", isEmpty);

  if (!isEmpty) {
    upsertChart("c6-gpa-screentime", "chart-c6-gpa-screentime", {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Mean GPA",
          data: avgs,
          backgroundColor: colors,
          borderRadius: 5,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => items[0].label,
              label: ctx => {
                const n = ns[ctx.dataIndex];
                return ` Mean GPA: ${ctx.parsed.y != null ? ctx.parsed.y : "—"}  ·  n = ${n.toLocaleString()} respondents`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: false,
            min: yMin,
            max: yMax,
            title: { display: true, text: "Mean Academic Performance GPA" },
            grid: { color: "#f3f4f6" },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §19  CHART 7 — Overall Impact Distribution
//       Doughnut · count + % in legend and tooltip
// ═══════════════════════════════════════════════════════════════
function chart7_impact(data) {
  const ORDER  = ["Beneficial", "Neutral", "Negative"];
  const grp    = groupBy(data, "Overall_Impact");
  const labels = ORDER.filter(o => grp[o]);
  const counts = labels.map(l => grp[l].length);
  const colors = labels.map(l => PALETTE_IMPACT[l]);
  const total  = counts.reduce((s, c) => s + c, 0);

  const isEmpty = total === 0;
  setChartEmpty("chart-c7-impact", isEmpty);

  if (!isEmpty) {
    upsertChart("c7-impact", "chart-c7-impact", {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: counts,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#fff",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              generateLabels: chart => chart.data.labels.map((lbl, i) => ({
                text:        `${lbl} — ${counts[i].toLocaleString()} (${total ? fmt(counts[i] / total * 100, 1) : "—"}%)`,
                fillStyle:   colors[i],
                strokeStyle: "#fff",
                lineWidth:   1,
                index:       i,
              })),
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total ? fmt(ctx.parsed / total * 100, 1) : "—";
                return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} respondents (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  §20  CHART 8 — Correlation Heatmap
//       Custom HTML/CSS table · pairwise complete observations
//       Student_ID excluded · diverging colour scale
// ═══════════════════════════════════════════════════════════════
function chart8_heatmap(data) {
  const container = document.getElementById("chart-c8-heatmap");
  if (!container) return;

  const vars = HEATMAP_VARS;
  const nv   = vars.length;

  if (data.length < 2) {
    container.innerHTML = `<p class="chart-note p-4">Insufficient data to compute correlations.</p>`;
    return;
  }

  // Compute all pairwise r values and valid-pair counts.
  // Uses pairwise complete observations: only rows valid for BOTH variables.
  // Variables with zero variance return NaN (handled gracefully).
  const rMatrix = [];
  const nMatrix = [];

  for (let i = 0; i < nv; i++) {
    rMatrix[i] = [];
    nMatrix[i] = [];
    for (let j = 0; j < nv; j++) {
      if (i === j) {
        rMatrix[i][j] = 1;
        nMatrix[i][j] = countValid(data, vars[i].key);
        continue;
      }
      const pairs = data.filter(d =>
        d[vars[i].key] != null && isFinite(d[vars[i].key]) &&
        d[vars[j].key] != null && isFinite(d[vars[j].key])
      );
      rMatrix[i][j] = pearsonR(pairs, vars[i].key, vars[j].key);
      nMatrix[i][j] = pairs.length;
    }
  }

  // Build the HTML table
  let html = `<table class="heatmap-table" role="grid" aria-label="Pearson correlation matrix">
    <thead><tr><th class="row-header" scope="col"></th>`;
  vars.forEach(v => {
    html += `<th scope="col" title="${v.key}">${v.label}</th>`;
  });
  html += `</tr></thead><tbody>`;

  for (let i = 0; i < nv; i++) {
    html += `<tr><th class="row-header" scope="row" title="${vars[i].key}">${vars[i].label}</th>`;
    for (let j = 0; j < nv; j++) {
      const r    = rMatrix[i][j];
      const n    = nMatrix[i][j];
      const bg   = heatmapColor(r);
      const fg   = heatmapTextColor(r);
      const rTxt = isFinite(r) ? r.toFixed(2) : "—";
      const tip  = isFinite(r)
        ? `${vars[i].label} × ${vars[j].label}\nr = ${r.toFixed(4)}\nn = ${n.toLocaleString()} valid pairs`
        : `${vars[i].label} × ${vars[j].label}: insufficient data`;
      html += `<td class="heatmap-cell" style="background:${bg};color:${fg};" title="${tip}" aria-label="${tip}">${rTxt}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
//  §21  MICRO-UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Safely read the current value of a filter <select> by ID.
 * Returns "" if the element is not found.
 *
 * @param {string} id - Element ID
 * @returns {string}
 */
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

/**
 * Safely set the textContent of an element by ID.
 * No-ops silently if the element does not exist.
 *
 * @param {string} id   - Element ID
 * @param {string} text - New text content
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
