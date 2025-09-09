// Via Flight Travel Planner (Advanced)
// Google API 키는 advanced/config.js의 API_KEY 상수를 사용합니다.

let map, places, directionsService;
let originPlace = null;
let originMarker = null;
let markers = [];
let userMarker = null;
let watchId = null;
let currentRoute = [];
let legPolylines = [];
let resultPlaces = [];
let resultPage = 1;
let catPlaces = [];
let catPage = 1;
const openStatusCache = new Map();

const SEG_COLORS = ['#4f8cff','#22c55e','#eab308','#ef4444','#a855f7','#10b981','#fb7185','#38bdf8','#f97316','#14b8a6'];
const segColor = (i)=> SEG_COLORS[i % SEG_COLORS.length];
const hexToRgba = (hex, a=0.14)=>{const m=hex.replace('#','');const r=parseInt(m.slice(0,2),16),g=parseInt(m.slice(2,4),16),b=parseInt(m.slice(4,6),16);return `rgba(${r}, ${g}, ${b}, ${a})`};

const state = {
  timeMode: 'now',
  arrivalDate: null,
  layoverMinutes: 360,
  timezone: 'auto',
  selectedCategories: new Set(['tourist_attraction']),
  itinerary: [],
};

function $(s){return document.querySelector(s)}
function $all(s){return Array.from(document.querySelectorAll(s))}
function humanTime(d){ try{ return new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit'}).format(d);}catch(_){ return d.toLocaleTimeString(); } }

function initUI(){
  $all('input[name="time-mode"]').forEach(r=>r.addEventListener('change',()=>{
    state.timeMode = r.value; $('#layover-fields').classList.toggle('hidden', state.timeMode!=='layover');
  }));
  $('#arrival-dt').addEventListener('change', e=>{ state.arrivalDate = e.target.value? new Date(e.target.value): null });
  initDatePicker();
  $('#layover-min').addEventListener('change', e=>{ const v=Number(e.target.value)||360; state.layoverMinutes=Math.min(1440,Math.max(30,v)); e.target.value=state.layoverMinutes; });
  $('#tz-select').addEventListener('change', e=> state.timezone = e.target.value);
  $all('.cat').forEach(ch=>{ ch.checked = ch.value==='tourist_attraction'; if(ch.checked) state.selectedCategories.add(ch.value); else state.selectedCategories.delete(ch.value); ch.addEventListener('change',()=>{ if(ch.checked) state.selectedCategories.add(ch.value); else state.selectedCategories.delete(ch.value); searchByCategories(); }) });
  $('#search-clear').addEventListener('click', ()=>{ $('#search-input').value=''; renderResults([]); });
  $('#search-btn').addEventListener('click', ()=> doSearch());
  $('#prev-page').addEventListener('click', ()=>{ resultPage--; renderResults(resultPlaces); });
  $('#next-page').addEventListener('click', ()=>{ resultPage++; renderResults(resultPlaces); });
  $('#use-gps').addEventListener('click', centerToGPS);
  $('#clear-origin').addEventListener('click', ()=>{ $('#origin-input').value=''; originPlace=null; if(originMarker){ originMarker.setMap(null); originMarker=null; } });
  $('#optimize').addEventListener('click', optimizeRouteAdvanced);
  $('#view-all').addEventListener('click', viewAll);
  $('#start-trip').addEventListener('click', startTrip);
  $('#pause-trip').addEventListener('click', pauseTrip);
  $('#resume-trip').addEventListener('click', resumeTrip);
  $('#end-trip').addEventListener('click', endTrip);
  $('#recenter').addEventListener('click', ()=>{ if(userMarker) map.panTo(userMarker.getPosition()) });
  $('#modal-close').addEventListener('click', ()=> hideModal());
  $('#modal').addEventListener('click', (e)=>{ if(e.target===$('#modal')) hideModal() });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && !$('#modal').classList.contains('hidden')) hideModal(); });
  $('#poi-prev').addEventListener('click', ()=>{ changeCatPage(-1) });
  $('#poi-next').addEventListener('click', ()=>{ changeCatPage(1) });
}

function initAutocomplete(){
  const ac = new google.maps.places.Autocomplete($('#origin-input'), { fields:['place_id','geometry','name'] });
  ac.addListener('place_changed', ()=>{ const p=ac.getPlace(); if(!p||!p.geometry) return; originPlace={place_id:p.place_id,name:p.name,location:p.geometry.location.toJSON()}; map.panTo(p.geometry.location); map.setZoom(14);
    if(!originMarker) originMarker=new google.maps.Marker({map, position:p.geometry.location, title:originPlace.name||'출발지', icon:{path:google.maps.SymbolPath.CIRCLE, scale:6, fillColor:'#22c55e', fillOpacity:1, strokeColor:'#fff', strokeWeight:2}}); else originMarker.setPosition(p.geometry.location);
  });
  const ac2 = new google.maps.places.Autocomplete($('#search-input'), { fields:['place_id','geometry','name','types','formatted_address'] });
  ac2.addListener('place_changed', ()=>{ const p=ac2.getPlace(); if(!p||!p.geometry)return; const item={place_id:p.place_id,name:p.name,location:p.geometry.location.toJSON(),types:p.types||[],formatted_address:p.formatted_address||''}; resultPlaces=[item]; resultPage=1; renderResults(resultPlaces); clearMarkers(); plotMarkers(resultPlaces); map.panTo(p.geometry.location); map.setZoom(15); });
}

