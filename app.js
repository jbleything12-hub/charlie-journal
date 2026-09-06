(function () {
  'use strict';

  var SIZES = ['Small', 'Typical', 'Large'];
  var TEXTURES = ['Solid', 'Soft', 'Runny'];

  // Universal supplement/treat model: a product has a category (supplement vs
  // treat) and a form (how it's administered). Each form has a sensible
  // default unit label, but the unit label is always editable free text so
  // this can grow to cover forms we haven't thought of yet without a redesign.
  var CATEGORY_OPTIONS = ['supplement', 'treat'];
  var CATEGORY_LABELS = { supplement: 'Supplement', treat: 'Treat' };
  var FORM_OPTIONS = ['liquid', 'pump', 'powder', 'capsule', 'tablet', 'chew', 'treat', 'other'];
  var FORM_LABELS = {
    liquid: 'Liquid', pump: 'Pump', powder: 'Powder', capsule: 'Capsule',
    tablet: 'Tablet', chew: 'Chew', treat: 'Treat', other: 'Other'
  };
  var FORM_DEFAULT_UNIT = {
    liquid: 'ml', pump: 'pumps', powder: 'scoops', capsule: 'capsules',
    tablet: 'tablets', chew: 'chews', treat: 'treats', other: 'units'
  };

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
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  var round2 = function (n) { return Math.round(n * 100) / 100; };
  var gramsPerCup = function (calsPerCup, kcalPerKg) {
    if (!kcalPerKg || kcalPerKg <= 0 || !calsPerCup) return null;
    return round2((calsPerCup / kcalPerKg) * 1000);
  };
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

  var emptyEntry = function () { return { meals: [], incidents: [], poopLogs: [], updatedAt: 0 }; };

  // A logged supplement/treat item from before this update only has `pumps`
  // (no quantity/unitLabel/category/form). Bring it up to the current shape
  // without touching anything about what was actually logged.
  function migrateMealItem(it) {
    if (it.type !== 'supplement') return it;
    if (it.quantity != null) return it;
    return Object.assign({}, it, {
      quantity: it.pumps != null ? it.pumps : it.quantity,
      unitLabel: it.unitLabel || 'pumps',
      category: it.category || 'supplement',
      form: it.form || 'pump'
    });
  }

  // A bathroom entry logged before "potty outings" existed only ever
  // represented an actual bowel movement, so it's safe to backfill hadBM:true.
  function migratePoopLog(p) {
    if (p.hadBM != null) return p;
    return Object.assign({}, p, { hadBM: true });
  }

  // Converts older shapes into the current one:
  //  - oldest: foodLogs was a flat array of single-item logs
  //  - previous update: meals existed, but an "ate something he shouldn't"
  //    entry was stored as a type:'other' item inside a meal
  //  - current: meals hold only food/supplement items; incidents are separate
  // Also brings meal items and bathroom entries up to date on every read (see
  // migrateMealItem / migratePoopLog above).
  function migrateEntryShape(raw) {
    if (!raw) return emptyEntry();
    if (Array.isArray(raw.meals)) {
      var incidents = Array.isArray(raw.incidents) ? raw.incidents.slice() : [];
      var meals = raw.meals.map(function (m) {
        var keepItems = [];
        (m.items || []).forEach(function (it) {
          if (it.type === 'other') {
            incidents.push({ id: it.id || uid(), time: m.time, description: it.description, updatedAt: m.updatedAt || raw.updatedAt || Date.now() });
          } else {
            keepItems.push(migrateMealItem(it));
          }
        });
        return Object.assign({}, m, { items: keepItems });
      }).filter(function (m) { return m.items.length > 0; });
      return { meals: meals, incidents: incidents, poopLogs: (raw.poopLogs || []).map(migratePoopLog), updatedAt: raw.updatedAt || 0 };
    }
    if (!Array.isArray(raw.foodLogs)) {
      return { meals: [], incidents: raw.incidents || [], poopLogs: (raw.poopLogs || []).map(migratePoopLog), updatedAt: raw.updatedAt || 0 };
    }
    var groups = {};
    var order = [];
    raw.foodLogs.forEach(function (f) {
      var key = f.time || 'unknown';
      if (!groups[key]) {
        groups[key] = { id: uid(), time: f.time || '00:00', updatedAt: raw.updatedAt || Date.now(), items: [] };
        order.push(key);
      }
      groups[key].items.push({
        id: f.id || uid(), type: 'food', foodId: f.foodId, foodName: f.foodName, cups: f.cups, calories: f.calories,
        proteinG: f.proteinG != null ? f.proteinG : null,
        fatG: f.fatG != null ? f.fatG : null,
        fiberG: f.fiberG != null ? f.fiberG : null
      });
    });
    return { meals: order.map(function (k) { return groups[k]; }), incidents: [], poopLogs: (raw.poopLogs || []).map(migratePoopLog), updatedAt: raw.updatedAt || 0 };
  }

  // A supplement/treat product added before this update only has calsPerPump
  // and is implicitly a liquid pump. Backfill category/form/unitLabel/calsPerUnit
  // without losing the calorie rate that was already entered.
  function migrateSupplement(s) {
    if (s.category && s.form && s.unitLabel) return s;
    var calsPerUnit = s.calsPerUnit != null ? s.calsPerUnit : (s.calsPerPump != null ? s.calsPerPump : null);
    return Object.assign({}, s, {
      category: s.category || 'supplement',
      form: s.form || 'pump',
      unitLabel: s.unitLabel || 'pumps',
      calsPerUnit: calsPerUnit
    });
  }

  // ---- storage ----
  function getFoods() {
    try { return JSON.parse(localStorage.getItem('charlie:foods') || '[]'); } catch (e) { return []; }
  }
  function setFoods(list) { localStorage.setItem('charlie:foods', JSON.stringify(list)); }
  function getSupplements() {
    try {
      var list = JSON.parse(localStorage.getItem('charlie:supplements') || '[]');
      return list.map(migrateSupplement);
    } catch (e) { return []; }
  }
  function setSupplements(list) { localStorage.setItem('charlie:supplements', JSON.stringify(list)); }
  function getEntry(key) {
    try {
      var raw = localStorage.getItem('charlie:entry:' + key);
      return raw ? migrateEntryShape(JSON.parse(raw)) : emptyEntry();
    } catch (e) { return emptyEntry(); }
  }
  function setEntry(key, val) { localStorage.setItem('charlie:entry:' + key, JSON.stringify(val)); }
  function saveEntryLocal(key, val) {
    val.updatedAt = Date.now();
    setEntry(key, val);
    if (window.CharlieSync && window.CharlieSync.pushEntry) window.CharlieSync.pushEntry(key, val);
    return val;
  }

  // Charlie's profile: optional daily calorie goal + chronological weight
  // history. Kept under its own storage key (rather than mixed into foods/
  // entries) so that adding multi-animal support later is a namespacing
  // change rather than a data-model rewrite.
  function emptyProfile() { return { dailyCalorieGoal: null, weightHistory: [], updatedAt: 0 }; }
  function getProfile() {
    try {
      var raw = JSON.parse(localStorage.getItem('charlie:profile') || 'null');
      if (!raw) return emptyProfile();
      return {
        dailyCalorieGoal: raw.dailyCalorieGoal != null ? raw.dailyCalorieGoal : null,
        weightHistory: Array.isArray(raw.weightHistory) ? raw.weightHistory : [],
        updatedAt: raw.updatedAt || 0
      };
    } catch (e) { return emptyProfile(); }
  }
  function setProfile(p) { localStorage.setItem('charlie:profile', JSON.stringify(p)); }
  function saveProfileLocal(p) {
    p.updatedAt = Date.now();
    setProfile(p);
    if (window.CharlieSync && window.CharlieSync.pushProfile) window.CharlieSync.pushProfile(p);
    return p;
  }
  // Most recently recorded weight wins (by date, then by updatedAt for
  // same-day entries) — every weight-dependent calculation should read
  // through this rather than caching a "current weight" anywhere.
  function currentWeight(profile) {
    var hist = (profile && profile.weightHistory) || [];
    if (!hist.length) return null;
    var best = hist[0];
    hist.forEach(function (w) {
      if (w.date > best.date || (w.date === best.date && (w.updatedAt || 0) > (best.updatedAt || 0))) best = w;
    });
    return best;
  }

  // ---- state ----
  var state = {
    tab: 'journal',
    dateKey: toKey(new Date()),
    foods: getFoods(),
    supplements: getSupplements(),
    entry: getEntry(toKey(new Date())),
    profile: getProfile(),

    draftMeal: null,          // { time, items: [] } while building/editing a bowl
    editingMealId: null,
    pendingChip: null,        // { type: 'food'|'supplement', id }

    showIncidentForm: false,
    editingIncidentId: null,

    showPoopForm: false,
    poopHadBM: true,
    poopSize: 'Typical',
    poopTexture: 'Solid',
    poopAbnormal: false,
    editingPoopLogId: null,
    editPoopHadBM: true,
    editPoopSize: 'Typical',
    editPoopTexture: 'Solid',
    editPoopAbnormal: false,

    editingFoodId: null,
    showAddNutrition: false,
    newFoodDraft: { name: '', cals: '', kcalkg: '', protein: '', fat: '', fiber: '' },

    editingSupplementId: null,
    newSuppDraft: { name: '', category: 'supplement', form: 'pump', unitLabel: 'pumps', cals: '' },
    editSuppDraft: null,      // { name, category, form, unitLabel, cals } while editing a supplement/treat

    calorieGoalDraft: '',
    showWeightForm: false,
    newWeightDraft: { date: toKey(new Date()), weight: '' },
    editingWeightId: null,
    editWeightDraft: null,    // { date, weight } while editing a weight entry

    error: '',
    reportGranularity: 'week',
    reportAnchor: toKey(new Date()),
    reportRows: []
  };
  state.calorieGoalDraft = state.profile.dailyCalorieGoal != null ? String(state.profile.dailyCalorieGoal) : '';

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  // ---- date nav ----
  function shiftDate(days) {
    var d = fromKey(state.dateKey);
    d.setDate(d.getDate() + days);
    var key = toKey(d);
    setState({
      dateKey: key, entry: getEntry(key),
      draftMeal: null, editingMealId: null, pendingChip: null,
      showIncidentForm: false, editingIncidentId: null,
      showPoopForm: false, editingPoopLogId: null
    });
  }
  function setDate(key) {
    setState({
      dateKey: key, entry: getEntry(key),
      draftMeal: null, editingMealId: null, pendingChip: null,
      showIncidentForm: false, editingIncidentId: null,
      showPoopForm: false, editingPoopLogId: null
    });
  }

  // ---- foods CRUD ----
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
    setState({ foods: list, showAddNutrition: false, newFoodDraft: { name: '', cals: '', kcalkg: '', protein: '', fat: '', fiber: '' } });
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

  function startEditFood(id) { setState({ editingFoodId: id }); }
  function cancelEditFood() { setState({ editingFoodId: null }); }
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

  // ---- supplements & treats CRUD ----
  function addSupplement() {
    var d = state.newSuppDraft;
    var name = d.name.trim();
    if (!name) return;
    var calsVal = d.cals ? parseFloat(d.cals) : null;
    var supp = {
      id: uid(), name: name,
      category: d.category, form: d.form,
      unitLabel: (d.unitLabel || '').trim() || FORM_DEFAULT_UNIT[d.form],
      calsPerUnit: (calsVal != null && !isNaN(calsVal) && calsVal > 0) ? calsVal : null,
      updatedAt: Date.now()
    };
    var list = state.supplements.concat([supp]);
    setSupplements(list);
    setState({ supplements: list, newSuppDraft: { name: '', category: 'supplement', form: 'pump', unitLabel: 'pumps', cals: '' } });
    if (window.CharlieSync && window.CharlieSync.pushSupplement) window.CharlieSync.pushSupplement(supp);
  }

  function deleteSupplement(id) {
    var supp = state.supplements.find(function (s) { return s.id === id; });
    var name = supp ? supp.name : 'this item';
    if (!window.confirm('Remove ' + name + ' from Charlie\'s supplements/treats? Past log entries that used it are kept as-is.')) return;
    var list = state.supplements.filter(function (s) { return s.id !== id; });
    setSupplements(list);
    setState({ supplements: list });
    if (window.CharlieSync && window.CharlieSync.deleteSupplementRemote) window.CharlieSync.deleteSupplementRemote(id);
  }

  function startEditSupplement(id) {
    var s = state.supplements.find(function (x) { return x.id === id; });
    if (!s) return;
    setState({
      editingSupplementId: id,
      editSuppDraft: {
        name: s.name, category: s.category, form: s.form, unitLabel: s.unitLabel,
        cals: s.calsPerUnit != null ? String(s.calsPerUnit) : ''
      }
    });
  }
  function cancelEditSupplement() { setState({ editingSupplementId: null, editSuppDraft: null }); }
  function saveEditSupplement(id) {
    var d = state.editSuppDraft;
    var name = d.name.trim();
    if (!name) return;
    if (!window.confirm('Save changes to this item? This won\'t change amounts already logged in the past.')) return;
    var calsVal = d.cals ? parseFloat(d.cals) : null;
    var updated = null;
    var list = state.supplements.map(function (s) {
      if (s.id !== id) return s;
      updated = Object.assign({}, s, {
        name: name, category: d.category, form: d.form,
        unitLabel: (d.unitLabel || '').trim() || FORM_DEFAULT_UNIT[d.form],
        calsPerUnit: (calsVal != null && !isNaN(calsVal) && calsVal > 0) ? calsVal : null,
        updatedAt: Date.now()
      });
      return updated;
    });
    setSupplements(list);
    setState({ supplements: list, editingSupplementId: null, editSuppDraft: null });
    if (updated && window.CharlieSync && window.CharlieSync.pushSupplement) window.CharlieSync.pushSupplement(updated);
  }

  // ---- profile: calorie goal ----
  function saveCalorieGoal() {
    var val = state.calorieGoalDraft;
    var num = val === '' ? null : parseFloat(val);
    if (val !== '' && (isNaN(num) || num <= 0)) return;
    var next = Object.assign({}, state.profile, { dailyCalorieGoal: (num && num > 0) ? num : null });
    var saved = saveProfileLocal(next);
    setState({ profile: saved });
  }

  // ---- profile: weight history ----
  function openWeightForm() {
    setState({ showWeightForm: true, newWeightDraft: { date: toKey(new Date()), weight: '' } });
  }
  function cancelWeightForm() { setState({ showWeightForm: false }); }
  function saveWeight() {
    var d = state.newWeightDraft;
    var w = parseFloat(d.weight);
    if (!d.date || isNaN(w) || w <= 0) return;
    var entry = { id: uid(), date: d.date, weight: w, updatedAt: Date.now() };
    var next = Object.assign({}, state.profile, { weightHistory: state.profile.weightHistory.concat([entry]) });
    var saved = saveProfileLocal(next);
    setState({ profile: saved, showWeightForm: false, newWeightDraft: { date: toKey(new Date()), weight: '' } });
  }
  function deleteWeight(id) {
    if (!window.confirm('Delete this weight entry? This can\'t be undone.')) return;
    var next = Object.assign({}, state.profile, {
      weightHistory: state.profile.weightHistory.filter(function (w) { return w.id !== id; })
    });
    var saved = saveProfileLocal(next);
    setState({ profile: saved });
  }
  function startEditWeight(id) {
    var w = state.profile.weightHistory.find(function (x) { return x.id === id; });
    if (!w) return;
    setState({ editingWeightId: id, editWeightDraft: { date: w.date, weight: String(w.weight) } });
  }
  function cancelEditWeight() { setState({ editingWeightId: null, editWeightDraft: null }); }
  function saveEditWeight(id) {
    var d = state.editWeightDraft;
    var w = parseFloat(d.weight);
    if (!d.date || isNaN(w) || w <= 0) return;
    var next = Object.assign({}, state.profile, {
      weightHistory: state.profile.weightHistory.map(function (x) {
        return x.id === id ? Object.assign({}, x, { date: d.date, weight: w, updatedAt: Date.now() }) : x;
      })
    });
    var saved = saveProfileLocal(next);
    setState({ profile: saved, editingWeightId: null, editWeightDraft: null });
  }

  // ---- building / editing a "bowl" (one time-stamped entry with several items) ----
  function startBowl() {
    if (!state.draftMeal) setState({ draftMeal: { time: nowTime(), items: [] } });
  }

  function openChipPicker(type, id) {
    var draft = state.draftMeal || { time: nowTime(), items: [] };
    setState({ draftMeal: draft, pendingChip: { type: type, id: id } });
  }
  function cancelPendingItem() { setState({ pendingChip: null }); }

  function confirmPendingItem() {
    var amountEl = document.getElementById('pending-amount-input');
    var amount = parseFloat(amountEl.value);
    if (isNaN(amount) || amount <= 0) return;
    var item;
    if (state.pendingChip.type === 'food') {
      var food = state.foods.find(function (f) { return f.id === state.pendingChip.id; });
      if (!food) return;
      var nutrients = computeNutrients(food, amount);
      item = Object.assign({
        id: uid(), type: 'food', foodId: food.id, foodName: food.name,
        cups: amount, calories: round2(amount * food.calsPerCup)
      }, nutrients);
    } else {
      var supp = state.supplements.find(function (s) { return s.id === state.pendingChip.id; });
      if (!supp) return;
      item = {
        id: uid(), type: 'supplement', supplementId: supp.id, supplementName: supp.name,
        category: supp.category, form: supp.form, unitLabel: supp.unitLabel,
        quantity: amount, calories: supp.calsPerUnit != null ? round2(amount * supp.calsPerUnit) : null
      };
    }
    var draft = Object.assign({}, state.draftMeal, { items: state.draftMeal.items.concat([item]) });
    setState({ draftMeal: draft, pendingChip: null });
  }

  function removeDraftItem(itemId) {
    var draft = Object.assign({}, state.draftMeal, {
      items: state.draftMeal.items.filter(function (it) { return it.id !== itemId; })
    });
    setState({ draftMeal: draft });
  }

  function saveMeal() {
    if (!state.draftMeal || state.draftMeal.items.length === 0) return;
    if (state.editingMealId) {
      if (!window.confirm('Save changes to this entry?')) return;
    }
    var timeEl = document.getElementById('draft-time');
    var time = (timeEl && timeEl.value) || state.draftMeal.time || nowTime();
    var mealObj = { id: state.editingMealId || uid(), time: time, updatedAt: Date.now(), items: state.draftMeal.items };
    var meals = state.editingMealId
      ? state.entry.meals.map(function (m) { return m.id === state.editingMealId ? mealObj : m; })
      : state.entry.meals.concat([mealObj]);
    var next = Object.assign({}, state.entry, { meals: meals });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, draftMeal: null, editingMealId: null, pendingChip: null });
  }

  function cancelMeal() {
    setState({ draftMeal: null, editingMealId: null, pendingChip: null });
  }

  function startEditMeal(id) {
    var meal = state.entry.meals.find(function (m) { return m.id === id; });
    if (!meal) return;
    setState({
      editingMealId: id,
      draftMeal: { time: meal.time, items: meal.items.map(function (it) { return Object.assign({}, it); }) },
      pendingChip: null
    });
  }

  function deleteMeal(id) {
    if (!window.confirm('Delete this entry? This can\'t be undone.')) return;
    var meals = state.entry.meals.filter(function (m) { return m.id !== id; });
    var next = Object.assign({}, state.entry, { meals: meals });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next });
  }

  // ---- "ate something he shouldn't" — separate from bowl-building on purpose ----
  function openIncidentForm() { setState({ showIncidentForm: true, editingIncidentId: null }); }
  function startEditIncident(id) { setState({ showIncidentForm: true, editingIncidentId: id }); }
  function cancelIncidentForm() { setState({ showIncidentForm: false, editingIncidentId: null }); }

  function saveIncident() {
    var timeEl = document.getElementById('incident-time');
    var descEl = document.getElementById('incident-desc');
    var desc = descEl.value.trim();
    if (!desc) return;
    var item = { id: uid(), time: (timeEl && timeEl.value) || nowTime(), description: desc, updatedAt: Date.now() };
    var next = Object.assign({}, state.entry, { incidents: state.entry.incidents.concat([item]) });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, showIncidentForm: false });
  }

  function saveEditIncident() {
    if (!window.confirm('Save changes to this entry?')) return;
    var timeEl = document.getElementById('incident-time');
    var descEl = document.getElementById('incident-desc');
    var desc = descEl.value.trim();
    if (!desc) return;
    var editingId = state.editingIncidentId;
    var next = Object.assign({}, state.entry, {
      incidents: state.entry.incidents.map(function (i) {
        if (i.id !== editingId) return i;
        return Object.assign({}, i, { time: (timeEl && timeEl.value) || i.time, description: desc, updatedAt: Date.now() });
      })
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, showIncidentForm: false, editingIncidentId: null });
  }

  function deleteIncident(id) {
    if (!window.confirm('Delete this entry? This can\'t be undone.')) return;
    var next = Object.assign({}, state.entry, {
      incidents: state.entry.incidents.filter(function (i) { return i.id !== id; })
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next });
  }

  // ---- bathroom log (potty outings; each outing may or may not include a BM) ----
  function openPoopForm() {
    setState({ showPoopForm: true, poopHadBM: true, poopSize: 'Typical', poopTexture: 'Solid', poopAbnormal: false, editingPoopLogId: null });
    setTimeout(function () {
      var t = document.getElementById('poop-time');
      if (t) t.value = nowTime();
    }, 0);
  }

  function logPoop() {
    var timeEl = document.getElementById('poop-time');
    var noteEl = document.getElementById('poop-note');
    var hadBM = state.poopHadBM;
    var next = Object.assign({}, state.entry, {
      poopLogs: state.entry.poopLogs.concat([{
        id: uid(),
        time: (timeEl && timeEl.value) || nowTime(),
        hadBM: hadBM,
        size: hadBM ? state.poopSize : null,
        texture: hadBM ? state.poopTexture : null,
        colorAbnormal: hadBM ? state.poopAbnormal : null,
        colorNote: hadBM && state.poopAbnormal && noteEl ? noteEl.value.trim() : ''
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

  function startEditPoopLog(id) {
    var log = state.entry.poopLogs.find(function (l) { return l.id === id; });
    if (!log) return;
    setState({
      editingPoopLogId: id, showPoopForm: false,
      editPoopHadBM: log.hadBM, editPoopSize: log.size || 'Typical', editPoopTexture: log.texture || 'Solid', editPoopAbnormal: !!log.colorAbnormal
    });
  }
  function cancelEditPoopLog() { setState({ editingPoopLogId: null }); }
  function saveEditPoopLog(id) {
    if (!window.confirm('Save changes to this bathroom entry?')) return;
    var timeEl = document.getElementById('edit-poop-time-' + id);
    var noteEl = document.getElementById('edit-poop-note-' + id);
    var hadBM = state.editPoopHadBM;
    var next = Object.assign({}, state.entry, {
      poopLogs: state.entry.poopLogs.map(function (l) {
        if (l.id !== id) return l;
        return Object.assign({}, l, {
          time: (timeEl && timeEl.value) || l.time,
          hadBM: hadBM,
          size: hadBM ? state.editPoopSize : null,
          texture: hadBM ? state.editPoopTexture : null,
          colorAbnormal: hadBM ? state.editPoopAbnormal : null,
          colorNote: hadBM && state.editPoopAbnormal && noteEl ? noteEl.value.trim() : ''
        });
      })
    });
    saveEntryLocal(state.dateKey, next);
    setState({ entry: next, editingPoopLogId: null });
  }

  // ---- reports ----
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

  function mealTotals(meal) {
    var cal = 0, protein = null, fat = null, fiber = null;
    meal.items.forEach(function (it) {
      if (it.calories != null) cal += it.calories;
      if (it.proteinG != null) protein = (protein || 0) + it.proteinG;
      if (it.fatG != null) fat = (fat || 0) + it.fatG;
      if (it.fiberG != null) fiber = (fiber || 0) + it.fiberG;
    });
    return { cal: cal, protein: protein, fat: fat, fiber: fiber };
  }

  function dayTotals(meals) {
    var cal = 0, protein = null, fat = null, fiber = null;
    meals.forEach(function (m) {
      var t = mealTotals(m);
      cal += t.cal;
      if (t.protein != null) protein = (protein || 0) + t.protein;
      if (t.fat != null) fat = (fat || 0) + t.fat;
      if (t.fiber != null) fiber = (fiber || 0) + t.fiber;
    });
    return { cal: cal, protein: protein, fat: fat, fiber: fiber };
  }

  // Single combined workbook covering food, supplements/treats, off-plan
  // incidents, potty outings (with explicit BM Yes/No and an explicit
  // "Normal" color rather than a blank), and any weigh-ins that fall inside
  // the selected range — one tidy, filterable/sortable sheet so food and
  // bathroom activity can be lined up chronologically per animal.
  function exportExcel() {
    var ANIMAL = 'Charlie';
    var rows = [];

    var blankRow = function (date, time, eventType) {
      return {
        Animal: ANIMAL, Date: date, Time: time, 'Event Type': eventType,
        'Item / Description': '', Category: '', Form: '', Quantity: '', Unit: '',
        Calories: '', 'Protein (g, est.)': '', 'Fat (g, est.)': '', 'Fiber (g, est.)': '',
        'BM Occurred': '', 'BM Size': '', 'BM Texture': '', 'BM Color': '', 'BM Color Note': ''
      };
    };

    state.reportRows.forEach(function (r) {
      r.meals.forEach(function (m) {
        m.items.forEach(function (it) {
          if (it.type === 'food') {
            var row = blankRow(r.date, m.time, 'Food');
            row['Item / Description'] = it.foodName;
            row.Quantity = it.cups;
            row.Unit = 'cups';
            row.Calories = it.calories != null ? it.calories : '';
            row['Protein (g, est.)'] = it.proteinG != null ? it.proteinG : '';
            row['Fat (g, est.)'] = it.fatG != null ? it.fatG : '';
            row['Fiber (g, est.)'] = it.fiberG != null ? it.fiberG : '';
            rows.push(row);
          } else if (it.type === 'supplement') {
            var row2 = blankRow(r.date, m.time, it.category === 'treat' ? 'Treat' : 'Supplement');
            row2['Item / Description'] = it.supplementName;
            row2.Category = it.category ? cap(it.category) : '';
            row2.Form = it.form ? cap(it.form) : '';
            row2.Quantity = it.quantity != null ? it.quantity : '';
            row2.Unit = it.unitLabel || '';
            row2.Calories = it.calories != null ? it.calories : '';
            rows.push(row2);
          }
        });
      });

      (r.incidents || []).forEach(function (i) {
        var row = blankRow(r.date, i.time, 'Off-Plan');
        row['Item / Description'] = i.description;
        rows.push(row);
      });

      (r.poopLogs || []).forEach(function (p) {
        var row = blankRow(r.date, p.time, 'Potty Outing');
        row['BM Occurred'] = p.hadBM ? 'Yes' : 'No';
        row['BM Size'] = p.hadBM ? p.size : '';
        row['BM Texture'] = p.hadBM ? p.texture : '';
        row['BM Color'] = p.hadBM ? (p.colorAbnormal ? 'Abnormal' : 'Normal') : '';
        row['BM Color Note'] = p.hadBM ? (p.colorNote || '') : '';
        rows.push(row);
      });

      state.profile.weightHistory.forEach(function (w) {
        if (w.date === r.date) {
          var row = blankRow(r.date, '', 'Weigh-In');
          row['Item / Description'] = 'Weight';
          row.Quantity = w.weight;
          row.Unit = 'lb';
          rows.push(row);
        }
      });
    });

    rows.sort(function (a, b) {
      if (a.Date !== b.Date) return a.Date < b.Date ? -1 : 1;
      return String(a.Time || '').localeCompare(String(b.Time || ''));
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      rows.length ? rows : [blankRow('', '', '')]
    ), 'Combined Log');

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

  // Like segmented(), but the button value (data-value) can differ from the
  // displayed label — used for category/form pickers where we store a stable
  // key ('supplement', 'pump') but show a friendly label ('Supplement', 'Pump').
  function pillGroup(options, labels, selected, onclickAttr) {
    return '<div class="segmented">' + options.map(function (key) {
      var cls = 'pill' + (selected === key ? ' selected' : '');
      return '<button type="button" class="' + cls + '" data-action="' + onclickAttr + '" data-value="' + esc(key) + '">' + esc(labels[key]) + '</button>';
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

  function itemDescription(it) {
    if (it.type === 'food') return it.cups + ' cup' + (it.cups === 1 ? '' : 's') + ' ' + esc(it.foodName);
    if (it.type === 'supplement') return it.quantity + ' ' + esc(it.unitLabel || 'units') + ' ' + esc(it.supplementName);
    return esc(it.description);
  }

  function chipRowsHtml() {
    if (state.foods.length === 0 && state.supplements.length === 0) {
      return '<div class="hint-box">No foods added yet. <button type="button" class="link" data-action="set-tab" data-value="foods">Add Charlie\'s food</button> to start logging.</div>';
    }
    var html = '';
    if (state.foods.length) {
      html += '<p class="mini-label">Foods</p><div class="chip-row">' + state.foods.map(function (f) {
        var active = state.pendingChip && state.pendingChip.type === 'food' && state.pendingChip.id === f.id;
        return '<button type="button" class="chip' + (active ? ' active' : '') + '" data-action="pick-chip" data-value="food:' + f.id + '">' + esc(f.name) + '</button>';
      }).join('') + '</div>';
    }
    var chipsFor = function (list) {
      return list.map(function (s) {
        var active = state.pendingChip && state.pendingChip.type === 'supplement' && state.pendingChip.id === s.id;
        return '<button type="button" class="chip' + (active ? ' active' : '') + '" data-action="pick-chip" data-value="supplement:' + s.id + '">' + esc(s.name) + '</button>';
      }).join('');
    };
    var supps = state.supplements.filter(function (s) { return s.category !== 'treat'; });
    var treats = state.supplements.filter(function (s) { return s.category === 'treat'; });
    if (supps.length) html += '<p class="mini-label">Supplements</p><div class="chip-row">' + chipsFor(supps) + '</div>';
    if (treats.length) html += '<p class="mini-label">Treats</p><div class="chip-row">' + chipsFor(treats) + '</div>';
    return html;
  }

  function pendingAmountFormHtml() {
    if (!state.pendingChip) return '';
    if (state.pendingChip.type === 'food') {
      var food = state.foods.find(function (f) { return f.id === state.pendingChip.id; });
      if (!food) return '';
      return '<div class="inline-form">' +
        '<div class="field"><label>Cups of ' + esc(food.name) + '</label><input type="number" step="0.25" min="0" id="pending-amount-input" placeholder="e.g. 0.75" /></div>' +
        '<div class="preview-line" id="pending-preview">Enter cups to see calories</div>' +
        '<div class="btn-row"><button type="button" class="btn-primary" data-action="confirm-pending-item">Add to entry</button>' +
        '<button type="button" class="btn-secondary" data-action="cancel-pending-item">Cancel</button></div></div>';
    }
    var supp = state.supplements.find(function (s) { return s.id === state.pendingChip.id; });
    if (!supp) return '';
    var unitLabel = supp.unitLabel || 'units';
    return '<div class="inline-form">' +
      '<div class="field"><label>' + esc(cap(unitLabel)) + ' of ' + esc(supp.name) + '</label><input type="number" step="0.25" min="0" id="pending-amount-input" placeholder="e.g. 1" /></div>' +
      (supp.calsPerUnit != null ? '<div class="preview-line" id="pending-preview">Enter amount to see calories</div>' : '') +
      '<div class="btn-row"><button type="button" class="btn-primary" data-action="confirm-pending-item">Add to entry</button>' +
      '<button type="button" class="btn-secondary" data-action="cancel-pending-item">Cancel</button></div></div>';
  }

  function bowlPanelHtml() {
    if (!state.draftMeal) return '';
    var draft = state.draftMeal;
    var html = '<div class="bowl-panel">';
    html += '<div class="field"><label>Time</label><input type="time" id="draft-time" value="' + draft.time + '" /></div>';
    if (draft.items.length) {
      html += '<ul class="draft-item-list">' + draft.items.map(function (it) {
        return '<li><span>' + itemDescription(it) +
          (it.calories != null ? ' — ' + it.calories + ' cal' : '') + '</span>' +
          '<button type="button" class="delete-btn" data-action="remove-draft-item" data-value="' + it.id + '">' + ICONS.x + '</button></li>';
      }).join('') + '</ul>';
    }
    html += chipRowsHtml();
    html += pendingAmountFormHtml();
    html += '<div class="btn-row" style="margin-top:10px;"><button type="button" class="btn-primary" data-action="save-meal">Save entry</button>' +
      '<button type="button" class="btn-secondary" data-action="cancel-meal">Cancel</button></div>';
    html += '</div>';
    return html;
  }

  function incidentFormHtml() {
    if (!state.showIncidentForm) return '';
    var editing = state.editingIncidentId ? state.entry.incidents.find(function (i) { return i.id === state.editingIncidentId; }) : null;
    var timeVal = editing ? editing.time : nowTime();
    var descVal = editing ? editing.description : '';
    return '<div class="bowl-panel">' +
      '<div class="field"><label>Time</label><input type="time" id="incident-time" value="' + timeVal + '" /></div>' +
      '<div class="field"><label>What happened</label><input type="text" id="incident-desc" value="' + esc(descVal) + '" placeholder="e.g. got into the trash" /></div>' +
      '<div class="btn-row"><button type="button" class="btn-primary" data-action="' + (editing ? 'save-edit-incident' : 'save-incident') + '">Save</button>' +
      '<button type="button" class="btn-secondary" data-action="cancel-incident-form">Cancel</button></div></div>';
  }

  function mealRowHtml(meal) {
    var t = mealTotals(meal);
    var summary = meal.items.map(itemDescription).join(', ');
    return '<li><span>' + meal.time + ' — ' + summary + '</span>' +
      '<span style="display:flex;align-items:center;gap:10px;">' +
      '<span style="color:var(--ink-soft);">' + (t.cal ? t.cal.toFixed(2) + ' cal' : '') + '</span>' +
      '<button type="button" class="delete-btn" data-action="edit-meal" data-value="' + meal.id + '">' + ICONS.edit + '</button>' +
      '<button type="button" class="delete-btn" data-action="delete-meal" data-value="' + meal.id + '">' + ICONS.x + '</button></span></li>';
  }

  function incidentRowHtml(inc) {
    return '<li><span style="color:var(--amber);display:flex;align-items:center;gap:6px;">' + ICONS.alert +
      inc.time + ' — ' + esc(inc.description) + '</span>' +
      '<span style="display:flex;align-items:center;gap:10px;">' +
      '<button type="button" class="delete-btn" data-action="edit-incident" data-value="' + inc.id + '">' + ICONS.edit + '</button>' +
      '<button type="button" class="delete-btn" data-action="delete-incident" data-value="' + inc.id + '">' + ICONS.x + '</button></span></li>';
  }

  function journalHtml() {
    var html = '<div class="date-nav">' +
      '<button class="arrow" data-action="shift-date" data-value="-1">' + ICONS.chevronLeft + '</button>' +
      '<div class="date-info"><span class="date-label">' + displayDate(state.dateKey) + '</span>' +
      '<input type="date" id="date-picker" value="' + state.dateKey + '" /></div>' +
      '<button class="arrow" data-action="shift-date" data-value="1">' + ICONS.chevronRight + '</button></div>';

    var totals = dayTotals(state.entry.meals);
    var nutrientParts = [];
    if (totals.protein != null) nutrientParts.push(round2(totals.protein) + 'g protein');
    if (totals.fat != null) nutrientParts.push(round2(totals.fat) + 'g fat');
    if (totals.fiber != null) nutrientParts.push(round2(totals.fiber) + 'g fiber');
    var nutrientLine = nutrientParts.length
      ? '<div style="font-size:13px;color:var(--ink-soft);margin-top:2px;">Estimated: ' + nutrientParts.join(' • ') + '</div>'
      : '';

    var goalLine = '';
    var goal = state.profile.dailyCalorieGoal;
    if (goal != null) {
      var remaining = round2(goal - totals.cal);
      var remainingText = remaining >= 0
        ? round2(remaining) + ' cal remaining'
        : (round2(Math.abs(remaining)) + ' cal over goal');
      goalLine = '<div style="font-size:13px;color:var(--ink-soft);margin-top:2px;">Goal: ' + goal + ' cal • ' + remainingText + '</div>';
    }

    html += '<section class="card"><div class="section-row"><h2>Food</h2><span style="color:var(--ink-soft);font-size:14px;">' + totals.cal.toFixed(2) + ' cal today</span></div>' + nutrientLine + goalLine;

    if (!state.draftMeal && !state.showIncidentForm) {
      html += '<button type="button" class="btn-primary" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;" data-action="start-bowl">' +
        '<img src="icons/bowl-40.png" alt="" style="width:22px;height:22px;" /> Build Bowl</button>' +
        '<button type="button" class="btn-secondary" style="width:100%;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px;" data-action="open-incident-form">' +
        ICONS.alert + ' Ate something he shouldn\'t</button>';
    }

    html += bowlPanelHtml();
    html += incidentFormHtml();

    var savedMeals = state.entry.meals.filter(function (m) { return m.id !== state.editingMealId; });
    html += '<ul class="log-list">';
    if (savedMeals.length === 0) {
      html += '<li class="log-empty">No food logged today.</li>';
    } else {
      html += savedMeals.map(mealRowHtml).join('');
    }
    html += '</ul>';

    var savedIncidents = state.entry.incidents.filter(function (i) { return i.id !== state.editingIncidentId; });
    if (savedIncidents.length) {
      html += '<p class="mini-label">Off-plan</p><ul class="log-list">' + savedIncidents.map(incidentRowHtml).join('') + '</ul>';
    }
    html += '</section>';

    // Bathroom card
    var outingCount = state.entry.poopLogs.length;
    var bmCount = state.entry.poopLogs.filter(function (p) { return p.hadBM; }).length;
    var summaryText = outingCount
      ? outingCount + ' outing' + (outingCount === 1 ? '' : 's') + ' • ' + bmCount + ' BM' + (bmCount === 1 ? '' : 's') + ' today'
      : '';

    html += '<section class="card"><div class="section-row"><h2>Bathroom</h2>';
    if (!state.showPoopForm) {
      html += '<button type="button" class="pill ghost" data-action="open-poop-form"><img src="icons/poop-40.png" alt="" style="width:16px;height:16px;" /> Add outing</button>';
    }
    html += '</div>';
    if (summaryText) html += '<div style="font-size:13px;color:var(--ink-soft);margin:-6px 0 10px;">' + summaryText + '</div>';

    if (state.showPoopForm) {
      html += '<div class="inline-form">' +
        '<div class="field"><label>Time</label><input type="time" id="poop-time" /></div>' +
        '<div class="field"><label>Bowel movement?</label>' + segmented(['Yes', 'No'], state.poopHadBM ? 'Yes' : 'No', 'set-poop-hadbm') + '</div>';
      if (state.poopHadBM) {
        html += '<div class="field"><label>Size</label>' + segmented(SIZES, state.poopSize, 'set-poop-size') + '</div>' +
          '<div class="field"><label>Texture</label>' + segmented(TEXTURES, state.poopTexture, 'set-poop-texture') + '</div>' +
          '<div class="field"><label>Color</label>' + segmented(['Normal', 'Abnormal'], state.poopAbnormal ? 'Abnormal' : 'Normal', 'set-poop-color') + '</div>';
        if (state.poopAbnormal) {
          html += '<div class="field"><label>What looked off</label><input type="text" id="poop-note" placeholder="e.g. dark red streaks" /></div>';
        }
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
            '<div class="field"><label>Bowel movement?</label>' + segmented(['Yes', 'No'], state.editPoopHadBM ? 'Yes' : 'No', 'set-edit-poop-hadbm') + '</div>' +
            (state.editPoopHadBM ? (
              '<div class="field"><label>Size</label>' + segmented(SIZES, state.editPoopSize, 'set-edit-poop-size') + '</div>' +
              '<div class="field"><label>Texture</label>' + segmented(TEXTURES, state.editPoopTexture, 'set-edit-poop-texture') + '</div>' +
              '<div class="field"><label>Color</label>' + segmented(['Normal', 'Abnormal'], state.editPoopAbnormal ? 'Abnormal' : 'Normal', 'set-edit-poop-color') + '</div>' +
              (state.editPoopAbnormal ? '<div class="field"><label>What looked off</label><input type="text" id="edit-poop-note-' + p.id + '" value="' + esc(p.colorNote || '') + '" /></div>' : '')
            ) : '') +
            '<div class="btn-row"><button type="button" class="btn-primary" data-action="save-edit-poop-log" data-value="' + p.id + '">Save</button>' +
            '<button type="button" class="btn-secondary" data-action="cancel-edit-poop-log">Cancel</button></div></div></li>';
        }
        if (!p.hadBM) {
          return '<li><span style="display:flex;align-items:center;gap:6px;"><img src="icons/poop-40.png" alt="" style="width:16px;height:16px;flex-shrink:0;opacity:0.4;" />' + p.time + ' — No bowel movement</span>' +
            '<span style="display:flex;align-items:center;gap:10px;">' +
            '<button type="button" class="delete-btn" data-action="edit-poop-log" data-value="' + p.id + '">' + ICONS.edit + '</button>' +
            '<button type="button" class="delete-btn" data-action="delete-poop-log" data-value="' + p.id + '">' + ICONS.x + '</button></span></li>';
        }
        // Always show an explicit color indicator — "Normal" shown plainly,
        // "Abnormal" shown as the existing amber badge. Never leave it blank,
        // since blank should only ever mean "not entered".
        var colorTag = p.colorAbnormal
          ? '<span class="badge-abnormal">' + ICONS.alert + 'Abnormal color' + (p.colorNote ? ': ' + esc(p.colorNote) : '') + '</span>'
          : '<span style="font-size:12px;color:var(--ink-faint);margin-left:8px;">Normal</span>';
        return '<li><span style="display:flex;align-items:center;gap:6px;"><img src="icons/poop-40.png" alt="" style="width:16px;height:16px;flex-shrink:0;" />' + p.time + ' — ' + p.size + ', ' + p.texture + colorTag + '</span>' +
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

  function shortDate(k) {
    return fromKey(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function profileCardHtml() {
    var cw = currentWeight(state.profile);
    var html = '<section class="card"><h2 style="margin-bottom:12px;">Charlie\'s profile</h2>' +
      '<div class="inline-form">' +
      '<div class="field"><label>Daily calorie goal (optional)</label>' +
      '<input type="number" step="1" min="0" id="calorie-goal-input" placeholder="e.g. 1200" value="' + esc(state.calorieGoalDraft) + '" /></div>' +
      '<button type="button" class="btn-primary" style="width:100%;" data-action="save-calorie-goal">Save goal</button>' +
      '</div>';

    html += '<div class="section-row" style="margin-top:14px;"><h2 style="font-size:16px;">Weight</h2>' +
      (!state.showWeightForm ? '<button type="button" class="pill ghost" data-action="open-weight-form">' + ICONS.plus + ' Log weight</button>' : '') +
      '</div>';
    html += '<p style="margin:0 0 10px;color:var(--ink-soft);font-size:14px;">Current: ' +
      (cw ? cw.weight + ' lb <span style="color:var(--ink-faint);">(as of ' + shortDate(cw.date) + ')</span>' : 'No weight recorded yet') + '</p>';

    if (state.showWeightForm) {
      var d = state.newWeightDraft;
      html += '<div class="inline-form">' +
        '<div class="field"><label>Date</label><input type="date" id="new-weight-date" value="' + d.date + '" /></div>' +
        '<div class="field"><label>Weight (lb)</label><input type="number" step="0.1" min="0" id="new-weight-value" value="' + esc(d.weight) + '" placeholder="e.g. 82.4" /></div>' +
        '<div class="btn-row"><button type="button" class="btn-primary" data-action="save-weight">Save</button>' +
        '<button type="button" class="btn-secondary" data-action="cancel-weight-form">Cancel</button></div></div>';
    }

    html += '<ul class="log-list">';
    var hist = state.profile.weightHistory.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    if (hist.length === 0) {
      html += '<li class="log-empty">No weight history yet.</li>';
    } else {
      html += hist.map(function (w) {
        if (w.id === state.editingWeightId) {
          var ed = state.editWeightDraft;
          return '<li class="log-edit-row"><div class="inline-form">' +
            '<div class="field"><label>Date</label><input type="date" id="edit-weight-date-' + w.id + '" value="' + ed.date + '" /></div>' +
            '<div class="field"><label>Weight (lb)</label><input type="number" step="0.1" min="0" id="edit-weight-value-' + w.id + '" value="' + esc(ed.weight) + '" /></div>' +
            '<div class="btn-row"><button type="button" class="btn-primary" data-action="save-edit-weight" data-value="' + w.id + '">Save</button>' +
            '<button type="button" class="btn-secondary" data-action="cancel-edit-weight">Cancel</button></div></div></li>';
        }
        return '<li><span>' + shortDate(w.date) + ' — ' + w.weight + ' lb</span>' +
          '<span style="display:flex;align-items:center;gap:10px;">' +
          '<button type="button" class="delete-btn" data-action="edit-weight" data-value="' + w.id + '">' + ICONS.edit + '</button>' +
          '<button type="button" class="delete-btn" data-action="delete-weight" data-value="' + w.id + '">' + ICONS.x + '</button></span></li>';
      }).join('');
    }
    html += '</ul></section>';
    return html;
  }

  function foodsHtml() {
    var d = state.newFoodDraft;
    var html = profileCardHtml();

    html += '<section class="card"><h2 style="margin-bottom:12px;">Charlie\'s foods</h2>' +
      '<div class="inline-form">' +
      '<div class="field"><label>Food name</label><input type="text" id="new-food-name" placeholder="e.g. Salmon LID" value="' + esc(d.name) + '" /></div>' +
      '<div class="field"><label>Calories per cup</label><input type="number" step="0.01" min="0" id="new-food-cals" placeholder="e.g. 413" value="' + esc(d.cals) + '" /></div>';

    if (state.showAddNutrition) {
      var draftCals = parseFloat(d.cals);
      var draftKcalKg = parseFloat(d.kcalkg);
      var draftFoodLike = {
        kcalPerKg: d.kcalkg, proteinPct: d.protein, fatPct: d.fat, fiberPct: d.fiber,
        gramsPerCup: gramsPerCup(draftCals, draftKcalKg)
      };
      html += nutritionFieldsHtml(function (f) { return 'new-food-' + f; }, draftFoodLike) +
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

    var sd = state.newSuppDraft;
    html += '<section class="card"><h2 style="margin-bottom:12px;">Charlie\'s supplements &amp; treats</h2>' +
      '<div class="inline-form">' +
      '<div class="field"><label>Name</label><input type="text" id="new-supp-name" placeholder="e.g. Fish Oil or Milk-Bone" value="' + esc(sd.name) + '" /></div>' +
      '<div class="field"><label>Category</label>' + pillGroup(CATEGORY_OPTIONS, CATEGORY_LABELS, sd.category, 'set-new-supp-category') + '</div>' +
      '<div class="field"><label>Form</label>' + pillGroup(FORM_OPTIONS, FORM_LABELS, sd.form, 'set-new-supp-form') + '</div>' +
      '<div class="field"><label>Unit label</label><input type="text" id="new-supp-unit" value="' + esc(sd.unitLabel) + '" placeholder="e.g. pumps, tablets, g" /></div>' +
      '<div class="field"><label>Calories per ' + esc(sd.unitLabel || 'unit') + ' (optional)</label><input type="number" step="0.1" min="0" id="new-supp-cals" value="' + esc(sd.cals) + '" placeholder="e.g. 17" /></div>' +
      '<button type="button" class="btn-primary" style="width:100%;" data-action="add-supplement">Add</button></div>';

    html += '<ul class="log-list">';
    if (state.supplements.length === 0) {
      html += '<li class="log-empty">No supplements or treats yet.</li>';
    } else {
      html += state.supplements.map(function (s) {
        if (s.id === state.editingSupplementId) {
          var ed = state.editSuppDraft;
          return '<li class="log-edit-row"><div class="inline-form">' +
            '<div class="field"><label>Name</label><input type="text" id="edit-supp-name-' + s.id + '" value="' + esc(ed.name) + '" /></div>' +
            '<div class="field"><label>Category</label>' + pillGroup(CATEGORY_OPTIONS, CATEGORY_LABELS, ed.category, 'set-edit-supp-category') + '</div>' +
            '<div class="field"><label>Form</label>' + pillGroup(FORM_OPTIONS, FORM_LABELS, ed.form, 'set-edit-supp-form') + '</div>' +
            '<div class="field"><label>Unit label</label><input type="text" id="edit-supp-unit-' + s.id + '" value="' + esc(ed.unitLabel) + '" /></div>' +
            '<div class="field"><label>Calories per ' + esc(ed.unitLabel || 'unit') + ' (optional)</label><input type="number" step="0.1" min="0" id="edit-supp-cals-' + s.id + '" value="' + esc(ed.cals) + '" /></div>' +
            '<div class="btn-row"><button type="button" class="btn-primary" data-action="save-edit-supplement" data-value="' + s.id + '">Save</button>' +
            '<button type="button" class="btn-secondary" data-action="cancel-edit-supplement">Cancel</button></div></div></li>';
        }
        return '<li style="align-items:flex-start;"><div>' + esc(s.name) +
          ' <span style="color:var(--ink-faint);font-size:12px;">(' + esc(CATEGORY_LABELS[s.category] || s.category) + ' · ' + esc(FORM_LABELS[s.form] || s.form) + ')</span>' +
          (s.calsPerUnit != null ? '<div style="font-size:12px;color:var(--ink-faint);margin-top:2px;">' + s.calsPerUnit + ' cal/' + esc(s.unitLabel) + '</div>' : '') +
          '</div>' +
          '<span style="display:flex;align-items:center;gap:10px;">' +
          '<button type="button" class="delete-btn" data-action="edit-supplement" data-value="' + s.id + '">' + ICONS.edit + '</button>' +
          '<button type="button" class="delete-btn" data-action="delete-supplement" data-value="' + s.id + '">' + ICONS.x + '</button></span></li>';
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

    html += '<section class="card"><h2 style="margin-bottom:10px;">Food &amp; bathroom summary</h2><div class="table-wrap"><table class="report-table"><thead><tr><th>Date</th><th>Cal</th><th>Protein</th><th>Fat</th><th>Fiber</th><th>Outings</th><th>BMs</th><th>Abnormal</th></tr></thead><tbody>';
    state.reportRows.forEach(function (r) {
      var t = dayTotals(r.meals);
      var bmCount = r.poopLogs.filter(function (p) { return p.hadBM; }).length;
      var abnormal = r.poopLogs.filter(function (p) { return p.hadBM && p.colorAbnormal; }).length;
      html += '<tr><td>' + shortDate(r.date) + '</td><td>' + (t.cal ? t.cal.toFixed(2) : '—') + '</td>' +
        '<td>' + (t.protein != null ? round2(t.protein) + 'g' : '—') + '</td>' +
        '<td>' + (t.fat != null ? round2(t.fat) + 'g' : '—') + '</td>' +
        '<td>' + (t.fiber != null ? round2(t.fiber) + 'g' : '—') + '</td>' +
        '<td>' + (r.poopLogs.length || '—') + '</td>' +
        '<td>' + (bmCount || '—') + '</td>' +
        '<td class="' + (abnormal > 0 ? 'abnormal' : '') + '">' + (abnormal > 0 ? abnormal : '—') + '</td></tr>';
    });
    html += '</tbody></table></div></section>';

    var poopRows = [];
    state.reportRows.forEach(function (r) {
      r.poopLogs.forEach(function (p) {
        poopRows.push({ date: r.date, time: p.time, hadBM: p.hadBM, size: p.size, texture: p.texture, colorAbnormal: p.colorAbnormal, colorNote: p.colorNote });
      });
    });
    html += '<section class="card"><h2 style="margin-bottom:10px;">Bathroom details</h2>';
    if (poopRows.length === 0) {
      html += '<p class="log-empty">No bathroom entries in this range.</p>';
    } else {
      html += '<div class="table-wrap"><table class="report-table"><thead><tr><th>Date</th><th>Time</th><th>BM</th><th>Size</th><th>Texture</th><th>Color</th></tr></thead><tbody>';
      poopRows.forEach(function (p) {
        html += '<tr><td>' + shortDate(p.date) + '</td><td>' + p.time + '</td><td>' + (p.hadBM ? 'Yes' : 'No') + '</td>' +
          '<td>' + (p.hadBM ? p.size : '—') + '</td><td>' + (p.hadBM ? p.texture : '—') + '</td>' +
          '<td class="' + (p.hadBM && p.colorAbnormal ? 'abnormal' : '') + '">' +
          (p.hadBM ? (p.colorAbnormal ? 'Abnormal' + (p.colorNote ? ': ' + esc(p.colorNote) : '') : 'Normal') : '—') +
          '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</section>';

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

        case 'start-bowl': startBowl(); break;
        case 'pick-chip': {
          var parts = value.split(':');
          openChipPicker(parts[0], parts[1]);
          break;
        }
        case 'cancel-pending-item': cancelPendingItem(); break;
        case 'confirm-pending-item': confirmPendingItem(); break;
        case 'remove-draft-item': removeDraftItem(value); break;
        case 'save-meal': saveMeal(); break;
        case 'cancel-meal': cancelMeal(); break;
        case 'edit-meal': startEditMeal(value); break;
        case 'delete-meal': deleteMeal(value); break;

        case 'open-incident-form': openIncidentForm(); break;
        case 'cancel-incident-form': cancelIncidentForm(); break;
        case 'save-incident': saveIncident(); break;
        case 'save-edit-incident': saveEditIncident(); break;
        case 'edit-incident': startEditIncident(value); break;
        case 'delete-incident': deleteIncident(value); break;

        case 'open-poop-form': openPoopForm(); break;
        case 'cancel-poop': setState({ showPoopForm: false }); break;
        case 'log-poop': logPoop(); break;
        case 'set-poop-hadbm': setState({ poopHadBM: value === 'Yes' }); break;
        case 'set-poop-size': setState({ poopSize: value }); break;
        case 'set-poop-texture': setState({ poopTexture: value }); break;
        case 'set-poop-color': setState({ poopAbnormal: value === 'Abnormal' }); break;
        case 'delete-poop-log': deletePoopLog(value); break;
        case 'edit-poop-log': startEditPoopLog(value); break;
        case 'cancel-edit-poop-log': cancelEditPoopLog(); break;
        case 'save-edit-poop-log': saveEditPoopLog(value); break;
        case 'set-edit-poop-hadbm': setState({ editPoopHadBM: value === 'Yes' }); break;
        case 'set-edit-poop-size': setState({ editPoopSize: value }); break;
        case 'set-edit-poop-texture': setState({ editPoopTexture: value }); break;
        case 'set-edit-poop-color': setState({ editPoopAbnormal: value === 'Abnormal' }); break;

        case 'add-food': addFood(); break;
        case 'toggle-add-nutrition': setState({ showAddNutrition: !state.showAddNutrition }); break;
        case 'delete-food': deleteFood(value); break;
        case 'edit-food': startEditFood(value); break;
        case 'cancel-edit-food': cancelEditFood(); break;
        case 'save-edit-food': saveEditFood(value); break;

        case 'add-supplement': addSupplement(); break;
        case 'delete-supplement': deleteSupplement(value); break;
        case 'edit-supplement': startEditSupplement(value); break;
        case 'cancel-edit-supplement': cancelEditSupplement(); break;
        case 'save-edit-supplement': saveEditSupplement(value); break;
        case 'set-new-supp-category': setState({ newSuppDraft: Object.assign({}, state.newSuppDraft, { category: value }) }); break;
        case 'set-new-supp-form': setState({ newSuppDraft: Object.assign({}, state.newSuppDraft, { form: value, unitLabel: FORM_DEFAULT_UNIT[value] }) }); break;
        case 'set-edit-supp-category': setState({ editSuppDraft: Object.assign({}, state.editSuppDraft, { category: value }) }); break;
        case 'set-edit-supp-form': setState({ editSuppDraft: Object.assign({}, state.editSuppDraft, { form: value, unitLabel: FORM_DEFAULT_UNIT[value] }) }); break;

        case 'save-calorie-goal': saveCalorieGoal(); break;
        case 'open-weight-form': openWeightForm(); break;
        case 'cancel-weight-form': cancelWeightForm(); break;
        case 'save-weight': saveWeight(); break;
        case 'edit-weight': startEditWeight(value); break;
        case 'cancel-edit-weight': cancelEditWeight(); break;
        case 'save-edit-weight': saveEditWeight(value); break;
        case 'delete-weight': deleteWeight(value); break;

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

    bindNewFoodDraftFields();
    if (state.editingFoodId) {
      bindGramsPreview(
        'edit-food-cals-' + state.editingFoodId,
        'edit-food-kcalkg-' + state.editingFoodId,
        'edit-food-gpc-preview-' + state.editingFoodId
      );
    }
    bindPendingPreview();
    bindCalorieGoalField();
    bindWeightDraftFields();
    bindNewSuppDraftFields();
    bindEditSuppDraftFields();
  }

  // Keeps state.newFoodDraft in sync with every keystroke in the Add Food
  // form — not just at submit time — so that toggling "Add nutrition info"
  // (or any other action that triggers a re-render while this form is open)
  // never wipes out what's already been typed. Also drives the live
  // grams-per-cup preview, since calories/cup and calories/kg live here too.
  function bindNewFoodDraftFields() {
    var ids = { name: 'new-food-name', cals: 'new-food-cals', kcalkg: 'new-food-kcalkg', protein: 'new-food-protein', fat: 'new-food-fat', fiber: 'new-food-fiber' };
    var calsEl = document.getElementById(ids.cals);
    var kcalEl = document.getElementById(ids.kcalkg);
    var previewEl = document.getElementById('new-food-gpc-preview');

    Object.keys(ids).forEach(function (key) {
      var el = document.getElementById(ids[key]);
      if (!el) return;
      el.oninput = function () {
        state.newFoodDraft[key] = this.value;
        if (previewEl && calsEl && kcalEl) {
          var gpc = gramsPerCup(parseFloat(calsEl.value), parseFloat(kcalEl.value));
          previewEl.textContent = gpc ? '≈' + gpc + 'g per cup' : 'Add this and calories/cup to see grams per cup';
        }
      };
    });
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

  function bindPendingPreview() {
    var input = document.getElementById('pending-amount-input');
    var preview = document.getElementById('pending-preview');
    if (!input || !preview || !state.pendingChip) return;
    input.oninput = function () {
      var amt = parseFloat(this.value);
      if (state.pendingChip.type === 'food') {
        var food = state.foods.find(function (f) { return f.id === state.pendingChip.id; });
        if (!food || isNaN(amt)) { preview.textContent = 'Enter cups to see calories'; return; }
        var cal = round2(amt * food.calsPerCup);
        preview.innerHTML = amt + ' cups × ' + food.calsPerCup + ' cal/cup = <strong>' + cal + ' cal</strong>';
      } else {
        var supp = state.supplements.find(function (s) { return s.id === state.pendingChip.id; });
        if (!supp || isNaN(amt) || supp.calsPerUnit == null) { preview.textContent = 'Enter amount to see calories'; return; }
        var cal2 = round2(amt * supp.calsPerUnit);
        preview.innerHTML = amt + ' ' + esc(supp.unitLabel) + ' × ' + supp.calsPerUnit + ' cal/' + esc(supp.unitLabel) + ' = <strong>' + cal2 + ' cal</strong>';
      }
    };
  }

  function bindCalorieGoalField() {
    var el = document.getElementById('calorie-goal-input');
    if (!el) return;
    el.oninput = function () { state.calorieGoalDraft = this.value; };
  }

  function bindWeightDraftFields() {
    var dateEl = document.getElementById('new-weight-date');
    var valEl = document.getElementById('new-weight-value');
    if (dateEl) dateEl.oninput = function () { state.newWeightDraft.date = this.value; };
    if (valEl) valEl.oninput = function () { state.newWeightDraft.weight = this.value; };
    if (state.editingWeightId && state.editWeightDraft) {
      var edDate = document.getElementById('edit-weight-date-' + state.editingWeightId);
      var edVal = document.getElementById('edit-weight-value-' + state.editingWeightId);
      if (edDate) edDate.oninput = function () { state.editWeightDraft.date = this.value; };
      if (edVal) edVal.oninput = function () { state.editWeightDraft.weight = this.value; };
    }
  }

  function bindNewSuppDraftFields() {
    var ids = { name: 'new-supp-name', unitLabel: 'new-supp-unit', cals: 'new-supp-cals' };
    Object.keys(ids).forEach(function (key) {
      var el = document.getElementById(ids[key]);
      if (!el) return;
      el.oninput = function () { state.newSuppDraft[key] = this.value; };
    });
  }

  function bindEditSuppDraftFields() {
    if (!state.editingSupplementId || !state.editSuppDraft) return;
    var id = state.editingSupplementId;
    var ids = { name: 'edit-supp-name-' + id, unitLabel: 'edit-supp-unit-' + id, cals: 'edit-supp-cals-' + id };
    Object.keys(ids).forEach(function (key) {
      var el = document.getElementById(ids[key]);
      if (!el) return;
      el.oninput = function () { state.editSuppDraft[key] = this.value; };
    });
  }

  // exposed so sync.js can ask for a re-render after pulling/merging remote data
  window.CharlieApp = {
    refresh: function () {
      state.entry = getEntry(state.dateKey);
      state.foods = getFoods();
      state.supplements = getSupplements();
      state.profile = getProfile();
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
