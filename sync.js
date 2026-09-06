(function () {
  'use strict';

  var sb = null;

  function initClient() {
    if (sb) return sb;
    if (!window.supabase || !window.SUPABASE_CONFIG) return null;
    sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return sb;
  }

  // ---- local storage helpers (mirrors app.js's own storage keys) ----
  function getLocalFoods() {
    try { return JSON.parse(localStorage.getItem('charlie:foods') || '[]'); } catch (e) { return []; }
  }
  function setLocalFoods(list) { localStorage.setItem('charlie:foods', JSON.stringify(list)); }
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
      updated_at: new Date(food.updatedAt || Date.now()).toISOString()
    }).then(function (res) { return !res.error; }).catch(function () { return false; });
  }

  function deleteFoodRemote(id) {
    if (!sb) return Promise.resolve(false);
    return sb.from('foods').delete().eq('id', id).then(function (res) { return !res.error; }).catch(function () { return false; });
  }

  function upsertEntryRemote(dateKey, entry) {
    if (!sb) return Promise.resolve(false);
    return sb.from('entries').upsert({
      date: dateKey,
      food_logs: entry.foodLogs,
      poop_logs: entry.poopLogs,
      updated_at: new Date(entry.updatedAt || Date.now()).toISOString()
    }, { onConflict: 'date,user_id' }).then(function (res) { return !res.error; }).catch(function () { return false; });
  }

  // ---- push with automatic retry-on-reconnect ----
  function pushFood(food) {
    upsertFoodRemote(food).then(function (ok) { markDirty('foods', food.id, !ok); });
  }
  function pushDeleteFood(id) {
    markDirty('foods', id, false);
    deleteFoodRemote(id).then(function (ok) { markDirty('deletedFoods', id, !ok); });
  }
  function pushEntry(dateKey, entry) {
    upsertEntryRemote(dateKey, entry).then(function (ok) { markDirty('entries', dateKey, !ok); });
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
    getDirty('entries').forEach(function (key) {
      var entry = getLocalEntry(key);
      if (entry) upsertEntryRemote(key, entry).then(function (ok) { markDirty('entries', key, !ok); });
    });
  }

  // ---- pull + merge (newest updatedAt wins per record) ----
  function mergeFoods(local, remote) {
    var map = {};
    local.forEach(function (f) { map[f.id] = f; });
    remote.forEach(function (f) {
      var existing = map[f.id];
      if (!existing || (f.updatedAt || 0) > (existing.updatedAt || 0)) map[f.id] = f;
    });
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function mergeEntry(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
  }

  function pullAndMerge() {
    if (!sb) return Promise.resolve();
    return Promise.all([
      sb.from('foods').select('*'),
      sb.from('entries').select('*')
    ]).then(function (results) {
      var foodsRes = results[0];
      var entriesRes = results[1];

      var remoteFoods = (foodsRes.data || []).map(function (r) {
        return { id: r.id, name: r.name, calsPerCup: Number(r.cals_per_cup), updatedAt: new Date(r.updated_at).getTime() };
      });
      var mergedFoods = mergeFoods(getLocalFoods(), remoteFoods);
      setLocalFoods(mergedFoods);

      var remoteEntries = {};
      (entriesRes.data || []).forEach(function (r) {
        remoteEntries[r.date] = {
          foodLogs: r.food_logs || [],
          poopLogs: r.poop_logs || [],
          updatedAt: new Date(r.updated_at).getTime()
        };
      });
      var keys = allLocalEntryKeys();
      Object.keys(remoteEntries).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
      keys.forEach(function (k) {
        var merged = mergeEntry(getLocalEntry(k), remoteEntries[k]);
        if (merged) setLocalEntry(k, merged);
      });

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
    allLocalEntryKeys().forEach(function (k) {
      var e = getLocalEntry(k);
      if (e) {
        if (!e.updatedAt) e.updatedAt = Date.now();
        setLocalEntry(k, e);
        jobs.push(upsertEntryRemote(k, e));
      }
    });
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
    pushEntry: pushEntry,
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
