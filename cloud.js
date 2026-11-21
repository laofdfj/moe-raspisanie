(() => {
  const settings = document.getElementById('settings');
  if (settings && !document.getElementById('cloudStatus')) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.cssText = 'padding:18px;max-width:520px;margin-top:14px';
    panel.innerHTML = '<h3 style="margin:0 0 6px">Синхронизация между устройствами</h3>' +
      '<p class="hint">Войдите в один аккаунт на телефоне и компьютере. При первом подключении выберите, какую копию использовать.</p>' +
      '<div class="formgrid"><div class="field"><label for="cloudEmail">Электронная почта</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
      '<div class="field"><label for="cloudPassword">Пароль</label><input id="cloudPassword" type="password" autocomplete="current-password" placeholder="Не менее 8 символов"></div></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button id="cloudSignIn">Войти</button><button id="cloudSignUp" class="secondary">Создать аккаунт</button><button id="cloudSignOut" class="secondary" hidden>Выйти</button></div>' +
      '<p id="cloudStatus" class="hint" role="status" aria-live="polite" style="margin:12px 0 8px">Подготавливаю синхронизацию…</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button id="cloudPull" class="secondary" hidden>Загрузить копию из облака</button><button id="cloudPush" hidden>Сохранить текущие данные в облако</button></div>';
    const firstPanel = settings.querySelector('.panel');
    if (firstPanel) firstPanel.insertAdjacentElement('afterend', panel);
    else settings.prepend(panel);
  }
  if (typeof window.persist === 'function' && !window.persist.__cloudWrapped) {
    const originalPersist = window.persist;
    const wrappedPersist = function () {
      originalPersist();
      if (window.cloudPersist && typeof state !== 'undefined') window.cloudPersist(state);
    };
    wrappedPersist.__cloudWrapped = true;
    window.persist = wrappedPersist;
  }
})();
(() => {
  const $ = id => document.getElementById(id);
  const status = $('cloudStatus');
  const pullButton = $('cloudPull');
  const pushButton = $('cloudPush');
  const signOutButton = $('cloudSignOut');
  const signInButton = $('cloudSignIn');
  const signUpButton = $('cloudSignUp');
  const emailInput = $('cloudEmail');
  const passwordInput = $('cloudPassword');
  const say = message => { if (status) status.textContent = message; };
  const config = window.SCHEDULE_CLOUD_CONFIG;

  if (!config || !config.url || !config.anonKey || config.url.includes('YOUR_PROJECT')) {
    say('Синхронизация подготовлена, но ещё не подключена к облачной базе. Нужны настройки проекта Supabase.');
    [signInButton, signUpButton, pullButton, pushButton, signOutButton].forEach(b => { if (b) b.disabled = true; });
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    say('Не удалось загрузить модуль облачной синхронизации. Проверьте интернет и обновите страницу.');
    return;
  }

  const db = window.supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  let user = null;
  let syncEnabled = false;
  let applyingCloud = false;
  let saveTimer = null;
  let channel = null;
  let lastSavedJson = '';

  const setAuthUI = signedIn => {
    emailInput.disabled = signedIn;
    passwordInput.disabled = signedIn;
    signInButton.hidden = signedIn;
    signUpButton.hidden = signedIn;
    signOutButton.hidden = !signedIn;
    pullButton.hidden = !signedIn;
    pushButton.hidden = !signedIn;
  };

  async function getCloudRow() {
    const { data, error } = await db.from('user_schedules').select('data, updated_at')
      .eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }

  function applyCloudData(data, updatedAt) {
    if (!data || !Array.isArray(data.groups) || !Array.isArray(data.events) || !data.comments || typeof data.comments !== 'object') {
      throw new Error('Облачная запись имеет неверный формат. Локальные данные не изменены.');
    }
    applyingCloud = true;
    try {
      state = { rate: Number(data.rate ?? 700), campRate: data.campRate ?? '',
        groups: data.groups, events: data.events, comments: data.comments };
      localStorage.setItem('scheduleAppV1', JSON.stringify(state));
      $('rate').value = state.rate;
      $('campRate').value = state.campRate;
      render();
      renderGroups();
      lastSavedJson = JSON.stringify(state);
      syncEnabled = true;
      say('Загружено из облака · ' + new Date(updatedAt || Date.now()).toLocaleString('ru-RU'));
    } finally { applyingCloud = false; }
  }

  async function uploadLocalState() {
    const snapshot = JSON.parse(JSON.stringify(state));
    const { error } = await db.from('user_schedules').upsert({
      user_id: user.id, data: snapshot, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
    lastSavedJson = JSON.stringify(snapshot);
    syncEnabled = true;
    say('Текущие данные сохранены в облако. Синхронизация включена.');
  }

  async function inspectCloud() {
    if (!user) return;
    syncEnabled = false;
    pullButton.disabled = true;
    pushButton.disabled = true;
    say('Проверяю облачную копию…');
    try {
      const row = await getCloudRow();
      if (row) {
        say('В облаке уже есть расписание (обновлено ' + new Date(row.updated_at).toLocaleString('ru-RU') + '). Выберите, какую копию оставить.');
        pullButton.textContent = 'Загрузить копию из облака';
        pushButton.textContent = 'Заменить облачную копию текущими данными';
        pullButton.disabled = false;
      } else {
        say('Облачная копия пока пустая. Если это первое устройство, отправьте в облако текущее расписание.');
        pullButton.disabled = true;
        pushButton.textContent = 'Загрузить текущее расписание в облако';
      }
    } catch (error) {
      say('Ошибка доступа к облаку: ' + (error.message || error));
    } finally { pushButton.disabled = false; }
  }

  function subscribe() {
    if (channel) db.removeChannel(channel);
    channel = db.channel('schedule-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_schedules',
        filter: 'user_id=eq.' + user.id }, payload => {
        const row = payload.new;
        if (!row || !row.data || !syncEnabled) return;
        const incomingJson = JSON.stringify(row.data);
        if (incomingJson === lastSavedJson) return;
        const localJson = JSON.stringify(state);
        const localDirty = (!!lastSavedJson && localJson !== lastSavedJson) || !!saveTimer;
        if (localDirty) {
          say('На другом устройстве изменили расписание, но здесь есть свои изменения. Локальная копия не перезаписана. После сохранения локальных изменений можно вручную загрузить облачную копию.');
          return;
        }
        applyCloudData(row.data, row.updated_at);
      }).subscribe();
  }

  window.cloudPersist = nextState => {
    if (!user || !syncEnabled || applyingCloud) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const snapshot = JSON.parse(JSON.stringify(nextState));
      if (JSON.stringify(snapshot) === lastSavedJson) return;
      say('Сохраняю изменения в облако…');
      try { await uploadLocalState(); }
      catch (error) { say('Не удалось сохранить в облако: ' + (error.message || error) + '. Локальные данные сохранены; проверьте соединение.'); }
    }, 700);
  };

  pullButton.onclick = async () => {
    if (!user) return;
    if (!confirm('Заменить расписание на этом устройстве копией из облака? Сначала скачайте резервную копию, если хотите сохранить локальные изменения.')) return;
    pullButton.disabled = true;
    try {
      const row = await getCloudRow();
      if (!row) throw new Error('В облаке пока нет резервной копии.');
      applyCloudData(row.data, row.updated_at);
      say('Синхронизация включена. Изменения будут передаваться автоматически.');
    } catch (error) { say('Не удалось загрузить копию: ' + (error.message || error)); }
    finally { pullButton.disabled = false; }
  };

  pushButton.onclick = async () => {
    if (!user) return;
    if (!confirm('Сохранить текущее расписание этого устройства в облако? Если там уже есть данные, они будут заменены. Перед продолжением скачайте резервную копию.')) return;
    pushButton.disabled = true;
    try { await uploadLocalState(); subscribe(); }
    catch (error) { say('Не удалось отправить данные: ' + (error.message || error)); }
    finally { pushButton.disabled = false; }
  };

  signInButton.onclick = async () => {
    const email = emailInput.value.trim(), password = passwordInput.value;
    if (!email || !password) return say('Введите электронную почту и пароль.');
    signInButton.disabled = true;
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      user = data.user;
      setAuthUI(true);
      await inspectCloud();
      subscribe();
    } catch (error) { say('Не удалось войти: ' + (error.message || error)); }
    finally { signInButton.disabled = false; }
  };

  signUpButton.onclick = async () => {
    const email = emailInput.value.trim(), password = passwordInput.value;
    if (!email || !password) return say('Введите электронную почту и пароль.');
    if (password.length < 8) return say('Пароль должен содержать не менее 8 символов.');
    signUpButton.disabled = true;
    try {
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session) {
        user = data.user; setAuthUI(true); await inspectCloud(); subscribe();
      } else say('Аккаунт создан. Подтвердите почту по письму от Supabase, затем вернитесь и войдите.');
    } catch (error) { say('Не удалось создать аккаунт: ' + (error.message || error)); }
    finally { signUpButton.disabled = false; }
  };

  signOutButton.onclick = async () => {
    const { error } = await db.auth.signOut();
    if (error) return say('Не удалось выйти: ' + error.message);
    user = null; syncEnabled = false;
    if (channel) { db.removeChannel(channel); channel = null; }
    setAuthUI(false);
    say('Вы вышли. Локальное расписание на этом устройстве сохранено.');
  };

  db.auth.onAuthStateChange((_event, session) => {
    if (session && !user) {
      user = session.user; setAuthUI(true);
      setTimeout(async () => { await inspectCloud(); subscribe(); }, 0);
    } else if (!session && user) {
      user = null; syncEnabled = false; setAuthUI(false);
      say('Вы вышли. Локальное расписание на этом устройстве сохранено.');
    }
  });

  setAuthUI(false);
  db.auth.getSession().then(({ data }) => {
    if (data.session) {
      user = data.session.user; setAuthUI(true);
      inspectCloud().then(subscribe);
    } else say('Введите почту и пароль или создайте аккаунт. Данные пока хранятся только на этом устройстве.');
  }).catch(error => say('Не удалось проверить вход: ' + error.message));
})();
