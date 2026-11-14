/* The Armory service worker - ENCRYPTED PWA build. Same-origin only; no importScripts / eval / external URLs; it only ever fetches the
   request it was asked for on this origin. The app exists here only as app.bin (AES-256-GCM). The unlock screen derives a
   non-extractable key from the passphrase and hands it over; the worker checks it against app.bin's GCM tag, keeps it in memory only
   (or reads the one the player chose to remember in IndexedDB "armory-vault"), and answers page loads with the decrypted app built
   in memory. Decrypted bytes are never written to Cache Storage or anywhere else. Versioned caches armory-<VERSION>; what is served
   only changes when the player taps "Update available" (armory-meta keeps the served version). Saves (localStorage) are never touched. */
'use strict';
const VERSION='112.1';
const CACHE='armory-'+VERSION, META='armory-meta', CUR='./__armory_serving__';
const FILES=[["./index.html","p4cfC66yk322TtRGzOnVXErXyTekiU1S/QdgkgDpF4M="],["./app.bin","DKQ0LzAHv5jVcVstwkzxP7nHoFg9IKDtPb5EfouHj9k="],["./manifest.webmanifest","Or8Ud3VicwW6ZJAsB+4yYoPyFsoUZPdu0cSVzTyBtLQ="],["./icons/icon-192.png","tdQgrEuUW/Z0a60Nh2GH4oTzFHWmYUJey24rE8cPMwg="],["./icons/icon-512.png","WoMRdSL/iaKGAr6014WciBJYa712KmsgOHtEQi1iNW0="],["./icons/icon-maskable-512.png","e7qxAQFipcG1f7HY1yWgDo0vcMbVB+CmvR5jKSMd4fE="],["./icons/apple-touch-icon.png","pLMWGSQynwNUpmUe8JPXATntRm4TqoQ6CY/IbMtCTLE="]];   // [path, sha256 base64] of this deploy (integrity-checked on download); app.bin is ciphertext
const VOK=/^[0-9A-Za-z._-]{1,32}$/, MAGIC='ARMENC01', VDB='armory-vault', VST='keys';
const HDRS={'content-type':'text/html; charset=utf-8','content-security-policy':"frame-ancestors 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store'};
let serving=null, memKey=null, memAt=0, plain=null;
const GRACE_MS=10000;   // an unlock (not remembered) only lasts while an app window stays open (reloads/updates keep it)
function readServing(){
  if(serving)return Promise.resolve(serving);
  return caches.open(META).then(c=>c.match(CUR)).then(r=>r?r.text():null).then(v=>{serving=v&&VOK.test(v)?v:null;return serving}).catch(()=>null);
}
function writeServing(v){serving=v;plain=null;return caches.open(META).then(c=>c.put(CUR,new Response(v,{headers:{'content-type':'text/plain'}})))}
function storedKey(){
  return (indexedDB.databases?indexedDB.databases():Promise.resolve([{name:VDB}])).then(l=>l.some(d=>d.name===VDB)?new Promise(res=>{
    const q=indexedDB.open(VDB,1);q.onupgradeneeded=()=>q.result.createObjectStore(VST);q.onerror=()=>res(null);
    q.onsuccess=()=>{const db=q.result;try{const g=db.transaction(VST,'readonly').objectStore(VST).get('k');g.onsuccess=()=>{db.close();res(g.result||null)};g.onerror=()=>{db.close();res(null)}}catch(_){db.close();res(null)}};
  }):null).catch(()=>null);
}
function okKey(k){return k&&typeof CryptoKey!=='undefined'&&k instanceof CryptoKey&&k.algorithm&&k.algorithm.name==='AES-GCM'&&k.usages.includes('decrypt')&&!k.extractable}
function decryptApp(v,key){
  if(plain&&plain.v===v&&plain.key===key)return Promise.resolve(plain.buf);
  return caches.open('armory-'+v).then(c=>c.match('./app.bin')).then(r=>{if(!r)throw new Error('no app.bin');return r.arrayBuffer()}).then(buf=>{
    const u=new Uint8Array(buf),m=String.fromCharCode(...u.subarray(0,8));
    if(m!==MAGIC)throw new Error('bad magic');
    const vl=u[8],hl=9+vl+12,ver=String.fromCharCode(...u.subarray(9,9+vl));
    if(ver!==v)throw new Error('version mismatch');
    return crypto.subtle.decrypt({name:'AES-GCM',iv:u.slice(9+vl,hl),additionalData:u.slice(0,hl),tagLength:128},key,u.subarray(hl));
  }).then(out=>{plain={v,key,buf:out};return out});
}
function precache(){
  return caches.open(CACHE).then(c=>Promise.all(FILES.map(([p,h])=>{
    const r=new Request(p,{cache:'reload',credentials:'same-origin',integrity:'sha256-'+h});
    return self.fetch(r).then(res=>{if(!res.ok)throw new Error('precache '+p+' '+res.status);return c.put(p,res)});
  })));
}
self.addEventListener('install',e=>{
  e.waitUntil(precache().then(readServing).then(v=>v&&v!==VERSION?caches.has('armory-'+v).then(ok=>ok?null:writeServing(VERSION)):writeServing(VERSION))
   .then(()=>self.skipWaiting()));   // taking control is safe: what is SERVED only changes on the player's tap
});
self.addEventListener('activate',e=>{
  e.waitUntil(readServing().then(v=>caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('armory-')&&k!==META&&k!==CACHE&&k!=='armory-'+v).map(k=>caches.delete(k)))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('message',e=>{
  const d=e.data,src=e.source,port=e.ports&&e.ports[0];
  if(!d||typeof d!=='object'||!port||!src||typeof src.url!=='string')return;
  let o;try{o=new URL(src.url).origin}catch(_){return}
  if(o!==self.location.origin)return;
  if(d.type==='armory-sw-status'){
    e.waitUntil(readServing().then(v=>port.postMessage({type:'armory-sw-status',serving:v||VERSION,latest:VERSION})));
  }else if(d.type==='armory-sw-ready'){
    const has=()=>readServing().then(v=>caches.open('armory-'+(v||VERSION))).then(c=>Promise.all([c.match('./app.bin'),c.match('./index.html')])).then(([a,b])=>!!(a&&b));
    // caches were cleared under a still-running worker (e.g. Delete all app data, then reopened): fetch this version again
    e.waitUntil(has().then(ok=>ok||precache().then(()=>writeServing(VERSION)).then(has,()=>false)).then(ok=>port.postMessage({type:'armory-sw-ready',ready:ok})));
  }else if(d.type==='armory-sw-unlock'){
    const k=d.key;
    if(!okKey(k)){port.postMessage({type:'armory-sw-failed'});return}
    e.waitUntil(readServing().then(v=>decryptApp(v||VERSION,k)).then(()=>{memKey=k;memAt=Date.now();port.postMessage({type:'armory-sw-unlocked'})},
      ()=>port.postMessage({type:'armory-sw-failed'})));
  }else if(d.type==='armory-sw-forget'){
    memKey=null;plain=null;port.postMessage({type:'armory-sw-forgot'});
  }else if(d.type==='armory-sw-apply'&&d.version===VERSION){
    e.waitUntil(caches.open(CACHE).then(c=>Promise.all([c.match('./index.html'),c.match('./app.bin')])).then(([a,b])=>{
      if(!a||!b)return port.postMessage({type:'armory-sw-failed'});
      return writeServing(VERSION)
        .then(()=>caches.keys()).then(ks=>Promise.all(ks.filter(k=>k.startsWith('armory-')&&k!==META&&k!==CACHE).map(k=>caches.delete(k))))
        .then(()=>port.postMessage({type:'armory-sw-applied',serving:VERSION}));
    }));
  }
});
function page(body){return new Response(body,{status:200,headers:HDRS})}
function liveKey(){
  if(!memKey)return Promise.resolve(null);
  return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    if(!cs.length&&Date.now()-memAt>GRACE_MS){memKey=null;plain=null}   // app was closed: next launch asks again
    else memAt=Date.now();
    return memKey;
  });
}
function navigate(r){
  return readServing().then(v=>{v=v||VERSION;
    return liveKey().then(k=>k||storedKey()).then(k=>okKey(k)?decryptApp(v,k).then(page,()=>null):null).then(app=>app||
      caches.open('armory-'+v).then(c=>c.match('./index.html')).then(m=>m||caches.open(CACHE).then(c=>c.match('./index.html')))
        .then(m=>m?m.arrayBuffer().then(page):self.fetch(r)));
  });
}
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  let u;try{u=new URL(r.url)}catch(_){return}
  if(u.origin!==self.location.origin)return;            // other sites: not ours, never touched
  if(r.mode==='navigate'){e.respondWith(navigate(r));return}
  e.respondWith(readServing().then(v=>caches.open('armory-'+(v||VERSION))).then(c=>c.match(r,{ignoreSearch:true}))
    .then(m=>m||caches.open(CACHE).then(c=>c.match(r,{ignoreSearch:true})))
    .then(m=>m||self.fetch(r)));
});
