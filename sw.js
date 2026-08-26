const CACHE='finance-control-v5.1';
const ASSETS=['./','./index.html','./styles-v5-1.css','./ai-import-v5.css','./app-v5-1.js','./ai-import-v5.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./prepared-import-template.json'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
    if(response&&response.status===200&&response.type==='basic'){
      const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));
    }
    return response;
  }).catch(()=>caches.match(event.request).then(hit=>hit||(event.request.mode==='navigate'?caches.match('./index.html'):undefined))));
});
