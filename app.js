(function () {
  'use strict';

  var SIZES = ['Small', 'Typical', 'Large'];
  var TEXTURES = ['Solid', 'Soft', 'Runny'];

  var pad = function (n) { return String(n).padStart(2, '0'); };
  var toKey = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var fromKey = function (k) {
    var parts = k.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  };
  var displayDate = function (k) {
    return fromKey(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var nowTime = function () { return new Date().toTimeString().slice(0, 5); };
  var emptyEntry = function () { return { foodLogs: [], poopLogs: [], updatedAt: 0 }; };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  var round2 = function (n) { return Math.round(n * 100) / 100; };
  // grams of food in one cup, derived from the two calorie numbers every dog
  // food label already prints (kcal/kg and kcal/cup) — no scale needed.
  var gramsPerCup = function (calsPerCup, kcalPerKg) {
    if (!kcalPerKg || kcalPerKg <= 0 || !calsPerCup) return null;
    return round2((calsPerCup / kcalPerKg) * 1000);
  };
  // estimated grams of a nutrient for a given number of cups, or null if the
  // food doesn't have that nutrient's guaranteed-analysis % on file.
  var nutrientGrams = function (food, cups, pctField) {
    if (!food.gramsPerCup || food[pctField] == null) return null;
    return round2(cups * food.gramsPerCup * (food[pctField] / 100));
  };
  var computeNutrients = function (food, cups) {
    return {
      proteinG: nutrientGrams(food, cups, 'proteinPct'),
      fatG: nutrientGrams(food, cups, 'fatPct'),
      fiberG: nutrientGrams(food, cups, 'fiberPct')
    };
  };

  // ---- storage ----
  function getFoods() {
    try { return JSON.parse(localStorage.getItem('charlie:foods') || '[]'); } catch (e) { return []; }
  }
  function setFoods(list) { localStorage.setItem('charlie:foods', JSON.stringify(list)); }
  function getEntry(key) {
    try {
      var raw = localStorage.getItem('charlie:entry:' + key);
      return raw ? JSON.parse(raw) : emptyEntry();
    } catch (e) { return emptyEntry(); }
  }
  function setEntry(key, val) { localStorage.setItem('charlie:entry:' + key, JSON.stringify(val)); }
  function saveEntryLocal(key, val) {
    val.updatedAt = Date.now();
    setEntry(key, val);
    if (window.CharlieSync && window.CharlieSync.pushEntry) window.CharlieSync.pushEntry(key, val);
    return val;
  }

  // ---- state ----
  var state = {
    tab: 'journal',
    dateKey: toKey(new Date()),
    foods: getFoods(),
    entry: getEntry(toKey(new Date())),
    activeFoodId: null,
    editingFoodLogId: null,
    showPoopForm: false,
    poopSize: 'Typical',
    poopTexture: 'Solid',
    poopAbnormal: false,
    editingPoopLogId: null,
    editPoopSize: 'Typical',
    editPoopTexture: 'Solid',
    editPoopAbnormal: false,
    editingFoodId: null,
    showAddNutrition: false,
    error: '',
    reportGranularity: 'week',
    reportAnchor: toKey(new Date()),
    reportRows: []
  };

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  // ---- actions ----
  function shiftDate(days) {
    var d = fromKey(state.dateKey);
    d.setDate(d.getDate() + days);
    var key = toKey(d);
    setState({ dateKey: key, entry: getEntry(key), activeFoodId: null, showPoopForm: false });
  }

  function setDate(key) {
    setState({ dateKey: key, entry: getEntry(key), activeFoodId: null, showPoopForm: false });
  }

  function addFood() {
    var nameEl = document.getElementById('new-food-name');
    var calsEl = document.getElementById('new-food-cals');
    var name = nameEl.value.trim();
    var cals = parseFloat(calsEl.value);
    if (!name || isNaN(cals) || cals <= 0) return;
    var kcalKgEl = document.getElementById('new-food-kcalkg');
    var proteinEl = document.getElementById('new-food-protein');
    var fatEl = document.getElementById('new-food-fat');
    var fiberEl = document.getElementById('new-food-fiber');
    var kcalPerKg = kcalKgEl && kcalKgEl.value ? parseFloat(kcalKgEl.value) : null;
    var proteinPct = proteinEl && proteinEl.value ? parseFloat(proteinEl.value) : null;
    var fatPct = fatEl && fatEl.value ? parseFloat(fatEl.value) : null;
    var fiberPct = fiberEl && fiberEl.value ? parseFloat(fiberEl.value) : null;
    var food = {
      id: uid(), name: name, calsPerCup: cals, updatedAt: Date.now(),
      kcalPerKg: (kcalPerKg && kcalPerKg > 0) ? kcalPerKg : null,
      proteinPct: (proteinPct != null && !isNaN(proteinPct)) ? proteinPct : null,
      fatPct: (fatPct != null && !isNaN(fatPct)) ? fatPct : null,
      fiberPct: (fiberPct != null && !isNaN(fiberPct)) ? fiberPct : null
    };
    food.gramsPerCup = gramsPerCup(food.calsPerCup, food.kcalPerKg);
    var list = state.foods.concat([food]);
    setFoods(list);
    setState({ foods: list, showAddNutrition: false });
    if (window.CharlieSync && window.CharlieSync.pushFood) window.CharlieSync.pushFood(food);
  }

  function deleteFood(id) {
    var food = state.foods.find(function (f) { return f.id === id; });
    var name = food ? food.name : 'this food';
    if (!window.confirm('Remove ' + name + ' from Charlie\'s foods? Past log entries that used it are kept as-is.')) return;
    var list = state.foods.filter(function (f) { return f.id !== id; });
    setFoods(list);
    setState({ foods: list });
    if (window.CharlieSync && window.CharlieSync.deleteFoodRemote) window.CharlieSync.deleteFoodRemote(id);
  }

  function logFood(foodId) {
    var food = state.foods.find(function (f) { return f.id === foodId; });
    if (!food) return;
    var cupsEl = document.getElementById('cups-input');
    var cups = parseFloat(cupsEl.value);
    if (isNaN(cups) || cups <= 0) return;
    var calories = Math.round(cups * food.calsPerCup * 100) / 100;
    var nutrients = computeNutrients(food, cups);
    var next = Object.assign({}, state.entry, {
      foodLogs: state.entry.foodLogs.concat([Object.assign({
        id: uid(), time: nowTime(), foodId: food.id, foodName: food.name, cups: cups, calories: calories
      }, nutrients)])
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, activeFoodId: null });
  }

  function deleteFoodLog(id) {
    if (!window.confirm('Delete this food log entry? This can\'t be undone.')) return;
    var next = Object.assign({}, state.entry, {
      foodLogs: state.entry.foodLogs.filter(function (l) { return l.id !== id; })
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next });
  }

  function openPoopForm() {
    setState({ showPoopForm: true, poopSize: 'Typical', poopTexture: 'Solid', poopAbnormal: false, editingPoopLogId: null });
    setTimeout(function () {
      var t = document.getElementById('poop-time');
      if (t) t.value = nowTime();
    }, 0);
  }

  function logPoop() {
    var timeEl = document.getElementById('poop-time');
    var noteEl = document.getElementById('poop-note');
    var next = Object.assign({}, state.entry, {
      poopLogs: state.entry.poopLogs.concat([{
        id: uid(),
        time: (timeEl && timeEl.value) || nowTime(),
        size: state.poopSize,
        texture: state.poopTexture,
        colorAbnormal: state.poopAbnormal,
        colorNote: state.poopAbnormal && noteEl ? noteEl.value.trim() : ''
      }])
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, showPoopForm: false });
  }

  function deletePoopLog(id) {
    if (!window.confirm('Delete this bathroom entry? This can\'t be undone.')) return;
    var next = Object.assign({}, state.entry, {
      poopLogs: state.entry.poopLogs.filter(function (l) { return l.id !== id; })
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next });
  }

  function rangeKeys(granularity, anchorKey) {
    var anchor = fromKey(anchorKey);
    var start, end;
    if (granularity === 'day') {
      start = new Date(anchor); end = new Date(anchor);
    } else if (granularity === 'week') {
      start = new Date(anchor); start.setDate(start.getDate() - start.getDay());
      end = new Date(start); end.setDate(end.getDate() + 6);
    } else {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    }
    var keys = [];
    var cur = new Date(start);
    while (cur <= end) { keys.push(toKey(cur)); cur.setDate(cur.getDate() + 1); }
    return keys;
  }

  function loadReport() {
    var keys = rangeKeys(state.reportGranularity, state.reportAnchor);
    var rows = keys.map(function (k) { return Object.assign({ date: k }, getEntry(k)); });
    setState({ reportRows: rows });
  }

  function exportExcel() {
    var foodRows = [];
    var poopRows = [];
    state.reportRows.forEach(function (r) {
      r.foodLogs.forEach(function (f) {
        foodRows.push({
          Date: r.date, Time: f.time, Food: f.foodName, Cups: f.cups, Calories: f.calories,
          'Protein (g, est.)': f.proteinG != null ? f.proteinG : '',
          'Fat (g, est.)': f.fatG != null ? f.fatG : '',
          'Fiber (g, est.)': f.fiberG != null ? f.fiberG : ''
        });
      });
      r.poopLogs.forEach(function (p) {
        poopRows.push({
          Date: r.date, Time: p.time, Size: p.size, Texture: p.texture,
          Color: p.colorAbnormal ? 'Abnormal' : 'Normal', Notes: p.colorNote
        });
      });
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      foodRows.length ? foodRows : [{ Date: '', Time: '', Food: '', Cups: '', Calories: '', 'Protein (g, est.)': '', 'Fat (g, est.)': '', 'Fiber (g, est.)': '' }]
    ), 'Food Log');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      poopRows.length ? poopRows : [{ Date: '', Time: '', Size: '', Texture: '', Color: '', Notes: '' }]
    ), 'Poop Log');
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var blob = new Blob([out], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'charlie-journal-' + state.reportGranularity + '-' + state.reportAnchor + '.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- edit: food log ----
  function startEditFoodLog(id) {
    setState({ editingFoodLogId: id, activeFoodId: null });
  }
  function cancelEditFoodLog() {
    setState({ editingFoodLogId: null });
  }
  function saveEditFoodLog(id) {
    var log = state.entry.foodLogs.find(function (l) { return l.id === id; });
    if (!log) return;
    var timeEl = document.getElementById('edit-food-log-time-' + id);
    var cupsEl = document.getElementById('edit-food-log-cups-' + id);
    var cups = parseFloat(cupsEl.value);
    if (isNaN(cups) || cups <= 0) return;
    if (!window.confirm('Save changes to this food log entry?')) return;
    var food = state.foods.find(function (f) { return f.id === log.foodId; });
    var calories, nutrients;
    if (food) {
      calories = Math.round(cups * food.calsPerCup * 100) / 100;
      nutrients = computeNutrients(food, cups);
    } else {
      // the underlying food was deleted since this was logged — scale proportionally
      // from what was recorded, so the entry stays sane instead of breaking.
      var perCup = log.cups > 0 ? log.calories / log.cups : 0;
      calories = Math.round(cups * perCup * 100) / 100;
      var scale = log.cups > 0 ? cups / log.cups : 0;
      nutrients = {
        proteinG: log.proteinG != null ? round2(log.proteinG * scale) : null,
        fatG: log.fatG != null ? round2(log.fatG * scale) : null,
        fiberG: log.fiberG != null ? round2(log.fiberG * scale) : null
      };
    }
    var next = Object.assign({}, state.entry, {
      foodLogs: state.entry.foodLogs.map(function (l) {
        if (l.id !== id) return l;
        return Object.assign({}, l, { time: (timeEl && timeEl.value) || l.time, cups: cups, calories: calories }, nutrients);
      })
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, editingFoodLogId: null });
  }

  // ---- edit: poop log ----
  function startEditPoopLog(id) {
    var log = state.entry.poopLogs.find(function (l) { return l.id === id; });
    if (!log) return;
    setState({
      editingPoopLogId: id, showPoopForm: false,
      editPoopSize: log.size, editPoopTexture: log.texture, editPoopAbnormal: log.colorAbnormal
    });
  }
  function cancelEditPoopLog() {
    setState({ editingPoopLogId: null });
  }
  function saveEditPoopLog(id) {
    if (!window.confirm('Save changes to this bathroom entry?')) return;
    var timeEl = document.getElementById('edit-poop-time-' + id);
    var noteEl = document.getElementById('edit-poop-note-' + id);
    var next = Object.assign({}, state.entry, {
      poopLogs: state.entry.poopLogs.map(function (l) {
        if (l.id !== id) return l;
        return Object.assign({}, l, {
          time: (timeEl && timeEl.value) || l.time,
          size: state.editPoopSize,
          texture: state.editPoopTexture,
          colorAbnormal: state.editPoopAbnormal,
          colorNote: state.editPoopAbnormal && noteEl ? noteEl.value.trim() : ''
        });
      })
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, editingPoopLogId: null });
  }

  // ---- edit: foods ----
  function startEditFood(id) {
    setState({ editingFoodId: id });
  }
  function cancelEditFood() {
    setState({ editingFoodId: null });
  }
  function saveEditFood(id) {
    var nameEl = document.getElementById('edit-food-name-' + id);
    var calsEl = document.getElementById('edit-food-cals-' + id);
    var name = nameEl.value.trim();
    var cals = parseFloat(calsEl.value);
    if (!name || isNaN(cals) || cals <= 0) return;
    if (!window.confirm('Save changes to this food? This won\'t change calories or nutrients already logged in the past.')) return;
    var kcalKgEl = document.getElementById('edit-food-kcalkg-' + id);
    var proteinEl = document.getElementById('edit-food-protein-' + id);
    var fatEl = document.getElementById('edit-food-fat-' + id);
    var fiberEl = document.getElementById('edit-food-fiber-' + id);
    var kcalPerKg = kcalKgEl && kcalKgEl.value ? parseFloat(kcalKgEl.value) : null;
    var proteinPct = proteinEl && proteinEl.value ? parseFloat(proteinEl.value) : null;
    var fatPct = fatEl && fatEl.value ? parseFloat(fatEl.value) : null;
    var fiberPct = fiberEl && fiberEl.value ? parseFloat(fiberEl.value) : null;
    var updated = null;
    var list = state.foods.map(function (f) {
      if (f.id !== id) return f;
      updated = Object.assign({}, f, {
        name: name, calsPerCup: cals, updatedAt: Date.now(),
        kcalPerKg: (kcalPerKg && kcalPerKg > 0) ? kcalPerKg : null,
        proteinPct: (proteinPct != null && !isNaN(proteinPct)) ? proteinPct : null,
        fatPct: (fatPct != null && !isNaN(fatPct)) ? fatPct : null,
        fiberPct: (fiberPct != null && !isNaN(fiberPct)) ? fiberPct : null
      });
      updated.gramsPerCup = gramsPerCup(updated.calsPerCup, updated.kcalPerKg);
      return updated;
    });
    setFoods(list);
    setState({ foods: list, editingFoodId: null });
    if (updated && window.CharlieSync && window.CharlieSync.pushFood) window.CharlieSync.pushFood(updated);
  }

  // ---- icons (inline SVG, stroke uses currentColor). Every icon carries an
  // explicit width/height attribute directly in the markup — not just in
  // CSS — so it always renders at a sane size even if the stylesheet hasn't
  // loaded yet or a browser is serving a stale cached copy of it. CSS rules
  // per-context (e.g. .badge-abnormal svg) can still override this default.
  var ICONS = {
    journal: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13a3 3 0 0 1 3 3v13"/><path d="M4 4v15a2 2 0 0 0 2 2h14"/><path d="M8 9h8M8 13h8"/></svg>',
    reports: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12.5" y="8" width="3" height="10"/><rect x="18" y="5" width="3" height="13"/></svg>',
    foods: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11c0-3.87 4-7 9-7s9 3.13 9 7"/><path d="M3 11h18l-1.5 8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z"/></svg>',
    chevronLeft: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    chevronRight: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    plus: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 17h.01"/></svg>',
    edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  };

  function segmented(options, value, onclickAttr) {
    return '<div class="segmented">' + options.map(function (opt) {
      var cls = 'pill' + (value === opt ? ' selected' : '');
      return '<button type="button" class="' + cls + '" data-action="' + onclickAttr + '" data-value="' + esc(opt) + '">' + esc(opt) + '</button>';
    }).join('') + '</div>';
  }

  // ---- rendering ----
  function render() {
    var app = document.getElementById('app');
    app.innerHTML =
      headerHtml() +
      (state.error ? '<div class="error-banner">' + ICONS.alert + '<span>' + esc(state.error) + '</span></div>' : '') +
      '<main id="main-content">' + mainHtml() + '</main>' +
      navHtml();
    attachEvents();
  }

  function headerHtml() {
    return '<header class="app-header"><div class="title-row"><img class="brand-mark" src="icons/icon-192.png" alt="" />' +
      '<div><h1>Charlie\'s Journal</h1><p>Food and bathroom log</p></div></div></header>';
  }

  function navHtml() {
    var tabs = [
      { id: 'journal', label: 'Journal', icon: ICONS.journal },
      { id: 'reports', label: 'Reports', icon: ICONS.reports },
      { id: 'foods', label: 'Foods', icon: ICONS.foods }
    ];
    return '<nav class="bottom-nav"><div class="bottom-nav-inner">' +
      tabs.map(function (t) {
        return '<button class="nav-btn' + (state.tab === t.id ? ' active' : '') + '" data-action="set-tab" data-value="' + t.id + '">' + t.icon + '<span>' + t.label + '</span></button>';
      }).join('') + '</div></nav>';
  }

  function mainHtml() {
    if (state.tab === 'journal') return journalHtml();
    if (state.tab === 'foods') return foodsHtml();
    return reportsHtml();
  }

  function journalHtml() {
    var html = '<div class="date-nav">' +
      '<button class="arrow" data-action="shift-date" data-value="-1">' + ICONS.chevronLeft + '</button>' +
      '<div class="date-info"><span class="date-label">' + displayDate(state.dateKey) + '</span>' +
      '<input type="date" id="date-picker" value="' + state.dateKey + '" /></div>' +
      '<button class="arrow" data-action="shift-date" data-value="1">' + ICONS.chevronRight + '</button></div>';

    var totalCal = state.entry.foodLogs.reduce(function (s, f) { return s + f.calories; }, 0);

    // Food card
    var totalProtein = null, totalFat = null, totalFiber = null;
    state.entry.foodLogs.forEach(function (f) {
      if (f.proteinG != null) totalProtein = (totalProtein || 0) + f.proteinG;
      if (f.fatG != null) totalFat = (totalFat || 0) + f.fatG;
      if (f.fiberG != null) totalFiber = (totalFiber || 0) + f.fiberG;
    });
    var nutrientParts = [];
    if (totalProtein != null) nutrientParts.push(round2(totalProtein) + 'g protein');
    if (totalFat != null) nutrientParts.push(round2(totalFat) + 'g fat');
    if (totalFiber != null) nutrientParts.push(round2(totalFiber) + 'g fiber');
    var nutrientLine = nutrientParts.length
      ? '<div style="font-size:13px;color:var(--ink-soft);margin-top:2px;">Estimated: ' + nutrientParts.join(' • ') + '</div>'
      : '';

    html += '<section class="card"><div class="section-row"><h2>Food</h2><span style="color:var(--ink-soft);font-size:14px;">' + totalCal.toFixed(2) + ' cal today</span></div>' + nutrientLine;

    if (state.foods.length === 0) {
      html += '<div class="hint-box">No foods added yet. <button type="button" class="link" data-action="set-tab" data-value="foods">Add Charlie\'s food</button> to start logging.</div>';
    } else {
      html += '<div class="chip-row">' + state.foods.map(function (f) {
        return '<button type="button" class="chip' + (state.activeFoodId === f.id ? ' active' : '') + '" data-action="toggle-food" data-value="' + f.id + '">' + esc(f.name) + '</button>';
      }).join('') + '</div>';
    }

    if (state.activeFoodId) {
      var food = state.foods.find(function (f) { return f.id === state.activeFoodId; });
      if (food) {
        html += '<div class="inline-form">' +
          '<div class="field"><label>Cups of ' + esc(food.name) + '</label>' +
          '<input type="number" step="0.25" min="0" id="cups-input" placeholder="e.g. 0.75" /></div>' +
          '<div class="preview-line" id="cal-preview">Enter cups to see calories</div>' +
          '<div class="btn-row"><button type="button" class="btn-primary" data-action="log-food" data-value="' + food.id + '">Log entry</button>' +
          '<button type="button" class="btn-secondary" data-action="cancel-food">Cancel</button></div></div>';
      }
    }

    html += '<ul class="log-list">';
    if (state.entry.foodLogs.length === 0) {
      html += '<li class="log-empty">No food logged today.</li>';
    } else {
      html += state.entry.foodLogs.map(function (f) {
        if (f.id === state.editingFoodLogId) {
          return '<li class="log-edit-row"><div class="inline-form">' +
            '<div class="field"><label>Time</label><input type="time" id="edit-food-log-time-' + f.id + '" value="' + f.time + '" /></div>' +
            '<div class="field"><label>Cups of ' + esc(f.foodName) + '</label>' +
            '<input type="number" step="0.25" min="0" id="edit-food-log-cups-' + f.id + '" value="' + f.cups + '" /></div>' +
            '<div class="btn-row"><button type="button" class="btn-primary" data-action="save-edit-food-log" data-value="' + f.id + '">Save</button>' +
            '<button type="button" class="btn-secondary" data-action="cancel-edit-food-log">Cancel</button></div></div></li>';
        }
        return '<li><span>' + f.time + ' — ' + esc(f.foodName) + ', ' + f.cups + ' cups</span>' +
          '<span style="display:flex;align-items:center;gap:10px;"><span style="color:var(--ink-soft);">' + f.calories + ' cal</span>' +
          '<button type="button" class="delete-btn" data-action="edit-food-log" data-value="' + f.id + '">' + ICONS.edit + '</button>' +
          '<button type="button" class="delete-btn" data-action="delete-food-log" data-value="' + f.id + '">' + ICONS.x + '</button></span></li>';
      }).join('');
    }
    html += '</ul></section>';

    // Poop card
    html += '<section class="card"><div class="section-row"><h2>Bathroom</h2>';
    if (!state.showPoopForm) {
      html += '<button type="button" class="pill ghost" data-action="open-poop-form">' + ICONS.plus + ' Add</button>';
    }
    html += '</div>';

    if (state.showPoopForm) {
      html += '<div class="inline-form">' +
        '<div class="field"><label>Time</label><input type="time" id="poop-time" /></div>' +
        '<div class="field"><label>Size</label>' + segmented(SIZES, state.poopSize, 'set-poop-size') + '</div>' +
        '<div class="field"><label>Texture</label>' + segmented(TEXTURES, state.poopTexture, 'set-poop-texture') + '</div>' +
        '<div class="field"><label>Color</label>' + segmented(['Normal', 'Abnormal'], state.poopAbnormal ? 'Abnormal' : 'Normal', 'set-poop-color') + '</div>';
      if (state.poopAbnormal) {
        html += '<div class="field"><label>What looked off</label><input type="text" id="poop-note" placeholder="e.g. dark red streaks" /></div>';
      }
      html += '<div class="btn-row"><button type="button" class="btn-primary" data-action="log-poop">Save entry</button>' +
        '<button type="button" class="btn-secondary" data-action="cancel-poop">Cancel</button></div></div>';
    }

    html += '<ul class="log-list">';
    if (state.entry.poopLogs.length === 0) {
      html += '<li class="log-empty">No bathroom entries today.</li>';
    } else {
      html += state.entry.poopLogs.map(function (p) {
        if (p.id === state.editingPoopLogId) {
          return '<li class="log-edit-row"><div class="inline-form">' +
            '<div class="field"><label>Time</label><input type="time" id="edit-poop-time-' + p.id + '" value="' + p.time + '" /></div>' +
            '<div class="field"><label>Size</label>' + segmented(SIZES, state.editPoopSize, 'set-edit-poop-size') + '</div>' +
            '<div class="field"><label>Texture</label>' + segmented(TEXTURES, state.editPoopTexture, 'set-edit-poop-texture') + '</div>' +
            '<div class="field"><label>Color</label>' + segmented(['Normal', 'Abnormal'], state.editPoopAbnormal ? 'Abnormal' : 'Normal', 'set-edit-poop-color') + '</div>' +
            (state.editPoopAbnormal ? '<div class="field"><label>What looked off</label><input type="text" id="edit-poop-note-' + p.id + '" value="' + esc(p.colorNote) + '" /></div>' : '') +
            '<div class="btn-row"><button type="button" class="btn-primary" data-action="save-edit-poop-log" data-value="' + p.id + '">Save</button>' +
            '<button type="button" class="btn-secondary" data-action="cancel-edit-poop-log">Cancel</button></div></div></li>';
        }
        var badge = p.colorAbnormal ? '<span class="badge-abnormal">' + ICONS.alert + 'Abnormal color' + (p.colorNote ? ': ' + esc(p.colorNote) : '') + '</span>' : '';
        return '<li><span>' + p.time + ' — ' + p.size + ', ' + p.texture + badge + '</span>' +
          '<span style="display:flex;align-items:center;gap:10px;">' +
          '<button type="button" class="delete-btn" data-action="edit-poop-log" data-value="' + p.id + '">' + ICONS.edit + '</button>' +
          '<button type="button" class="delete-btn" data-action="delete-poop-log" data-value="' + p.id + '">' + ICONS.x + '</button></span></li>';
      }).join('');
    }
    html += '</ul></section>';

    return html;
  }

  function nutritionFieldsHtml(idFn, food) {
    var kcal = food && food.kcalPerKg != null ? food.kcalPerKg : '';
    var protein = food && food.proteinPct != null ? food.proteinPct : '';
    var fat = food && food.fatPct != null ? food.fatPct : '';
    var fiber = food && food.fiberPct != null ? food.fiberPct : '';
    var gpc = food && food.gramsPerCup ? food.gramsPerCup : null;
    return '<div class="field"><label>Calories per kg (optional — from the label)</label>' +
      '<input type="number" step="1" min="0" id="' + idFn('kcalkg') + '" value="' + kcal + '" placeholder="e.g. 3641" /></div>' +
      '<div class="preview-line" id="' + idFn('gpc-preview') + '">' +
      (gpc ? '≈' + gpc + 'g per cup' : 'Add this and calories/cup to see grams per cup') +
      '</div>' +
      '<div class="field"><label>Protein % (min, optional)</label><input type="number" step="0.1" min="0" id="' + idFn('protein') + '" value="' + protein + '" placeholder="e.g. 30" /></div>' +
      '<div class="field"><label>Fat % (min, optional)</label><input type="number" step="0.1" min="0" id="' + idFn('fat') + '" value="' + fat + '" placeholder="e.g. 18" /></div>' +
      '<div class="field"><label>Fiber % (max, optional)</label><input type="number" step="0.1" min="0" id="' + idFn('fiber') + '" value="' + fiber + '" placeholder="e.g. 5.5" /></div>';
  }

  function foodNutrientSubtext(f) {
    if (!f.gramsPerCup) return '';
    var parts = [];
    var p = nutrientGrams(f, 1, 'proteinPct'); if (p != null) parts.push(p + 'g protein');
    var fa = nutrientGrams(f, 1, 'fatPct'); if (fa != null) parts.push(fa + 'g fat');
    var fi = nutrientGrams(f, 1, 'fiberPct'); if (fi != null) parts.push(fi + 'g fiber');
    if (!parts.length) return '';
    return '<div style="font-size:12px;color:var(--ink-faint);margin-top:2px;">' + parts.join(' • ') + ' per cup (est.)</div>';
  }

  function foodsHtml() {
    var html = '<section class="card"><h2 style="margin-bottom:12px;">Charlie\'s foods</h2>' +
      '<div class="inline-form">' +
      '<div class="field"><label>Food name</label><input type="text" id="new-food-name" placeholder="e.g. Salmon LID" /></div>' +
      '<div class="field"><label>Calories per cup</label><input type="number" step="0.01" min="0" id="new-food-cals" placeholder="e.g. 413" /></div>';

    if (state.showAddNutrition) {
      html += nutritionFieldsHtml(function (f) { return 'new-food-' + f; }, null) +
        '<button type="button" class="btn-secondary" style="width:100%;" data-action="toggle-add-nutrition">Hide nutrition info</button>';
    } else {
      html += '<button type="button" class="btn-secondary" style="width:100%;" data-action="toggle-add-nutrition">' + ICONS.plus + ' Add nutrition info (optional)</button>';
    }
    html += '<button type="button" class="btn-primary" style="width:100%;" data-action="add-food">Add food</button></div>';

    html += '<ul class="log-list">';
    if (state.foods.length === 0) {
      html += '<li class="log-empty">No foods yet.</li>';
    } else {
      html += state.foods.map(function (f) {
        if (f.id === state.editingFoodId) {
          return '<li class="log-edit-row"><div class="inline-form">' +
            '<div class="field"><label>Food name</label><input type="text" id="edit-food-name-' + f.id + '" value="' + esc(f.name) + '" /></div>' +
            '<div class="field"><label>Calories per cup</label><input type="number" step="0.01" min="0" id="edit-food-cals-' + f.id + '" value="' + f.calsPerCup + '" /></div>' +
            nutritionFieldsHtml(function (field) { return 'edit-food-' + field + '-' + f.id; }, f) +
            '<div class="btn-row"><button type="button" class="btn-primary" data-action="save-edit-food" data-value="' + f.id + '">Save</button>' +
            '<button type="button" class="btn-secondary" data-action="cancel-edit-food">Cancel</button></div></div></li>';
        }
        return '<li style="align-items:flex-start;"><div>' + esc(f.name) + ' — ' + f.calsPerCup + ' cal/cup' + foodNutrientSubtext(f) + '</div>' +
          '<span style="display:flex;align-items:center;gap:10px;">' +
          '<button type="button" class="delete-btn" data-action="edit-food" data-value="' + f.id + '">' + ICONS.edit + '</button>' +
          '<button type="button" class="delete-btn" data-action="delete-food" data-value="' + f.id + '">' + ICONS.x + '</button></span></li>';
      }).join('');
    }
    html += '</ul></section>';

    html += '<section class="card"><h2 style="margin-bottom:8px;">Account</h2>' +
      '<p style="font-size:14px;color:var(--ink-soft);margin:0 0 12px;">Charlie\'s log is backed up automatically while you\'re signed in.</p>' +
      '<button type="button" class="btn-secondary" style="width:100%;" data-action="sign-out">Sign out</button></section>';

    return html;
  }

  function reportsHtml() {
    var anchorInput = state.reportGranularity === 'month'
      ? '<input type="month" id="report-anchor" value="' + state.reportAnchor.slice(0, 7) + '" />'
      : '<input type="date" id="report-anchor" value="' + state.reportAnchor + '" />';

    var html = '<section class="card">' +
      segmented(['day', 'week', 'month'], state.reportGranularity, 'set-granularity') +
      '<div class="field" style="margin-top:10px;">' + anchorInput + '</div>' +
      '<button type="button" class="btn-dark" style="margin-top:10px;" data-action="export-excel">' + ICONS.download + ' Export to Excel</button>' +
      '</section>';

    html += '<section class="card"><div class="table-wrap"><table class="report-table"><thead><tr><th>Date</th><th>Cal</th><th>Protein</th><th>Fat</th><th>Fiber</th><th>BMs</th><th>Abnormal</th></tr></thead><tbody>';
    state.reportRows.forEach(function (r) {
      var cal = r.foodLogs.reduce(function (s, f) { return s + f.calories; }, 0);
      var protein = null, fat = null, fiber = null;
      r.foodLogs.forEach(function (f) {
        if (f.proteinG != null) protein = (protein || 0) + f.proteinG;
        if (f.fatG != null) fat = (fat || 0) + f.fatG;
        if (f.fiberG != null) fiber = (fiber || 0) + f.fiberG;
      });
      var abnormal = r.poopLogs.filter(function (p) { return p.colorAbnormal; }).length;
      html += '<tr><td>' + r.date + '</td><td>' + (cal ? cal.toFixed(2) : '—') + '</td>' +
        '<td>' + (protein != null ? round2(protein) + 'g' : '—') + '</td>' +
        '<td>' + (fat != null ? round2(fat) + 'g' : '—') + '</td>' +
        '<td>' + (fiber != null ? round2(fiber) + 'g' : '—') + '</td>' +
        '<td>' + (r.poopLogs.length || '—') + '</td>' +
        '<td class="' + (abnormal > 0 ? 'abnormal' : '') + '">' + (abnormal > 0 ? abnormal : '—') + '</td></tr>';
    });
    html += '</tbody></table></div></section>';
    return html;
  }

  // ---- events ----
  function attachEvents() {
    var app = document.getElementById('app');

    app.onclick = function (e) {
      var el = e.target.closest('[data-action]');
      if (!el) return;
      var action = el.getAttribute('data-action');
      var value = el.getAttribute('data-value');
      switch (action) {
        case 'set-tab':
          setState({ tab: value });
          if (value === 'reports') loadReport();
          break;
        case 'shift-date': shiftDate(parseInt(value, 10)); break;
        case 'toggle-food': setState({ activeFoodId: state.activeFoodId === value ? null : value, editingFoodLogId: null }); break;
        case 'cancel-food': setState({ activeFoodId: null }); break;
        case 'log-food': logFood(value); break;
        case 'open-poop-form': openPoopForm(); break;
        case 'cancel-poop': setState({ showPoopForm: false }); break;
        case 'log-poop': logPoop(); break;
        case 'set-poop-size': setState({ poopSize: value }); break;
        case 'set-poop-texture': setState({ poopTexture: value }); break;
        case 'set-poop-color': setState({ poopAbnormal: value === 'Abnormal' }); break;
        case 'delete-food-log': deleteFoodLog(value); break;
        case 'edit-food-log': startEditFoodLog(value); break;
        case 'cancel-edit-food-log': cancelEditFoodLog(); break;
        case 'save-edit-food-log': saveEditFoodLog(value); break;
        case 'delete-poop-log': deletePoopLog(value); break;
        case 'edit-poop-log': startEditPoopLog(value); break;
        case 'cancel-edit-poop-log': cancelEditPoopLog(); break;
        case 'save-edit-poop-log': saveEditPoopLog(value); break;
        case 'set-edit-poop-size': setState({ editPoopSize: value }); break;
        case 'set-edit-poop-texture': setState({ editPoopTexture: value }); break;
        case 'set-edit-poop-color': setState({ editPoopAbnormal: value === 'Abnormal' }); break;
        case 'add-food': addFood(); break;
        case 'toggle-add-nutrition': setState({ showAddNutrition: !state.showAddNutrition }); break;
        case 'delete-food': deleteFood(value); break;
        case 'edit-food': startEditFood(value); break;
        case 'cancel-edit-food': cancelEditFood(); break;
        case 'save-edit-food': saveEditFood(value); break;
        case 'set-granularity':
          setState({ reportGranularity: value });
          loadReport();
          break;
        case 'export-excel': exportExcel(); break;
        case 'sign-out':
          if (window.CharlieSync && window.CharlieSync.signOut) {
            window.CharlieSync.signOut().then(function () { location.reload(); });
          }
          break;
      }
    };

    var datePicker = document.getElementById('date-picker');
    if (datePicker) datePicker.onchange = function () { setDate(this.value); };

    var reportAnchor = document.getElementById('report-anchor');
    if (reportAnchor) reportAnchor.onchange = function () {
      var v = state.reportGranularity === 'month' ? this.value + '-01' : this.value;
      setState({ reportAnchor: v });
      loadReport();
    };

    var cupsInput = document.getElementById('cups-input');
    if (cupsInput) cupsInput.oninput = function () {
      var cups = parseFloat(this.value);
      var food = state.foods.find(function (f) { return f.id === state.activeFoodId; });
      var preview = document.getElementById('cal-preview');
      if (!preview || !food) return;
      if (isNaN(cups)) { preview.textContent = 'Enter cups to see calories'; return; }
      var cal = Math.round(cups * food.calsPerCup * 100) / 100;
      preview.innerHTML = cups + ' cups × ' + food.calsPerCup + ' cal/cup = <strong>' + cal + ' cal</strong>';
    };

    bindGramsPreview('new-food-cals', 'new-food-kcalkg', 'new-food-gpc-preview');
    if (state.editingFoodId) {
      bindGramsPreview(
        'edit-food-cals-' + state.editingFoodId,
        'edit-food-kcalkg-' + state.editingFoodId,
        'edit-food-gpc-preview-' + state.editingFoodId
      );
    }
  }

  function bindGramsPreview(calsId, kcalId, previewId) {
    var calsEl = document.getElementById(calsId);
    var kcalEl = document.getElementById(kcalId);
    var previewEl = document.getElementById(previewId);
    if (!calsEl || !kcalEl || !previewEl) return;
    var update = function () {
      var cals = parseFloat(calsEl.value);
      var kcal = parseFloat(kcalEl.value);
      var gpc = gramsPerCup(cals, kcal);
      previewEl.textContent = gpc ? '≈' + gpc + 'g per cup' : 'Add this and calories/cup to see grams per cup';
    };
    calsEl.oninput = update;
    kcalEl.oninput = update;
  }

  // exposed so sync.js can ask for a re-render after pulling/merging remote data
  window.CharlieApp = {
    refresh: function () {
      state.entry = getEntry(state.dateKey);
      state.foods = getFoods();
      if (state.tab === 'reports') loadReport(); else render();
    }
  };

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', function () {
    render();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(function () {});
    }
  });
})();