function initMap(){
  map = new google.maps.Map(document.getElementById('map'), { center:{lat:1.3521,lng:103.8198}, zoom:12, streetViewControl:false, fullscreenControl:false });
  places = new google.maps.places.PlacesService(map);
  directionsService = new google.maps.DirectionsService();
  initUI(); initAutocomplete();
  initDatePicker();
  searchByCategories();
  let searchTimer=null; map.addListener('idle', ()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(()=> searchByCategories(), 400); });
}

function loadGoogle(){ const s=document.createElement('script'); s.src=`https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places&callback=initMap`; s.async=true; s.defer=true; document.body.appendChild(s); }
document.addEventListener('DOMContentLoaded', loadGoogle);
document.addEventListener('DOMContentLoaded', ()=>{ initDatePicker(); });

function initDatePicker(){
  const el = $('#arrival-dt'); if(!el) return;
  if(window.flatpickr){
    if(el._flatpickr){ try{ el._flatpickr.destroy(); }catch(_){}}
    flatpickr(el, { enableTime:true, time_24hr:true, minuteIncrement:5, dateFormat:'Y-m-d H:i', defaultDate: state.arrivalDate||null, onChange:(sel)=>{ state.arrivalDate = sel?.[0]||null; } });
  } else {
    // 라이브러리 미로딩 시 브라우저 기본 피커 사용
    if(!el.getAttribute('type')) el.setAttribute('type','datetime-local');
  }
}

function centerToGPS(){ if(!navigator.geolocation) return alert('위치 서비스를 사용할 수 없습니다.'); navigator.geolocation.getCurrentPosition(p=>{ const ll={lat:p.coords.latitude,lng:p.coords.longitude}; map.setCenter(ll); map.setZoom(14); if(!userMarker) userMarker=new google.maps.Marker({map,position:ll,icon:userIcon(),title:'내 위치'}); else userMarker.setPosition(ll); if(!originPlace){ originPlace={place_id:null,name:'현재 위치',location:ll}; } if(!originMarker) originMarker=new google.maps.Marker({map, position:ll, title:'출발지', icon:{path:google.maps.SymbolPath.CIRCLE, scale:6, fillColor:'#22c55e', fillOpacity:1, strokeColor:'#fff', strokeWeight:2}}); else originMarker.setPosition(ll); }, err=> alert('GPS 실패: '+err.message), {enableHighAccuracy:true,timeout:8000}); }
function userIcon(){ return { path: google.maps.SymbolPath.CIRCLE, scale:6, fillColor:'#4f8cff', fillOpacity:1, strokeColor:'#fff', strokeWeight:2 } }

function doSearch(){ const q=$('#search-input').value.trim(); if(!q){ renderResults([]); return; } const cats=Array.from(state.selectedCategories); places.textSearch({query:q, location:map.getCenter(), radius:8000}, (res,status)=>{ if(status!==google.maps.places.PlacesServiceStatus.OK||!res){ renderResults([]); return;} const filtered=res.filter(p=>!cats.length||(p.types||[]).some(t=>cats.includes(t))); resultPlaces=filtered.map(p=>({place_id:p.place_id,name:p.name,location:p.geometry?.location?.toJSON(),rating:p.rating,types:p.types||[],formatted_address:p.formatted_address||''})).sort((a,b)=>(b.rating||0)-(a.rating||0)); resultPage=1; renderResults(resultPlaces); clearMarkers(); plotMarkers(resultPlaces); }); }

function renderResults(list){ const el=$('#results'); el.innerHTML=''; const per=5; const total=Math.ceil((list.length||0)/per)||0; const page=Math.min(Math.max(1,resultPage), Math.max(1,total)); $('#page-info').textContent=`${total?page:0} / ${total}`; $('#prev-page').disabled=page<=1; $('#next-page').disabled=page>=total||total===0; const items=list.slice((page-1)*per, page*per); items.forEach(p=>{ const card=document.createElement('div'); card.className='card'; card.innerHTML=`<div class="row gap" style="justify-content:space-between"><div><div class="title">${p.name}</div><div class="muted">${p.formatted_address||''}</div><div class="row gap muted">${(p.types||[]).slice(0,2).join(', ')}</div></div><div class="row gap">${p.rating?`<span class=tag>★ ${p.rating.toFixed(1)}</span>`:''}<span class="tag" data-role="open-badge">영업정보</span></div></div><div class="row gap" style="margin-top:8px"><button class="btn sm" data-action=focus>이동</button><button class="btn sm" data-action=detail>상세</button><button class="btn sm" data-action=add>일정 추가</button></div>`; card.querySelector('[data-action=focus]').onclick=()=>{ if(p.location){ map.panTo(p.location); map.setZoom(15);} }; card.querySelector('[data-action=detail]').onclick=()=> openDetailModal(p.place_id); card.querySelector('[data-action=add]').onclick=()=> addToItinerary(p); el.appendChild(card); const badge=card.querySelector('[data-role="open-badge"]'); getOpenNow(p.place_id).then(v=>{ if(v===true){ badge.textContent='영업중'; badge.style.background='#1b3a2611'; badge.style.color='#a7f3d0'; badge.style.borderColor='#1b3a26'; } else if(v===false){ badge.textContent='영업종료'; badge.style.background='#3a1b1b11'; badge.style.color='#fecaca'; badge.style.borderColor='#3a1b1b'; } else { badge.textContent='영업정보 없음'; badge.style.opacity='0.7'; } }); }); }

