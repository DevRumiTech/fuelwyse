/* FuelWyse — app.js
   Vanilla JS, instant calculations, presets (editable), comparison, themes, persistence, and shareable URL state.
*/

(() => {
    const STORAGE_KEY = "fuelwyse:v1";
  
    // ---- Helpers ----
    const $ = (sel) => document.querySelector(sel);
  
    function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  
    function toNumber(v, fallback = 0) {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }
  
    function formatNaira(n) {
      const value = Number.isFinite(n) ? n : 0;
      // No decimals for ₦ display (typical for big costs). Keep internally as float.
      return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0
      }).format(value);
    }
  
    function formatNumber(n, maxFractionDigits = 2) {
      const value = Number.isFinite(n) ? n : 0;
      return new Intl.NumberFormat("en-NG", {
        maximumFractionDigits: maxFractionDigits
      }).format(value);
    }
  
    function setTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      document.querySelectorAll("[data-theme-btn]").forEach(btn => {
        btn.classList.toggle("is-active", btn.getAttribute("data-theme-btn") === theme);
      });
    }
  
    function show(el, yes) {
      el.hidden = !yes;
    }
  
    function copyToClipboard(text) {
      // Prefer modern Clipboard API; fall back to selection
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return new Promise((resolve, reject) => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          resolve();
        } catch (e) { reject(e); }
      });
    }
  
    function setStatus(el, msg) {
      el.textContent = msg;
      if (!msg) return;
      setTimeout(() => { el.textContent = ""; }, 2200);
    }
  
    // === NEW: Date helper (for "last updated") ===
    function todayISO() {
      // YYYY-MM-DD
      return new Date().toISOString().slice(0, 10);
    }
  
    // ---- Presets (editable defaults, never locked) ----
    const VEHICLE_PRESETS = {
      small: { label: "Small car", kmPerL: 14 },
      sedan: { label: "Sedan", kmPerL: 12 },
      suv: { label: "SUV", kmPerL: 9 },
      bus: { label: "Bus", kmPerL: 4 },
      truck: { label: "Truck", kmPerL: 3.5 },
      custom: { label: "Custom", kmPerL: 10 }
    };
  
    // Base litres/hour for generator at MEDIUM load (rough planning estimates)
    const GEN_PRESETS = {
      "0.8": { label: "0.8kVA", baseLph: 0.35 },
      "1.6": { label: "1.6kVA", baseLph: 0.60 },
      "2.5": { label: "2.5kVA", baseLph: 0.90 },
      "3.5": { label: "3.5kVA", baseLph: 1.20 },
      "5":   { label: "5kVA",   baseLph: 1.70 },
      custom:{ label: "Custom", baseLph: 1.00 }
    };
  
    const LOAD_MULTIPLIER = {
      low: 0.80,
      medium: 1.00,
      high: 1.25
    };
  
    // Pattern → approximate days per month (simple & explainable)
    const GEN_DAYS_PER_MONTH = {
      occasional: 12,
      daily: 30,
      business: 26
    };
  
    // Fuel usage → monthly trip multiplier (simple, clear)
    const FUEL_MONTH_MULTIPLIER = {
      oneoff: 1,
      daily: 30,
      weekly: 4.345, // average weeks per month
      monthly: 1
    };
  
    // Range for low/avg/high estimates (transparent buffer)
    const RANGE_DELTA = 0.10; // ±10%
  
    // ---- State ----
    const DEFAULT_STATE = {
      theme: "dark",
      mode: "fuel",
  
      fuel: {
        usage: "daily",
        distanceKm: 30,
        vehiclePreset: "small",
        efficiencyKmPerL: VEHICLE_PRESETS.small.kmPerL,
        fuelPrice: 700, // editable default
  
        // === NEW: Fuel price "last updated" (YYYY-MM-DD) ===
        fuelPriceDate: ""
      },
  
      gen: {
        pattern: "daily",
        preset: "0.8",
        hoursPerDay: 4,
        load: "medium",
        litresPerHour: GEN_PRESETS["0.8"].baseLph * LOAD_MULTIPLIER.medium,
        fuelPrice: 700, // editable default
  
        // === NEW: Generator fuel price "last updated" (YYYY-MM-DD) ===
        fuelPriceDate: ""
      },
  
      baseline: {
        fuel: null,
        gen: null
      }
    };
  
    function deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }
  
    function loadState() {
      const raw = localStorage.getItem(STORAGE_KEY);
      let st = deepClone(DEFAULT_STATE);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          st = { ...st, ...parsed };
          // Shallow merge nested blocks carefully
          st.fuel = { ...DEFAULT_STATE.fuel, ...(parsed.fuel || {}) };
          st.gen  = { ...DEFAULT_STATE.gen,  ...(parsed.gen  || {}) };
          st.baseline = { ...DEFAULT_STATE.baseline, ...(parsed.baseline || {}) };
        } catch (_) {}
      }
  
      // If URL has share params, they override localStorage
      st = applyUrlParamsToState(st);
      return st;
    }
  
    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  
    function applyUrlParamsToState(st) {
      const url = new URL(window.location.href);
      const p = url.searchParams;
      const mode = p.get("mode");
      if (mode === "fuel" || mode === "gen") st.mode = mode;
  
      // Fuel params
      if (p.get("fu")) st.fuel.usage = p.get("fu");
      if (p.get("fd")) st.fuel.distanceKm = clamp(toNumber(p.get("fd"), st.fuel.distanceKm), 0, 999999);
      if (p.get("fvp")) st.fuel.vehiclePreset = p.get("fvp");
      if (p.get("fef")) st.fuel.efficiencyKmPerL = clamp(toNumber(p.get("fef"), st.fuel.efficiencyKmPerL), 0.1, 9999);
      if (p.get("ffp")) st.fuel.fuelPrice = clamp(toNumber(p.get("ffp"), st.fuel.fuelPrice), 1, 999999);
  
      // === NEW: Fuel price date param ===
      if (p.get("fpd")) st.fuel.fuelPriceDate = p.get("fpd") || "";
  
      // Gen params
      if (p.get("gp")) st.gen.pattern = p.get("gp");
      if (p.get("gpr")) st.gen.preset = p.get("gpr");
      if (p.get("gh")) st.gen.hoursPerDay = clamp(toNumber(p.get("gh"), st.gen.hoursPerDay), 0, 24);
      if (p.get("gl")) st.gen.load = p.get("gl");
      if (p.get("glph")) st.gen.litresPerHour = clamp(toNumber(p.get("glph"), st.gen.litresPerHour), 0.01, 99);
      if (p.get("gfp")) st.gen.fuelPrice = clamp(toNumber(p.get("gfp"), st.gen.fuelPrice), 1, 999999);
  
      // === NEW: Generator price date param ===
      if (p.get("gpd")) st.gen.fuelPriceDate = p.get("gpd") || "";
  
      return st;
    }
  
    function buildShareUrl() {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("mode", state.mode);
  
      // Fuel
      url.searchParams.set("fu", state.fuel.usage);
      url.searchParams.set("fd", String(round1(state.fuel.distanceKm)));
      url.searchParams.set("fvp", state.fuel.vehiclePreset);
      url.searchParams.set("fef", String(round1(state.fuel.efficiencyKmPerL)));
      url.searchParams.set("ffp", String(Math.round(state.fuel.fuelPrice)));
  
      // === NEW: include last-updated date (if present) ===
      if (state.fuel.fuelPriceDate) url.searchParams.set("fpd", state.fuel.fuelPriceDate);
  
      // Gen
      url.searchParams.set("gp", state.gen.pattern);
      url.searchParams.set("gpr", state.gen.preset);
      url.searchParams.set("gh", String(round1(state.gen.hoursPerDay)));
      url.searchParams.set("gl", state.gen.load);
      url.searchParams.set("glph", String(round2(state.gen.litresPerHour)));
      url.searchParams.set("gfp", String(Math.round(state.gen.fuelPrice)));
  
      // === NEW: include last-updated date (if present) ===
      if (state.gen.fuelPriceDate) url.searchParams.set("gpd", state.gen.fuelPriceDate);
  
      return url.toString();
    }
  
    function round1(n) { return Math.round(n * 10) / 10; }
    function round2(n) { return Math.round(n * 100) / 100; }
  
    // ---- Calculations ----
    function calcFuel(stFuel) {
      const usage = stFuel.usage;
      const distance = clamp(toNumber(stFuel.distanceKm, 0), 0, 999999);
      const kmPerL = clamp(toNumber(stFuel.efficiencyKmPerL, 10), 0.1, 9999);
      const price = clamp(toNumber(stFuel.fuelPrice, 700), 1, 999999);
  
      const monthlyTrips = FUEL_MONTH_MULTIPLIER[usage] ?? 1;
      const monthlyDistance = distance * monthlyTrips;
  
      const litresMonthly = monthlyDistance / kmPerL;
      const costMonthly = litresMonthly * price;
  
      const costPerKm = price / kmPerL; // ₦ per km
      const costDaily = costMonthly / 30;
      const costWeekly = costMonthly / 4.345;
      const costYearly = costMonthly * 12;
  
      return {
        monthlyTrips,
        monthlyDistance,
        litresMonthly,
        costMonthly,
        costPerKm,
        costDaily,
        costWeekly,
        costYearly
      };
    }
  
    function calcGen(stGen) {
      const pattern = stGen.pattern;
      const hours = clamp(toNumber(stGen.hoursPerDay, 0), 0, 24);
      const lph = clamp(toNumber(stGen.litresPerHour, 0.5), 0.01, 99);
      const price = clamp(toNumber(stGen.fuelPrice, 700), 1, 999999);
  
      const daysPerMonth = GEN_DAYS_PER_MONTH[pattern] ?? 30;
  
      const litresPerDay = hours * lph;
      const litresMonthly = litresPerDay * daysPerMonth;
      const costMonthly = litresMonthly * price;
  
      const costPerHour = lph * price;
      const costDaily = litresPerDay * price;
      const costWeekly = costDaily * 7; // generator “weekly” as 7 days of typical daily
      const costYearly = costMonthly * 12;
  
      return {
        daysPerMonth,
        litresPerDay,
        litresMonthly,
        costMonthly,
        costPerHour,
        costDaily,
        costWeekly,
        costYearly
      };
    }
  
    function rangeText(avgCost) {
      const low = avgCost * (1 - RANGE_DELTA);
      const high = avgCost * (1 + RANGE_DELTA);
      return `${formatNaira(low)} (low) • ${formatNaira(avgCost)} (avg) • ${formatNaira(high)} (high)`;
    }
  
    // ---- UI Wiring ----
    let state = loadState();
  
    // Elements (Fuel)
    const tabFuel = $("#tabFuel");
    const tabGen = $("#tabGen");
    const panelFuel = $("#panelFuel");
    const panelGen = $("#panelGen");
  
    const fuelUsage = $("#fuelUsage");
    const fuelDistance = $("#fuelDistance");
    const fuelDistanceLabel = $("#fuelDistanceLabel");
    const fuelDistanceManual = $("#fuelDistanceManual");
    const btnFuelDistanceApply = $("#btnFuelDistanceApply");
    const vehiclePreset = $("#vehiclePreset");
    const fuelEfficiency = $("#fuelEfficiency");
    const fuelPrice = $("#fuelPrice");
  
    // === NEW: Fuel price date + quick update button (optional in HTML) ===
    const fuelPriceDate = $("#fuelPriceDate");
    const btnQuickFuelPrice = $("#btnQuickFuelPrice");
  
    const fuelHero = $("#fuelHero");
    const fuelRange = $("#fuelRange");
    const fuelLitres = $("#fuelLitres");
    const fuelCostPerKm = $("#fuelCostPerKm");
    const fuelTrips = $("#fuelTrips");
    const fuelDaily = $("#fuelDaily");
    const fuelWeekly = $("#fuelWeekly");
    const fuelMonthly = $("#fuelMonthly");
    const fuelYearly = $("#fuelYearly");
    const fuelAssumptions = $("#fuelAssumptions");
  
    const btnFuelHelpEfficiency = $("#btnFuelHelpEfficiency");
    const btnFuelHelpPrice = $("#btnFuelHelpPrice");
    const fuelEfficiencyHint = $("#fuelEfficiencyHint");
    const fuelPriceHint = $("#fuelPriceHint");
  
    const btnFuelSetBaseline = $("#btnFuelSetBaseline");
    const btnFuelClearBaseline = $("#btnFuelClearBaseline");
    const fuelCompare = $("#fuelCompare");
  
    const btnFuelCopyText = $("#btnFuelCopyText");
    const btnFuelCopyUrl = $("#btnFuelCopyUrl");
    const fuelCopyStatus = $("#fuelCopyStatus");
  
    // Elements (Gen)
    const genPattern = $("#genPattern");
    const genPreset = $("#genPreset");
    const genHours = $("#genHours");
    const genHoursLabel = $("#genHoursLabel");
  
    const genLph = $("#genLph");
    const genFuelPrice = $("#genFuelPrice");
  
    // === NEW: Generator price date + quick update button (optional in HTML) ===
    const genPriceDate = $("#genPriceDate");
    const btnQuickGenFuelPrice = $("#btnQuickGenFuelPrice");
  
    const genHero = $("#genHero");
    const genRange = $("#genRange");
    const genLitresDay = $("#genLitresDay");
    const genCostHour = $("#genCostHour");
    const genDaysMonth = $("#genDaysMonth");
    const genDaily = $("#genDaily");
    const genWeekly = $("#genWeekly");
    const genMonthly = $("#genMonthly");
    const genYearly = $("#genYearly");
    const genAssumptions = $("#genAssumptions");
  
    const btnGenHelpLph = $("#btnGenHelpLph");
    const btnGenHelpPrice = $("#btnGenHelpPrice");
    const genLphHint = $("#genLphHint");
    const genPriceHint = $("#genPriceHint");
  
    const btnGenSetBaseline = $("#btnGenSetBaseline");
    const btnGenClearBaseline = $("#btnGenClearBaseline");
    const genCompare = $("#genCompare");
  
    const btnGenCopyText = $("#btnGenCopyText");
    const btnGenCopyUrl = $("#btnGenCopyUrl");
    const genCopyStatus = $("#genCopyStatus");
  
    // Global
    const btnReset = $("#btnReset");
  
    // Theme buttons
    document.querySelectorAll("[data-theme-btn]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.theme = btn.getAttribute("data-theme-btn");
        setTheme(state.theme);
        saveState();
      });
    });
  
    // Mode switching
    function setMode(mode, shouldScroll = false) {
      state.mode = mode;
    
      tabFuel.setAttribute("aria-selected", mode === "fuel" ? "true" : "false");
      tabGen.setAttribute("aria-selected", mode === "gen" ? "true" : "false");
    
      show(panelFuel, mode === "fuel");
      show(panelGen, mode === "gen");
    
      // Scroll ONLY when triggered by user click
      if (shouldScroll) {
        (mode === "fuel" ? panelFuel : panelGen)
          .scrollIntoView({ behavior: "smooth", block: "start" });
      }
    
      saveState();
      render();
    }
    

    tabFuel.addEventListener("click", () => setMode("fuel", true));
    tabGen.addEventListener("click", () => setMode("gen", true));




  
    // Fuel quick distance chips
    document.querySelectorAll("[data-quick-distance]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = toNumber(btn.getAttribute("data-quick-distance"), 30);
        state.fuel.distanceKm = v;
        syncFuelInputs();
        render();
      });
    });
  
    // Gen quick hours chips
    document.querySelectorAll("[data-quick-hours]").forEach(btn => {
      btn.addEventListener("click", () => {
        const v = toNumber(btn.getAttribute("data-quick-hours"), 4);
        state.gen.hoursPerDay = v;
        syncGenInputs();
        render();
      });
    });
  
    // Load segmented buttons
    const loadBtns = document.querySelectorAll('[data-load]');
    function setLoad(load) {
      state.gen.load = load;
      loadBtns.forEach(b => b.classList.toggle("is-active", b.getAttribute("data-load") === load));
      // If the user is using a preset (not custom), keep litres/hour smart by load
      if (state.gen.preset !== "custom") {
        const base = GEN_PRESETS[state.gen.preset]?.baseLph ?? 1.0;
        state.gen.litresPerHour = round2(base * (LOAD_MULTIPLIER[load] ?? 1));
      }
      syncGenInputs();
      render();
    }
    loadBtns.forEach(btn => btn.addEventListener("click", () => setLoad(btn.getAttribute("data-load"))));
  
    // ---- Input bindings (Fuel) ----
    fuelUsage.addEventListener("change", () => {
      state.fuel.usage = fuelUsage.value;
      saveState();
      render();
    });
  
    fuelDistance.addEventListener("input", () => {
      state.fuel.distanceKm = toNumber(fuelDistance.value, state.fuel.distanceKm);
      fuelDistanceLabel.textContent = String(state.fuel.distanceKm);
      saveState();
      render();
    });
  
    btnFuelDistanceApply.addEventListener("click", () => {
      const v = toNumber(fuelDistanceManual.value, NaN);
      if (Number.isFinite(v) && v >= 0) {
        state.fuel.distanceKm = round1(v);
        syncFuelInputs();
        render();
      }
    });
  
    vehiclePreset.addEventListener("change", () => {
      state.fuel.vehiclePreset = vehiclePreset.value;
      // Auto-fill efficiency from preset, but editable after
      const preset = VEHICLE_PRESETS[state.fuel.vehiclePreset] || VEHICLE_PRESETS.small;
      state.fuel.efficiencyKmPerL = preset.kmPerL;
      syncFuelInputs();
      render();
    });
  
    fuelEfficiency.addEventListener("input", () => {
      state.fuel.efficiencyKmPerL = toNumber(fuelEfficiency.value, state.fuel.efficiencyKmPerL);
      // If they changed it, treat as custom (but keep preset label user selected)
      saveState();
      render();
    });
  
    fuelPrice.addEventListener("input", () => {
      state.fuel.fuelPrice = toNumber(fuelPrice.value, state.fuel.fuelPrice);
  
      // === NEW: If user manually changes price, we do NOT force a date.
      // They can set "Last updated" if they want (or via quick update button).
      saveState();
      render();
    });
  
    // === NEW: Fuel "last updated" date binding (only if the input exists) ===
    if (fuelPriceDate) {
      fuelPriceDate.addEventListener("change", () => {
        state.fuel.fuelPriceDate = fuelPriceDate.value || "";
        saveState();
        render();
      });
    }
  
    // === NEW: Quick update fuel price button (only if the button exists) ===
    if (btnQuickFuelPrice) {
      btnQuickFuelPrice.addEventListener("click", () => {
        const v = prompt("Enter new fuel price per litre (₦):", String(state.fuel.fuelPrice));
        if (v === null) return; // cancelled
        const price = toNumber(v, NaN);
        if (Number.isFinite(price) && price > 0) {
          state.fuel.fuelPrice = price;
          state.fuel.fuelPriceDate = todayISO();
          syncFuelInputs();
          render();
        }
      });
    }
  
    btnFuelHelpEfficiency.addEventListener("click", () => {
      const on = fuelEfficiencyHint.hidden;
      fuelEfficiencyHint.hidden = !on;
      if (on) {
        fuelEfficiencyHint.textContent =
          "Typical planning ranges: Small car 12–16 km/L, Sedan 10–14, SUV 7–10, Bus 3–5, Truck 2.5–4. If unsure, use a preset then fine-tune.";
      }
    });
  
    btnFuelHelpPrice.addEventListener("click", () => {
      const on = fuelPriceHint.hidden;
      fuelPriceHint.hidden = !on;
      if (on) {
        fuelPriceHint.textContent =
          "If you’re unsure, use a recent pump price you saw. You can also leave the default and update later.";
      }
    });
  
    // ---- Input bindings (Gen) ----
    genPattern.addEventListener("change", () => {
      state.gen.pattern = genPattern.value;
  
      // Smart hours defaults based on pattern (only if user hasn't strongly customized)
      if (state.gen.pattern === "occasional" && state.gen.hoursPerDay > 6) state.gen.hoursPerDay = 2;
      if (state.gen.pattern === "business" && state.gen.hoursPerDay < 6) state.gen.hoursPerDay = 8;
  
      syncGenInputs();
      render();
    });
  
    genPreset.addEventListener("change", () => {
      state.gen.preset = genPreset.value;
      if (state.gen.preset !== "custom") {
        const base = GEN_PRESETS[state.gen.preset]?.baseLph ?? 1.0;
        const mult = LOAD_MULTIPLIER[state.gen.load] ?? 1.0;
        state.gen.litresPerHour = round2(base * mult);
      }
      syncGenInputs();
      render();
    });
  
    genHours.addEventListener("input", () => {
      state.gen.hoursPerDay = toNumber(genHours.value, state.gen.hoursPerDay);
      genHoursLabel.textContent = String(state.gen.hoursPerDay);
      saveState();
      render();
    });
  
    genLph.addEventListener("input", () => {
      state.gen.litresPerHour = toNumber(genLph.value, state.gen.litresPerHour);
      // If user edits litres/hour, treat as custom preset for future load changes
      if (state.gen.preset !== "custom") state.gen.preset = "custom";
      syncGenInputs(false);
      saveState();
      render();
    });
  
    genFuelPrice.addEventListener("input", () => {
      state.gen.fuelPrice = toNumber(genFuelPrice.value, state.gen.fuelPrice);
  
      // === NEW: manual change does not force a date ===
      saveState();
      render();
    });
  
    // === NEW: Generator "last updated" date binding (only if the input exists) ===
    if (genPriceDate) {
      genPriceDate.addEventListener("change", () => {
        state.gen.fuelPriceDate = genPriceDate.value || "";
        saveState();
        render();
      });
    }
  
    // === NEW: Quick update generator fuel price button (only if the button exists) ===
    if (btnQuickGenFuelPrice) {
      btnQuickGenFuelPrice.addEventListener("click", () => {
        const v = prompt("Enter new fuel price per litre (₦):", String(state.gen.fuelPrice));
        if (v === null) return; // cancelled
        const price = toNumber(v, NaN);
        if (Number.isFinite(price) && price > 0) {
          state.gen.fuelPrice = price;
          state.gen.fuelPriceDate = todayISO();
          syncGenInputs();
          render();
        }
      });
    }
  
    btnGenHelpLph.addEventListener("click", () => {
      const on = genLphHint.hidden;
      genLphHint.hidden = !on;
      if (on) {
        genLphHint.textContent =
          "Planning tip: smaller generators might use ~0.3–0.7 L/hr, mid-size ~0.8–1.3, larger ~1.5–2.5 (depends heavily on load). Use a preset + load then adjust.";
      }
    });
  
    btnGenHelpPrice.addEventListener("click", () => {
      const on = genPriceHint.hidden;
      genPriceHint.hidden = !on;
      if (on) {
        genPriceHint.textContent =
          "Enter today’s fuel price if you know it. Otherwise, keep the default and update later.";
      }
    });
  
    // ---- Comparison (Before vs After) ----
    btnFuelSetBaseline.addEventListener("click", () => {
      state.baseline.fuel = deepClone(state.fuel);
      saveState();
      render();
    });
  
    btnFuelClearBaseline.addEventListener("click", () => {
      state.baseline.fuel = null;
      saveState();
      render();
    });
  
    btnGenSetBaseline.addEventListener("click", () => {
      state.baseline.gen = deepClone(state.gen);
      saveState();
      render();
    });
  
    btnGenClearBaseline.addEventListener("click", () => {
      state.baseline.gen = null;
      saveState();
      render();
    });
  
    // ---- Share ----
    btnFuelCopyText.addEventListener("click", async () => {
      const txt = buildFuelShareText();
      try {
        await copyToClipboard(txt);
        setStatus(fuelCopyStatus, "Copied!");
      } catch {
        setStatus(fuelCopyStatus, "Copy failed (try manually).");
      }
    });
  
    btnFuelCopyUrl.addEventListener("click", async () => {
      const url = buildShareUrl();
      try {
        await copyToClipboard(url);
        setStatus(fuelCopyStatus, "Link copied!");
        // Also update address bar (non-intrusive)
        history.replaceState(null, "", url);
      } catch {
        setStatus(fuelCopyStatus, "Copy failed (try manually).");
      }
    });
  
    btnGenCopyText.addEventListener("click", async () => {
      const txt = buildGenShareText();
      try {
        await copyToClipboard(txt);
        setStatus(genCopyStatus, "Copied!");
      } catch {
        setStatus(genCopyStatus, "Copy failed (try manually).");
      }
    });
  
    btnGenCopyUrl.addEventListener("click", async () => {
      const url = buildShareUrl();
      try {
        await copyToClipboard(url);
        setStatus(genCopyStatus, "Link copied!");
        history.replaceState(null, "", url);
      } catch {
        setStatus(genCopyStatus, "Copy failed (try manually).");
      }
    });
  
    // ---- Reset ----
    btnReset.addEventListener("click", () => {
      // Hard reset to defaults but keep theme choice if user wants; here we reset all
      state = deepClone(DEFAULT_STATE);
      saveState();
      // Remove URL params too
      history.replaceState(null, "", window.location.pathname);
      initFromState();
      render();
    });
  
    // ---- Sync inputs from state ----
    function syncFuelInputs(doSave = true) {
      fuelUsage.value = state.fuel.usage;
  
      fuelDistance.value = String(clamp(state.fuel.distanceKm, 1, 600));
      fuelDistanceLabel.textContent = String(state.fuel.distanceKm);
  
      vehiclePreset.value = state.fuel.vehiclePreset;
      fuelEfficiency.value = String(state.fuel.efficiencyKmPerL);
      fuelPrice.value = String(state.fuel.fuelPrice);
  
      // === NEW: sync date input if present ===
      if (fuelPriceDate) fuelPriceDate.value = state.fuel.fuelPriceDate || "";
  
      if (doSave) saveState();
    }
  
    function syncGenInputs(doSave = true) {
      genPattern.value = state.gen.pattern;
      genPreset.value = state.gen.preset;
  
      genHours.value = String(state.gen.hoursPerDay);
      genHoursLabel.textContent = String(state.gen.hoursPerDay);
  
      genLph.value = String(state.gen.litresPerHour);
      genFuelPrice.value = String(state.gen.fuelPrice);
  
      // === NEW: sync date input if present ===
      if (genPriceDate) genPriceDate.value = state.gen.fuelPriceDate || "";
  
      loadBtns.forEach(b => b.classList.toggle("is-active", b.getAttribute("data-load") === state.gen.load));
  
      if (doSave) saveState();
    }
  
    function initFromState() {
      setTheme(state.theme);
      syncFuelInputs(false);
      syncGenInputs(false);
      setMode(state.mode);
    }
  
    // ---- Render ----
    function renderFuel() {
      const r = calcFuel(state.fuel);
  
      fuelHero.textContent = formatNaira(r.costMonthly);
      fuelRange.textContent = rangeText(r.costMonthly);
  
      fuelLitres.textContent = `${formatNumber(r.litresMonthly, 2)} L`;
      fuelCostPerKm.textContent = formatNaira(r.costPerKm);
      fuelTrips.textContent = `${formatNumber(r.monthlyTrips, 2)} / month`;
  
      fuelDaily.textContent = formatNaira(r.costDaily);
      fuelWeekly.textContent = formatNaira(r.costWeekly);
      fuelMonthly.textContent = formatNaira(r.costMonthly);
      fuelYearly.textContent = formatNaira(r.costYearly);
  
      // === NEW: include price date in assumptions if present ===
      const priceDateLine = state.fuel.fuelPriceDate
        ? `Price last updated: <strong>${state.fuel.fuelPriceDate}</strong><br/>`
        : "";
  
      fuelAssumptions.innerHTML = `
        <strong>Assumptions used:</strong><br/>
        ${priceDateLine}
        Distance: <strong>${formatNumber(state.fuel.distanceKm, 1)} km</strong> per ${state.fuel.usage} •
        Efficiency: <strong>${formatNumber(state.fuel.efficiencyKmPerL, 1)} km/L</strong> •
        Fuel price: <strong>${formatNaira(state.fuel.fuelPrice).replace(".00","")}/L</strong><br/>
        Monthly distance ≈ <strong>${formatNumber(r.monthlyDistance, 1)} km</strong> •
        Monthly fuel ≈ <strong>${formatNumber(r.litresMonthly, 2)} L</strong>
      `;
  
      // Comparison
      const base = state.baseline.fuel;
      if (base) {
        const rb = calcFuel(base);
        const diff = r.costMonthly - rb.costMonthly;
        const pct = rb.costMonthly > 0 ? (diff / rb.costMonthly) * 100 : 0;
  
        fuelCompare.hidden = false;
        fuelCompare.innerHTML = `
          <div><strong>Comparison (Before vs Now)</strong></div>
          <div class="muted small">Before: ${formatNaira(rb.costMonthly)} • Now: ${formatNaira(r.costMonthly)}</div>
          <div style="margin-top:8px;">
            <strong>${diff >= 0 ? "Increase" : "Savings"}:</strong>
            ${formatNaira(Math.abs(diff))} (${formatNumber(Math.abs(pct), 1)}%)
          </div>
        `;
      } else {
        fuelCompare.hidden = true;
        fuelCompare.innerHTML = "";
      }
    }
  
    function renderGen() {
      const r = calcGen(state.gen);
  
      genHero.textContent = formatNaira(r.costMonthly);
      genRange.textContent = rangeText(r.costMonthly);
  
      genLitresDay.textContent = `${formatNumber(r.litresPerDay, 2)} L`;
      genCostHour.textContent = formatNaira(r.costPerHour);
      genDaysMonth.textContent = `${r.daysPerMonth} days`;
  
      genDaily.textContent = formatNaira(r.costDaily);
      genWeekly.textContent = formatNaira(r.costWeekly);
      genMonthly.textContent = formatNaira(r.costMonthly);
      genYearly.textContent = formatNaira(r.costYearly);
  
      const presetLabel = GEN_PRESETS[state.gen.preset]?.label ?? "Custom";
  
      // === NEW: include price date in assumptions if present ===
      const priceDateLine = state.gen.fuelPriceDate
        ? `Price last updated: <strong>${state.gen.fuelPriceDate}</strong><br/>`
        : "";
  
      genAssumptions.innerHTML = `
        <strong>Assumptions used:</strong><br/>
        ${priceDateLine}
        Pattern: <strong>${state.gen.pattern}</strong> (${r.daysPerMonth} days/month) •
        Hours/day: <strong>${formatNumber(state.gen.hoursPerDay, 1)} hrs</strong> •
        Load: <strong>${state.gen.load}</strong><br/>
        Litres/hour: <strong>${formatNumber(state.gen.litresPerHour, 2)} L/hr</strong> (${presetLabel}) •
        Fuel price: <strong>${formatNaira(state.gen.fuelPrice).replace(".00","")}/L</strong>
      `;
  
      // Comparison
      const base = state.baseline.gen;
      if (base) {
        const rb = calcGen(base);
        const diff = r.costMonthly - rb.costMonthly;
        const pct = rb.costMonthly > 0 ? (diff / rb.costMonthly) * 100 : 0;
  
        genCompare.hidden = false;
        genCompare.innerHTML = `
          <div><strong>Comparison (Before vs Now)</strong></div>
          <div class="muted small">Before: ${formatNaira(rb.costMonthly)} • Now: ${formatNaira(r.costMonthly)}</div>
          <div style="margin-top:8px;">
            <strong>${diff >= 0 ? "Increase" : "Savings"}:</strong>
            ${formatNaira(Math.abs(diff))} (${formatNumber(Math.abs(pct), 1)}%)
          </div>
        `;
      } else {
        genCompare.hidden = true;
        genCompare.innerHTML = "";
      }
    }
  
    function render() {
      const shareUrl = buildShareUrl();
      const now = Date.now();
    
      if (!window.__lastUrlUpdate || now - window.__lastUrlUpdate > 300) {
        history.replaceState(null, "", shareUrl);
        window.__lastUrlUpdate = now;
      }
    
      if (state.mode === "fuel") renderFuel();
      else renderGen();
    
      saveState();
    }
    
  
    // ---- Share text builders ----
    function buildFuelShareText() {
      const r = calcFuel(state.fuel);
      return [
        "FuelWyse (Estimate) — Fuel Cost",
        `Monthly cost: ${formatNaira(r.costMonthly)}`,
        `Distance: ${formatNumber(state.fuel.distanceKm, 1)} km per ${state.fuel.usage}`,
        `Efficiency: ${formatNumber(state.fuel.efficiencyKmPerL, 1)} km/L`,
        `Fuel price: ${formatNaira(state.fuel.fuelPrice).replace(".00","")}/L`,
        ...(state.fuel.fuelPriceDate ? [`Price last updated: ${state.fuel.fuelPriceDate}`] : []),
        `Monthly fuel: ${formatNumber(r.litresMonthly, 2)} L`,
        `Cost per km: ${formatNaira(r.costPerKm)}`,
        "Disclaimer: This is an estimate. Actual fuel usage and costs may vary.",
        `Share link: ${buildShareUrl()}`
      ].join("\n");
    }
  
    function buildGenShareText() {
      const r = calcGen(state.gen);
      const presetLabel = GEN_PRESETS[state.gen.preset]?.label ?? "Custom";
      return [
        "FuelWyse (Estimate) — Generator Cost",
        `Monthly cost: ${formatNaira(r.costMonthly)}`,
        `Pattern: ${state.gen.pattern} (${r.daysPerMonth} days/month)`,
        `Generator: ${presetLabel} • Load: ${state.gen.load}`,
        `Hours/day: ${formatNumber(state.gen.hoursPerDay, 1)} hrs`,
        `Litres/hour: ${formatNumber(state.gen.litresPerHour, 2)} L/hr`,
        `Fuel price: ${formatNaira(state.gen.fuelPrice).replace(".00","")}/L`,
        ...(state.gen.fuelPriceDate ? [`Price last updated: ${state.gen.fuelPriceDate}`] : []),
        `Fuel/day: ${formatNumber(r.litresPerDay, 2)} L`,
        `Cost/hour: ${formatNaira(r.costPerHour)}`,
        "Disclaimer: This is an estimate. Actual fuel usage and costs may vary.",
        `Share link: ${buildShareUrl()}`
      ].join("\n");
    }
  
    // ---- Boot ----
    function ensureSmartDefaults() {
      // Keep sensible starting values if localStorage had weird data
      state.fuel.distanceKm = clamp(toNumber(state.fuel.distanceKm, 30), 0, 999999);
      state.fuel.efficiencyKmPerL = clamp(toNumber(state.fuel.efficiencyKmPerL, 12), 0.1, 9999);
      state.fuel.fuelPrice = clamp(toNumber(state.fuel.fuelPrice, 700), 1, 999999);
  
      // === NEW: ensure string default ===
      state.fuel.fuelPriceDate = (typeof state.fuel.fuelPriceDate === "string") ? state.fuel.fuelPriceDate : "";
  
      state.gen.hoursPerDay = clamp(toNumber(state.gen.hoursPerDay, 4), 0, 24);
      state.gen.litresPerHour = clamp(toNumber(state.gen.litresPerHour, 0.6), 0.01, 99);
      state.gen.fuelPrice = clamp(toNumber(state.gen.fuelPrice, 700), 1, 999999);
  
      // === NEW: ensure string default ===
      state.gen.fuelPriceDate = (typeof state.gen.fuelPriceDate === "string") ? state.gen.fuelPriceDate : "";
  
      // Apply preset-derived values if preset selected and litres/hour missing
      if (state.gen.preset !== "custom") {
        const base = GEN_PRESETS[state.gen.preset]?.baseLph ?? 1;
        const mult = LOAD_MULTIPLIER[state.gen.load] ?? 1;
        state.gen.litresPerHour = round2(base * mult);
      }
    }
  
    ensureSmartDefaults();
    initFromState();
    render();
  })();