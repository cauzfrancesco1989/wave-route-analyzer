
const WORLD_BOUNDS=L.latLngBounds([[-85.05112878,-180],[85.05112878,180]]);
const map=L.map('map',{worldCopyJump:false,continuousWorld:false,maxBounds:WORLD_BOUNDS,maxBoundsViscosity:1,minZoom:2}).setView([35,0],2);

// Keep the viewport wide enough that Leaflet can display only ONE copy of the
// world. At lower zooms the world is narrower than the map and tile grids can
// otherwise appear side-by-side. Recompute after resize.
function enforceSingleWorldZoom(){
  const w=Math.max(256,map.getSize().x||256);
  const required=Math.max(2,Math.ceil(Math.log2(w/256))+1);
  if(map.getMinZoom()!==required)map.setMinZoom(required);
  if(map.getZoom()<required)map.setZoom(required,{animate:false});
}
setTimeout(enforceSingleWorldZoom,0);
window.addEventListener('resize',()=>setTimeout(enforceSingleWorldZoom,0));
const tileOpts={noWrap:true,bounds:WORLD_BOUNDS,attribution:'© OpenStreetMap contributors'};
const osmLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',tileOpts);
const satelliteLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{noWrap:true,bounds:WORLD_BOUNDS,attribution:'Tiles © Esri'});
const satelliteLabels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{noWrap:true,bounds:WORLD_BOUNDS,attribution:'Labels © Esri'});
osmLayer.addTo(map);
const satelliteWithLabels=L.layerGroup([satelliteLayer,satelliteLabels]);
L.control.layers({'Standard':osmLayer,'Satellite':satelliteLayer,'Satellite + Labels':satelliteWithLabels},null,{position:'topright',collapsed:true}).addTo(map);