function plotMarkers(list){ clearMarkers(); for(const p of list){ if(!p.location) continue; const m=new google.maps.Marker({map, position:p.location, title:p.name, icon:categoryIcon((p.types||[])[0])}); m.addListener('click', ()=> openDetailModal(p.place_id)); markers.push(m);} }
function clearMarkers(){ markers.forEach(m=>m.setMap(null)); markers=[]; }

function addToItinerary(p){ if(state.itinerary.find(x=>x.placeId===p.place_id)) return; state.itinerary.push({placeId:p.place_id, name:p.name, location:p.location, category:(p.types||[])[0]||'poi', stay:60}); renderItinerary(); }
function renderItinerary(){ const box=$('#itinerary'); box.innerHTML=''; state.itinerary.forEach(it=>{ const row=document.createElement('div'); row.className='item'; row.dataset.id=it.placeId; row.innerHTML=`<div style="min-width:0"><div class=strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${it.name}</div><div class=muted>${it.category}</div></div><div class=row gap><label class=row gap>체류<input type=number min=1 max=240 value="${it.stay}" class=input style="width:72px"/>분</label><button class="btn sm" data-action=del>삭제</button></div>`; row.querySelector('input').addEventListener('change', e=>{ it.stay=Math.min(240,Math.max(1,Number(e.target.value)||60)); e.target.value=it.stay; }); row.querySelector('[data-action=del]').onclick=()=>{ state.itinerary=state.itinerary.filter(x=>x.placeId!==it.placeId); renderItinerary(); }; box.appendChild(row); }); new Sortable(box,{animation:150,onEnd:()=>{ const ordered=Array.from(box.children).map(ch=>ch.dataset.id); state.itinerary.sort((a,b)=> ordered.indexOf(a.placeId)-ordered.indexOf(b.placeId)); }}); }

function openDetailModal(placeId){ places.getDetails({ placeId, fields:['name','photos','formatted_address','international_phone_number','rating','types','opening_hours','website','reviews','geometry']}, (p,status)=>{ if(status!==google.maps.places.PlacesServiceStatus.OK||!p){ alert('상세 정보를 가져올 수 없습니다.'); return; } const body=$('#modal-body'); const photo=p.photos?.[0]?.getUrl({maxWidth:600})||''; body.innerHTML=`${photo?`<img src="${photo}" alt="${p.name}" style="width:100%;border-radius:8px"/>`:''}<h3 style="margin:12px 0 4px 0">${p.name}</h3><div class=muted>${p.formatted_address||''}</div><div class=row gap style="margin:6px 0">${p.rating?`<span class=tag>★ ${p.rating.toFixed(1)}</span>`:''}</div>${p.international_phone_number?`<div>전화: ${p.international_phone_number}</div>`:''}${p.website?`<div><a href="${p.website}" target=_blank>웹사이트 열기</a></div>`:''}<div style="margin-top:8px"><label class=row gap>체류시간(분)<input id=detail-stay class=input type=number min=1 max=240 value=60 style="width:90px" /></label><button id=detail-add class=btn style="margin-top:8px">일정에 추가</button></div><div style="margin-top:12px"><h4>운영시간</h4><div id=ohours class=cards></div><h4>방문자 리뷰</h4><div id=reviews class=cards></div></div>`; const oh=$('#ohours'); const wtxt=p.opening_hours?.weekday_text||[]; const nowOpen = typeof p.opening_hours?.isOpen==='function' ? p.opening_hours.isOpen() : null; const nowBadge=document.createElement('div'); nowBadge.className='tag'; nowBadge.textContent = nowOpen===true?'현재 영업중': nowOpen===false?'현재 영업종료':'영업정보 없음'; oh.appendChild(nowBadge); wtxt.forEach(t=>{ const li=document.createElement('div'); li.className='card'; li.textContent=t; oh.appendChild(li); }); const rbox=body.querySelector('#reviews'); (p.reviews||[]).slice(0,5).forEach(r=>{ const d=new Date(r.time*1000); const item=document.createElement('div'); item.className='card'; item.innerHTML=`<div class=row gap style="justify-content:space-between"><span class=strong>${r.author_name||'익명'}</span><span class=muted>${d.toLocaleDateString()}</span></div><div>★ ${r.rating||''}</div><div class=muted>${r.text||''}</div>`; rbox.appendChild(item); }); $('#detail-add').onclick=()=>{ const stay=Math.min(240,Math.max(1,Number($('#detail-stay').value)||60)); addToItinerary({ place_id:placeId, name:p.name, location:p.geometry?.location?.toJSON(), types:p.types||[] }); const it=state.itinerary.find(x=>x.placeId===placeId); if(it) it.stay=stay; renderItinerary(); hideModal(); }; showModal(); }); }
function showModal(){ $('#modal').classList.remove('hidden') } function hideModal(){ $('#modal').classList.add('hidden') }

