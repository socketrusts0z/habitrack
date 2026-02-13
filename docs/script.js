let selectedFoods = {}, habitToDelete = null, activeHabitName = null, lastMenuAnchorRect = null;
const EMOJI_OPTIONS = ['💧','🏃','🧘','📖','🥗','😴','🏋️','🧠','📝','🧹','🧑‍💻','🦷','🍵','🚶','🎧','🪴','🎯','🛌','🧴','🧊','🚰','🍎','🌞','🧘‍♂️','🧘‍♀️','🧠'];
const DEFAULT_FOODS = [{ id: 101, name: 'Egg', protein_per_serving: 6 }, { id: 102, name: 'Whey Protein', protein_per_serving: 25 }];
const el = (id) => document.getElementById(id);
const setAttrs = (node, attrs) => Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));

// Storage: chrome.storage for extension, localStorage for PWA
const isExtensionStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
const getData = (key) => new Promise((res) => {
    if (isExtensionStorage) return chrome.storage.local.get([key], r => res(r[key] || []));
    try {
        const raw = localStorage.getItem(key);
        res(raw ? JSON.parse(raw) : []);
    } catch (_) {
        res([]);
    }
});

const setData = (key, val) => new Promise((res) => {
    if (isExtensionStorage) return chrome.storage.local.set({ [key]: val }, res);
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
    res();
});

const clearAllData = () => new Promise((res) => {
    if (isExtensionStorage) return chrome.storage.local.clear(res);
    localStorage.clear(); res();
});

const exportAllData = () => new Promise((res) => {
    if (isExtensionStorage) return chrome.storage.local.get(null, res);
    const all = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        try { all[k] = JSON.parse(localStorage.getItem(k) || '[]'); } catch { all[k] = []; }
    }
    res(all);
});
const getLocalDateString = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
const getHabitLists = async () => {
    const [habits, hidden] = await Promise.all([getData('habits_list'), getData('hidden_habits')]);
    const cleanedHidden = hidden.filter(h => habits.includes(h));
    if (cleanedHidden.length !== hidden.length) await setData('hidden_habits', cleanedHidden);
    return { habits, hidden: cleanedHidden };
};
const getHabitIcons = async () => {
    const icons = await getData('habit_icons');
    return icons && !Array.isArray(icons) ? icons : {};
};

