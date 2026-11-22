/* Direct, user-initiated sync. Credentials never enter snapshot/backup data. */
(() => {
    'use strict';
    const PREFIX = 'habitrack_sync_';
    const DATA_KEYS = ['habits_list', 'hidden_habits', 'default_habit', 'habit_history',
        'habit_icons', 'food_recipes', 'protein_intake', 'food_list', 'screentime_history', 'weekly_snippets'];
    const MONTHLY_KEYS = ['habit_history', 'protein_intake', 'screentime_history'];
    const INDEX_PATH = 'habitrack/index.json';
    const SETTINGS_PATH = 'habitrack/settings.json';
    const byId = id => document.getElementById(id);
    const repository = byId('sync-repository');
    const tokenInput = byId('sync-token');
    const remember = byId('sync-remember');
    const button = byId('github-sync-btn');
    const status = byId('github-sync-status');
    const link = byId('github-sync-link');
    const testButton = byId('sync-test');
    const tokenStatus = byId('sync-token-status');
    function credentialStatus(message, state = 'idle') {
        tokenStatus.textContent = message;
        tokenStatus.dataset.state = state;
    }
    function resetCredentialStatus() {
        credentialStatus(tokenInput.value.trim() ? 'Token entered, not verified. Click Test connection.' : 'Token not entered.');
    }
    let token = '';
    let busy = false;
    const settings = byId('github-sync-settings');
    function report(message, state = 'idle', notify = false) {
        status.textContent = message;
        status.dataset.state = state;
        if (notify && typeof showToast === 'function') showToast(message);
    }
    function requireField(field, message) {
        settings.open = true;
        report(message, 'error', true);
        field.focus();
    }
    const read = key => { try { return localStorage.getItem(PREFIX + key); } catch { return null; } };
    const remove = key => { try { localStorage.removeItem(PREFIX + key); } catch { /* storage may be blocked */ } };
    const write = (key, value) => localStorage.setItem(PREFIX + key, value);
    const target = () => repository.value.trim();
    function showLast() {
        link.hidden = true;
        status.dataset.state = 'idle';
        try {
            const last = JSON.parse(read('last') || 'null');
            if (last && last.repository === target() && /^[0-9a-f]{40}$/.test(last.commit || '')) {
                link.href = `https://github.com/${last.repository}/blob/${last.commit}/${last.indexSha ? INDEX_PATH : 'latest.json'}`;
                link.hidden = false;
            }
            status.textContent = last && last.repository === target()
                ? `Last synced from this device: ${new Date(last.at).toLocaleString()}. Click Sync now to upload changes.`
                : 'Ready to connect. Enter your private repository and token in Connection settings.';
        } catch { status.textContent = 'Not synced from this device.'; }
    }
    repository.value = read('repository') || '';
    token = read('token') || '';
    tokenInput.value = token;
    remember.checked = Boolean(token);
    showLast();
    button.disabled = false;
    testButton.disabled = false;
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
    tokenInput.addEventListener('input', () => { persistToken(); resetCredentialStatus(); });
    remember.addEventListener('change', persistToken);
    byId('sync-forget').onclick = () => {
        token = ''; tokenInput.value = ''; remember.checked = false; remove('token');
        resetCredentialStatus();
        report('Token forgotten on this device. Revoke it on GitHub too if needed.');
    };
    repository.addEventListener('input', () => { showLast(); resetCredentialStatus(); });
    // Clearing all app data must also erase an in-memory/session credential.
    byId('clear-all-btn').addEventListener('click', () => {
        token = ''; tokenInput.value = ''; remember.checked = false; remove('token');
    });
    function splitData(data) {
        const settings = Object.fromEntries(Object.entries(data).filter(([key]) => !MONTHLY_KEYS.includes(key)));
        const files = new Map([[SETTINGS_PATH, settings]]);
        for (const key of MONTHLY_KEYS) {
            if (data[key] === undefined) continue;
            if (!Array.isArray(data[key])) throw new Error(`Unexpected format for ${key}. Sync stopped.`);
            for (const row of data[key]) {
                if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(row?.date || '')) {
                    throw new Error(`An entry in ${key} has no valid date. Sync stopped.`);
                }
                const path = `habitrack/logs/${row.date.slice(0, 7)}.json`;
                if (!files.has(path)) files.set(path, {});
                const month = files.get(path);
                (month[key] ??= []).push(row);
            }
        }
        return files;
    }
    function serialize(value) {
        // Stable object key order while preserving the order of entries in each array.
        return JSON.stringify(value, (_key, item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
        }, 2) + '\n';
    }
    async function blobSha(content) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(content);
        if (bytes.length > 750000) throw new Error('One sync file exceeds 750 KB. Your local Export backup is still available.');
        // Git identifies a blob by the SHA-1 of its header and UTF-8 bytes.
        const gitBlob = encoder.encode(`blob ${bytes.length}\0${content}`);
        const digest = await crypto.subtle.digest('SHA-1', gitBlob);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function decodeFile(file) {
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content), c => c.charCodeAt(0))));
    }
    async function syncRepository(route, credential, branch, repo, data) {
        const branchPath = branch.split('/').map(encodeURIComponent).join('/');
        const readJson = async (path, optional = false) => {
            const response = await request(route + path, credential);
            if (optional && response.status === 404) return null;
            if (!response.ok) throw apiError(response);
            return response.json();
        };
        const post = async (path, body, method = 'POST') => {
            const response = await request(route + path, credential, {method, body: JSON.stringify(body)});
            if (!response.ok) throw apiError(response);
            return response.json();
        };
        const getFile = (path, ref) => readJson(`/contents/${path}?ref=${encodeURIComponent(ref)}`, true);
        const head = (await readJson(`/git/ref/heads/${branchPath}`)).object.sha;
        const index = await getFile(INDEX_PATH, head);
        const previous = index ? decodeFile(index) : null;
        const validPath = path => path === SETTINGS_PATH || /^habitrack\/logs\/\d{4}-(0[1-9]|1[0-2])\.json$/.test(path);
        if (index && (previous?.schema_version !== 2 || !previous.files
            || !Object.hasOwn(previous.files, SETTINGS_PATH)
            || !Object.entries(previous.files).every(([path, sha]) => validPath(path) && /^[0-9a-f]{40}$/.test(sha)))) {
            throw new Error('GitHub sync index is invalid. Sync stopped to protect existing data.');
        }
        const files = {};
        const changes = [];
        const remoteFiles = previous?.files || {};
        for (const [path, value] of splitData(data)) {
            const content = serialize(value);
            const sha = await blobSha(content);
            files[path] = sha;
            if (remoteFiles[path] !== sha) changes.push({path, mode: '100644', type: 'blob', content});
        }
        for (const path of Object.keys(remoteFiles)) {
            if (!Object.hasOwn(files, path)) changes.push({path, mode: '100644', type: 'blob', sha: null});
        }
        if (!changes.length) return {commit: head, indexSha: index.sha, at: previous.exported_at, changed: 0};
        const last = JSON.parse(read('last') || 'null');
        const sameRepo = last?.repository?.toLowerCase() === repo.toLowerCase();
        const conflict = () => new Error('GitHub has data from another sync. Use the device that last synced, or ask for help reconciling the logs. No files were overwritten.');
        if (index && (!sameRepo || last.indexSha !== index.sha)) throw conflict();
        if (!index) {
            const legacy = await getFile('latest.json', head);
            if (legacy) {
                const legacyBase = sameRepo && /^[a-f0-9]{40}$/.test(last.commit || '')
                    ? await getFile('latest.json', last.commit) : null;
                if (legacyBase?.sha !== legacy.sha && serialize(decodeFile(legacy).data) !== serialize(data)) throw conflict();
            }
        }
        const at = new Date().toISOString();
        const manifest = {schema_version: 2, exported_at: at,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown', files};
        const content = serialize(manifest);
        const indexSha = await blobSha(content);
        const base = await readJson(`/git/commits/${head}`);
        const tree = await post('/git/trees', {base_tree: base.tree.sha, tree: [
            ...changes, {path: INDEX_PATH, mode: '100644', type: 'blob', content}
        ]});
        const commit = await post('/git/commits', {message: 'Sync changed HabiTrack files', tree: tree.sha, parents: [head]});
        report('Publishing changed files…', 'busy');
        await post(`/git/refs/heads/${branchPath}`, {sha: commit.sha, force: false}, 'PATCH');
        report('Verifying synced files…', 'busy');
        if ((await getFile(INDEX_PATH, commit.sha))?.sha !== indexSha) {
            throw new Error('GitHub accepted the commit but the index could not be verified. Check the repository before retrying.');
        }
        return {commit: commit.sha, indexSha, at, changed: changes.length};
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
    async function verifyToken(credential) {
        credentialStatus('Checking token with GitHub…', 'busy');
        const response = await request('/user', credential);
        if (!response.ok) throw apiError(response);
        const user = await response.json();
        if (!user.login) throw new Error('GitHub did not confirm the token identity.');
        return user.login;
    }
    testButton.onclick = async () => {
        if (busy) return;
        persistToken();
        const credential = token;
        const repo = target();
        if (!credential) { credentialStatus('No token entered.', 'error'); requireField(tokenInput, 'Paste your GitHub token first.'); return; }
        busy = true; testButton.disabled = true; button.disabled = true;
        testButton.textContent = 'Testing…';
        try {
            const login = await verifyToken(credential);
            if (credential !== tokenInput.value.trim() || repo !== target()) throw new Error('Connection settings changed. Test again.');
            credentialStatus(`Token valid for ${login}. Checking repository…`, 'busy');
            if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || /\/(\.|\.)$/.test(repo)) {
                credentialStatus(`Token valid for ${login}. Enter owner/repository to check access.`, 'success'); return;
            }
            const response = await request(`/repos/${repo.split('/').map(encodeURIComponent).join('/')}`, credential);
            if (!response.ok) {
                credentialStatus(`Token valid for ${login}, but repository access failed (${response.status}). Check the repository name and this token’s selected repositories.`, 'error'); return;
            }
            const metadata = await response.json();
            if (credential !== tokenInput.value.trim() || repo !== target()) throw new Error('Connection settings changed. Test again.');
            if (metadata.private !== true) throw new Error(`Token valid for ${login}, but ${repo} is public. Choose a private repository.`);
            credentialStatus(`Token valid for ${login} · Private repository accessible. Upload permission is confirmed only when Sync now succeeds.`, 'success');
        } catch (error) {
            credentialStatus(error.name === 'AbortError' || error instanceof TypeError
                ? 'Could not reach GitHub. Token was not verified; check your connection and retry.' : error.message, 'error');
        } finally { busy = false; testButton.disabled = false; button.disabled = false; testButton.textContent = 'Test connection'; }
    };
    button.onclick = async () => {
        if (busy) return;
        const repo = target();
        persistToken();
        const credential = token;
        if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || /\/(\.|\.\.)$/.test(repo)) {
            requireField(repository, 'Enter the private repository name, e.g. socketrusts0z/habitrack-data.'); return;
        }
        if (!credential) {
            requireField(tokenInput, 'Paste your GitHub token in Connection settings.'); return;
        }
        if (navigator.onLine === false) { report('Offline. Your data remains on this device; retry when connected.', 'error', true); return; }
        busy = true; button.disabled = true; testButton.disabled = true; button.textContent = 'Syncing…'; link.hidden = true;
        report('Checking private repository…', 'busy');
        const route = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
        let uploading = false;
        try {
            const login = await verifyToken(credential);
            credentialStatus(`Token valid for ${login}. Checking repository access…`, 'busy');
            const repoResponse = await request(route, credential);
            if (!repoResponse.ok) throw apiError(repoResponse);
            const metadata = await repoResponse.json();
            if (metadata.private !== true) throw new Error('Sync stopped: destination must be private. Choose a separate private data repository.');
            credentialStatus(`Token valid for ${login} · Private repository accessible.`, 'success');
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
            if (!metadata.default_branch) throw new Error('Initialize the private repository with a README before syncing.');
            report('Checking for changed files…', 'busy');
            uploading = true;
            const result = await syncRepository(route, credential, metadata.default_branch, repo, data);
            let saved = true;
            try {
                write('repository', repo);
                write('last', JSON.stringify({repository: repo, at: result.at, commit: result.commit, indexSha: result.indexSha}));
            } catch { saved = false; }
            link.href = `https://github.com/${repo}/blob/${result.commit}/${INDEX_PATH}`;
            link.hidden = false;
            if (result.changed) credentialStatus('Token verified · Upload permission confirmed.', 'success');
            const message = result.changed
                ? `Verified sync · ${result.changed} data file${result.changed === 1 ? '' : 's'} updated.`
                : 'Already up to date. Nothing uploaded.';
            report(message + (saved ? '' : ' Browser could not save local sync status.'), 'success', true);
        } catch (error) {
            credentialStatus(error.name === 'AbortError' || error instanceof TypeError ? 'Connection interrupted. Retry Test connection.' : error.message, 'error');
            report(error.name === 'AbortError' || error instanceof TypeError
                ? (uploading ? 'Upload could not be confirmed. Check habitrack/index.json on GitHub before retrying.' : 'Could not reach GitHub. Check your connection and retry.')
                : error.message, 'error', true);
        } finally { busy = false; button.disabled = false; testButton.disabled = false; button.textContent = 'Sync now'; }

    };
})();