function searchByCategories(){ const cats=Array.from(state.selectedCategories); if(cats.length===0){ catPlaces=[]; renderCatStrip(); clearMarkers(); return; } const center=map.getCenter(); const radius=5000; const acc=new Map(); let done=0; cats.forEach(type=>{ places.nearbySearch({location:center, radius, type}, (res,status)=>{ done++; if(status===google.maps.places.PlacesServiceStatus.OK && res){ res.forEach(p=>{ const id=p.place_id; if(!acc.has(id)) acc.set(id,{place_id:id,name:p.name,location:p.geometry?.location?.toJSON(),rating:p.rating,types:p.types||[type],formatted_address:p.vicinity||'',photoRef:p.photos?.[0]||null}); }); } if(done===cats.length){ catPlaces=Array.from(acc.values()).sort((a,b)=>(b.rating||0)-(a.rating||0)); catPage=1; renderCatStrip(); clearMarkers(); plotMarkers(catPlaces); } }); }); }
function renderCatStrip(){ const strip=$('#poi-strip'), cards=$('#poi-cards'); if(!catPlaces.length){ strip.classList.add('hidden'); cards.innerHTML=''; return;} const per=5; const total=Math.ceil(catPlaces.length/per); catPage=Math.min(Math.max(1,catPage), total); const items=catPlaces.slice((catPage-1)*per, catPage*per); strip.classList.remove('hidden'); cards.innerHTML=''; items.forEach(p=>{ const div=document.createElement('div'); div.className='poi-card'; const photo=p.photoRef? p.photoRef.getUrl({maxWidth:300,maxHeight:180}) : ''; div.innerHTML=`${photo?`<img src="${photo}" alt="${p.name}">`:''}<div class=strong style="margin-top:6px">${p.name}</div><div class=muted>${p.formatted_address||''}</div><div class=row gap style="margin:6px 0">${p.rating?`<span class=tag>★ ${p.rating.toFixed(1)}</span>`:''}<span class="tag" data-role="open-badge">영업정보</span></div><div class=row gap><button class="btn sm" data-action=focus>이동</button><button class="btn sm" data-action=detail>상세</button><button class="btn sm" data-action=add>일정 추가</button></div>`; div.querySelector('[data-action=focus]').onclick=()=>{ if(p.location){ map.panTo(p.location); map.setZoom(15);} }; div.querySelector('[data-action=detail]').onclick=()=> openDetailModal(p.place_id); div.querySelector('[data-action=add]').onclick=()=> addToItinerary(p); cards.appendChild(div); const badge=div.querySelector('[data-role="open-badge"]'); getOpenNow(p.place_id).then(v=>{ if(v===true){ badge.textContent='영업중'; badge.style.background='#1b3a2611'; badge.style.color='#a7f3d0'; badge.style.borderColor='#1b3a26'; } else if(v===false){ badge.textContent='영업종료'; badge.style.background='#3a1b1b11'; badge.style.color='#fecaca'; badge.style.borderColor='#3a1b1b'; } else { badge.textContent='영업정보 없음'; badge.style.opacity='0.7'; } }); }); }
function changeCatPage(d){ catPage+=d; renderCatStrip(); }

async function optimizeRouteAdvanced(){ if(!originPlace||state.itinerary.length===0){ alert('출발지와 일정 항목을 확인하세요.'); return; }
  const greedy = await greedyRoute(originPlace.location, state.itinerary.map(x=>({...x})), 'TRANSIT');
  const { feasible, info: infoA } = await buildFeasibleSchedule(greedy);
  const improved = await twoOptImprove(feasible);
  const { adjusted, info: infoB } = await adjustToLayover(improved);
  const info = { excluded: infoA.excluded, adjusted: infoB.adjusted, changed: infoB.changed, dropped: infoB.dropped };
  currentRoute = adjusted;
  await drawRouteWithDetails(adjusted);
  await buildScheduleCards(adjusted, info);
}

