/* Direct, user-initiated sync. Credentials never enter snapshot/backup data. */
(() => {
    'use strict';
    const PREFIX = 'habitrack_sync_';
    const DATA_KEYS = ['habits_list', 'hidden_habits', 'default_habit', 'habit_history',
        'habit_icons', 'protein_intake', 'food_list', 'screentime_history', 'weekly_snippets'];
    const byId = id => document.getElementById(id);
    const repository = byId('sync-repository');
    const tokenInput = byId('sync-token');
    const remember = byId('sync-remember');
    const button = byId('github-sync-btn');
    const status = byId('github-sync-status');
    const link = byId('github-sync-link');
    let token = '';
    let busy = false;
    const read = key => { try { return localStorage.getItem(PREFIX + key); } catch { return null; } };
    const remove = key => { try { localStorage.removeItem(PREFIX + key); } catch { /* storage may be blocked */ } };
    const write = (key, value) => localStorage.setItem(PREFIX + key, value);
    const target = () => repository.value.trim();
    function showLast() {
        link.hidden = true;
        try {
            const last = JSON.parse(read('last') || 'null');
            status.textContent = last && last.repository === target()
                ? `Last synced from this device: ${new Date(last.at).toLocaleString()}. Click Sync now to upload changes.`
                : 'Not synced from this device to this repository.';
        } catch { status.textContent = 'Not synced from this device.'; }
    }
    repository.value = read('repository') || '';
    token = read('token') || '';
    tokenInput.value = token;
    remember.checked = Boolean(token);
    showLast();
    function persistToken() {
        token = tokenInput.value.trim();
        // Always erase the old persistent value when switching to session-only mode.
        remove('token');
        if (remember.checked && token) {
            try { write('token', token); }
            catch {
                remember.checked = false;
                status.textContent = 'Token is available for this session only; browser storage is unavailable.';
            }
        }
    }
    tokenInput.addEventListener('input', persistToken);
    remember.addEventListener('change', persistToken);
    byId('sync-forget').onclick = () => {
        token = ''; tokenInput.value = ''; remember.checked = false; remove('token');
        status.textContent = 'Token forgotten on this device. Revoke it on GitHub too if needed.';
    };
    repository.addEventListener('input', showLast);
    // Clearing all app data must also erase an in-memory/session credential.
    byId('clear-all-btn').addEventListener('click', () => {
        token = ''; tokenInput.value = ''; remember.checked = false; remove('token');
    });
    function encodeContent(value) {
        const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
        if (bytes.length > 750000) throw new Error('Snapshot exceeds the 750 KB sync limit. Use Export for a backup.');
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
    }
    async function request(path, credential, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            return await fetch(`https://api.github.com${path}`, {
                ...options, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
                headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential}`,
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
            });
        } finally { clearTimeout(timer); }
    }
    function apiError(response) {
        if (response.status === 401) return new Error('Token is invalid or expired. Update it in GitHub sync settings.');
        if (response.status === 403 || response.status === 429) return new Error('GitHub denied access or rate-limited this request. Check Contents read/write permission and try later.');
        if (response.status === 404) return new Error('Private repository not accessible. Check owner/name and token repository access.');
        if (response.status === 409 || response.status === 422) return new Error('Snapshot changed on GitHub or the branch is protected. Retry or check repository rules.');
        return new Error(`GitHub request failed (${response.status}). Try again later.`);
    }
    button.onclick = async () => {
        if (busy) return;
        const repo = target();
        persistToken();
        const credential = token;
        if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || /\/(\.|\.\.)$/.test(repo)) {
            status.textContent = 'Enter a private repository as owner/name in GitHub sync settings.';
            byId('github-sync-settings').open = true; return;
        }
        if (!credential) {
            status.textContent = 'Enter your GitHub token in sync settings.';
            byId('github-sync-settings').open = true; return;
        }
        if (navigator.onLine === false) { status.textContent = 'Offline. Your data remains on this device; retry when connected.'; return; }
        busy = true; button.disabled = true; link.hidden = true;
        status.textContent = 'Checking private repository…';
        const route = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
        let uploading = false;
        try {
            const repoResponse = await request(route, credential);
            if (!repoResponse.ok) throw apiError(repoResponse);
            const metadata = await repoResponse.json();
            if (metadata.private !== true) throw new Error('Sync stopped: destination must be private. Choose a separate private data repository.');
            // Read only known data keys: never arbitrary storage, tokens or sync settings.
            const data = {};
            for (const key of DATA_KEYS) {
                if (isExtensionStorage) {
                    const value = await new Promise(resolve => chrome.storage.local.get([key], resolve));
                    if (Object.hasOwn(value, key)) data[key] = value[key];
                } else {
                    const raw = localStorage.getItem(key);
                    if (raw !== null) {
                        try { data[key] = JSON.parse(raw); }
                        catch { throw new Error(`Cannot read ${key}. Fix the stored data before syncing.`); }
                    }
                }
            }
            const at = new Date().toISOString();
            const content = encodeContent({ schema_version: 1, exported_at: at,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
                source: 'HabiTrack PWA', data });
            const fileRoute = `${route}/contents/latest.json`;
            const current = await request(fileRoute, credential);
            let sha;
            if (current.ok) sha = (await current.json()).sha;
            else if (current.status !== 404) throw apiError(current);
            status.textContent = 'Uploading latest.json…'; uploading = true;
            const response = await request(fileRoute, credential, { method: 'PUT', body: JSON.stringify({
                message: 'Sync HabiTrack snapshot', content, ...(sha ? { sha } : {})
            }) });
            if (!response.ok) throw apiError(response);
            const result = await response.json();
            if (!result.content?.sha || !result.commit?.sha) throw new Error('GitHub did not confirm the saved snapshot. Check latest.json before retrying.');
            let saved = true;
            try { write('repository', repo); write('last', JSON.stringify({ repository: repo, at })); }
            catch { saved = false; }
            link.href = `https://github.com/${repo}/blob/${result.commit.sha}/latest.json`;
            link.hidden = false;
            status.textContent = `Synced ${new Date(at).toLocaleString()} to ${repo}/latest.json.${saved ? '' : ' Browser could not save your local sync status.'} Authorize ChatGPT for this repository to use it in a review.`;
        } catch (error) {
            status.textContent = error.name === 'AbortError' || error instanceof TypeError
                ? (uploading ? 'Upload could not be confirmed. Check latest.json on GitHub before retrying.' : 'Could not reach GitHub. Check your connection and retry.')
                : error.message;
        } finally { busy = false; button.disabled = false; }
    };
})();
