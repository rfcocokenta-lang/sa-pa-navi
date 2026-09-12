const $ = s => document.querySelector(s);
const destination = $('#destination'), searchBtn = $('#searchBtn'), locateBtn = $('#locateBtn');
const statusEl = $('#status'), spotsEl = $('#spots'), countEl = $('#count'), summary = $('#summary');
let current = null, watchId = null, route = null, routeLayer = null, currentMarker = null, destMarker = null, saMarkers = [], cached = [];
const TOKYO = [35.681236,139.767125];

const map = L.map('map').setView([35.681236,139.767125], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const status = t => statusEl.textContent = t;
const time = d => d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
const dur = s => { const m=Math.max(0,Math.round(s/60)); return `${Math.floor(m/60)}時間${m%60}分`; };
function hav(a,b){const R=6371000,p=Math.PI/180,d1=(b[0]-a[0])*p,d2=(b[1]-a[1])*p,x=Math.sin(d1/2)**2+Math.cos(a[0]*p)*Math.cos(b[0]*p)*Math.sin(d2/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function cum(cs){const a=[0];for(let i=1;i<cs.length;i++)a.push(a[i-1]+hav([cs[i-1][1],cs[i-1][0]],[cs[i][1],cs[i][0]]));return a;}
function nearestOnRoute(rt,lat,lon){let best={i:0,d:Infinity};rt.geometry.coordinates.forEach((c,i)=>{const d=hav([lat,lon],[c[1],c[0]]);if(d<best.d)best={i,d};});return best;}
function bearing(a,b){const p=Math.PI/180,y1=a[0]*p,y2=b[0]*p,dl=(b[1]-a[1])*p;const y=Math.sin(dl)*Math.cos(y2),x=Math.cos(y1)*Math.sin(y2)-Math.sin(y1)*Math.cos(y2)*Math.cos(dl);return (Math.atan2(y,x)*180/Math.PI+360)%360;}
function angleDiff(a,b){return Math.abs(((a-b+540)%360)-180);}
function routeBearing(rt,i){const cs=rt.geometry.coordinates;const a=cs[Math.max(0,i-1)],b=cs[Math.min(cs.length-1,i+1)];return a&&b?bearing([a[1],a[0]],[b[1],b[0]]):0;}
function destinationDirectionFromTokyo(lat,lon){return bearing(TOKYO,[lat,lon]);}
function directionMatches(label,la,lo,rt,i){
  const hasUp=/上り|東京方面|都心方面|内回り/i.test(label);
  const hasDown=/下り|下り線|地方方面|外回り/i.test(label);
  if(!hasUp&&!hasDown) return true;
  const rb=routeBearing(rt,i);
  const toTokyo=bearing([la,lo],TOKYO);
  // 「上り」は原則東京方向、「下り」は東京から離れる方向という全国共通の概念を使う。
  // 都市高速の内回り/外回りはラベルだけで断定せず、位置と走行方向の一致を補助判定する。
  if(hasUp) return angleDiff(rb,toTokyo)<110;
  if(hasDown) return angleDiff(rb,toTokyo)>=70;
  return true;
}

function gps(){
  if(!navigator.geolocation) return status('このブラウザではGPSを利用できません。');
  status('現在地を取得しています…');
  if(watchId!==null) navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(p=>{
    current={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed||0};
    if(!currentMarker) currentMarker=L.marker([current.lat,current.lon]).addTo(map).bindPopup('現在地'); else currentMarker.setLatLng([current.lat,current.lon]);
    if(!route) map.setView([current.lat,current.lon],15); else update();
  },e=>status(e.code===1?'位置情報の利用を許可してください。':'GPSを取得できませんでした。'),{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
}

async function geocode(q){
  const u='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q='+encodeURIComponent(q);
  const r=await fetch(u); if(!r.ok) throw Error('目的地検索に失敗しました'); const d=await r.json();
  if(!d.length) throw Error('目的地が見つかりませんでした'); return {lat:+d[0].lat,lon:+d[0].lon};
}

async function getRoutes(a,b){
  const u=`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  const r=await fetch(u); if(!r.ok) throw Error('ルートAPIに接続できませんでした'); const d=await r.json();
  if(d.code!=='Ok' || !d.routes?.length) throw Error('ルートが見つかりませんでした'); return d.routes;
}

function motorwayScore(rt){
  let motorway=0, trunk=0, total=0;
  for(const leg of rt.legs||[]) for(const st of leg.steps||[]){
    const km=st.distance||0; total+=km;
    const cls=st.classes||[];
    if(cls.includes('motorway')) motorway+=km;
    else if(cls.includes('trunk')) trunk+=km;
  }
  return {motorway,trunk,total,ratio:total?(motorway+trunk)/total:0};
}
function chooseHighwayRoute(routes){
  return [...routes].sort((a,b)=>{
    const A=motorwayScore(a),B=motorwayScore(b);
    if(Math.abs(B.ratio-A.ratio)>0.05) return B.ratio-A.ratio;
    return a.duration-b.duration;
  })[0];
}

async function getSpots(rt){
  const cs=rt.geometry.coordinates;
  const lat=cs.map(c=>c[1]), lon=cs.map(c=>c[0]);
  // ルートから離れた「道の駅・駐車場・ラウンジ」等を拾わないよう、検索範囲を狭める。
  const s=Math.min(...lat)-.03,n=Math.max(...lat)+.03,w=Math.min(...lon)-.03,e=Math.max(...lon)+.03;
  const q=`[out:json][timeout:30];nwr["highway"~"^(services|rest_area)$"](${s},${w},${n},${e});out center tags;`;
  const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'text/plain'},body:q});
  if(!r.ok) throw Error('SA・PAデータを取得できませんでした');
  const d=await r.json(), cc=cum(cs), total=cc.at(-1), out=[];

  // 明らかなSA/PA以外を除外。OSMでは services/rest_area に道の駅等が混ざるため、
  // 名称だけでなく除外語・SA/PA語を両方チェックする。
  const include=/(サービスエリア|パーキングエリア|\bSA\b|\bPA\b|SA・PA|ＳＡ|ＰＡ)/i;
  const exclude=/(道の駅|コインパーキング|駐車場|VIP|ラウンジ|ロータリー|バス停|ガソリンスタンド|サービスステーション)/i;

  for(const x of d.elements||[]){
    const la=x.lat??x.center?.lat, lo=x.lon??x.center?.lon;
    if(la==null || lo==null) continue;
    const tags=x.tags||{};
    const name=tags.name||tags['name:ja']||'';
    const ja=tags['name:ja']||name;
    if(!name && !ja) continue;
    const label=ja||name;
    if(exclude.test(label)) continue;
    if(!include.test(name) && !include.test(ja)) continue;

    // ルート上への距離を厳しく制限。1.8kmでは一般道の施設まで混ざるため、350m以内だけ採用。
    const z=nearestOnRoute(rt,la,lo);
    if(z.d>120) continue;
    const km=cc[z.i]/1000;
    if(km<1 || km>total/1000-1) continue;
    const rb=routeBearing(rt,z.i);
    if(current && Number.isFinite(current.heading) && current.speed>3){
      if(angleDiff(current.heading,rb)>75) continue;
    }
    if(!directionMatches(label,la,lo,rt,z.i)) continue;

    // 上り/下り・東行き/西行き等の表記は残す。
    let type='PA';
    if(/サービスエリア|\bSA\b|ＳＡ/i.test(label) && !/パーキングエリア|\bPA\b|ＰＡ/i.test(label)) type='SA';
    if(/SA・PA/i.test(label)) type='PA';

    // 同一施設の複数ノードをまとめる。
    if(out.some(v=>hav([v.lat,v.lon],[la,lo])<500)) continue;
    out.push({name:label,type,lat:la,lon:lo,km,roadDist:z.d});
  }

  // ルート上の順番で並べ、現在地より前の施設は render() 側で除外する。
  return out.sort((a,b)=>a.km-b.km).slice(0,40);
}
function draw(){
  if(routeLayer) map.removeLayer(routeLayer);
  routeLayer=L.geoJSON(route.geometry,{style:{weight:5}}).addTo(map);
  map.fitBounds(routeLayer.getBounds(),{padding:[15,15]});
  if(destMarker) map.removeLayer(destMarker);
  destMarker=L.marker([route.dest.lat,route.dest.lon]).addTo(map).bindPopup('目的地');
}

function render(spots){
  saMarkers.forEach(m=>map.removeLayer(m)); saMarkers=[];
  const now=Date.now(), near=nearestOnRoute(route,current.lat,current.lon), cc=cum(route.geometry.coordinates);
  const passed=cc[near.i], total=cc.at(-1), remain=Math.max(0,total-passed);
  const sec=route.duration*(remain/Math.max(1,total));
  $('#totalDistance').textContent=(remain/1000).toFixed(1)+' km';
  $('#eta').textContent=time(new Date(now+sec*1000));
  $('#remainingTime').textContent=dur(sec); summary.classList.remove('hidden');

  const active=spots.map(x=>({...x,remaining:Math.max(0,x.km*1000-passed)})).filter(x=>x.remaining>500);
  spotsEl.innerHTML=active.length?active.map(x=>{
    const es=sec*(x.remaining/Math.max(1,remain));
    return `<article class="spot"><div class="badge">${x.type==='SA'?'S':'P'}</div><div><h3>${x.name}</h3><p>${x.type} ・ 到着予定 ${time(new Date(now+es*1000))}</p></div><div class="distance"><strong>${(x.remaining/1000).toFixed(1)} km</strong><span>あと ${dur(es)}</span></div></article>`;
  }).join(''):`<div class="empty">このルート上で確認できるSA・PAはありません。</div>`;
  countEl.textContent=active.length+'か所';
  active.forEach(x=>saMarkers.push(L.marker([x.lat,x.lon]).addTo(map).bindPopup(`${x.name}（${x.type}）`)));
}

function update(){if(route&&current)render(cached);}

async function search(){
  if(!current){status('先に⌖を押して現在地を取得してください。');gps();return;}
  const q=destination.value.trim(); if(!q)return;
  searchBtn.disabled=true;
  try{
    status('目的地を検索中…'); const to=await geocode(q);
    status('高速道路ルートを検索中…'); const routes=await getRoutes(current,to); route=chooseHighwayRoute(routes); route.dest=to;
    const score=motorwayScore(route);
    draw();
    status(`高速道路を優先したルートを表示中（高速・高規格道路 ${Math.round(score.ratio*100)}%）`);
    cached=await getSpots(route); render(cached);
    status('GPSで現在地を自動更新しています。');
  }catch(e){console.error(e);status(e.message||'検索に失敗しました。');}
  finally{searchBtn.disabled=false;}
}

locateBtn.onclick=gps; searchBtn.onclick=search; destination.onkeydown=e=>{if(e.key==='Enter')search();}; gps();