async function greedyRoute(startLL, items, mode){ const remaining=items.slice(); const route=[]; let current=startLL; while(remaining.length){ const times=await matrixDurations(current, remaining.map(r=>r.location), mode); let minIdx=0,minV=Infinity; times.forEach((v,i)=>{ if(v<minV){minV=v;minIdx=i} }); route.push(remaining.splice(minIdx,1)[0]); current=route[route.length-1].location; } return route; }
function matrixDurations(originLL, destLLs, mode){ return new Promise(resolve=>{ const svc=new google.maps.DistanceMatrixService(); svc.getDistanceMatrix({ origins:[originLL], destinations:destLLs, travelMode:google.maps.TravelMode[mode]||google.maps.TravelMode.TRANSIT, unitSystem:google.maps.UnitSystem.METRIC }, (res,status)=>{ if(status!=='OK'){ resolve(destLLs.map(()=>Infinity)); return;} const row=res.rows?.[0]?.elements||[]; resolve(row.map(e=> e.duration?.value ?? Infinity)); }); }); }

async function twoOptImprove(route){ if(route.length<3) return route; const coords=[originPlace.location, ...route.map(r=>r.location)]; const dm = await fullMatrix(coords);
  let best = route.slice(); let improved=true;
  function cost(seq){ let c=0; let prev=0; for(let i=0;i<seq.length;i++){ const idx=i+1; c+=dm[prev][idx]; prev=idx; } c+=dm[prev][0]; return c; }
  while(improved){ improved=false; for(let i=0;i<best.length-1;i++){ for(let k=i+1;k<best.length;k++){ const newRoute = best.slice(); newRoute.splice(i, k-i+1, ...best.slice(i, k+1).reverse()); if(cost(newRoute) < cost(best)){ best=newRoute; improved=true; } } } }
  return best;
}
async function fullMatrix(coords){ const n=coords.length; const dm=Array.from({length:n},()=>Array(n).fill(0)); const svc=new google.maps.DistanceMatrixService(); for(let i=0;i<n;i++){ await new Promise(res=>{ svc.getDistanceMatrix({origins:[coords[i]], destinations:coords, travelMode:google.maps.TravelMode.TRANSIT}, (r,st)=>{ if(st==='OK'){ const row=r.rows?.[0]?.elements||[]; for(let j=0;j<row.length;j++){ dm[i][j]=row[j].duration?.value??Infinity; } } res(); }); }); } return dm; }

async function buildFeasibleSchedule(route){ const out=[]; const info={excluded:[]}; const start = computeStartTime(); const endLimit = new Date(start.getTime()+ state.layoverMinutes*60*1000); let cursor = new Date(start); let fromLL=originPlace.location; for(const it of route){ const [sec]=await matrixDurations(fromLL,[it.location],'TRANSIT'); const moveMin = Math.round((sec||0)/60); const arrive = new Date(cursor.getTime()+ moveMin*60*1000); const leave = new Date(arrive.getTime()+ it.stay*60*1000); const tz = state.timezone==='auto'? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timezone; const openOk = await isOpenAtPlace(it.placeId, arrive, leave, tz); if(leave> endLimit){ info.excluded.push({name:it.name, reason:'환승 제한 초과'}); continue; } if(!openOk){ info.excluded.push({name:it.name, reason:'운영시간'}); continue; } out.push(it); cursor=leave; fromLL=it.location; }
  return { feasible: out, info };
}

function getLocalParts(date, timeZone){ const fmt = new Intl.DateTimeFormat('en-US',{ timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false, weekday:'short' }); const parts = fmt.formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{}); const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday); return { Y:Number(parts.year), M:Number(parts.month), D:Number(parts.day), h:Number(parts.hour), m:Number(parts.minute), wd } }
function hmToMin(hm){ const h=Number(hm.slice(0,2)), m=Number(hm.slice(2,4)); return h*60+m }
async function isOpenAtPlace(placeId, arrive, leave, timeZone){ return new Promise(res=>{ places.getDetails({ placeId, fields:['opening_hours']}, (p,st)=>{ if(st!==google.maps.places.PlacesServiceStatus.OK || !p?.opening_hours?.periods){ res(true); return; } const periods=p.opening_hours.periods; const a=getLocalParts(arrive, timeZone), l=getLocalParts(leave,timeZone); const aMin=a.h*60+a.m, lMin=l.h*60+l.m; const sameDay=a.wd===l.wd; let ok=false; for(const pr of periods){ const od=pr.open?.day, cd=pr.close?.day, ot=pr.open?.time, ct=pr.close?.time; if(ot==null||ct==null) continue; const oMin=hmToMin(ot), cMin=hmToMin(ct); if(od===cd){ if(a.wd===od && l.wd===cd && aMin>=oMin && lMin<=cMin) { ok=true; break; } } else { if((a.wd===od && aMin>=oMin) || (l.wd===cd && lMin<=cMin) || (sameDay && a.wd===od && l.wd===cd && aMin>=oMin && lMin<=cMin)) { ok=true; break; } } } res(ok); }); }); }