document.addEventListener("DOMContentLoaded", async () => {
    // Prevent keyboard zoom jumps on iOS
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    window.addEventListener('resize', () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`));

    if (await getData('theme_preference') === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    if (el('date')) el('date').value = getLocalDateString();
    updateDailyDateDisplay();
    
    const now = new Date();
    const currentWeekStr = `${now.getFullYear()}-W${getWeekNumber(now).toString().padStart(2, '0')}`;
    el('snippet-week-picker').value = currentWeekStr;
    el('screen-week-picker').value = currentWeekStr;

    const perfRange = await getData('performance_range');
    if (!perfRange || Array.isArray(perfRange)) await setData('performance_range', 'weekly');
    const habitCreateOpen = await getData('habit_create_open');
    const dataPanelOpen = await getData('data_management_open');
    if (habitCreateOpen === false) {
        el('habit-create-panel')?.classList.add('habit-create-hidden');
    }
    if (dataPanelOpen === false) {
        el('data-management-panel')?.classList.add('panel-hidden');
    }
    const snippetCollapsed = await getData('snippet_collapsed');
    if (snippetCollapsed === true) {
        el('snippet-body')?.classList.add('collapsed');
    }

    if ((await getData('food_list')).length === 0) await setData('food_list', DEFAULT_FOODS);
    const proteinRange = (await getData('protein_range')) || 'last365';
    const habitRange = (await getData('habit_range')) || 'last365';
    const proteinOrder = (await getData('protein_order')) || 'asc';
    const habitOrder = (await getData('habit_order')) || 'asc';
    let screenTimeRange = await getData('screen_time_range');
    if (!screenTimeRange || Array.isArray(screenTimeRange)) screenTimeRange = '7';
    await setData('protein_range', proteinRange);
    await setData('habit_range', habitRange);
    await setData('protein_order', proteinOrder);
    await setData('habit_order', habitOrder);
    await setData('screen_time_range', screenTimeRange);
    if (el('protein-range')) el('protein-range').value = proteinRange;
    if (el('habit-range')) el('habit-range').value = habitRange;
    if (el('protein-order')) el('protein-order').value = proteinOrder;
    if (el('habit-order')) el('habit-order').value = habitOrder;
    if (el('screen-time-range')) el('screen-time-range').value = screenTimeRange;
    await refreshDashboard();
    setupEventListeners();
    await setupMobileTabs();
    setupGridHaptics();
});

async function refreshDashboard() {
    renderFoods();
    await loadDailySelections(el('date').value);
    await renderGraph();
    await renderHabitTrackers();
    await renderTodayHabitList();
    await updateWeeklyInsights();
    await renderScreenTimeChart();
    await loadSnippet();
}

async function setupMobileTabs() {
    const buttons = Array.from(document.querySelectorAll('.mobile-tab-btn'));
    const panels = Array.from(document.querySelectorAll('.mobile-tab-section'));
    if (!buttons.length || !panels.length) return;

    const allowedTabs = new Set(buttons.map((btn) => btn.dataset.tab));
    let activeTab = await getData('mobile_active_tab');
    if (!activeTab || Array.isArray(activeTab) || !allowedTabs.has(activeTab)) {
        activeTab = buttons[0].dataset.tab;
    }

    const mql = window.matchMedia('(max-width: 980px)');
    const applyTab = (tab, persist = true) => {
        activeTab = tab;
        buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));

        if (!mql.matches) {
            panels.forEach((panel) => panel.classList.remove('mobile-tab-hidden'));
            return;
        }

        panels.forEach((panel) => {
            panel.classList.toggle('mobile-tab-hidden', panel.dataset.tabPanel !== tab);
        });
        if (tab === 'trends') renderScreenTimeChart();
        if (persist) setData('mobile_active_tab', tab);
    };

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => applyTab(btn.dataset.tab, true));
    });

    if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', () => applyTab(activeTab, false));
    } else if (typeof mql.addListener === 'function') {
        mql.addListener(() => applyTab(activeTab, false));
    }

    applyTab(activeTab, false);
}

async function renderTodayHabitList() {
    const listEl = el('today-habits-list');
    const metaEl = el('today-habits-meta');
    const titleEl = el('today-habits-title');
    if (!listEl || !metaEl) return;

    const selectedDate = el('date')?.value || getLocalDateString();
    const today = getLocalDateString();
    const isToday = selectedDate === today;
    const parts = selectedDate.split('-');
    const shortDate = parts.length === 3 ? `${parts[1]}/${parts[2]}` : selectedDate;
    if (titleEl) titleEl.textContent = isToday ? "Today's Habits" : `Habits for ${shortDate}`;
    metaEl.textContent = isToday ? 'Today' : shortDate;
    const [{ habits, hidden }, icons, history] = await Promise.all([
        getHabitLists(),
        getHabitIcons(),
        getData('habit_history')
    ]);
    const hiddenSet = new Set(hidden);
    const visibleHabits = habits.filter((name) => !hiddenSet.has(name));
    const todaySet = new Set(
        history
            .filter((entry) => entry.date === selectedDate && entry.performed)
            .map((entry) => entry.habit_name)
    );

    listEl.innerHTML = '';
    if (!visibleHabits.length) {
        const empty = document.createElement('div');
        empty.className = 'today-habits-empty';
        empty.textContent = 'Create a habit to start tracking today.';
        listEl.appendChild(empty);
        return;
    }

    visibleHabits.forEach((name) => {
        const isDone = todaySet.has(name);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `today-habit-btn${isDone ? ' is-done' : ''}`;
        const emoji = icons[name] ? `<span class="habit-emoji">${icons[name]}</span>` : '';
        btn.innerHTML = `<span class="today-habit-name">${emoji}<span>${name}</span></span><span class="today-habit-state">${isDone ? 'Done' : 'Pending'}</span>`;
        btn.onclick = async () => {
            let h = await getData('habit_history');
            const idx = h.findIndex((entry) => entry.habit_name === name && entry.date === selectedDate);
            const next = isDone ? 0 : 1;
            if (idx > -1) h[idx].performed = next;
            else h.push({ date: selectedDate, habit_name: name, performed: next });
            await setData('habit_history', h);
            await renderHabitTrackers();
            await updateWeeklyInsights();
            showToast(`${name} • ${next ? 'Done' : 'Pending'} (${shortDate})`);
        };
        listEl.appendChild(btn);
    });
}

function setupEventListeners() {
    el('theme-toggle').onclick = async () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        next === 'dark' ? document.documentElement.setAttribute('data-theme', 'dark') : document.documentElement.removeAttribute('data-theme');
        await setData('theme_preference', next);
        renderScreenTimeChart();
    };

    document.addEventListener('click', (e) => {
        if (!el('custom-context-menu').contains(e.target)) el('custom-context-menu').classList.add('hidden');
        if (!el('emoji-picker').contains(e.target)) el('emoji-picker').classList.add('hidden');
    });

    el('date')?.addEventListener('change', () => { updateDailyDateDisplay(); refreshDashboard(); });
    el('daily-date-btn')?.addEventListener('click', () => el('date')?.showPicker?.() || el('date')?.click());
    el('performance-range-toggle').onclick = (e) => {
        e.stopPropagation();
        el('performance-range-menu').classList.toggle('hidden');
    };
    el('habit-create-toggle').onclick = async (e) => {
        e.stopPropagation();
        const panel = el('habit-create-panel');
        const isHidden = panel.classList.toggle('habit-create-hidden');
        await setData('habit_create_open', !isHidden);
    };
    el('data-management-toggle').onclick = async (e) => {
        e.stopPropagation();
        const panel = el('data-management-panel');
        const isHidden = panel.classList.toggle('panel-hidden');
        await setData('data_management_open', !isHidden);
    };
    document.addEventListener('click', () => {
        el('performance-range-menu')?.classList.add('hidden');
    });
    document.querySelectorAll('.summary-menu-item').forEach(b => {
        b.onclick = async (e) => {
            e.stopPropagation();
            await setData('performance_range', b.dataset.range);
            el('performance-range-menu').classList.add('hidden');
            updateWeeklyInsights();
        };
    });
    if (el('screen-time-range')) {
        el('screen-time-range').onchange = async (e) => {
            await setData('screen_time_range', e.target.value);
            renderScreenTimeChart();
        };
    }
    el('protein-range').onchange = async (e) => { await setData('protein_range', e.target.value); renderGraph(); };
    el('habit-range').onchange = async (e) => { await setData('habit_range', e.target.value); renderHabitTrackers(); };
    el('protein-order').onchange = async (e) => { await setData('protein_order', e.target.value); renderGraph(); };
    el('habit-order').onchange = async (e) => { await setData('habit_order', e.target.value); renderHabitTrackers(); };
    el('screen-week-picker').onchange = renderScreenTimeChart;

    el('submit').onclick = async () => {
        const date = el('date').value, total = Object.values(selectedFoods).reduce((s, f) => s + (f.protein_per_serving * f.servings), 0);
        const list = (await getData('protein_intake')).filter(i => i.date !== date);
        list.push({ date, protein_grams: total, foods: { ...selectedFoods } });
        await setData('protein_intake', list);
        showToast('Saved'); renderGraph(); updateWeeklyInsights();
    };

    el('save-screen-time').onclick = async () => {
        const mins = (parseInt(el('screen-hours').value) || 0) * 60 + (parseInt(el('screen-minutes').value) || 0);
        const history = (await getData('screentime_history')).filter(h => h.date !== el('date').value);
        history.push({ date: el('date').value, total_minutes: mins });
        await setData('screentime_history', history);
        showToast('Saved'); renderScreenTimeChart(); updateWeeklyInsights();
    };

    el('snippet-week-picker').onchange = loadSnippet;

    el('save-snippet').onclick = async () => {
        const week = el('snippet-week-picker').value, content = el('snippet-input').value;
        const snips = (await getData('weekly_snippets')).filter(s => s.week !== week);
        snips.push({ week, content });
        await setData('weekly_snippets', snips);
        el('snippet-preview-container').innerHTML = parseMarkdown(content);
        toggleSnippet(true); 
        showToast('Saved');
    };

    el('toggle-snippet-preview').onclick = () => {
        const isCurrentlyEditing = !el('snippet-editor-container').classList.contains('hidden');
        if (isCurrentlyEditing) {
            el('snippet-preview-container').innerHTML = parseMarkdown(el('snippet-input').value);
            toggleSnippet(true);
        } else {
            toggleSnippet(false);
        }
    };
    el('toggle-snippet-collapse').onclick = async () => {
        const body = el('snippet-body');
        const isCollapsed = body.classList.toggle('collapsed');
        await setData('snippet_collapsed', isCollapsed);
    };

    el('food-search').oninput = (e) => {
        const term = e.target.value.toLowerCase();
        let count = 0;
        document.querySelectorAll('.food-box').forEach(b => {
            const m = b.getAttribute('data-name').toLowerCase().includes(term);
            b.style.display = m ? 'block' : 'none';
            if (m) count++;
        });
        el('add-food-form').classList.toggle('hidden', count > 0 || term === "");
    };

    el('save-new-food').onclick = async () => {
        const name = el('food-search').value.trim(), prot = parseInt(el('new-food-protein').value);
        if (name && !isNaN(prot)) {
            const foods = await getData('food_list');
            foods.push({ id: Date.now(), name, protein_per_serving: prot });
            await setData('food_list', foods);
            el('food-search').value = ''; el('new-food-protein').value = '';
            renderFoods(); showToast('Added');
        }
    };

    const createHabit = async (name) => {
        if (!name) return;
        const habits = await getData('habits_list');
        if (!habits.includes(name)) {
            habits.push(name);
            await setData('habits_list', habits);
            renderHabitTrackers(); showToast('Created');
        }
    };

    el('create-habit').onclick = () => { createHabit(el('new-habit-name').value.trim()); el('new-habit-name').value = ''; };
    el('splash-create-btn').onclick = () => createHabit(el('splash-habit-name').value.trim());
    el('splash-import-btn').onclick = () => el('splash-import-file')?.click();
    el('splash-import-file').onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (isExtensionStorage) await chrome.storage.local.set(parsed);
            else Object.entries(parsed).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
            location.reload();
        } catch { alert("Invalid JSON file"); }
    };

    el('set-default-option').onclick = async () => {
        if (habitToDelete) {
            await setData('default_habit', habitToDelete);
            showToast(`Default: ${habitToDelete}`);
            el('custom-context-menu').classList.add('hidden');
        }
    };

    el('set-icon-option').onclick = async (e) => {
        e.stopPropagation();
        if (!habitToDelete) return;
        const menu = el('custom-context-menu');
        const picker = el('emoji-picker');
        const r = lastMenuAnchorRect || menu.getBoundingClientRect();
        picker.style.cssText = `top:${r.bottom + window.scrollY + 6}px;left:${r.left + window.scrollX}px;`;
        renderEmojiPicker(habitToDelete);
        picker.classList.remove('hidden');
        el('custom-context-menu').classList.add('hidden');
    };

    el('hide-option').onclick = async () => {
        if (!habitToDelete) return;
        const hidden = await getData('hidden_habits');
        if (!hidden.includes(habitToDelete)) {
            hidden.push(habitToDelete);
            await setData('hidden_habits', hidden);
            showToast(`Hidden: ${habitToDelete}`);
            renderHabitTrackers(); updateWeeklyInsights();
        }
        el('custom-context-menu').classList.add('hidden');
    };

    el('delete-option').onclick = async () => {
        if (habitToDelete && confirm(`Delete "${habitToDelete}"?`)) {
            const hList = (await getData('habits_list')).filter(h => h !== habitToDelete);
            const hData = (await getData('habit_history')).filter(h => h.habit_name !== habitToDelete);
            const hidden = (await getData('hidden_habits')).filter(h => h !== habitToDelete);
            await setData('habits_list', hList); await setData('habit_history', hData); await setData('hidden_habits', hidden);
            renderHabitTrackers(); updateWeeklyInsights();
        }
    };

    el('import-btn').onclick = async () => {
        try {
            const parsed = JSON.parse(el('import-json').value);
            if (isExtensionStorage) await chrome.storage.local.set(parsed);
            else Object.entries(parsed).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
            location.reload();
        } catch { alert("Invalid JSON"); }
    };
    el('import-file').onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (isExtensionStorage) await chrome.storage.local.set(parsed);
            else Object.entries(parsed).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
            location.reload();
        } catch { alert("Invalid JSON file"); }
    };

    el('export-btn').onclick = async () => {
        const data = await exportAllData();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        a.download = `backup-${getLocalDateString()}.json`; a.click();
    };

    el('clear-all-btn').onclick = async () => confirm("Clear all?") && (await clearAllData(), location.reload());
}

function updateDailyDateDisplay() {
    const input = el('date');
    const label = el('daily-date-display');
    if (!input || !label) return;
    const value = input.value || getLocalDateString();
    const parts = value.split('-');
    label.textContent = parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}


function setupGridHaptics() {
    const getGrid = (t) => t && t.closest && t.closest('.graph-day, .habit-day');
    const clearTap = (el) => el && el.classList.remove('grid-tap');
    document.addEventListener('pointerdown', (e) => {
        const el = getGrid(e.target);
        if (!el) return;
        el.classList.add('grid-tap');
    }, true);
    document.addEventListener('pointerup', (e) => {
        const el = getGrid(e.target);
        if (!el) return;
        setTimeout(() => clearTap(el), 160);
    }, true);
    document.addEventListener('pointerleave', (e) => clearTap(getGrid(e.target)), true);
    document.addEventListener('pointercancel', (e) => clearTap(getGrid(e.target)), true);
}

async function buildMonthlyCardData() {
    const days = 30;
    const last30 = Array.from({length: days}, (_, i) => getLocalDateString(new Date(Date.now() - i * 864e5)));
    const startDate = last30[last30.length - 1];
    const endDate = last30[0];
    const [pD, hD, sD, lists] = await Promise.all([
        getData('protein_intake'),
        getData('habit_history'),
        getData('screentime_history'),
        getHabitLists()
    ]);
    const hiddenSet = new Set(lists.hidden);
    const visibleHabits = lists.habits.filter(h => !hiddenSet.has(h));
    const totalProtein = pD.filter(d => last30.includes(d.date)).reduce((a, b) => a + b.protein_grams, 0);
    const totalScreenMins = sD.filter(d => last30.includes(d.date)).reduce((a, b) => a + b.total_minutes, 0);
    const avgProtein = totalProtein / days;
    const avgScreenHours = totalScreenMins / (days * 60);
    let totalCompletions = 0;
    let activeHabits = 0;
    let bestStreak = 0;
    for (const h of visibleHabits) {
        const done = hD.filter(d => d.habit_name === h && last30.includes(d.date) && d.performed).length;
        totalCompletions += done;
        if (done > 0) activeHabits++;
        const streak = await getStreakData(h, 'pb');
        if (streak > bestStreak) bestStreak = streak;
    }
    const totalPossible = visibleHabits.length * days;
    const completionRate = totalPossible ? (totalCompletions / totalPossible) : 0;
    const daily = last30.slice().reverse().map(date => {
        const done = hD.filter(d => d.date === date && d.performed && visibleHabits.includes(d.habit_name)).length;
        const possible = visibleHabits.length || 0;
        const rate = possible ? (done / possible) : 0;
        const level = rate === 0 ? 0 : rate < 0.34 ? 1 : rate < 0.67 ? 2 : 3;
        return { date, rate, level };
    });
    return {
        startDate,
        endDate,
        avgProtein: Math.round(avgProtein),
        avgScreenHours: Number(avgScreenHours.toFixed(1)),
        totalCompletions,
        completionRate: Math.round(completionRate * 100),
        habitsTracked: visibleHabits.length,
        activeHabits,
        bestStreak,
        daily
    };
}

async function renderMonthlyCardImage(data) {
    const w = 1080, h = 1350;
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#eef2ff');
    bg.addColorStop(0.5, '#fef3c7');
    bg.addColorStop(1, '#ecfccb');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const cardX = 60, cardY = 60, cardW = w - 120, cardH = h - 120;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.15)';
    drawRoundedRect(ctx, cardX + 8, cardY + 10, cardW, cardH, 28);
    ctx.fillStyle = '#ffffff';
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);

    const titleX = 120, titleY = 170;
    const accent = ctx.createLinearGradient(titleX, 0, titleX + 400, 0);
    accent.addColorStop(0, '#2563eb');
    accent.addColorStop(0.5, '#7c3aed');
    accent.addColorStop(1, '#db2777');
    ctx.fillStyle = accent;
    ctx.font = '800 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.fillText('Monthly Summary', titleX, titleY);
    ctx.font = '500 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`${data.startDate} to ${data.endDate}`, titleX, titleY + 40);

    const bar = ctx.createLinearGradient(120, 0, w - 120, 0);
    bar.addColorStop(0, '#22c55e');
    bar.addColorStop(0.5, '#38bdf8');
    bar.addColorStop(1, '#a855f7');
    ctx.fillStyle = bar;
    ctx.fillRect(120, 250, w - 240, 8);

    const rows = [
        ['Avg Protein', `${data.avgProtein}g`],
        ['Avg Screen Time', `${data.avgScreenHours}h`],
        ['Completion Rate', `${data.completionRate}%`],
        ['Total Completions', `${data.totalCompletions}`],
        ['Habits Tracked', `${data.habitsTracked}`],
        ['Active Habits', `${data.activeHabits}`],
        ['Best Streak', `${data.bestStreak} days`]
    ];

    let y = 330;
    rows.forEach(([label, value], i) => {
        const isAlt = i % 2 === 0;
        if (isAlt) {
            ctx.fillStyle = '#f8fafc';
            drawRoundedRect(ctx, 120, y - 42, w - 240, 78, 12);
        }
        ctx.fillStyle = '#0f172a';
        ctx.font = '600 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
        ctx.fillText(label, 150, y);
        ctx.font = '800 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#0ea5e9';
        const textWidth = ctx.measureText(value).width;
        ctx.fillText(value, w - 150 - textWidth, y);
        y += 90;
    });

    const graphTop = 980;
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.fillText('Habit Consistency (Last 30 Days)', 120, graphTop);
    const gridX = 120, gridY = graphTop + 20, cell = 24, gap = 8;
    const levels = ['#e2e8f0', '#a7f3d0', '#34d399', '#16a34a'];
    data.daily.forEach((d, i) => {
        const col = i % 10;
        const row = Math.floor(i / 10);
        const x = gridX + col * (cell + gap);
        const yPos = gridY + row * (cell + gap);
        ctx.fillStyle = levels[d.level];
        drawRoundedRect(ctx, x, yPos, cell, cell, 6);
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    ctx.fillText('Anonymized stats • Habit Dashboard', 120, h - 120);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return canvas.toDataURL('image/png');
    return URL.createObjectURL(blob);
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

function toggleSnippet(toPreview) {
    if (toPreview) {
        el('snippet-editor-container').classList.add('hidden');
        el('snippet-preview-container').classList.remove('hidden');
        el('toggle-snippet-preview').textContent = 'Edit';
    } else {
        el('snippet-editor-container').classList.remove('hidden');
        el('snippet-preview-container').classList.add('hidden');
        el('toggle-snippet-preview').textContent = 'Preview';
    }
}

async function renderScreenTimeChart() {
    const svg = el('screen-time-svg'), 
          rangeRaw = el('screen-time-range')?.value,
          weekVal = el('screen-week-picker')?.value,
          data = await getData('screentime_history');
    let range = parseInt(rangeRaw, 10);
    if (!Number.isFinite(range) || range < 2) range = 7;
    
    if (!svg) return;
    svg.innerHTML = '';

    const w = svg.parentElement.clientWidth, h = 180, pL = 40, pB = 30, pT = 20, pR = 20;
    const cW = w - pL - pR, cH = h - pT - pB;
    const pts = [];

    // Anchor calculation based on week picker
    let endDate = new Date();
    if (weekVal) {
        const [year, week] = weekVal.split('-W');
        // Get the Sunday of that week
        endDate = new Date(year, 0, 1 + (week - 1) * 7);
        const dayOfWeek = endDate.getDay();
        endDate.setDate(endDate.getDate() + (7 - dayOfWeek));
    }

    for (let i = range - 1; i >= 0; i--) {
        const d = new Date(endDate);
        d.setDate(d.getDate() - i);
        const s = getLocalDateString(d), entry = data.find(x => x.date === s);
        pts.push({ date: s, val: entry ? entry.total_minutes / 60 : 0, label: `${d.getMonth() + 1}/${d.getDate()}` });
    }

    const maxV = Math.max(...pts.map(p => p.val), 5);
    const getX = (i) => pL + (i * cW / (range - 1));
    const getY = (v) => (h - pB) - (v * cH / maxV);

    for (let v = 0; v <= maxV; v += (maxV > 10 ? 4 : 2)) {
        const y = getY(v);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        setAttrs(line, { x1: pL, y1: y, x2: w - pR, y2: y, stroke: "var(--border)", "stroke-dasharray": "2,2", opacity: 0.5 });
        svg.appendChild(line);
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        setAttrs(txt, { x: pL - 5, y: y + 3, "text-anchor": "end", "font-size": "10px", fill: "var(--text-muted)" });
        txt.textContent = `${v}h`; svg.appendChild(txt);
    }

    pts.forEach((pt, i) => {
        if (range > 14 && i % Math.ceil(range/7) !== 0 && i !== pts.length - 1) return;
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        setAttrs(txt, { x: getX(i), y: h - 10, "text-anchor": "middle", "font-size": "10px", fill: "var(--text-muted)" });
        txt.textContent = pt.label; svg.appendChild(txt);
    });

    let pathD = `M ${getX(0)} ${getY(pts[0].val)}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const x1 = getX(i), y1 = getY(pts[i].val), x2 = getX(i+1), y2 = getY(pts[i+1].val);
        const cx = (x1 + x2) / 2;
        pathD += ` C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    setAttrs(path, { d: pathD, fill: "none", stroke: "var(--primary)", "stroke-width": "2.5" });
    svg.appendChild(path);

    pts.forEach((pt, i) => {
        const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        setAttrs(circ, { cx: getX(i), cy: getY(pt.val), r: 4, fill: "var(--primary)" });
        circ.style.cursor = "pointer";
        circ.onclick = () => { el('date').value = pt.date; refreshDashboard(); };
        const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
        t.textContent = `${pt.date}: ${pt.val.toFixed(1)}h`; circ.appendChild(t);
        svg.appendChild(circ);
    });
}

async function updateWeeklyInsights() {
    const range = (await getData('performance_range')) || 'weekly';
    const cont = el('habit-success-rates');
    const { label, days, dates } = getPerformanceRange(range);
    el('performance-title').textContent = label;
    const [pD, hD, sD, lists, icons] = await Promise.all([
        getData('protein_intake'),
        getData('habit_history'),
        getData('screentime_history'),
        getHabitLists(),
        getHabitIcons()
    ]);
    const hiddenSet = new Set(lists.hidden);
    const hL = lists.habits.filter(h => !hiddenSet.has(h));
    const avgP = pD.filter(d => dates.includes(d.date)).reduce((a, b) => a + b.protein_grams, 0) / days;
    const avgS = sD.filter(d => dates.includes(d.date)).reduce((a, b) => a + b.total_minutes, 0) / (days * 60);
    updateStatCard(cont, "Avg Protein", `${Math.round(avgP)}g`);
    updateStatCard(cont, "Avg Screen", `${avgS.toFixed(1)}h`);
    for (const h of hL) {
        const done = hD.filter(d => d.habit_name === h && dates.includes(d.date) && d.performed).length;
        const streak = await getStreakData(h, 'streak'), pb = await getStreakData(h, 'pb');
        const emoji = icons[h] ? `${icons[h]} ` : '';
        updateStatCard(cont, h, `${Math.round((done / days) * 100)}%`, streak, pb, `${emoji}${h}`);
    }
}

function getPerformanceRange(range) {
    const today = new Date();
    if (range === 'calendar') {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const dates = [];
        const d = new Date(start);
        while (d <= today) {
            dates.push(getLocalDateString(d));
            d.setDate(d.getDate() + 1);
        }
        return { label: 'Calendar', days: dates.length || 1, dates };
    }
    if (range === 'last30') {
        const dates = Array.from({length: 30}, (_, i) => getLocalDateString(new Date(Date.now() - i * 864e5)));
        return { label: 'Last 30 Days', days: 30, dates };
    }
    const dates = Array.from({length: 7}, (_, i) => getLocalDateString(new Date(Date.now() - i * 864e5)));
    return { label: 'Weekly', days: 7, dates };
}

async function getStreakData(name, type) {
    const data = (await getData('habit_history')).filter(d => d.habit_name === name && d.performed).map(e => e.date).sort();
    if (!data.length) return 0;
    let max = 0, curr = 0, last = null;
    for (const d of data) {
        const c = new Date(d);
        curr = (last && Math.ceil(Math.abs(c - last) / 864e5) === 1) ? curr + 1 : 1;
        max = Math.max(max, curr); last = c;
    }
    if (type === 'pb') return max;
    const today = getLocalDateString(), yest = getLocalDateString(new Date(Date.now() - 864e5));
    return (data.includes(today) || data.includes(yest)) ? curr : 0;
}

function updateStatCard(cont, title, val, streak = 0, pb = 0, displayTitle = null) {
    const id = `stat-${title.replace(/\s+/g, '-').toLowerCase()}`;
    let c = el(id);
    if (!c) { c = document.createElement('div'); c.className = 'stat-card'; c.id = id; cont.appendChild(c); }
    const label = displayTitle || title;
    c.innerHTML = `<span class="stat-label">${label}</span><div class="stat-main"><span class="stat-value">${val}</span>${streak ? `<span class="stat-streak">🔥${streak}</span>` : ''}</div>${pb ? `<div class="stat-pb">Best: ${pb}</div>` : ''}`;
}

async function renderGraph() {
    const data = await getData('protein_intake'), g = el('graph');
    if (!g) return; g.innerHTML = '';
    const rangeKey = (await getData('protein_range')) || 'last365';
    const orderKey = (await getData('protein_order')) || 'asc';
    const { dates } = getDisplayRange(rangeKey);
    const displayDates = orderKey === 'desc' ? dates.slice().reverse() : dates;
    for (let i = 0; i < displayDates.length; i++) {
        const s = displayDates[i];
        const v = data.find(x => x.date === s)?.protein_grams || 0;
        const lvl = v === 0 ? 0 : v < 50 ? 1 : v < 100 ? 2 : v < 150 ? 3 : 4;
        const day = document.createElement('div'); day.className = `graph-day level-${lvl}`; day.title = `${s}: ${v}g`;
        day.onclick = () => {
            const dateInput = el('date');
            if (!dateInput) return;
            dateInput.value = s;
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        };
        g.appendChild(day);
    }
}

async function renderHabitTrackers() {
    const [{ habits, hidden }, icons] = await Promise.all([getHabitLists(), getHabitIcons()]);
    const hiddenSet = new Set(hidden);
    const visibleHabits = habits.filter(h => !hiddenSet.has(h));
    const nav = el('habit-navigation'), cont = el('habit-grid-container'), hiddenWrap = el('hidden-habits');
    el('splash-screen').classList.toggle('hidden', habits.length > 0);
    if (!habits.length) {
        if (nav) nav.innerHTML = '';
        if (cont) cont.innerHTML = '';
        if (hiddenWrap) hiddenWrap.classList.add('hidden');
        renderTodayHabitList();
        return;
    }
    nav.innerHTML = '';
    visibleHabits.forEach(h => {
        const btn = document.createElement('div'); btn.className = 'habit-nav-item'; btn.dataset.habit = h;
        const emoji = icons[h] ? `<span class="habit-emoji">${icons[h]}</span>` : '';
        btn.innerHTML = `<span class="habit-label">${emoji}<span class="habit-name">${h}</span></span><button class="habit-menu-btn" type="button" aria-label="Habit menu">⋮</button>`;
        btn.querySelector('.habit-label').onclick = () => showHabitGrid(h);
        const menuBtn = btn.querySelector('.habit-menu-btn');
        menuBtn.onclick = (e) => {
            e.stopPropagation(); habitToDelete = h;
            const menu = el('custom-context-menu');
            menu.classList.remove('hidden');
            const r = menuBtn.getBoundingClientRect();
            lastMenuAnchorRect = r;
            const m = menu.getBoundingClientRect();
            const left = Math.max(8, r.right + window.scrollX - m.width);
            const top = r.bottom + window.scrollY + 6;
            menu.style.cssText = `top:${top}px;left:${left}px;`;
        };
        nav.appendChild(btn);
        if (!el(`habit-${h}`)) {
            const g = document.createElement('div'); g.id = `habit-${h}`; g.className = 'habit-grid-instance hidden';
            cont.appendChild(g);
        }
        renderHabitGraph(h);
    });
    if (hiddenWrap) {
        hiddenWrap.innerHTML = '';
        if (hidden.length) {
            hiddenWrap.classList.remove('hidden');
            const label = document.createElement('span'); label.textContent = 'Hidden:';
            hiddenWrap.appendChild(label);
            hidden.forEach(h => {
                const pill = document.createElement('span'); pill.className = 'hidden-habit-pill'; pill.textContent = h;
                if (icons[h]) pill.textContent = `${icons[h]} ${h}`;
                pill.title = `Show ${h}`;
                pill.onclick = async () => {
                    const nextHidden = (await getData('hidden_habits')).filter(x => x !== h);
                    await setData('hidden_habits', nextHidden);
                    showToast(`Shown: ${h}`);
                    renderHabitTrackers(); updateWeeklyInsights();
                };
                hiddenWrap.appendChild(pill);
            });
        } else {
            hiddenWrap.classList.add('hidden');
        }
    }
    const def = await getData('default_habit');
    if (!visibleHabits.length) {
        cont.innerHTML = '';
        activeHabitName = null;
        renderTodayHabitList();
        return;
    }
    showHabitGrid(activeHabitName && visibleHabits.includes(activeHabitName) ? activeHabitName : (visibleHabits.includes(def) ? def : visibleHabits[0]));
    renderTodayHabitList();
}

async function renderHabitGraph(name) {
    const hist = await getData('habit_history'), g = el(`habit-${name}`);
    if (!g) return;
    const rangeKey = (await getData('habit_range')) || 'last365';
    const orderKey = (await getData('habit_order')) || 'asc';
    const { dates } = getDisplayRange(rangeKey);
    const displayDates = orderKey === 'desc' ? dates.slice().reverse() : dates;
    g.innerHTML = '';
    for (let i = 0; i < displayDates.length; i++) {
        const s = displayDates[i];
        const done = hist.find(x => x.habit_name === name && x.date === s)?.performed;
        const day = document.createElement('div');
        day.onclick = async () => {
            let h = await getData('habit_history');
            const idx = h.findIndex(x => x.habit_name === name && x.date === s);
            idx > -1 ? h[idx].performed = h[idx].performed ? 0 : 1 : h.push({ date: s, habit_name: name, performed: 1 });
            await setData('habit_history', h); renderHabitGraph(name); updateWeeklyInsights();
            showToast(`${name} • ${s}`);
        };
        day.className = `habit-day ${done ? 'level-3' : 'level-0'}`; day.title = s;
        g.appendChild(day);
    }
}

function getDisplayRange(range) {
    const today = new Date();
    if (range === 'year') {
        const start = new Date(today.getFullYear(), 0, 1);
        const dates = [];
        const d = new Date(start);
        while (d <= today) { dates.push(getLocalDateString(d)); d.setDate(d.getDate() + 1); }
        return { dates };
    }
    if (range === 'month') {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        const dates = [];
        const d = new Date(start);
        while (d <= today) { dates.push(getLocalDateString(d)); d.setDate(d.getDate() + 1); }
        return { dates };
    }
    if (range === 'week') {
        const dates = Array.from({ length: 7 }, (_, i) => getLocalDateString(new Date(Date.now() - i * 864e5))).reverse();
        return { dates };
    }
    const dates = Array.from({ length: 365 }, (_, i) => getLocalDateString(new Date(Date.now() - i * 864e5))).reverse();
    return { dates };
}

async function renderFoods() {
    const foods = await getData('food_list'), gal = el('food-gallery');
    gal.innerHTML = '';
    foods.forEach(f => {
        const b = document.createElement('div'); b.className = 'food-box'; b.setAttribute('data-name', f.name);
        b.innerHTML = `<span class="delete-food-btn">&times;</span><div>${f.name}</div><div style="color:var(--primary)">${f.protein_per_serving}g</div>`;
        b.onclick = async (e) => {
            if (e.target.className === 'delete-food-btn') {
                if (confirm("Delete?")) { const fl = (await getData('food_list')).filter(x => x.id !== f.id); await setData('food_list', fl); renderFoods(); }
            } else { selectedFoods[f.id] = { ...f, servings: (selectedFoods[f.id]?.servings || 0) + 1 }; renderSelectedFoods(); }
        };
        gal.appendChild(b);
    });
}

function renderSelectedFoods() {
    const list = el('selected-foods-list'); list.innerHTML = '';
    let total = 0;
    Object.keys(selectedFoods).forEach(id => {
        const f = selectedFoods[id]; total += f.servings * f.protein_per_serving;
        const li = document.createElement('li');
        li.innerHTML = `<span>${f.name} (x${f.servings})</span><span style="color:red;cursor:pointer;font-weight:bold;font-size:18px">×</span>`;
        li.querySelector('span:last-child').onclick = () => { f.servings > 1 ? f.servings-- : delete selectedFoods[id]; renderSelectedFoods(); };
        list.appendChild(li);
    });
    el('protein-total-amount').textContent = `${total}g`;
    const goal = 150;
    const pct = Math.min((total / goal) * 100, 100);
    const ring = el('protein-ring-progress');
    const percentEl = el('protein-meter-percent');
    if (ring) {
        const r = 56;
        const circ = 2 * Math.PI * r;
        ring.style.strokeDasharray = `${circ}`;
        ring.style.strokeDashoffset = `${circ * (1 - pct / 100)}`;
    }
    if (percentEl) percentEl.textContent = `${Math.round(pct)}%`;
}

async function loadDailySelections(date) {
    const entry = (await getData('protein_intake')).find(x => x.date === date);
    selectedFoods = entry ? entry.foods : {}; renderSelectedFoods();
    const s = (await getData('screentime_history')).find(x => x.date === date);
    el('screen-hours').value = s ? Math.floor(s.total_minutes / 60) : '';
    el('screen-minutes').value = s ? s.total_minutes % 60 : '';
}

function showHabitGrid(name) {
    activeHabitName = name;
    document.querySelectorAll('.habit-grid-instance').forEach(g => g.classList.toggle('hidden', g.id !== `habit-${name}`));
    document.querySelectorAll('.habit-nav-item').forEach(i => i.classList.toggle('active', i.dataset.habit === name));
}


function showToast(m) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = m;
    el('toast-container').appendChild(t); setTimeout(() => t.remove(), 2500);
}

async function loadSnippet() {
    const snips = await getData('weekly_snippets'), entry = snips.find(s => s.week === el('snippet-week-picker').value);
    el('snippet-input').value = entry?.content || '';
    el('snippet-preview-container').innerHTML = parseMarkdown(entry?.content);
    if(entry?.content) toggleSnippet(true);
}

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return Math.ceil((((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 864e5) + 1) / 7);
}

function parseMarkdown(t) {
    if (!t) return '<p style="color:var(--text-muted)">No content.</p>';
    return t.split('\n').map(l => {
        l = l.trim(); if (!l) return '<br>';
        if (l.startsWith('### ')) return `<h3>${l.slice(4)}</h3>`;
        if (l.startsWith('## ')) return `<h2>${l.slice(3)}</h2>`;
        if (l.startsWith('# ')) return `<h1>${l.slice(2)}</h1>`;
        if (l.startsWith('* ') || l.startsWith('- ')) return `<li>${l.slice(2)}</li>`;
        return `<span>${l.replace(/\*\*(.*)\*\*/g, '<b>$1</b>').replace(/\*(.*)\*/g, '<i>$1</i>')}</span><br>`;
    }).join('');
}

async function renderEmojiPicker(habitName) {
    const picker = el('emoji-picker');
    picker.innerHTML = '';
    EMOJI_OPTIONS.forEach(e => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = e;
        b.onclick = async () => {
            const icons = await getHabitIcons();
            icons[habitName] = e;
            await setData('habit_icons', icons);
            picker.classList.add('hidden');
            renderHabitTrackers(); updateWeeklyInsights();
        };
        picker.appendChild(b);
    });
    const customWrap = document.createElement('div');
    customWrap.className = 'emoji-picker-custom';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Custom emoji';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Set';
    const applyCustomEmoji = async () => {
        const val = input.value.trim();
        if (!val) return;
        const emoji = extractSingleEmoji(val);
        if (!emoji) { showToast('Please enter a single emoji'); return; }
        const icons = await getHabitIcons();
        icons[habitName] = emoji;
        await setData('habit_icons', icons);
        picker.classList.add('hidden');
        renderHabitTrackers(); updateWeeklyInsights();
    };
    save.onclick = applyCustomEmoji;
    input.onkeydown = (e) => { if (e.key === 'Enter') applyCustomEmoji(); };
    customWrap.appendChild(input);
    customWrap.appendChild(save);
    picker.appendChild(customWrap);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = '×';
    clear.title = 'Clear icon';
    clear.onclick = async () => {
        const icons = await getHabitIcons();
        delete icons[habitName];
        await setData('habit_icons', icons);
        picker.classList.add('hidden');
        renderHabitTrackers(); updateWeeklyInsights();
    };
    picker.appendChild(clear);
}

function extractSingleEmoji(input) {
    const seg = ('Segmenter' in Intl) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    const graphemes = seg ? Array.from(seg.segment(input), s => s.segment) : Array.from(input);
    if (graphemes.length < 1) return null;
    const candidate = graphemes[0];
    const emojiRegex = /\p{Extended_Pictographic}/u;
    return emojiRegex.test(candidate) ? candidate : null;
}
