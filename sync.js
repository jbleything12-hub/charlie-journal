(function () {
  'use strict';

  var sb = null;

  function initClient() {
    if (sb) return sb;
    if (!window.supabase || !window.SUPABASE_CONFIG) return null;
    sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return sb;
  }

  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  // ---- local storage helpers (mirrors app.js's own storage keys) ----
  function getLocalFoods() {
    try { return JSON.parse(localStorage.getItem('charlie:foods') || '[]'); } catch (e) { return []; }
  }
  function setLocalFoods(list) { localStorage.setItem('charlie:foods', JSON.stringify(list)); }
  function getLocalSupplements() {
    try { return JSON.parse(localStorage.getItem('charlie:supplements') || '[]'); } catch (e) { return []; }
  }
  function setLocalSupplements(list) { localStorage.setItem('charlie:supplements', JSON.stringify(list)); }
  function getLocalEntry(key) {
    try {
      var raw = localStorage.getItem('charlie:entry:' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setLocalEntry(key, val) { localStorage.setItem('charlie:entry:' + key, JSON.stringify(val)); }
  function allLocalEntryKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('charlie:entry:') === 0) out.push(k.replace('charlie:entry:', ''));
    }
    return out;
  }
  function getLocalProfile() {
    try {
      var raw = JSON.parse(localStorage.getItem('charlie:profile') || 'null');
      if (!raw) return { dailyCalorieGoal: null, weightHistory: [], updatedAt: 0 };
      return {
        dailyCalorieGoal: raw.dailyCalorieGoal != null ? raw.dailyCalorieGoal : null,
        weightHistory: Array.isArray(raw.weightHistory) ? raw.weightHistory : [],
        updatedAt: raw.updatedAt || 0
      };
    } catch (e) { return { dailyCalorieGoal: null, weightHistory: [], updatedAt: 0 }; }
  }
  function setLocalProfile(p) { localStorage.setItem('charlie:profile', JSON.stringify(p)); }

  // A logged supplement/treat item from before this update only has `pumps`.
  // Mirrors app.js's migrateMealItem so pulled/merged remote data matches
  // whatever shape a local read would already have produced.
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
  function migratePoopLog(p) {
    if (p.hadBM != null) return p;
    return Object.assign({}, p, { hadBM: true });
  }
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

  // Same conversion app.js does on read: an older flat foodLogs array becomes
  // a meals array (grouped by time), any type:'other' item embedded in a
  // meal (from a brief earlier version) is split out into its own incident,
  // and meal items / bathroom entries are brought up to the current shape.
  function toMealsShape(raw) {
    if (!raw) return { meals: [], incidents: [], poopLogs: [], updatedAt: 0 };
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

  // Converts a raw food_logs array pulled from Supabase into the meals shape,
  // and splits out any embedded type:'other' items into incidents. Handles
  // current data (already { time, items }) and older flat-array rows.
  function normalizeRemoteFoodLogs(foodLogsArr, fallbackUpdatedAt) {
    var arr = foodLogsArr || [];
    var extraIncidents = [];
    if (arr.length === 0) return { meals: [], incidents: extraIncidents };
    if (arr[0] && Array.isArray(arr[0].items)) {
      var meals = arr.map(function (m) {
        var keepItems = [];
        (m.items || []).forEach(function (it) {
          if (it.type === 'other') {
            extraIncidents.push({ id: it.id || uid(), time: m.time, description: it.description, updatedAt: m.updatedAt || fallbackUpdatedAt || Date.now() });
          } else {
            keepItems.push(migrateMealItem(it));
          }
        });
        return Object.assign({}, m, { items: keepItems });
      }).filter(function (m) { return m.items.length > 0; });
      return { meals: meals, incidents: extraIncidents };
    }
    var groups = {};
    var order = [];
    arr.forEach(function (f) {
      var key = f.time || 'unknown';
      if (!groups[key]) {
        groups[key] = { id: uid(), time: f.time || '00:00', updatedAt: fallbackUpdatedAt || Date.now(), items: [] };
        order.push(key);
      }
      groups[key].items.push({
        id: f.id || uid(), type: 'food', foodId: f.foodId, foodName: f.foodName, cups: f.cups, calories: f.calories,
        proteinG: f.proteinG != null ? f.proteinG : null,
        fatG: f.fatG != null ? f.fatG : null,
        fiberG: f.fiberG != null ? f.fiberG : null
      });
    });
    return { meals: order.map(function (k) { return groups[k]; }), incidents: extraIncidents };
  }

  function refreshApp() {
    if (window.CharlieApp && window.CharlieApp.refresh) window.CharlieApp.refresh();
  }

  // ---- dirty queue, for writes that fail while offline ----
  function markDirty(kind, key, isDirty) {
    var storeKey = 'charlie:dirty:' + kind;
    var list = [];
    try { list = JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch (e) {}
    var idx = list.indexOf(key);
    if (isDirty && idx === -1) list.push(key);
    if (!isDirty && idx !== -1) list.splice(idx, 1);
    localStorage.setItem(storeKey, JSON.stringify(list));
  }
  function getDirty(kind) {
    try { return JSON.parse(localStorage.getItem('charlie:dirty:' + kind) || '[]'); } catch (e) { return []; }
  }

  // ---- remote operations ----
  function upsertFoodRemote(food) {
    if (!sb) return Promise.resolve(false);
    return sb.from('foods').upsert({
      id: food.id,
      name: food.name,
      cals_per_cup: food.calsPerCup,
      kcal_per_kg: food.kcalPerKg != null ? food.kcalPerKg : null,
      protein_pct: food.proteinPct != null ? food.proteinPct : null,
      fat_pct: food.fatPct != null ? food.fatPct : null,
      fiber_pct: food.fiberPct != null ? food.fiberPct : null,
      grams_per_cup: food.gramsPerCup != null ? food.gramsPerCup : null,
      updated_at: new Date(food.updatedAt || Date.now()).toISOString()
    }).then(function (res) { return !res.error; }).catch(function () { return false; });
  }
  function deleteFoodRemote(id) {
    if (!sb) return Promise.resolve(false);
    return sb.from('foods').delete().eq('id', id).then(function (res) { return !res.error; }).catch(function () { return false; });
  }

  function upsertSupplementRemote(supp) {
    if (!sb) return Promise.resolve(false);
    return sb.from('supplements').upsert({
      id: supp.id,
      name: supp.name,
      category: supp.category || 'supplement',
      form: supp.form || 'pump',
      unit_label: supp.unitLabel || 'pumps',
      cals_per_unit: supp.calsPerUnit != null ? supp.calsPerUnit : null,
      // kept in sync for older app versions / direct table viewers that still
      // read cals_per_pump; harmless once form isn't 'pump'
      cals_per_pump: supp.form === 'pump' && supp.calsPerUnit != null ? supp.calsPerUnit : null,
      updated_at: new Date(supp.updatedAt || Date.now()).toISOString()
    }).then(function (res) { return !res.error; }).catch(function () { return false; });
  }
  function deleteSupplementRemote(id) {
    if (!sb) return Promise.resolve(false);
    return sb.from('supplements').delete().eq('id', id).then(function (res) { return !res.error; }).catch(function () { return false; });
  }

  function upsertEntryRemote(dateKey, entry) {
    if (!sb) return Promise.resolve(false);
    return sb.from('entries').upsert({
      date: dateKey,
      food_logs: entry.meals,
      incidents: entry.incidents,
      poop_logs: entry.poopLogs,
      updated_at: new Date(entry.updatedAt || Date.now()).toISOString()
    }, { onConflict: 'date,user_id' }).then(function (res) { return !res.error; }).catch(function () { return false; });
  }

  function upsertProfileRemote(profile) {
    if (!sb) return Promise.resolve(false);
    return sb.from('profile').upsert({
      daily_calorie_goal: profile.dailyCalorieGoal != null ? profile.dailyCalorieGoal : null,
      weight_history: profile.weightHistory || [],
      updated_at: new Date(profile.updatedAt || Date.now()).toISOString()
    }, { onConflict: 'user_id' }).then(function (res) { return !res.error; }).catch(function () { return false; });
  }

  // ---- push with automatic retry-on-reconnect ----
  function pushFood(food) {
    upsertFoodRemote(food).then(function (ok) { markDirty('foods', food.id, !ok); });
  }
  function pushDeleteFood(id) {
    markDirty('foods', id, false);
    deleteFoodRemote(id).then(function (ok) { markDirty('deletedFoods', id, !ok); });
  }
  function pushSupplement(supp) {
    upsertSupplementRemote(supp).then(function (ok) { markDirty('supplements', supp.id, !ok); });
  }
  function pushDeleteSupplement(id) {
    markDirty('supplements', id, false);
    deleteSupplementRemote(id).then(function (ok) { markDirty('deletedSupplements', id, !ok); });
  }
  function pushEntry(dateKey, entry) {
    upsertEntryRemote(dateKey, entry).then(function (ok) { markDirty('entries', dateKey, !ok); });
  }
  function pushProfile(profile) {
    upsertProfileRemote(profile).then(function (ok) { markDirty('profile', 'charlie', !ok); });
  }

  function flushDirty() {
    if (!sb) return;
    getDirty('foods').forEach(function (id) {
      var food = getLocalFoods().find(function (f) { return f.id === id; });
      if (food) upsertFoodRemote(food).then(function (ok) { markDirty('foods', id, !ok); });
      else markDirty('foods', id, false);
    });
    getDirty('deletedFoods').forEach(function (id) {
      deleteFoodRemote(id).then(function (ok) { markDirty('deletedFoods', id, !ok); });
    });
    getDirty('supplements').forEach(function (id) {
      var supp = getLocalSupplements().find(function (s) { return s.id === id; });
      if (supp) upsertSupplementRemote(supp).then(function (ok) { markDirty('supplements', id, !ok); });
      else markDirty('supplements', id, false);
    });
    getDirty('deletedSupplements').forEach(function (id) {
      deleteSupplementRemote(id).then(function (ok) { markDirty('deletedSupplements', id, !ok); });
    });
    getDirty('entries').forEach(function (key) {
      var entry = getLocalEntry(key);
      if (entry) upsertEntryRemote(key, entry).then(function (ok) { markDirty('entries', key, !ok); });
    });
    getDirty('profile').forEach(function () {
      var profile = getLocalProfile();
      upsertProfileRemote(profile).then(function (ok) { markDirty('profile', 'charlie', !ok); });
    });
  }

  // ---- pull + merge (newest updatedAt wins per record) ----
  function mergeById(local, remote) {
    var map = {};
    local.forEach(function (r) { map[r.id] = r; });
    remote.forEach(function (r) {
      var existing = map[r.id];
      if (!existing || (r.updatedAt || 0) > (existing.updatedAt || 0)) map[r.id] = r;
    });
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function mergeEntry(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
  }

  // Weight history entries merge by id like foods/supplements (so a weigh-in
  // logged on one device isn't lost when pulling from another). The scalar
  // calorie goal just takes whichever profile record was updated more
  // recently overall.
  function mergeProfile(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    var newerScalarSource = (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
    return {
      dailyCalorieGoal: newerScalarSource.dailyCalorieGoal,
      weightHistory: mergeById(local.weightHistory || [], remote.weightHistory || []),
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
    };
  }

  function pullAndMerge() {
    if (!sb) return Promise.resolve();
    return Promise.all([
      sb.from('foods').select('*'),
      sb.from('supplements').select('*'),
      sb.from('entries').select('*'),
      sb.from('profile').select('*')
    ]).then(function (results) {
      var foodsRes = results[0];
      var suppsRes = results[1];
      var entriesRes = results[2];
      var profileRes = results[3];

      var remoteFoods = (foodsRes.data || []).map(function (r) {
        return {
          id: r.id, name: r.name, calsPerCup: Number(r.cals_per_cup), updatedAt: new Date(r.updated_at).getTime(),
          kcalPerKg: r.kcal_per_kg != null ? Number(r.kcal_per_kg) : null,
          proteinPct: r.protein_pct != null ? Number(r.protein_pct) : null,
          fatPct: r.fat_pct != null ? Number(r.fat_pct) : null,
          fiberPct: r.fiber_pct != null ? Number(r.fiber_pct) : null,
          gramsPerCup: r.grams_per_cup != null ? Number(r.grams_per_cup) : null
        };
      });
      setLocalFoods(mergeById(getLocalFoods(), remoteFoods));

      var remoteSupps = (suppsRes.data || []).map(function (r) {
        return migrateSupplement({
          id: r.id, name: r.name,
          category: r.category || null,
          form: r.form || null,
          unitLabel: r.unit_label || null,
          calsPerUnit: r.cals_per_unit != null ? Number(r.cals_per_unit) : (r.cals_per_pump != null ? Number(r.cals_per_pump) : null),
          calsPerPump: r.cals_per_pump != null ? Number(r.cals_per_pump) : null,
          updatedAt: new Date(r.updated_at).getTime()
        });
      });
      setLocalSupplements(mergeById(getLocalSupplements(), remoteSupps));

      var remoteEntries = {};
      (entriesRes.data || []).forEach(function (r) {
        var updatedAtMs = new Date(r.updated_at).getTime();
        var normalized = normalizeRemoteFoodLogs(r.food_logs, updatedAtMs);
        var incidents = (r.incidents || []).concat(normalized.incidents);
        remoteEntries[r.date] = {
          meals: normalized.meals,
          incidents: incidents,
          poopLogs: (r.poop_logs || []).map(migratePoopLog),
          updatedAt: updatedAtMs
        };
      });
      var keys = allLocalEntryKeys();
      Object.keys(remoteEntries).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
      keys.forEach(function (k) {
        var merged = mergeEntry(toMealsShape(getLocalEntry(k)), remoteEntries[k]);
        if (merged) setLocalEntry(k, merged);
      });

      var profileRow = (profileRes.data || [])[0];
      var remoteProfile = profileRow ? {
        dailyCalorieGoal: profileRow.daily_calorie_goal != null ? Number(profileRow.daily_calorie_goal) : null,
        weightHistory: Array.isArray(profileRow.weight_history) ? profileRow.weight_history : [],
        updatedAt: new Date(profileRow.updated_at).getTime()
      } : null;
      setLocalProfile(mergeProfile(getLocalProfile(), remoteProfile));

      refreshApp();
    });
  }

  function forcePushAll() {
    if (!sb) return Promise.resolve();
    var jobs = [];
    var foods = getLocalFoods();
    foods.forEach(function (f) {
      if (!f.updatedAt) f.updatedAt = Date.now();
      jobs.push(upsertFoodRemote(f));
    });
    setLocalFoods(foods);

    var supps = getLocalSupplements().map(migrateSupplement);
    supps.forEach(function (s) {
      if (!s.updatedAt) s.updatedAt = Date.now();
      jobs.push(upsertSupplementRemote(s));
    });
    setLocalSupplements(supps);

    allLocalEntryKeys().forEach(function (k) {
      var e = toMealsShape(getLocalEntry(k));
      if (e) {
        if (!e.updatedAt) e.updatedAt = Date.now();
        setLocalEntry(k, e);
        jobs.push(upsertEntryRemote(k, e));
      }
    });

    var profile = getLocalProfile();
    if (!profile.updatedAt) profile.updatedAt = Date.now();
    setLocalProfile(profile);
    jobs.push(upsertProfileRemote(profile));

    return Promise.all(jobs);
  }

  function startSync() {
    if (!sb) return;
    var migrated = localStorage.getItem('charlie:migrated');
    var run = migrated === '1'
      ? pullAndMerge()
      : forcePushAll().then(function () {
          localStorage.setItem('charlie:migrated', '1');
          return pullAndMerge();
        });
    run.then(flushDirty).catch(function () {});
  }

  // ---- sign-in overlay (exists in the page from the start, just hidden — this
  // is deliberate: iOS is unreliable about popping the keyboard for inputs that
  // are created and inserted purely via JavaScript, especially in an installed
  // home-screen app) ----
  function showSignIn(onSuccess) {
    var overlay = document.getElementById('signin-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    var submit = document.getElementById('signin-submit');
    var doSubmit = function () {
      var email = document.getElementById('signin-email').value.trim();
      var password = document.getElementById('signin-password').value;
      var errEl = document.getElementById('signin-error');
      errEl.textContent = '';
      if (!email || !password) { errEl.textContent = 'Enter your email and password.'; return; }
      submit.textContent = 'Signing in…';
      sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        submit.textContent = 'Sign in';
        if (res.error) { errEl.textContent = res.error.message; return; }
        overlay.classList.add('hidden');
        onSuccess();
      });
    };
    submit.onclick = doSubmit;
    overlay.onkeydown = function (e) {
      if (e.key === 'Enter') doSubmit();
    };
  }

  window.CharlieSync = {
    pushFood: pushFood,
    deleteFoodRemote: pushDeleteFood,
    pushSupplement: pushSupplement,
    deleteSupplementRemote: pushDeleteSupplement,
    pushEntry: pushEntry,
    pushProfile: pushProfile,
    forcePushAll: forcePushAll,
    signOut: function () {
      if (!sb) return Promise.resolve();
      return sb.auth.signOut();
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var client = initClient();
    if (!client) return; // offline or library failed to load — app keeps working locally
    client.auth.getSession().then(function (res) {
      if (res.data && res.data.session) {
        startSync();
      } else {
        showSignIn(startSync);
      }
    });
    window.addEventListener('online', flushDirty);
  });
})();