async function drawRouteWithDetails(ordered){ legPolylines.forEach(pl=>pl.setMap(null)); legPolylines=[]; clearMarkers();
  if(originMarker) originMarker.setMap(null);
  originMarker = new google.maps.Marker({map, position:originPlace.location, title:originPlace.name||'출발지', icon:{path:google.maps.SymbolPath.CIRCLE, scale:6, fillColor:'#22c55e', fillOpacity:1, strokeColor:'#fff', strokeWeight:2}});
  let from=originPlace.location;
  for(let i=0;i<ordered.length;i++){
    const stop=ordered[i];
    await new Promise(resolve=>{ directionsService.route({ origin:from, destination:stop.location, travelMode:google.maps.TravelMode.TRANSIT }, (res,st)=>{ if(st==='OK'){ const line=new google.maps.Polyline({ path:res.routes[0].overview_path, strokeColor:segColor(i), strokeOpacity:.95, strokeWeight:4, map }); legPolylines.push(line); stop._transit = parseTransit(res.routes[0]); } resolve(); }); });
    new google.maps.Marker({map, position:stop.location, title:stop.name});
    from=stop.location;
  }
  if(ordered.length){ const i=ordered.length; await new Promise(resolve=>{ directionsService.route({ origin:from, destination:originPlace.location, travelMode:google.maps.TravelMode.TRANSIT }, (res,st)=>{ if(st==='OK'){ const line=new google.maps.Polyline({ path:res.routes[0].overview_path, strokeColor:segColor(i), strokeOpacity:.95, strokeWeight:4, map }); legPolylines.push(line); } resolve(); }); }); }
}

function parseTransit(route){ const leg=route.legs?.[0]; if(!leg) return []; const out=[]; for(const s of leg.steps||[]){ if(s.travel_mode==='TRANSIT' && s.transit){ const t=s.transit; const type=vehicleKo(t.line?.vehicle?.type); const name=t.line?.short_name||t.line?.name||''; const dep=t.departure_stop?.name||''; const arr=t.arrival_stop?.name||''; out.push(`${type} ${name} · ${dep} → ${arr}`.trim()); } else if(s.travel_mode==='WALKING'){ out.push('도보'); } } if(out.length>3){ const head=out.slice(0,3); head.push(`외 ${out.length-3}개`); return head; } return out; }
function vehicleKo(type){ const map={ SUBWAY:'지하철', HEAVY_RAIL:'기차', COMMUTER_TRAIN:'전철', HIGH_SPEED_TRAIN:'고속철', BUS:'버스', TROLLEYBUS:'트롤리버스', TRAM:'트램', FERRY:'페리', CABLE_CAR:'케이블카', GONDOLA_LIFT:'곤돌라', MONORAIL:'모노레일' }; return map[type]||'대중교통'; }

async function buildScheduleCards(ordered, info){ const box=$('#schedule'); box.innerHTML=''; const start=computeStartTime(); let cursor=new Date(start); let from=originPlace; let totalMove=0,totalStay=0; for(let i=0;i<ordered.length;i++){ const it=ordered[i]; const [sec]=await matrixDurations(from.location,[it.location],'TRANSIT'); const moveMin=Math.round((sec||0)/60); totalMove+=moveMin; const arrive=new Date(cursor.getTime()+moveMin*60*1000); const color=segColor(i); const openOk = await isOpenAtPlace(it.placeId, arrive, new Date(arrive.getTime()+(it.stay||60)*60*1000), state.timezone==='auto'? Intl.DateTimeFormat().resolvedOptions().timeZone : state.timezone); const seg=document.createElement('div'); seg.className='card'; seg.style.background=hexToRgba(color,.14); seg.style.borderLeft=`4px solid ${color}`; const transitLines=(it._transit||[]).map(x=>`<div class=muted>· ${x}</div>`).join(''); seg.innerHTML=`<div class=strong>구간 ${i+1}: ${from.name||'출발지'} → ${it.name}</div><div class=muted>이동시간 약 ${moveMin}분 · 도착 ${humanTime(arrive)}</div>${transitLines}<div class=row gap style=margin-top:6px><button class="btn sm" data-action=focus>이 구간 보기</button><a class="btn sm" target=_blank href="https://www.google.com/maps/dir/?api=1&origin=${from.location.lat},${from.location.lng}&destination=${it.location.lat},${it.location.lng}&travelmode=transit">구글맵으로 열기</a></div>`; seg.querySelector('[data-action=focus]').onclick=()=>{ highlightLeg(i); fitPolyline(i); }; box.appendChild(seg); const stayMin=it.stay||60; totalStay+=stayMin; const leave=new Date(arrive.getTime()+stayMin*60*1000); const stay=document.createElement('div'); stay.className='card'; stay.style.background=hexToRgba(color,.08); stay.style.borderLeft=`4px solid ${color}`; stay.innerHTML=`<div class=row gap style="justify-content:space-between"><div class=strong>체류: ${it.name}</div><span class=tag>${stayMin}분</span></div><div class=muted>출발 예정 ${humanTime(leave)}</div><div class=row gap style=margin-top:6px><span class="tag" style="border-color:${openOk?'#1b3a26':'#3a1b1b'}; color:${openOk?'#a7f3d0':'#fecaca'}; background:${openOk?'#1b3a2611':'#3a1b1b11'};">${openOk?'영업중':'영업종료'}</span></div>`; box.appendChild(stay); cursor=leave; from=it; }
  if(ordered.length){ const i=ordered.length; const [sec]=await matrixDurations(ordered[ordered.length-1].location,[originPlace.location],'TRANSIT'); const moveMin=Math.round((sec||0)/60); totalMove+=moveMin; const arrive=new Date(cursor.getTime()+moveMin*60*1000); const color=segColor(i); const seg=document.createElement('div'); seg.className='card'; seg.style.background=hexToRgba(color,.14); seg.style.borderLeft=`4px solid ${color}`; seg.innerHTML=`<div class=strong>구간 ${i+1}: ${ordered[ordered.length-1].name} → 출발지 복귀</div><div class=muted>이동시간 약 ${moveMin}분 · 도착 ${humanTime(arrive)}</div><div class=row gap style=margin-top:6px><button class="btn sm" data-action=focus>이 구간 보기</button><a class="btn sm" target=_blank href="https://www.google.com/maps/dir/?api=1&origin=${ordered[ordered.length-1].location.lat},${ordered[ordered.length-1].location.lng}&destination=${originPlace.location.lat},${originPlace.location.lng}&travelmode=transit">구글맵으로 열기</a></div>`; seg.querySelector('[data-action=focus]').onclick=()=>{ highlightLeg(i); fitPolyline(i); }; box.appendChild(seg); }
  if(info && (info.adjusted || info.dropped?.length || info.excluded?.length)){ const note=document.createElement('div'); note.className='card warn-card'; const dropped = (info.dropped||[]).map(n=>`<span class=tag>${n}</span>`).join(' '); const changed = (info.changed||[]).map(c=>`${c.name}: ${c.before}→${c.after}분`).join(', '); const excluded = (info.excluded||[]).map(e=>`${e.name}(${e.reason})`).join(', '); note.innerHTML = `일정이 조정되었습니다. ${excluded?`제외(${excluded})`:''} ${changed?`변경(${changed})`:''} ${dropped?`추가 제외(${dropped})`:''}`; box.appendChild(note); }
  const total=totalMove+totalStay; const sum=document.createElement('div'); sum.className='card'; sum.innerHTML=`<div class=strong>전체 요약</div><div class=muted>총 이동 ${totalMove}분 · 체류 ${totalStay}분 · 소요 ${total}분 · 환승 제한 ${state.layoverMinutes}분</div>`; box.appendChild(sum);
}

