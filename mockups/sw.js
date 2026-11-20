/* Mockup Hub service worker (box tool: /workspace/mockup_hub/hub.py). Same update system as the Armory's sw.js, scoped to this
   folder only (/the-armory/mockups/). Same-origin only; no script imports, no eval, no external URLs; it only fetches requests on
   this origin inside this folder. Its caches are all named "mockuphub-*" (the Armory's are "armory-*" / "armorydev-*" and are never
   touched). Versioned caches mockuphub-<VERSION> (hub page, manifest, icons; integrity-checked on download). What is SERVED only
   changes when the user taps "Update available" (mockuphub-meta keeps the served version), exactly like the Armory.
   Mockup files m/<id>.<hash>.bin are ciphertext only (never decrypted here); the name carries the content hash, so a cached copy is
   never stale. Each one is kept after its first open so it also opens offline; files the served version no longer lists are dropped. */
'use strict';
const VERSION='3';
const FILES=[["./index.html","D1XRk1SiT0KtO27cczHRx4bgd10NN0wY2iPUWajhX1Y="],["./manifest.webmanifest","1U/100UL1WJdY1cSHUmxFrcVvrMyMxjyFD+niPL/bJI="],["./icons/icon-192.png","WYme61CRQ+ksKB9G2aXCTNHD+StsCR4/Z29l0nrp66U="],["./icons/icon-512.png","xvTfL/zsBsaYeT+Gv+t3f/noMZ9Y/8Sp232B7cM2x0M="],["./icons/icon-maskable-512.png","5ILejvRIYYb1Zuo6hl6y0Tgdyq2aSx63Bw83kya91oM="],["./icons/apple-touch-icon.png","EUzEjKjJlX5jlHOAJvWsxvQQpCodl6a8JcLqmOafm9c="]];   // [path, sha256 base64] of this build's hub shell
const BINLIST=["./m/battle_map.040f6c4525b9397b.bin"];  // mockup files this build's hub page lists (public file names, ciphertext)
const P='mockuphub', CACHE=P+'-'+VERSION, META=P+'-meta', BINS=P+'-bins', CUR='./__mockuphub_serving__';
const VOK=/^[0-9A-Za-z._-]{1,32}$/;
const SCOPE=new URL(self.registration.scope).pathname;            // /the-armory/mockups/
const OWN=new Set(FILES.map(([p])=>new URL(p,self.registration.scope).pathname));
const BINSET=new Set(BINLIST.map(p=>new URL(p,self.registration.scope).pathname));
const BINRX=/^m\/[a-z0-9_-]{1,40}\.[0-9a-f]{16}\.bin$/;
const good=r=>r&&r.ok&&r.status===200&&r.type==='basic'&&!r.redirected;
let serving=null;
function readServing(){
  if(serving)return Promise.resolve(serving);
  return caches.open(META).then(c=>c.match(CUR)).then(r=>r?r.text():null).then(v=>{serving=v&&VOK.test(v)?v:null;return serving}).catch(()=>null);
}
function writeServing(v){serving=v;return caches.open(META).then(c=>c.put(CUR,new Response(v,{headers:{'content-type':'text/plain'}})))}
function pruneBins(){   // only once this build is the one being served
  return readServing().then(v=>v!==VERSION?null:caches.open(BINS).then(c=>c.keys().then(ks=>Promise.all(ks.filter(k=>!BINSET.has(new URL(k.url).pathname)).map(k=>c.delete(k)))))).catch(()=>{});
}
function precache(){
  return caches.open(CACHE).then(c=>Promise.all(FILES.map(([p,h])=>{
    const r=new Request(p,{cache:'reload',credentials:'omit',integrity:'sha256-'+h});
    return self.fetch(r).then(res=>{if(!good(res))throw new Error('precache '+p+' '+res.status);return c.put(p,res)});
  })));
}
self.addEventListener('install',e=>{
  e.waitUntil(precache().then(readServing).then(v=>v&&v!==VERSION?caches.has(P+'-'+v).then(ok=>ok?null:writeServing(VERSION)):writeServing(VERSION))
   .then(()=>self.skipWaiting()));   // taking control is safe: what is SERVED only changes on the user's tap
});
self.addEventListener('activate',e=>{
  e.waitUntil(readServing().then(v=>caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith(P+'-')&&k!==META&&k!==BINS&&k!==CACHE&&k!==P+'-'+v).map(k=>caches.delete(k)))))
    .then(pruneBins).then(()=>self.clients.claim()));
});
self.addEventListener('message',e=>{
  const d=e.data,src=e.source,port=e.ports&&e.ports[0];
  if(!d||typeof d!=='object'||!port||!src||typeof src.url!=='string')return;
  let o;try{o=new URL(src.url).origin}catch(_){return}
  if(o!==self.location.origin)return;
  if(d.type==='mockuphub-sw-status'){
    e.waitUntil(readServing().then(v=>port.postMessage({type:'mockuphub-sw-status',serving:v||VERSION,latest:VERSION})));
  }else if(d.type==='mockuphub-sw-apply'&&d.version===VERSION){
    e.waitUntil(caches.open(CACHE).then(c=>c.match('./index.html')).then(a=>{
      if(!a)return port.postMessage({type:'mockuphub-sw-failed'});
      return writeServing(VERSION)
        .then(()=>caches.keys()).then(ks=>Promise.all(ks.filter(k=>k.startsWith(P+'-')&&k!==META&&k!==BINS&&k!==CACHE).map(k=>caches.delete(k))))
        .then(pruneBins).then(()=>port.postMessage({type:'mockuphub-sw-applied',serving:VERSION}));
    }));
  }
});
function fromServing(path,r){
  return readServing().then(v=>caches.open(P+'-'+(v||VERSION))).then(c=>c.match(path,{ignoreSearch:true}))
    .then(m=>m||caches.open(CACHE).then(c=>c.match(path,{ignoreSearch:true})))
    .then(m=>m||self.fetch(r));
}
function bin(r,path){   // cache-first; content-hashed names never go stale
  return caches.open(BINS).then(c=>c.match(path).then(m=>m||self.fetch(r).then(res=>{
    if(good(res)){const copy=res.clone();c.put(path,copy).catch(()=>{})}
    return res;
  })));
}
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  let u;try{u=new URL(r.url)}catch(_){return}
  if(u.origin!==self.location.origin||!u.pathname.startsWith(SCOPE))return;   // not this folder (Armory root, /dev/): never touched
  const rel=u.pathname.slice(SCOPE.length);
  if(r.mode==='navigate'){if(rel===''||rel==='index.html')e.respondWith(fromServing('./index.html',r));return}
  if(BINRX.test(rel)){e.respondWith(bin(r,u.pathname));return}
  if(OWN.has(u.pathname)){e.respondWith(fromServing('./'+rel,r));return}
  // anything else (sw.js, VERSION.txt): left to the browser
});
