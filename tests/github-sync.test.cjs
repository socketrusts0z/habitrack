const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const syncCode = readFileSync('docs/github-sync.js', 'utf8');
function app({ privateRepo = true, fileExists = false, failure, userFailure, repoFailure, persistent = {} } = {}) {
    const ids = ['sync-repository','sync-token','sync-remember','github-sync-btn','github-sync-status','github-sync-link','sync-forget','clear-all-btn','github-sync-settings','sync-test','sync-token-status'];
    const elements = Object.fromEntries(ids.map(id => [id, { value:'', checked:false, hidden:true, dataset:{}, focus(){this.focused=true;}, events:{}, addEventListener(type, fn) { this.events[type] = fn; } }]));
    const storage = new Map(Object.entries({habit_history: JSON.stringify([{name:'睡眠',date:'2026-11-17'}]), ...persistent}));
    const calls = [];
    const context = { document: {getElementById:id=>elements[id]}, localStorage: {
        getItem:k=>storage.get(k)??null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k)
    }, isExtensionStorage:false, navigator:{onLine:true}, Intl, Date, TextEncoder, AbortController, setTimeout, clearTimeout,
    btoa:s=>Buffer.from(s,'binary').toString('base64'), fetch:async(url, options)=> {
        calls.push({url,options});
        let data = {private:privateRepo}, status = repoFailure || 200;
        if (url.endsWith('/user')) {data={login:'testuser'};status=userFailure||200;}
        if (url.includes('/latest.json')) {
            if (options.method === 'PUT') {data={content:{sha:'file'},commit:{sha:'commit'}};status=failure||201;}
            else if(url.includes('?ref=')) {data={sha:'file'};status=200;}
            else {data={sha:'existing'};status=fileExists?200:404;}
        }
        return {ok:status>=200&&status<300,status,json:async()=>data};
    }};
    vm.runInNewContext(syncCode, context);
    elements['sync-repository'].value='owner/data'; elements['sync-token'].value='secret';
    return {elements,storage,calls,context, run:()=>elements['github-sync-btn'].onclick()};
}
(async()=>{
    for (const fileExists of [false,true]) {
        const a=app({fileExists}); await a.run();
        const put=a.calls.find(c=>c.options.method==='PUT'); assert.ok(put);
        const body=JSON.parse(put.options.body); assert.equal(body.sha,fileExists?'existing':undefined);
        const snapshot=JSON.parse(Buffer.from(body.content,'base64').toString('utf8'));
        assert.equal(snapshot.data.habit_history[0].name,'睡眠');
        assert.ok(snapshot.exported_at);assert.ok(snapshot.timezone);
        assert.ok(!JSON.stringify(snapshot).includes('secret'));assert.equal(a.storage.get('habitrack_sync_token'),undefined);
        assert.equal(a.elements['github-sync-link'].hidden,false);assert.equal(a.elements['github-sync-status'].dataset.state,'success');assert.equal(a.elements['github-sync-btn'].textContent,'Sync now');assert.equal(a.calls.length,5);
    }
    const pub=app({privateRepo:false}); await pub.run();assert.equal(pub.calls.length,2);assert.match(pub.elements['github-sync-status'].textContent,/must be private/);
    const offline=app();offline.context.navigator.onLine=false;await offline.run();assert.equal(offline.calls.length,0);
    const invalid=app();invalid.elements['sync-repository'].value='https://evil/owner';await invalid.run();assert.equal(invalid.calls.length,0);assert.equal(invalid.elements['sync-repository'].focused,true);assert.equal(invalid.elements['github-sync-status'].dataset.state,'error');
    const blank=app();blank.elements['sync-token'].value='';await blank.run();assert.equal(blank.calls.length,0);assert.equal(blank.elements['sync-token'].focused,true);
    const memory=app();memory.elements['sync-remember'].checked=true;memory.elements['sync-remember'].events.change();assert.equal(memory.storage.get('habitrack_sync_token'),'secret');
    memory.elements['sync-remember'].checked=false;memory.elements['sync-remember'].events.change();assert.equal(memory.storage.has('habitrack_sync_token'),false);
    memory.elements['sync-remember'].checked=true;memory.elements['sync-remember'].events.change();memory.elements['sync-forget'].onclick();assert.equal(memory.elements['sync-token'].value,'');assert.equal(memory.storage.has('habitrack_sync_token'),false);
    const verified=app();await verified.elements['sync-test'].onclick();assert.match(verified.elements['sync-token-status'].textContent,/Token valid for testuser/);assert.equal(verified.calls.length,2);assert.ok(!verified.calls.some(c=>c.options.method==='PUT'));
    const expired=app({userFailure:401});await expired.elements['sync-test'].onclick();assert.match(expired.elements['sync-token-status'].textContent,/invalid or expired/);assert.equal(expired.calls.length,1);
    const denied=app({repoFailure:404});await denied.elements['sync-test'].onclick();assert.match(denied.elements['sync-token-status'].textContent,/Token valid.*repository access failed/);
    verified.elements['sync-token'].events.input();assert.match(verified.elements['sync-token-status'].textContent,/not verified/);
    const conflict=app({fileExists:true,failure:409});await conflict.run();assert.match(conflict.elements['github-sync-status'].textContent,/Snapshot changed/);assert.equal(conflict.elements['github-sync-link'].hidden,true);assert.equal(conflict.elements['github-sync-btn'].disabled,false);
    const corrupt=app({persistent:{habit_history:'not JSON'}});await corrupt.run();assert.ok(!corrupt.calls.some(c=>c.options.method==='PUT'));assert.match(corrupt.elements['github-sync-status'].textContent,/Cannot read/);
    // Verify the existing regular backup path filters remembered credentials too.
    const main=readFileSync('docs/script.js','utf8');const fn=main.slice(main.indexOf('const exportAllData ='),main.indexOf('const getLocalDateString'));
    const backup=app({persistent:{habitrack_sync_token:'secret',habitrack_sync_repository:'owner/data'}});
    backup.context.localStorage.length=backup.storage.size;
    backup.context.localStorage.key=i=>[...backup.storage.keys()][i];
    const data=await vm.runInNewContext(fn+'\nexportAllData()',backup.context);
    assert.equal(data.habitrack_sync_token,undefined);assert.ok(data.habit_history);
    console.log('PASS: create/update, Unicode, private-only, offline, validation, session/remember/forget, conflict, corrupt data, and backup credential exclusion');
})().catch(error=>{console.error(error);process.exitCode=1;});