function fitPolyline(i){ const pl=legPolylines[i]; if(!pl) return; const path=pl.getPath(); const b=new google.maps.LatLngBounds(); for(let j=0;j<path.getLength();j++){ b.extend(path.getAt(j)); } map.fitBounds(b); }
function highlightLeg(i){ legPolylines.forEach((pl,idx)=>{ pl.setOptions({ strokeOpacity: idx===i?1:0.7, strokeWeight: idx===i?6:4 }); }); }
function highlightNone(){ legPolylines.forEach(pl=> pl.setOptions({ strokeOpacity:0.95, strokeWeight:4 })); }
function viewAll(){ highlightNone(); const b=new google.maps.LatLngBounds(); let added=false; legPolylines.forEach(pl=>{ const path=pl.getPath(); for(let j=0;j<path.getLength();j++){ b.extend(path.getAt(j)); added=true; } }); if(added){ map.fitBounds(b); } else if(originMarker){ map.setCenter(originMarker.getPosition()); map.setZoom(12); } }

function computeStartTime(){ if(state.timeMode==='layover'){ return state.arrivalDate? new Date(state.arrivalDate): new Date(); } return new Date(); }

function startTrip(){ if(watchId) return; if(!navigator.geolocation) return alert('GPS를 사용할 수 없습니다.'); $('#status-indicator').classList.remove('hidden'); watchId=navigator.geolocation.watchPosition(onWatch,onWatchError,{enableHighAccuracy:true,maximumAge:0,timeout:8000}); }
function pauseTrip(){ if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; setStatus('warn','일시정지'); toggleTripButtons('paused'); } }
function resumeTrip(){ if(!watchId){ startTrip(); toggleTripButtons('running'); } }
function endTrip(){ if(watchId){ navigator.geolocation.clearWatch(watchId); watchId=null; } $('#status-indicator').classList.add('hidden'); toggleTripButtons('ended'); }
function onWatch(pos){ const ll={lat:pos.coords.latitude,lng:pos.coords.longitude}; if(!userMarker) userMarker=new google.maps.Marker({map,position:ll,icon:userIcon(),title:'내 위치'}); else userMarker.setPosition(ll); $('#eta-remaining').textContent='실시간 추적 중'; setStatus('ok','정상'); if(currentRoute && currentRoute.length){ const target=currentRoute[0]; if(haversine(ll,target.location)<20){ currentRoute.shift(); $('#next-dest').textContent=currentRoute[0]?`다음: ${currentRoute[0].name}`:'여정 완료'; alert(`${target.name}에 도착했습니다. 다음 목적지로 이동합니다.`); } else { $('#next-dest').textContent=`다음: ${target.name}`; } } }
function onWatchError(err){ setStatus('danger','오류'); $('#eta-remaining').textContent='GPS 오류: '+err.message; }
function setStatus(level,text){ const icon=$('#status-icon'); icon.className=`badge ${level==='ok'?'ok':level==='warn'?'warn':'danger'}`; icon.textContent=level==='ok'?'정상':level==='warn'?'경고':'위험'; if(text) $('#eta-remaining').textContent=text; }
function haversine(a,b){ const R=6371e3; const toRad=x=>x*Math.PI/180; const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng); const la1=toRad(a.lat), la2=toRad(b.lat); const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
function categoryIcon(type){ const colors={ tourist_attraction:'#f97316', restaurant:'#22c55e', cafe:'#eab308', lodging:'#38bdf8', shopping_mall:'#a855f7', airport:'#ef4444', park:'#10b981', museum:'#fb7185', default:'#4f8cff' }; const c=colors[type]||colors.default; return { path:'M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8zm0 10.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 7.5 12 7.5s2.5 1.12 2.5 2.5S13.38 12.5 12 12.5z', fillColor:c, fillOpacity:1, strokeColor:'#0b0f19', strokeWeight:1.5, scale:1.2, anchor:new google.maps.Point(12,24)}; }