let routeLayer=null, routeColorLayer=null, originMarker=null, destinationMarker=null, waypointMarkers=[], headingLayer=null, roseMapLayer=null, routeCoords=[], chart=null, roseChart=null, lastRows=[];
let originPoint=[51.9244,4.4777], destinationPoint=[1.3521,103.8198], waypointPoints=[null,null,null];
let splitterDragging=false;
let pickMode=null;
const $=id=>document.getElementById(id);
initSplitter();
function kmToNm(km){return Number(km)*0.539956803;}
function status(s,err=false){$('status').textContent=s;$('status').style.color=err?'#b42318':'#667085';}
function initSplitter(){
  const app=document.querySelector('.app'),resizer=$('resizer');
  if(!app||!resizer)return;
  let startX=0,startW=360;
  const move=e=>{if(!splitterDragging)return;const delta=e.clientX-startX;const w=Math.max(280,Math.min(620,startW+delta));app.style.gridTemplateColumns=`${w}px 7px minmax(400px,1fr)`;map.invalidateSize();};
  const up=()=>{if(!splitterDragging)return;splitterDragging=false;resizer.classList.remove('dragging');document.body.style.cursor='';document.body.style.userSelect='';window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};
  resizer.addEventListener('pointerdown',e=>{if(window.innerWidth<=850)return;splitterDragging=true;startX=e.clientX;startW=$('sidebar').getBoundingClientRect().width;resizer.classList.add('dragging');document.body.style.cursor='col-resize';document.body.style.userSelect='none';resizer.setPointerCapture?.(e.pointerId);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);});
}
function hav(a,b){const R=6371.0088,p=Math.PI/180;const dlat=(b[1]-a[1])*p,dlon=(b[0]-a[0])*p;const x=Math.sin(dlat/2)**2+Math.cos(a[1]*p)*Math.cos(b[1]*p)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function signedAngleDeg(a,b){return ((b-a+540)%360)-180;}
function seaStateClass(relative){const a=Math.abs(relative);if(a<=30)return 'Head seas';if(a<=75)return 'Bow quartering';if(a<105)return 'Beam seas';if(a<=150)return 'Stern quartering';return 'Following seas';}
function bearingDeg(a,b){
  const p=Math.PI/180,lat1=a[1]*p,lat2=b[1]*p;
  let dlon=(b[0]-a[0])*p;
  if(dlon>Math.PI)dlon-=2*Math.PI;
  if(dlon<-Math.PI)dlon+=2*Math.PI;
  const y=Math.sin(dlon)*Math.cos(lat2);
  const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dlon);
  return (Math.atan2(y,x)/p+360)%360;
}
function headingFor(points,i){
  if(points.length<2)return 0;
  if(i===0)return bearingDeg(points[0],points[1]);
  if(i===points.length-1)return bearingDeg(points[i-1],points[i]);
  // Use the direction from the previous sample to the next sample to smooth
  // small bends in the route.
  return bearingDeg(points[i-1],points[i+1]);
}
function hsRouteColor(hs,mode){
  if(!Number.isFinite(hs))return '#1769aa';
  if(mode==='douglas'){
    if(hs===0)return '#313695';
    if(hs<=0.1)return '#4575b4';
    if(hs<=0.5)return '#74add1';
    if(hs<=1.25)return '#00a6ca';
    if(hs<=2.5)return '#1a9850';
    if(hs<=4.0)return '#fee08b';
    if(hs<=6.0)return '#fdae61';
    if(hs<=9.0)return '#f46d43';
    if(hs<=14.0)return '#d73027';
    return '#7f0000';
  }
  // Beaufort is retained as an indicative wind-force correlation, not a wave-height scale.
  if(hs<0.5)return '#2166ac';
  if(hs<1.5)return '#67a9cf';
  if(hs<2.5)return '#1a9850';
  if(hs<4.0)return '#fee08b';
  if(hs<6.0)return '#f46d43';
  return '#a50026';
}
function renderHsLegend(mode){
  const el=$('hsLegend');
  if(mode==='none'){el.hidden=true;el.innerHTML='';return;}
  el.hidden=false;
  if(mode==='douglas'){
    const rows=[
      ['#313695','0','0 m','Calm (glassy)'],['#4575b4','1','0–0.1 m','Calm (rippled)'],['#74add1','2','0.1–0.5 m','Smooth'],['#00a6ca','3','0.5–1.25 m','Slight'],['#1a9850','4','1.25–2.5 m','Moderate'],['#fee08b','5','2.5–4 m','Rough'],['#fdae61','6','4–6 m','Very rough'],['#f46d43','7','6–9 m','High'],['#d73027','8','9–14 m','Very high'],['#7f0000','9','>14 m','Phenomenal']
    ];
    el.innerHTML='<div class="hs-legend-title">Mean Hs (m) · WMO / Douglas Sea State</div>'+rows.map(r=>`<div class="hs-legend-row"><span class="hs-swatch" style="background:${r[0]}"></span><b>${r[2]}</b>&nbsp; · ${r[1]} · ${r[3]}</div>`).join('')+'<div class="hs-legend-note">Classification based directly on wave height. Bounding heights are included in the lower class.</div>';
  }else{
    el.innerHTML='<div class="hs-legend-title">Mean Hs (m) · Beaufort sea-state equivalent</div><div class="hs-legend-row"><span class="hs-swatch" style="background:#2166ac"></span><b>&lt; 0.5</b>&nbsp; · Bft 0–1 · Calm</div><div class="hs-legend-row"><span class="hs-swatch" style="background:#67a9cf"></span><b>0.5 – 1.5</b>&nbsp; · Bft 2–3 · Slight</div><div class="hs-legend-row"><span class="hs-swatch" style="background:#1a9850"></span><b>1.5 – 2.5</b>&nbsp; · Bft 4–5 · Moderate</div><div class="hs-legend-row"><span class="hs-swatch" style="background:#fee08b"></span><b>2.5 – 4.0</b>&nbsp; · Bft 6 · Moderate</div><div class="hs-legend-row"><span class="hs-swatch" style="background:#f46d43"></span><b>4.0 – 6.0</b>&nbsp; · Bft 7–8 · High</div><div class="hs-legend-row"><span class="hs-swatch" style="background:#a50026"></span><b>≥ 6.0</b>&nbsp; · Bft 9–12 · Very high</div><div class="hs-legend-note">Indicative correlation only; Beaufort is a wind-force scale, not a wave-height classification.</div>';
  }
}
function clearRouteColorLayer(){
  if(routeColorLayer){map.removeLayer(routeColorLayer);routeColorLayer=null;}
}
function routeCumulative(coords){
  const segments=(coords.length&&Array.isArray(coords[0][0]))?coords:[coords];
  const out=[]; let total=0;
  for(const seg of segments){
    if(!seg||seg.length<2)continue;
    const pts=[];
    for(let i=0;i<seg.length;i++){
      if(i>0)total+=hav(seg[i-1],seg[i]);
      pts.push({p:seg[i],d:total});
    }
    out.push(pts);
  }
  return out;
}
function meanAtDistance(d,rows){
  if(!rows.length)return NaN;
  if(d<=rows[0].distanceKm)return Number(rows[0].mean);
  if(d>=rows[rows.length-1].distanceKm)return Number(rows[rows.length-1].mean);
  let i=0; while(i<rows.length-2 && rows[i+1].distanceKm<d)i++;
  const a=rows[i],b=rows[i+1],da=Number(a.distanceKm),db=Number(b.distanceKm),ma=Number(a.mean),mb=Number(b.mean);
  if(!Number.isFinite(ma)&&!Number.isFinite(mb))return NaN;
  if(!Number.isFinite(ma))return mb; if(!Number.isFinite(mb))return ma;
  const f=db>da?(d-da)/(db-da):0; return ma+f*(mb-ma);
}
function renderRouteColoring(){
  clearRouteColorLayer();
  const mode=$('routeColorMode').value;
  renderHsLegend(mode);
  if(mode==='none' || !routeCoords.length || !lastRows.length)return;
  routeColorLayer=L.layerGroup().addTo(map);
  const groups=routeCumulative(routeCoords);
  groups.forEach(group=>{
    for(let i=0;i<group.length-1;i++){
      const a=group[i],b=group[i+1],d=(a.d+b.d)/2,hs=meanAtDistance(d,lastRows);
      L.polyline([[a.p[1],a.p[0]],[b.p[1],b.p[0]]],{color:hsRouteColor(hs,mode),weight:6,opacity:.95,lineCap:'round',lineJoin:'round',interactive:false}).addTo(routeColorLayer);
    }
  });
}
function clearHeadingLayer(){
  if(headingLayer){headingLayer.clearLayers();map.removeLayer(headingLayer);}
  headingLayer=null;
}
function clearRoseMapLayer(){
  if(roseMapLayer){roseMapLayer.clearLayers();map.removeLayer(roseMapLayer);}
  roseMapLayer=null;
}
function destroyRose(){if(roseChart){roseChart.destroy();roseChart=null;}}
const roseLabels=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const roseAngles=roseLabels.map((_,i)=>i*22.5);
function relativeCategoryFromAngle(angle){const a=Math.abs(signedAngleDeg(0,angle));if(a<=30)return 'Head seas';if(a<=75)return 'Bow quartering';if(a<105)return 'Beam seas';if(a<=150)return 'Stern quartering';return 'Following seas';}
function polarPoint(cx,cy,r,aDeg){const a=(aDeg-90)*Math.PI/180;return [cx+r*Math.cos(a),cy+r*Math.sin(a)];}
function roseSvgData(r,size=48){
  const bins=Array.isArray(r.waveBins)?r.waveBins.map(Number):Array(16).fill(0);
  const arctic=!!r.isArctic;
  const palette=arctic?['#5b21b6','#6d28d9','#7c3aed','#8b5cf6','#a855f7','#c026d3','#d946ef','#db2777','#be185d','#9d174d','#86198f','#7e22ce','#9333ea','#a21caf','#c026d3','#7c3aed']:['#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed','#2f80ed'];
  const maxBin=Math.max(1,...bins.filter(Number.isFinite));
  const heading=Number.isFinite(r.heading)?r.heading:0;
  const cx=size/2,cy=size/2,ro=size*.43,ri=size*.10;
  const parts=[];
  for(let i=0;i<16;i++){
    const a0=roseAngles[i]-11.25,a1=roseAngles[i]+11.25;
    const p0=polarPoint(cx,cy,ro,a0),p1=polarPoint(cx,cy,ro,a1),q1=polarPoint(cx,cy,ri,a1),q0=polarPoint(cx,cy,ri,a0);
    const opacity=.18+.70*((Number.isFinite(bins[i])?bins[i]:0)/maxBin);
    parts.push(`<path d="M ${q0[0].toFixed(1)} ${q0[1].toFixed(1)} L ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A ${ro.toFixed(1)} ${ro.toFixed(1)} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L ${q1[0].toFixed(1)} ${q1[1].toFixed(1)} Z" fill="${palette[i]}" fill-opacity="${opacity.toFixed(2)}" stroke="#fff" stroke-width=".7"/>`);
  }
  const end=polarPoint(cx,cy,ro*.82,heading), ah=size*.13, aw=size*.065;
  const left=polarPoint(end[0],end[1],ah,heading+150), right=polarPoint(end[0],end[1],ah,heading-150);
  const border=`<circle cx="${cx}" cy="${cy}" r="${ro.toFixed(1)}" fill="rgba(255,255,255,.86)" stroke="#1769aa" stroke-width="1.4"/>`;
  const arrow=`<line x1="${cx}" y1="${cy}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}" stroke="#1769aa" stroke-width="1.8"/><polygon points="${end[0].toFixed(1)},${end[1].toFixed(1)} ${left[0].toFixed(1)},${left[1].toFixed(1)} ${right[0].toFixed(1)},${right[1].toFixed(1)}" fill="#1769aa"/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${border}${parts.join('')}${arrow}</svg>`;
  return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);
}
function renderMapRoses(rows){
  clearRoseMapLayer();
  if(!$('showMapRoses').checked || !rows.length)return;
  roseMapLayer=L.layerGroup().addTo(map);
  rows.forEach((r,i)=>{
    if(!Array.isArray(r.waveBins)||!r.waveBins.some(v=>Number.isFinite(v)&&Number(v)>0))return;
    const icon=L.divIcon({className:'',html:`<div class="map-rose-icon"><img src="${roseSvgData(r,72)}" alt="Wave direction rose"></div>`,iconSize:[72,72],iconAnchor:[36,36]});
    const marker=L.marker([r.lat,r.lon],{icon,interactive:true,zIndexOffset:250});
    marker.bindTooltip(`<b>Route point ${i+1}</b><br>Vessel heading: ${Number.isFinite(r.heading)?r.heading.toFixed(0)+'°':'—'}<br>Mean Hs: ${Number.isFinite(r.mean)?r.mean.toFixed(2)+' m':'—'}<br>${r.isArctic?'<span style="color:#7c3aed"><b>Arctic wave product</b></span><br>':''}<span style="color:#1769aa"><b>Click to inspect direction distribution</b></span>`,{direction:'top',sticky:true});
    marker.on('click',()=>selectRosePoint(r,i));
    marker.addTo(roseMapLayer);
  });
}
function renderHeadingArrows(rows){
  clearHeadingLayer();
  // When map roses are displayed, hide the vessel shuttle markers to avoid visual overlap.
  if($('showMapRoses').checked || !$('showHeading').checked || rows.length<2)return;
  headingLayer=L.layerGroup().addTo(map);
  rows.forEach((r,i)=>{
    if(!Number.isFinite(r.heading))return;
    const icon=L.divIcon({className:'',html:`<div class="boat-icon" style="transform:rotate(${r.heading}deg)"></div>`,iconSize:[14,28],iconAnchor:[7,14]});
    const marker=L.marker([r.lat,r.lon],{icon,interactive:true,zIndexOffset:300});
    marker.bindTooltip(`<b>Route point ${i+1}</b><br>Vessel heading: ${r.heading.toFixed(0)}°<br>Distance: ${kmToNm(r.distanceKm).toFixed(0)} NM<br>Mean Hs: ${Number.isFinite(r.mean)?r.mean.toFixed(2)+' m':'—'}<br>P95 Hs: ${Number.isFinite(r.p95)?r.p95.toFixed(2)+' m':'—'}<br><span style="color:#1769aa"><b>Click to inspect wave direction distribution</b></span>`,{direction:'top',sticky:true});
    marker.on('click',()=>selectRosePoint(r,i));
    marker.addTo(headingLayer);
  });
}
function selectRosePoint(r,index){
  $('directionSubtitle').textContent=`Point ${index+1}/${lastRows.length} · ${kmToNm(r.distanceKm).toFixed(0)} NM · ${r.lat.toFixed(3)}°, ${r.lon.toFixed(3)}°${r.isArctic?' · ARCTIC':''}`;
  $('directionEmpty').hidden=true;
  $('directionContent').hidden=false;
  $('directionMean').textContent=Number.isFinite(r.mean)?r.mean.toFixed(2)+' m':'—';
  $('directionP95').textContent=Number.isFinite(r.p95)?r.p95.toFixed(2)+' m':'—';
  $('directionMax').textContent=Number.isFinite(r.max)?r.max.toFixed(2)+' m':'—';
  $('directionHeading').textContent=Number.isFinite(r.heading)?r.heading.toFixed(0)+'°':'—';
  const bins=Array.isArray(r.waveBins)?r.waveBins.map(Number):Array(16).fill(0);
  const total=bins.reduce((a,b)=>a+(Number.isFinite(b)?b:0),0);
  const maxBin=Math.max(1,...bins);
  const arctic=!!r.isArctic;
  const rosePalette=arctic?['#5b21b6','#6d28d9','#7c3aed','#8b5cf6','#a855f7','#c026d3','#d946ef','#db2777','#be185d','#9d174d','#86198f','#7e22ce','#9333ea','#a21caf','#c026d3','#7c3aed']:null;
  destroyRose();
  const heading=Number.isFinite(r.heading)?r.heading:0;
  const headingPlugin={id:'vesselHeading',afterDraw(chart){const {ctx,chartArea}=chart;const cx=(chartArea.left+chartArea.right)/2,cy=(chartArea.top+chartArea.bottom)/2;const rr=Math.min(chartArea.right-chartArea.left,chartArea.bottom-chartArea.top)*.42;const a=heading*Math.PI/180;const ex=cx+Math.sin(a)*rr,ey=cy-Math.cos(a)*rr;ctx.save();ctx.strokeStyle='#1769aa';ctx.fillStyle='#1769aa';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ex,ey);ctx.stroke();const ah=9,aw=4;ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-Math.sin(a)*ah+Math.cos(a)*aw,ey+Math.cos(a)*ah+Math.sin(a)*aw);ctx.lineTo(ex-Math.sin(a)*ah-Math.cos(a)*aw,ey+Math.cos(a)*ah-Math.sin(a)*aw);ctx.closePath();ctx.fill();ctx.restore();}};
  roseChart=new Chart($('roseChart'),{type:'polarArea',plugins:[headingPlugin],data:{labels:roseLabels,datasets:[{data:bins,backgroundColor:roseLabels.map((_,i)=>{const alpha=.28+.52*(bins[i]/maxBin);const c=rosePalette?rosePalette[i]:'#2f80ed'; const rgb=c.match(/#(..)(..)(..)/); const rr=parseInt(rgb[1],16),gg=parseInt(rgb[2],16),bb=parseInt(rgb[3],16); return `rgba(${rr},${gg},${bb},${alpha.toFixed(2)})`}),borderColor:'#fff',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:200},scales:{r:{beginAtZero:true,ticks:{display:false},grid:{circular:true},angleLines:{display:true},pointLabels:{display:true,font:{size:10,weight:'700'}}}},plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>{const n=Number(ctx.raw||0),pct=total?100*n/total:0;return `${roseLabels[ctx.dataIndex]}: ${n.toLocaleString()} obs (${pct.toFixed(1)}%)`;},title:()=>`Waves FROM`}}}}});
  const relCounts={'Head seas':0,'Bow quartering':0,'Beam seas':0,'Stern quartering':0,'Following seas':0};
  bins.forEach((n,i)=>{const cat=relativeCategoryFromAngle(signedAngleDeg(heading,roseAngles[i]));relCounts[cat]+=n;});
  const order=['Head seas','Bow quartering','Beam seas','Stern quartering','Following seas'];
  $('directionLegend').innerHTML=order.map(k=>`<div><b>${total?(100*relCounts[k]/total).toFixed(0):0}%</b>${k}</div>`).join('');
  $('directionCard').scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('showHeading').addEventListener('change',()=>{renderHeadingArrows(lastRows);});
$('showMapRoses').addEventListener('change',()=>{renderMapRoses(lastRows);renderHeadingArrows(lastRows);});

const searchState={origin:{results:[],query:''},destination:{results:[],query:''}};
function closeSearchResults(which){$(which+'Results').classList.remove('open');$(which+'Results').innerHTML='';}
function formatSearchResult(x){const p=x.properties||{};const parts=[p.city,p.state,p.country].filter(Boolean);const key=p.osm_key||'';const value=p.osm_value||p.type||'';const kind=value||key||'location';return {name:p.name||p.label||'Unnamed location',context:parts.join(', '),kind,marine:['harbour','harbor','port','marina','pier','dock','quay'].includes(String(value).toLowerCase()),lon:Number(x.geometry?.coordinates?.[0]),lat:Number(x.geometry?.coordinates?.[1])};}
function renderSearchResults(which,items){const box=$(which+'Results');if(!items.length){box.innerHTML='<div class="search-result"><b>No suitable locations found</b><span>Try a port name, coastal city or country.</span></div>';box.classList.add('open');return;}box.innerHTML=items.map((x,i)=>`<div class="search-result" data-index="${i}"><b>${escapeHtml(x.name)}</b><span>${escapeHtml([x.marine?'Port / harbour':x.kind,x.context].filter(Boolean).join(' · '))}</span></div>`).join('');box.classList.add('open');box.querySelectorAll('.search-result[data-index]').forEach(el=>el.onclick=()=>selectSearchResult(which,Number(el.dataset.index)));}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function selectSearchResult(which,i){const item=searchState[which].results[i];if(!item)return;const p=[item.lat,item.lon];if(which==='origin'){setOrigin(p);}else{setDest(p);}map.setView(p,Math.max(map.getZoom(),6));$(which+'Search').value=item.name;$(which+'SearchStatus').textContent=`Selected: ${item.name} — pin remains draggable.`;closeSearchResults(which);status(`${which==='origin'?'Origin':'Destination'} selected from search. You can still drag the pin or use Pick on map.`);}
async function searchCoastal(which){const input=$(which+'Search'),statusEl=$(which+'SearchStatus'),q=input.value.trim();if(q.length<2){statusEl.textContent='Enter at least 2 characters.';return;}statusEl.textContent='Searching ports and coastal locations…';closeSearchResults(which);try{const r=await fetch(`/api/geocode?q=${encodeURIComponent(q)}`,{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j.error||`Search HTTP ${r.status}`);const items=(j.features||[]).map(formatSearchResult).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));searchState[which].results=items;searchState[which].query=q;renderSearchResults(which,items);statusEl.textContent=items.length?`${items.length} result${items.length===1?'':'s'} — select one to place the pin.`:'No results.';}catch(e){statusEl.textContent=e.message||'Search failed.';}}
$('searchOrigin').onclick=()=>searchCoastal('origin');$('searchDestination').onclick=()=>searchCoastal('destination');
$('originSearch').addEventListener('keydown',e=>{if(e.key==='Enter')searchCoastal('origin');});$('destinationSearch').addEventListener('keydown',e=>{if(e.key==='Enter')searchCoastal('destination');});
document.addEventListener('click',e=>{if(!e.target.closest('.search-block')){closeSearchResults('origin');closeSearchResults('destination');}});

function setOrigin(p){originPoint=[Number(p[0]),Number(p[1])];updateMarker('origin');invalidateRoute('Origin updated. Calculate the maritime route again.');}
function setDest(p){destinationPoint=[Number(p[0]),Number(p[1])];updateMarker('destination');invalidateRoute('Destination updated. Calculate the maritime route again.');}
function setWaypoint(i,p){waypointPoints[i-1]=[Number(p[0]),Number(p[1])];updateWaypointMarker(i);invalidateRoute(`Waypoint ${i} updated. Calculate the maritime route again.`);}
function waypointPoint(i){return waypointPoints[i-1] || null;}
function clearWaypointMarkers(){waypointMarkers.forEach(m=>{if(m)map.removeLayer(m)});waypointMarkers=[];}
function updateWaypointMarker(i){
  const old=waypointMarkers[i-1];if(old){map.removeLayer(old);waypointMarkers[i-1]=null;}
  const p=waypointPoint(i);if(!p)return;
  const m=L.marker(p,{draggable:true}).addTo(map).bindTooltip(`Waypoint ${i}`);
  m.on('dragend',e=>{const q=e.target.getLatLng();setWaypoint(i,[q.lat,q.lng]);});
  waypointMarkers[i-1]=m;
}
function updateMarker(which){
  if(which==='origin'){
    if(originMarker)map.removeLayer(originMarker);
    originMarker=L.marker(originPoint,{draggable:true}).addTo(map).bindTooltip('Origin');
    originMarker.on('dragend',e=>{const q=e.target.getLatLng();setOrigin([q.lat,q.lng]);$('originSearchStatus').textContent='Pin manually moved — search result remains only as a label.';});
  }else{
    if(destinationMarker)map.removeLayer(destinationMarker);
    destinationMarker=L.marker(destinationPoint,{draggable:true}).addTo(map).bindTooltip('Destination');
    destinationMarker.on('dragend',e=>{const q=e.target.getLatLng();setDest([q.lat,q.lng]);$('destinationSearchStatus').textContent='Pin manually moved — search result remains only as a label.';});
  }
}
function invalidateRoute(msg){
  routeCoords=[];lastRows=[];$('waves').disabled=true;$('csv').disabled=true;
  if(routeLayer){map.removeLayer(routeLayer);routeLayer=null;} clearRouteColorLayer(); renderRouteColoring(); clearHeadingLayer(); clearRoseMapLayer(); destroyRose(); $('directionEmpty').hidden=false; $('directionContent').hidden=true; $('directionSubtitle').textContent='Select a vessel heading or wave-rose point on the map.';
  $('dist').textContent='—';$('npts').textContent='—';
  $('mean').textContent='—';$('median').textContent='—';$('max').textContent='—';$('p95').textContent='—';$('p99').textContent='—';
  if(chart){chart.destroy();chart=null;}
  status(msg);
}

function activatePick(mode){
  pickMode=mode;
  $('pickOrigin').classList.toggle('active',mode==='origin');
  $('pickDestination').classList.toggle('active',mode==='destination');
  document.querySelectorAll('.wpPick').forEach(b=>b.classList.toggle('active',mode===`waypoint${b.dataset.wp}`));
  map.getContainer().classList.toggle('pick-mode',!!mode);
  $('pickhelp').textContent=mode==='origin'?'Now click the origin location on the map.':mode==='destination'?'Now click the destination location on the map.':mode?.startsWith('waypoint')?`Now click the location for ${mode.replace('waypoint','Waypoint ')}.`:'Select a route-point button, then click the map.';
}
$('routeColorMode').onchange=()=>renderRouteColoring();
$('pickOrigin').onclick=()=>activatePick('origin');
$('pickDestination').onclick=()=>activatePick('destination');
document.querySelectorAll('.wpPick').forEach(b=>b.onclick=()=>activatePick(`waypoint${b.dataset.wp}`));
map.on('click',e=>{
  if(!pickMode)return;
  const p=[e.latlng.lat,e.latlng.lng];
  if(pickMode==='origin'){setOrigin(p);status('Origin selected on map.');}
  else if(pickMode==='destination'){setDest(p);status('Destination selected on map.');}
  else if(pickMode.startsWith('waypoint')){const i=Number(pickMode.replace('waypoint',''));setWaypoint(i,p);status(`Waypoint ${i} selected on map.`);}
  activatePick(null);
});

updateMarker('origin');updateMarker('destination');for(let i=1;i<=3;i++)updateWaypointMarker(i);

async function getRoute(){
  const startPoint=originPoint;
  const endPoint=destinationPoint;
  const waypoints=[];
  for(let i=1;i<=3;i++){const p=waypointPoint(i);if(p)waypoints.push({i,p});}
  const sequence=[{name:'Origin',p:startPoint},...waypoints.map(x=>({name:`Waypoint ${x.i}`,p:x.p})),{name:'Destination',p:endPoint}];
  for(const x of sequence){if(!Number.isFinite(x.p[0])||!Number.isFinite(x.p[1]))throw new Error(`Please enter valid coordinates for ${x.name}.`);if(Math.abs(x.p[0])>90||Math.abs(x.p[1])>180)throw new Error(`Invalid coordinates for ${x.name}.`);}
  status('Loading maritime routing network...');
  let seaRoute,lastImportError=null,routeEngine='';
  const moduleUrls=['https://cdn.jsdelivr.net/npm/searoute-ts@2.3.0/+esm','https://unpkg.com/searoute-ts@2.3.0/dist/esm/index.js','https://esm.sh/searoute-ts@2.3.0'];
  for(const url of moduleUrls){try{const mod=await import(url);if(typeof mod.seaRoute==='function'){seaRoute=mod.seaRoute;routeEngine=url;break;}lastImportError=new Error('Module loaded but seaRoute export was not found.');}catch(e){lastImportError=e;}}
  if(typeof seaRoute!=='function')throw new Error('Could not load the maritime routing engine.'+(lastImportError?.message?` (${lastImportError.message})`:''));
  const restrictions=[];if($('avoidSuez').checked)restrictions.push('suez');if($('avoidPanama').checked)restrictions.push('panama');
  const allowArctic=$('allowArctic').checked;
  const segments=[];let totalDistanceKm=0;
  for(let i=0;i<sequence.length-1;i++){
    status(`Calculating maritime leg ${i+1}/${sequence.length-1}: ${sequence[i].name} → ${sequence[i+1].name}...`);
    const a=sequence[i].p,b=sequence[i+1].p;
    const result=seaRoute([a[1],a[0]],[b[1],b[0]],{units:'kilometers',appendOriginDestination:true,returnPassages:true,maxSnapDistanceKm:250,antimeridian:'split',allowArctic,restrictions});
    if(!result||!result.geometry)throw new Error(`No maritime route was found for ${sequence[i].name} → ${sequence[i+1].name}.`);
    let segs=result.geometry.type==='MultiLineString'?result.geometry.coordinates:[result.geometry.coordinates];
    segs=segs.filter(x=>Array.isArray(x)&&x.length>=2);
    segments.push(...segs);
    totalDistanceKm+=Number(result.properties?.length||0)+Number(result.properties?.originSnapKm||0)+Number(result.properties?.destinationSnapKm||0);
  }
  if(!segments.length)throw new Error('No maritime route geometry was returned.');
  const geometry=segments.length===1?{type:'LineString',coordinates:segments[0]}:{type:'MultiLineString',coordinates:segments};
  return {geometry,distanceKm:totalDistanceKm,totalDistanceKm,routeEngine,restrictions,waypointCount:waypoints.length,allowArctic};
}

$('route').onclick=async()=>{
  $('route').disabled=true;$('waves').disabled=true;status('Starting maritime route calculation...');
  try{
    const r=await getRoute();routeCoords=r.geometry.coordinates;
    if(routeLayer)map.removeLayer(routeLayer);
    routeLayer=L.geoJSON({type:'Feature',geometry:r.geometry},{style:{weight:4,color:'#1769aa',opacity:.8}}).addTo(map); clearRouteColorLayer(); renderRouteColoring();
    updateMarker('origin');updateMarker('destination');for(let i=1;i<=3;i++)updateWaypointMarker(i);
    fitRouteSingleWorld(r.geometry);
    $('dist').textContent=kmToNm(r.totalDistanceKm).toFixed(0)+' NM';
    $('npts').textContent=r.geometry.type==='MultiLineString'?r.geometry.coordinates.reduce((n,x)=>n+x.length,0):r.geometry.coordinates.length;
    $('restrictions').textContent=r.restrictions.length?r.restrictions.join(', '):'None';
    status(`Maritime route calculated successfully. ${kmToNm(r.totalDistanceKm).toFixed(0)} NM total with ${r.waypointCount} intermediate waypoint${r.waypointCount===1?'':'s'}.`+(r.restrictions.length?` Avoided: ${r.restrictions.join(', ')}.`:'')+(r.allowArctic?' Arctic passages enabled; no sea-ice model is applied.':''));
    $('waves').disabled=false;
  }catch(e){console.error(e);status(e.message||'Route calculation failed.',true);}finally{$('route').disabled=false;}
};

function fitRouteSingleWorld(geometry){
  const groups=geometry.type==='MultiLineString'?geometry.coordinates:[geometry.coordinates];
  const pts=[];
  for(const seg of groups)for(const p of seg||[])if(Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1]))pts.push(p);
  if(!pts.length)return;

  // Find the smallest longitude interval containing the route. This avoids
  // treating +179° and -179° as 358° apart when the route crosses the
  // antimeridian.
  const lons=pts.map(p=>((p[0]+180)%360+360)%360-180).sort((a,b)=>a-b);
  let bestStart=lons[0],bestSpan=360;
  for(let i=0;i<lons.length;i++){
    const a=lons[i], b=i===lons.length-1?lons[0]+360:lons[i+1];
    const gap=b-a;
    const span=360-gap;
    if(span<bestSpan){bestSpan=span;bestStart=b%360; if(bestStart>180)bestStart-=360;}
  }
  const end=bestStart+bestSpan;
  const centerLon=((bestStart+end)/2+540)%360-180;
  const minLat=Math.max(-85.05112878,Math.min(...pts.map(p=>p[1])));
  const maxLat=Math.min(85.05112878,Math.max(...pts.map(p=>p[1])));

  if(bestSpan>180){
    map.setView([Math.max(-80,Math.min(80,(minLat+maxLat)/2)),centerLon],Math.max(2,map.getMinZoom()),{animate:false});
    return;
  }

  // For normal routes Leaflet's bounds are safe. For an antimeridian route,
  // use the calculated center and a conservative zoom so the route remains
  // on the single displayed world.
  if(bestStart<-180||end>180||Math.abs(end-bestStart)>170){
    const z=Math.max(2,map.getMinZoom(),bestSpan<60?3:2);
    map.setView([Math.max(-80,Math.min(80,(minLat+maxLat)/2)),centerLon],z,{animate:false});
  }else{
    map.fitBounds(L.latLngBounds([[minLat,bestStart],[maxLat,end]]),{padding:[20,20],maxZoom:7});
  }
}
function sampleLine(coords,count){
  // Preserve MultiLineString breaks returned by searoute-ts. In particular,
  // an antimeridian-split Arctic route must NEVER be interpolated from +180°
  // to -180° as if those were neighbouring longitudes on the same segment.
  const segments=(coords.length&&Array.isArray(coords[0][0]))?coords:[coords];
  const usable=[];
  let total=0;
  for(const segment of segments){
    if(!Array.isArray(segment)||segment.length<2)continue;
    let length=0;
    const cumulative=[0];
    for(let k=0;k<segment.length-1;k++){
      length+=hav(segment[k],segment[k+1]);
      cumulative.push(length);
    }
    if(length>0){
      usable.push({segment,cumulative,start:total,length,end:total+length});
      total+=length;
    }
  }
  if(!usable.length)return {points:[],dist:[]};
  const n=Math.max(2,Math.min(100,Number(count)||30));
  const points=[],dist=[];
  for(let j=0;j<n;j++){
    const target=(j===n-1)?total:total*j/(n-1);
    let item=usable[usable.length-1];
    for(const candidate of usable){
      if(target<=candidate.end+1e-9){item=candidate;break;}
    }
    const local=Math.max(0,Math.min(item.length,target-item.start));
    let k=0;
    while(k<item.cumulative.length-2 && item.cumulative[k+1]<local)k++;
    const d0=item.cumulative[k],d1=item.cumulative[k+1];
    const a=item.segment[k],b=item.segment[k+1];
    const f=d1>d0?(local-d0)/(d1-d0):0;
    points.push([a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])]);
    dist.push(target);
  }
  return {points,dist};
}
async function fetchHs(points,start,end,season){
  const r=await fetch('/api/hs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({points:points.map(p=>({lon:Number(p.lon),lat:Number(p.lat)})),start:start.toISOString(),end:end.toISOString(),season})});
  const text=await r.text();let j={};try{j=JSON.parse(text)}catch(e){}
  if(!r.ok)throw new Error(j.error||`Wave API HTTP ${r.status}`);
  if(!Array.isArray(j.points))throw new Error('Copernicus API returned no point results.');
  return j;
}
function dates(period){
  const DATA_START=new Date('1980-01-01T00:00:00Z'),DATA_END=new Date('2026-05-31T21:00:00Z');let end=new Date();if(end>DATA_END)end=new Date(DATA_END);const start=new Date(end);const key=period.replace('m','').replace('y','');const days={3:90,6:182,1:365,5:1826,10:3652,20:7305}[key]||90;start.setUTCDate(start.getUTCDate()-days);if(start<DATA_START)start.setTime(DATA_START.getTime());return {start,end};}
function stat(a){if(!a.length)return null;a=[...a].filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const q=p=>a[Math.min(a.length-1,Math.floor(p*(a.length-1)))];return {mean:a.reduce((x,y)=>x+y,0)/a.length,median:q(.5),max:a[a.length-1],p95:q(.95),p99:q(.99)};}
function renderDebug(rows){
  const good=rows.filter(r=>Number.isFinite(r.mean));
  let html=`<div><b>${good.length}/${rows.length}</b> route points with valid Hs. Backend sample counts are full 3-hourly observations used for the statistics.</div>`;
  html+='<table><thead><tr><th>#</th><th>Dist NM</th><th>Heading</th><th>Mean wave from</th><th>Δθ</th><th>Sea state</th><th>n</th><th>season n</th><th>Mean</th><th>P95</th><th>Max</th><th>Wave source</th></tr></thead><tbody>';
  rows.forEach((r,i)=>{html+=`<tr title="${String(r.error||'').replace(/"/g,'&quot;')}"><td>${i+1}</td><td>${kmToNm(r.distanceKm).toFixed(0)}</td><td>${Number.isFinite(r.heading)?r.heading.toFixed(0)+'°':'—'}</td><td>${Number.isFinite(r.waveFrom)?r.waveFrom.toFixed(0)+'°':'—'}</td><td>${Number.isFinite(r.relativeAngle)?(r.relativeAngle>0?'+':'')+r.relativeAngle.toFixed(0)+'°':'—'}</td><td>${r.seaState||'—'}</td><td>${r.count??'—'}</td><td>${r.seasonCount||'—'}</td><td>${Number.isFinite(r.mean)?r.mean.toFixed(2):'—'}</td><td>${Number.isFinite(r.p95)?r.p95.toFixed(2):'—'}</td><td>${Number.isFinite(r.max)?r.max.toFixed(2):'—'}</td><td>${r.dataSource||'—'}</td></tr>`;});
  html+='</tbody></table>'; $('debug').innerHTML=html;
}
$('waves').onclick=async()=>{
  if(!routeCoords.length)return;$('waves').disabled=true;$('csv').disabled=true;status('Sampling the route and requesting historical wave data...');
  try{
    const sm=sampleLine(routeCoords,Number($('sampleCount').value)),{start,end}=dates($('period').value);
    const selected=sm.points.map((p,idx)=>({idx,lon:p[0],lat:p[1]}));
    const season=$('season').value;
    const seasonLabel=$('season').selectedOptions[0].textContent;
    status(`Requesting Copernicus VHM0 for ${selected.length} route points (${seasonLabel})...`);
    const response=await fetchHs(selected,start,end,season),results=response.points;
    if(results.length!==selected.length)throw new Error(`Copernicus returned ${results.length} points for ${selected.length} requested points.`);
    const rows=[];
    for(let i=0;i<selected.length;i++){
      const p=selected[i],h=results[i]||{};
      const heading=headingFor(sm.points,i);
      const waveFrom=Number.isFinite(Number(h.wave_from_deg))?Number(h.wave_from_deg):NaN;
      const relativeAngle=Number.isFinite(waveFrom)?signedAngleDeg(heading,waveFrom):NaN;
      rows.push({lon:p.lon,lat:p.lat,distanceKm:sm.dist[p.idx],heading,waveFrom,relativeAngle,seaState:Number.isFinite(relativeAngle)?seaStateClass(relativeAngle):'',count:Number(h.count||0),waveCount:Number(h.wave_direction_count||0),waveBins:Array.isArray(h.wave_direction_bins)?h.wave_direction_bins.map(Number):Array(16).fill(0),rawCount:Number(h.raw_count||0),seasonCount:Number(h.season_count||0),seasonName:h.season_name||'',dataSource:h.data_source||'—',isArctic:Boolean(h.is_arctic),mean:Number(h.mean),median:Number(h.median),max:Number(h.max),p95:Number(h.p95),p99:Number(h.p99),error:h.error||''});
    }
    lastRows=rows;renderDebug(rows);renderHeadingArrows(rows);renderMapRoses(rows);renderRouteColoring();
    const validRows=rows.filter(r=>Number.isFinite(r.mean));
    if(!validRows.length){
      const firstError=rows.find(r=>r.error)?.error || 'Copernicus returned no valid VHM0 values.';
      throw new Error(firstError);
    }
    const sMean=stat(validRows.map(r=>r.mean)),sMedian=stat(validRows.map(r=>r.median)),sMax=stat(validRows.map(r=>r.max)),sP95=stat(validRows.map(r=>r.p95)),sP99=stat(validRows.map(r=>r.p99));
    $('mean').textContent=sMean? sMean.mean.toFixed(2)+' m':'—';
    $('median').textContent=sMedian? sMedian.median.toFixed(2)+' m':'—';
    $('max').textContent=sMax? sMax.max.toFixed(2)+' m':'—';
    $('p95').textContent=sP95? sP95.p95.toFixed(2)+' m':'—';
    $('p99').textContent=sP99? sP99.p99.toFixed(2)+' m':'—';
    draw(rows);$('csv').disabled=false;const seasonInfo=season==='all'?'All seasons':`${seasonLabel} — same months retained in every year of the selected period`;
    status(`Completed ${rows.length} sampled points. Historical Hs + wave-direction distribution (VMDR) from Copernicus Marine. Arctic points use the dedicated Arctic wave product when applicable. Click a vessel symbol to open the directional rose. ${seasonInfo}.`);
  }catch(e){console.error(e);status(e.message||'Historical Hs calculation failed.',true);}finally{$('waves').disabled=false;}
};
function draw(rows){if(chart)chart.destroy();chart=new Chart($('chart'),{type:'line',data:{labels:rows.map(r=>kmToNm(r.distanceKm).toFixed(0)),datasets:[{label:'Mean Hs',data:rows.map(r=>r.mean),borderWidth:2,pointRadius:2,tension:.15},{label:'P95 Hs',data:rows.map(r=>r.p95),borderWidth:1,pointRadius:1,borderDash:[5,5],tension:.15}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{title:{display:true,text:'Distance (NM)'}},y:{title:{display:true,text:'Hs (m)'},beginAtZero:true}}}});}
$('csv').onclick=()=>{const head='lon,lat,distance_nm,heading_deg,wave_mean_from_deg,relative_wave_angle_deg,sea_state,observations,wave_direction_observations,wave_direction_bins_N_to_NNW,wave_source,is_arctic,mean_hs_m,median_hs_m,max_hs_m,p95_hs_m,p99_hs_m\n';const body=lastRows.map(r=>[r.lon,r.lat,kmToNm(r.distanceKm),r.heading,r.waveFrom,r.relativeAngle,r.seaState,r.count,r.waveCount,`\"${(r.waveBins||[]).join('|')}\"`,r.dataSource,r.isArctic,r.mean,r.median,r.max,r.p95,r.p99].join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([head+body],{type:'text/csv'}));a.download='wave_route_v3_17.csv';a.click();};
