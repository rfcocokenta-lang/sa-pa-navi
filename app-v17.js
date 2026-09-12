const $=s=>document.querySelector(s);
const destination=$('#destination'),searchBtn=$('#searchBtn'),locateBtn=$('#locateBtn');
const statusEl=$('#status'),spotsEl=$('#spots'),countEl=$('#count'),summary=$('#summary');
const routesEl=$('#routes'),routeChoicesEl=$('#routeChoices'),routeCountEl=$('#routeCount');
let current=null,watchId=null,route=null,routeLayer=null,currentMarker=null,destMarker=null,saMarkers=[],cached=[],routeOptions=[];
const TOKYO=[35.681236,139.767125];
console.info('SA・PAナビ build v0.17');
const map=L.map('map').setView(TOKYO,6);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const status=t=>statusEl.textContent=t;const time=d=>d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});const dur=s=>{const m=Math.max(0,Math.round(s/60));return `${Math.floor(m/60)}時間${m%60}分`;};
function hav(a,b){const R=6371000,p=Math.PI/180,d1=(b[0]-a[0])*p,d2=(b[1]-a[1])*p,x=Math.sin(d1/2)**2+Math.cos(a[0]*p)*Math.cos(b[0]*p)*Math.sin(d2/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function cum(cs){const a=[0];for(let i=1;i<cs.length;i++)a.push(a[i-1]+hav([cs[i-1][1],cs[i-1][0]],[cs[i][1],cs[i][0]]));return a;}
function nearestOnRoute(rt,lat,lon){let best={i:0,d:Infinity};rt.geometry.coordinates.forEach((c,i)=>{const d=hav([lat,lon],[c[1],c[0]]);if(d<best.d)best={i,d};});return best;}
function bearing(a,b){const p=Math.PI/180,y1=a[0]*p,y2=b[0]*p,dl=(b[1]-a[1])*p,y=Math.sin(dl)*Math.cos(y2),x=Math.cos(y1)*Math.sin(y2)-Math.sin(y1)*Math.cos(y2)*Math.cos(dl);return(Math.atan2(y,x)*180/Math.PI+360)%360;}
function angleDiff(a,b){return Math.abs(((a-b+540)%360)-180);}function routeBearing(rt,i){const cs=rt.geometry.coordinates,a=cs[Math.max(0,i-2)],b=cs[Math.min(cs.length-1,i+2)];return a&&b?bearing([a[1],a[0]],[b[1],b[0]]):0;}
function bearingToTokyo(rt,i){const c=rt.geometry.coordinates[i];return bearing([c[1],c[0]],TOKYO);}
function directionMatches(label,rt,i){const up=/上り|東京方面|都心方面|内回り/i.test(label),down=/下り|地方方面|外回り/i.test(label);if(!up&&!down)return true;if(!current)return true;const ref=Number.isFinite(current.heading)&&current.speed>3?current.heading:routeBearing(rt,i);if(up)return angleDiff(ref,bearingToTokyo(rt,i))<110;if(down)return angleDiff(ref,bearingToTokyo(rt,i))>=70;return true;}
function gps(){if(!navigator.geolocation)return status('このブラウザではGPSを利用できません。');status('現在地を取得しています…');if(watchId!==null)navigator.geolocation.clearWatch(watchId);watchId=navigator.geolocation.watchPosition(p=>{current={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed||0};if(!currentMarker)currentMarker=L.marker([current.lat,current.lon]).addTo(map).bindPopup('現在地');else currentMarker.setLatLng([current.lat,current.lon]);if(!route)map.setView([current.lat,current.lon],15);else update();},e=>status(e.code===1?'位置情報の利用を許可してください。':'GPSを取得できませんでした。'),{enableHighAccuracy:true,maximumAge:5000,timeout:15000});}

// 目的地検索：複数候補を返し、ユーザーが選択できるようにする。
async function geocodeCandidates(q){
  const raw=q.trim();
  const isPoi=/(駅|インター|IC|空港|港|スタジアム|病院|ホテル|公園|道の駅)$/i.test(raw);
  const fixed={
    '館山駅':{lat:34.99592,lon:139.86189,label:'館山駅（千葉県館山市）',source:'固定座標'},
  };
  if(fixed[raw]) return [fixed[raw]];
  const qn=raw.replace(/[\s　]+/g,'').replace(/駅$/,'');
  const candidates=[];
  const nom='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=12&countrycodes=jp&accept-language=ja&addressdetails=1&q='+encodeURIComponent(raw);
  try{
    const r=await fetch(nom,{headers:{'Accept':'application/json'}});
    if(r.ok){
      const d=await r.json();
      for(const x of d){
        const txt=(x.display_name||'')+' '+(x.type||'')+' '+(x.class||'')+' '+(x.name||'');
        let score=0;
        if(isPoi) score+=30;
        if(/駅/.test(raw)){
          if(/railway|station|halt|train/i.test(txt)||x.type==='station')score+=180;
          if(/駅/.test(x.name||''))score+=90;
        }
        if(/IC|インター/.test(raw)&&/motorway_junction|motorway/i.test(txt))score+=180;
        const normalized=(x.name||'').replace(/[\s　]+/g,'').replace(/駅$/,'');
        if(normalized===qn)score+=160;
        if((x.display_name||'').startsWith(raw))score+=30;
        if(current){const km=hav([current.lat,current.lon],[+x.lat,+x.lon])/1000;score+=Math.max(0,70-Math.min(km,70));}
        if(!/日本|Japan/i.test(x.display_name||''))score-=300;
        const key=`${(+x.lat).toFixed(5)},${(+x.lon).toFixed(5)}`;
        if(!candidates.some(c=>c.key===key))candidates.push({lat:+x.lat,lon:+x.lon,label:x.display_name||raw,score,source:'施設検索',key});
      }
    }
  }catch(e){console.warn('Nominatim failed',e);}
  // 住所検索は国土地理院も候補として追加する。
  try{
    const r=await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q='+encodeURIComponent(raw));
    if(r.ok){
      const d=await r.json();
      for(const x of (d||[]).slice(0,8)){
        const la=+x.geometry.coordinates[1],lo=+x.geometry.coordinates[0];
        const label=x.properties?.title||raw,key=`${la.toFixed(5)},${lo.toFixed(5)}`;
        let score=25;if(!isPoi)score+=25;
        if(current){const km=hav([current.lat,current.lon],[la,lo])/1000;score+=Math.max(0,60-Math.min(km,60));}
        if(!candidates.some(c=>c.key===key))candidates.push({lat:la,lon:lo,label,score,source:'国土地理院',key});
      }
    }
  }catch(e){console.warn('GSI failed',e);}
  candidates.sort((a,b)=>b.score-a.score);
  const out=candidates.slice(0,6).map(({key,score,...c})=>c);
  if(!out.length)throw Error('住所・施設名が見つかりませんでした。');
  return out;
}
async function geocode(q){return (await geocodeCandidates(q))[0];}
async function osrm(a,b,extra=''){const u=`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=true&alternatives=true${extra}`;const r=await fetch(u);if(!r.ok)throw Error('ルートAPIに接続できませんでした');const d=await r.json();if(d.code!=='Ok'||!d.routes?.length)throw Error('ルートが見つかりませんでした');return d.routes;}
async function osrmVia(points,extra=''){const coords=points.map(p=>`${p.lon},${p.lat}`).join(';');const u=`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=false&continue_straight=true${extra}`;const r=await fetch(u);if(!r.ok)return null;const d=await r.json();return d.code==='Ok'&&d.routes?.[0]?d.routes[0]:null;}
function stepRoadLabel(st){
  const name=String(st.name||'').trim();
  const ref=String(st.ref||'').trim();
  if(name&&ref&&name!==ref)return `${name} (${ref})`;
  return name||ref||'名称不明';
}
function stepIsHighway(st){
  const cls=Array.isArray(st.classes)?st.classes:[];
  if(cls.includes('motorway'))return true;
  if(cls.includes('trunk') && /E\d{1,3}|高速|自動車道|首都高|アクアライン|湾岸線|環状線/i.test(`${st.name||''} ${st.ref||''} ${st.destinations||''}`))return true;
  const txt=`${st.name||''} ${st.ref||''} ${st.destinations||''}`;
  // 日本の高速道路・都市高速で実際に使われる名称/路線番号を優先して判定する。
  return /(首都高速|首都高|中央環状線|湾岸線|京葉道路|東関東自動車道|東関東道|館山自動車道|館山道|富津館山道路|富津館山道|東京湾アクアライン|アクアライン|東京湾横断道路|横浜横須賀道路|第三京浜|東京外環自動車道|外環道|常磐自動車道|常磐道|東北自動車道|東北道|関越自動車道|関越道|中央自動車道|中央道|東名高速道路|東名|新東名高速道路|新東名|E14|E51|E1A|E20|E4|E6|E17|E18|E19|E50|E1\b|E2\b)/i.test(txt);
}
function analyzeRoute(rt){
  const segments=[];
  let total=0, highwayDistance=0, hasStepData=false;
  for(const leg of rt.legs||[]){
    for(const st of leg.steps||[]){
      hasStepData=true;
      const distance=Number(st.distance)||0;
      const isHighway=stepIsHighway(st);
      const label=stepRoadLabel(st);
      total+=distance;
      if(isHighway)highwayDistance+=distance;
      const last=segments.at(-1);
      if(last && last.isHighway===isHighway && last.label===label){
        last.distance+=distance; last.toKm=total/1000;
      }else{
        segments.push({label,isHighway,distance,fromKm:(total-distance)/1000,toKm:total/1000});
      }
    }
  }
  if(!hasStepData)return {hasStepData:false,segments:[],highwayDistance:0,highwayRatio:null,highwayStart:null,highwayEnd:null};
  const highwaySegments=segments.filter(x=>x.isHighway&&x.distance>0);
  const first=highwaySegments[0], last=highwaySegments.at(-1);
  return {
    hasStepData:true,segments,total,highwayDistance,
    highwayRatio:total?highwayDistance/total:0,
    highwayStart:first?{label:first.label,km:first.fromKm}:null,
    highwayEnd:last?{label:last.label,km:last.toKm}:null
  };
}
function motorwayScore(rt){
  const a=analyzeRoute(rt);
  if(!a.hasStepData)return{motorway:0,trunk:0,total:rt.distance||0,ratio:null};
  return{motorway:a.highwayDistance,trunk:0,total:a.total,ratio:a.highwayRatio};
}
function roadNames(rt){
  const a=[];
  const add=n=>{if(!n||n==='名称不明')return; n=String(n).trim(); if(!a.includes(n))a.push(n);};
  for(const leg of rt.legs||[]){
    for(const st of leg.steps||[]){
      add(stepRoadLabel(st));
      if(a.length>=10)break;
    }
    if(a.length>=10)break;
  }
  return a.join(' → ');
}
function routeRoadSummary(rt,kind){
  const roads=roadNames(rt);
  if(roads)return roads;
  if(kind==='highway')return '高速道路経由（道路名取得なし）';
  if(kind==='general')return '一般道経由（道路名取得なし）';
  return '道路名取得なし';
}
function segmentSummary(rt){
  const a=analyzeRoute(rt);
  if(!a.hasStepData)return {text:'区間判定情報なし',transition:'',segments:[],analysis:a};
  const compact=[];
  for(const s of a.segments){
    const label=s.label==='名称不明'?(s.isHighway?'高速道路':'一般道'):s.label;
    const last=compact.at(-1);
    if(last && last.isHighway===s.isHighway && last.label===label){last.toKm=s.toKm;}
    else compact.push({label,isHighway:s.isHighway,fromKm:s.fromKm,toKm:s.toKm});
  }
  const text=compact.map(s=>`${s.isHighway?'高速':'一般道'} ${s.fromKm.toFixed(1)}–${s.toKm.toFixed(1)}km`).join(' → ');
  let transition='';
  if(a.highwayStart&&a.highwayEnd){
    transition=`高速道路開始: ${a.highwayStart.label}（約${a.highwayStart.km.toFixed(1)}km） ／ 高速道路終了: ${a.highwayEnd.label}（約${a.highwayEnd.km.toFixed(1)}km）`;
  }else if(a.highwayRatio===0){
    transition='高速道路区間なし（判定できた範囲）';
  }else{
    transition='高速道路の開始・終了地点を特定できませんでした。';
  }
  return {text,transition,segments:compact,analysis:a};
}
function classifyRoute(rt,i,kind='auto',meta={}){
  const a=analyzeRoute(rt);
  const ratio=meta.ratio!=null?meta.ratio:a.highwayRatio;
  let name=kind==='highway'?'高速道路優先':kind==='general'?'一般道中心':(ratio!=null&&ratio>=.65?'高速道路優先':ratio!=null&&ratio>=.35?'高速＋一般道':'一般道中心');
  return{rt,name,tag:i===0?'おすすめ':'別ルート',mins:Math.round(rt.duration/60),km:(rt.distance/1000).toFixed(1),ratio,roads:meta.roads||routeRoadSummary(rt,kind),kind,analysis:a};
}
function decodePolyline6(str){let idx=0,lat=0,lon=0,out=[];while(idx<str.length){let b,shift=0,result=0;do{b=str.charCodeAt(idx++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);lat+=result&1?~(result>>1):result>>1;shift=0;result=0;do{b=str.charCodeAt(idx++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);lon+=result&1?~(result>>1):result>>1;out.push([lon/1e6,lat/1e6]);}return out;}
function valhallaShape(trip){const coords=[];for(const leg of trip.legs||[]){const sh=leg.shape;if(Array.isArray(sh)){for(const p of sh)coords.push(Array.isArray(p)?p:[p.lon,p.lat]);}
 else if(sh&&Array.isArray(sh.coordinates))coords.push(...sh.coordinates);
 else if(typeof sh==='string')coords.push(...decodePolyline6(sh).map(([lon,lat])=>[lon,lat]));}
 const unique=[];for(const c of coords){if(!unique.length||c[0]!==unique.at(-1)[0]||c[1]!==unique.at(-1)[1])unique.push(c);}return unique;}
async function motorwayJunctionsAround(lat,lon,km=45){
  const dLat=km/111, dLon=km/(111*Math.max(0.2,Math.cos(lat*Math.PI/180)));
  const q=`[out:json][timeout:25];node["highway"="motorway_junction"](${lat-dLat},${lon-dLon},${lat+dLat},${lon+dLon});out tags;`;
  const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'text/plain'},body:q});
  if(!r.ok)throw Error('高速道路IC情報を取得できませんでした');
  const d=await r.json();
  return (d.elements||[]).map(x=>({lat:x.lat,lon:x.lon,name:x.tags?.name||x.tags?.ref||'高速IC',ref:x.tags?.ref||''}))
    .sort((a,b)=>hav([lat,lon],[a.lat,a.lon])-hav([lat,lon],[b.lat,b.lon]));
}
function routeMotorwayRatio(rt){return motorwayScore(rt).ratio;}
async function buildForcedHighwayRoutes(a,b){
  // OSRMの代替ルートだけでは高速道路が返らないことがあるため、
  // 高速道路ICを経由点として明示的に指定する。
  const [orig,dest]=await Promise.all([motorwayJunctionsAround(a.lat,a.lon,50),motorwayJunctionsAround(b.lat,b.lon,50)]);
  const os=orig.slice(0,5), ds=dest.slice(0,6);
  const pairs=[];
  for(const oi of os){
    for(const di of ds){
      const straight=hav([oi.lat,oi.lon],[di.lat,di.lon]);
      if(straight<5000)continue;
      pairs.push({oi,di,score:straight/1000});
    }
  }
  pairs.sort((x,y)=>x.score-y.score);
  const best=[];
  for(const pair of pairs.slice(0,10)){
    try{
      const rt=await osrmVia([a,pair.oi,pair.di,b]);
      if(!rt)continue;
      const analysis=analyzeRoute(rt);
      const ratio=analysis.highwayRatio;
      // 「高速道路優先」と表示する以上、実際のstep情報から高速区間を検出できる候補だけ採用する。
      if(ratio==null || analysis.highwayDistance < 5000) continue;

      const signature=`${Math.round(rt.distance/1000)}-${Math.round(rt.duration/60)}-${pair.oi.name}-${pair.di.name}`;
      if(best.some(x=>x.signature===signature))continue;
      best.push({rt,ratio,oi:pair.oi,di:pair.di,signature});
    }catch(e){console.warn('IC経由ルート失敗',e);}
    if(best.length>=4)break;
  }
  best.sort((x,y)=>x.rt.duration-y.rt.duration);
  return best;
}
async function valhallaRoute(a,b,useHighways){
  const body={locations:[{lat:a.lat,lon:a.lon},{lat:b.lat,lon:b.lon}],costing:'auto',units:'kilometers',directions_options:{units:'kilometers'},costing_options:{auto:{use_highways:useHighways,use_tolls:1,use_ferry:0}},shape_format:'polyline6'};
  const r=await fetch('https://valhalla1.openstreetmap.de/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw Error('Valhalla route API error');
  const d=await r.json();
  if(!d.trip?.legs?.length)throw Error('Valhalla route not found');
  const coordinates=valhallaShape(d.trip);
  if(coordinates.length<2)throw Error('Valhalla geometry missing');
  const summary=d.trip.summary||{};
  return {geometry:{type:'LineString',coordinates},distance:(summary.length||0)*1000,duration:(summary.time||0),legs:d.trip.legs};
}
async function valhallaCandidates(a,b){
  const specs=[
    {kind:'highway',use:1.0,label:'高速道路優先'},
    {kind:'mixed',use:0.55,label:'高速＋一般道'},
    {kind:'general',use:0.0,label:'一般道優先'}
  ];
  const out=[];
  for(const sp of specs){
    try{
      const rt=await valhallaRoute(a,b,sp.use);
      const ratio=analyzeRoute(rt).highwayRatio;
      out.push({rt,kind:sp.kind,label:sp.label,ratio});
    }catch(e){console.warn('Valhalla',sp.kind,e);}
  }
  return out;
}
async function getRoutes(a,b){
  const candidates=[];
  const seenKinds=new Set();

  // 1) 高速道路優先：高速ICを明示的な経由点にしてOSRMで実ルートを生成。
  //    これをValhallaより先に行うことで、Valhalla障害時でも高速候補を失わない。
  try{
    const forced=await buildForcedHighwayRoutes(a,b);
    if(forced.length){
      const best=forced[0];
      const o=classifyRoute(best.rt,0,'highway',{ratio:best.ratio,roads:routeRoadSummary(best.rt,'highway')});
      o.name='高速道路優先'; o.kind='highway'; o.tag='おすすめ';
      candidates.push(o); seenKinds.add('highway');
    }
  }catch(e){console.warn('Forced highway route failed',e);}

  // 2) 高速＋一般道：通常のOSRM最短/最速候補。
  try{
    const rs=await osrm(a,b);
    if(rs.length){
      // 高速候補とほぼ同じルートなら別候補として成立しないので、別形状を優先。
      const mixed=rs.find(r=>!candidates.some(o=>routeSimilar(o.rt,r)) ) || rs[0];
      const o=classifyRoute(mixed,candidates.length,'auto');
      o.name='高速＋一般道'; o.kind='mixed'; o.tag='別ルート';
      candidates.push(o); seenKinds.add('mixed');
    }
  }catch(e){console.warn('OSRM mixed route failed',e);}

  // 3) 一般道優先：motorwayを除外して検索。
  try{
    const rs=await osrm(a,b,'&exclude=motorway');
    if(rs.length){
      const general=rs.find(r=>!candidates.some(o=>routeSimilar(o.rt,r))) || rs[0];
      const o=classifyRoute(general,candidates.length,'general');
      o.name='一般道優先'; o.kind='general'; o.tag='別ルート';
      candidates.push(o); seenKinds.add('general');
    }
  }catch(e){console.warn('OSRM general route failed',e);}

  // OSRMだけで不足した場合はValhallaを補完に利用。
  if(candidates.length<3){
    try{
      const vs=await valhallaCandidates(a,b);
      for(const v of vs){
        if(candidates.some(o=>o.kind===v.kind))continue;
        const o=classifyRoute(v.rt,candidates.length,v.kind==='highway'?'highway':v.kind==='general'?'general':'auto',{
          ratio:v.ratio,roads:routeRoadSummary(v.rt,v.kind)||v.label
        });
        o.name=v.label; o.kind=v.kind; o.tag=o.kind==='highway'?'おすすめ':'別ルート';
        candidates.push(o);
        if(candidates.length>=3)break;
      }
    }catch(e){console.warn('Valhalla fallback failed',e);}
  }

  // 最終的に同一系統しか取れない場合でも、OSRM alternativesから未重複候補を補完。
  if(candidates.length<3){
    try{
      const rs=await osrm(a,b);
      for(const r of rs){
        if(candidates.some(o=>routeSimilar(o.rt,r)))continue;
        const o=classifyRoute(r,candidates.length,'auto');
        o.kind=candidates.length===0?'highway':candidates.length===1?'mixed':'general';
        o.name=['高速道路優先','高速＋一般道','一般道優先'][candidates.length];
        o.tag=candidates.length===0?'おすすめ':'別ルート';
        candidates.push(o);
        if(candidates.length>=3)break;
      }
    }catch(e){console.warn('OSRM final alternatives failed',e);}
  }

  // 表示順を固定。
  const order={highway:0,mixed:1,general:2};
  candidates.sort((x,y)=>(order[x.kind]??9)-(order[y.kind]??9));
  candidates.slice(0,3).forEach((o,i)=>{
    o.name=['高速道路優先','高速＋一般道','一般道優先'][i];
    o.tag=i===0?'おすすめ':'別ルート';
  });
  return candidates.slice(0,3);
}
function routeSimilar(a,b){
  if(!a||!b)return false;
  const ak=a.distance||0,bk=b.distance||0,at=a.duration||0,bt=b.duration||0;
  return Math.abs(ak-bk)<800 && Math.abs(at-bt)<180;
}
function showRouteChoices(routes){routeOptions=routes;routeCountEl.textContent=routeOptions.length+'ルート';routesEl.classList.remove('hidden');routeChoicesEl.innerHTML=routeOptions.map((o,i)=>{const a=o.analysis||analyzeRoute(o.rt);const pct=a.highwayRatio==null?'判定情報不足':Math.round(a.highwayRatio*100)+'%';const seg=a.hasStepData?segmentSummary(o.rt):{text:'区間判定情報なし',transition:''};return`<button class="route-choice ${i===0?'selected':''}" data-index="${i}"><div class="top"><span class="name">${o.name}</span><span class="tag">${o.tag}</span></div><div class="meta"><span>${o.km} km</span><span>${o.mins}分</span><span>高速等 ${pct}</span></div><div class="roads">${o.roads||'経路詳細なし'}</div><div class="segments">${seg.text}</div><div class="transition">${seg.transition}</div></button>`;}).join('');routeChoicesEl.querySelectorAll('.route-choice').forEach(b=>b.onclick=()=>selectRoute(+b.dataset.index));}
async function selectRoute(i){const o=routeOptions[i];if(!o)return;route=o.rt;route.dest=window.__dest;routeOptions.forEach((_,j)=>{const b=routeChoicesEl.querySelector(`[data-index="${j}"]`);if(b)b.classList.toggle('selected',j===i);});status('選択したルートのSA・PAを検索中…');draw();try{cached=await getSpots(route);render(cached);status(`「${o.name}」を選択中。GPSで現在地を自動更新しています。`);}catch(e){status(e.message||'SA・PA検索に失敗しました。');}}
async function getSpots(rt){const cs=rt.geometry.coordinates,lat=cs.map(c=>c[1]),lon=cs.map(c=>c[0]);const s=Math.min(...lat)-.03,n=Math.max(...lat)+.03,w=Math.min(...lon)-.03,e=Math.max(...lon)+.03;const q=`[out:json][timeout:30];nwr["highway"~"^(services|rest_area)$"](${s},${w},${n},${e});out center tags;`;const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'text/plain'},body:q});if(!r.ok)throw Error('SA・PAデータを取得できませんでした');const d=await r.json(),cc=cum(cs),total=cc.at(-1),out=[];const include=/(サービスエリア|パーキングエリア|\bSA\b|\bPA\b|SA・PA|ＳＡ|ＰＡ)/i,exclude=/(道の駅|コインパーキング|駐車場|VIP|ラウンジ|ロータリー|バス停|ガソリンスタンド|サービスステーション)/i;for(const x of d.elements||[]){const la=x.lat??x.center?.lat,lo=x.lon??x.center?.lon;if(la==null||lo==null)continue;const t=x.tags||{},name=t.name||t['name:ja']||'',ja=t['name:ja']||name,label=ja||name;if(!label||exclude.test(label)||(!include.test(name)&&!include.test(ja)))continue;const z=nearestOnRoute(rt,la,lo);if(z.d>120)continue;const km=cc[z.i]/1000;if(km<1||km>total/1000-1)continue;if(current&&Number.isFinite(current.heading)&&current.speed>3&&angleDiff(current.heading,routeBearing(rt,z.i))>75)continue;if(!directionMatches(label,rt,z.i))continue;let type='PA';if(/サービスエリア|\bSA\b|ＳＡ/i.test(label)&&!/パーキングエリア|\bPA\b|ＰＡ/i.test(label))type='SA';if(/SA・PA/i.test(label))type='PA';if(out.some(v=>hav([v.lat,v.lon],[la,lo])<500))continue;out.push({name:label,type,lat:la,lon:lo,km,roadDist:z.d});}return out.sort((a,b)=>a.km-b.km).slice(0,40);}
function draw(){if(routeLayer)map.removeLayer(routeLayer);routeLayer=L.geoJSON(route.geometry,{style:{weight:5}}).addTo(map);map.fitBounds(routeLayer.getBounds(),{padding:[15,15]});if(destMarker)map.removeLayer(destMarker);destMarker=L.marker([route.dest.lat,route.dest.lon]).addTo(map).bindPopup(`目的地: ${route.dest.label||'目的地'}`);}
function render(spots){saMarkers.forEach(m=>map.removeLayer(m));saMarkers=[];const now=Date.now(),near=nearestOnRoute(route,current.lat,current.lon),cc=cum(route.geometry.coordinates),passed=cc[near.i],total=cc.at(-1),remain=Math.max(0,total-passed),sec=route.duration*(remain/Math.max(1,total));$('#totalDistance').textContent=(remain/1000).toFixed(1)+' km';$('#eta').textContent=time(new Date(now+sec*1000));$('#remainingTime').textContent=dur(sec);summary.classList.remove('hidden');const active=spots.map(x=>({...x,remaining:Math.max(0,x.km*1000-passed)})).filter(x=>x.remaining>500);spotsEl.innerHTML=active.length?active.map(x=>{const es=sec*(x.remaining/Math.max(1,remain));return`<article class="spot"><div class="badge">${x.type==='SA'?'S':'P'}</div><div><h3>${x.name}</h3><p>${x.type} ・ 到着予定 ${time(new Date(now+es*1000))}</p></div><div class="distance"><strong>${(x.remaining/1000).toFixed(1)} km</strong><span>あと ${dur(es)}</span></div></article>`;}).join(''):`<div class="empty">このルート上で確認できるSA・PAはありません。</div>`;countEl.textContent=active.length+'か所';active.forEach(x=>saMarkers.push(L.marker([x.lat,x.lon]).addTo(map).bindPopup(`${x.name}（${x.type}）`)));}
function update(){if(route&&current)render(cached);}
function showDestinationChoices(cands){const box=$('#destinationChoices');if(!box)return;if(cands.length<=1){box.classList.add('hidden');box.innerHTML='';return;}box.classList.remove('hidden');box.innerHTML=`<div class="section-title"><h2>目的地候補を選択</h2><span>${cands.length}候補</span></div>`+cands.map((c,i)=>`<button class="dest-choice" data-index="${i}"><strong>${c.label}</strong><small>${c.source||''}</small></button>`).join('');box.querySelectorAll('.dest-choice').forEach(b=>b.onclick=()=>selectDestination(+b.dataset.index));}
let destinationCandidates=[];
async function selectDestination(i){const to=destinationCandidates[i];if(!to)return;window.__dest=to;showDestinationChoices([]);status(`目的地「${to.label}」を選択しました。高速道路を含む複数ルートを検索中…`);await searchRoutesForDestination(to);}
async function searchRoutesForDestination(to){try{const routes=await getRoutes(current,to);showRouteChoices(routes);await selectRoute(0);status(`「${routeOptions[0].name}」を選択中。別ルートもタップで選べます。`);}catch(e){console.error(e);status(e.message||'ルート検索に失敗しました。');}}
async function search(){if(!current){status('先に⌖を押して現在地を取得してください。');gps();return;}const q=destination.value.trim();if(!q)return;searchBtn.disabled=true;try{routesEl.classList.add('hidden');status('目的地の候補を検索中…');destinationCandidates=await geocodeCandidates(q);showDestinationChoices(destinationCandidates);if(destinationCandidates.length===1){window.__dest=destinationCandidates[0];await searchRoutesForDestination(destinationCandidates[0]);}else{status(`${destinationCandidates.length}件の候補があります。正しい目的地を選択してください。`);}}catch(e){console.error(e);status(e.message||'検索に失敗しました。');}finally{searchBtn.disabled=false;}}
locateBtn.onclick=gps;searchBtn.onclick=search;destination.onkeydown=e=>{if(e.key==='Enter')search();};gps();