// 현재 영업중 여부(현재 시각 기준). getDetails(opening_hours.isOpen) 사용. 캐시됨.
function getOpenNow(placeId){ if(openStatusCache.has(placeId)) return Promise.resolve(openStatusCache.get(placeId)); return new Promise(res=>{ places.getDetails({ placeId, fields:['opening_hours']}, (p,st)=>{ if(st!==google.maps.places.PlacesServiceStatus.OK || !p?.opening_hours){ openStatusCache.set(placeId,null); res(null); return;} const v = typeof p.opening_hours.isOpen==='function' ? !!p.opening_hours.isOpen() : null; openStatusCache.set(placeId, v); res(v); }); }); }

window.initMap = initMap;

// 환승 제한 자동 조정: 체류시간 비율 축소 → 초과 시 뒤에서부터 제외
async function adjustToLayover(route){
  // 이동시간 합(복귀 포함) 계산
  let move=0; let from=originPlace.location; const moves=[];
  for(const it of route){ const [sec]=await matrixDurations(from,[it.location],'TRANSIT'); const m=Math.round((sec||0)/60); moves.push(m); move+=m; from=it.location; }
  if(route.length){ const [sec2]=await matrixDurations(from,[originPlace.location],'TRANSIT'); const m2=Math.round((sec2||0)/60); moves.push(m2); move+=m2; }

  let stays = route.map(r=>r.stay||60);
  const limit = state.layoverMinutes;
  const initialTotal = move + stays.reduce((a,b)=>a+b,0);
  const info = { adjusted:false, changed:[], dropped:[] };
  if(initialTotal <= limit){ return { adjusted: route.map((r,i)=>({...r, stay:stays[i]})), info } }

  const availableForStay = Math.max(0, limit - move);
  if(availableForStay <= 0){ info.dropped = route.map(r=>r.name); return { adjusted: [], info }; }

  const sumStay = stays.reduce((a,b)=>a+b,0);
  let scale = availableForStay / sumStay; const minStay = 15;
  let newStays = stays.map(s=> Math.max(minStay, Math.floor(s*scale)) );
  let total = move + newStays.reduce((a,b)=>a+b,0);
  if(total > limit){
    // 뒤에서부터 목적지 제거하며 재계산
    const kept=[]; const keptStays=[];
    for(let i=0;i<route.length;i++){ kept.push(route[i]); keptStays.push(newStays[i]); }
    while(kept.length && (move + keptStays.reduce((a,b)=>a+b,0)) > limit){ const removed=kept.pop(); keptStays.pop(); info.dropped.push(removed.name);
      from = kept.length? kept[kept.length-1].location : originPlace.location;
      const [secBack]=await matrixDurations(from,[originPlace.location],'TRANSIT'); const backMin=Math.round((secBack||0)/60);
      move = moves.slice(0, kept.length).reduce((a,b)=>a+b,0) + backMin;
    }
    route = kept; newStays = keptStays; total = move + newStays.reduce((a,b)=>a+b,0);
  }
  route.forEach((r,i)=>{ if(stays[i]!==newStays[i]){ info.changed.push({name:r.name, before:stays[i], after:newStays[i]}); info.adjusted=true; } });
  const adjusted = route.map((r,i)=>({...r, stay:newStays[i]}));
  return { adjusted, info };
}

// 여행 버튼 토글 상태 관리
function toggleTripButtons(state){
  const actions = $('#trip-actions');
  const pauseBtn = $('#pause-trip');
  const resumeBtn = $('#resume-trip');
  if(state==='running'){
    actions.classList.remove('hidden');
    pauseBtn.classList.remove('hidden');
    resumeBtn.classList.add('hidden');
  } else if(state==='paused'){
    actions.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    resumeBtn.classList.remove('hidden');
  } else if(state==='ended'){
    actions.classList.add('hidden');
    pauseBtn.classList.add('hidden');
    resumeBtn.classList.add('hidden');
  }
}
