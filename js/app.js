const NDFD_URL = 'https://mapservices.weather.noaa.gov/raster/rest/services/NDFD/NDFD_temp/MapServer';

// NDFD daily max temperature layers are daily forecast containers. When a named
// daily layer is a parent group, the actual colored raster that ArcGIS exports is
// its child layer named "Image". Display and identify should both target the
// image layer so the exported raster and sampled values stay in sync.
const DEFAULT_DAILY_MAX_LAYER = {
  1: { display: 127, identify: 127 },
  2: { display: 131, identify: 131 },
  3: { display: 135, identify: 135 }
};
let dailyMaxLayer = {...DEFAULT_DAILY_MAX_LAYER};
const CITIES = [
  ['Baton Rouge', 30.5332, -91.1496], // KBTR
  ['New Orleans', 29.9934, -90.2580], // KMSY, not KNEW
  ['Gulfport',    30.4073, -89.0701], // KGPT
  ['McComb',      31.1785, -90.4719], // KMCB
  ['Woodville',   31.1046, -91.2990], // keep existing point
  ['Hammond',     30.5217, -90.4183], // KHDC
  ['Bogalusa',    30.8137, -89.8650], // KBXA
  ['Houma',       29.5665, -90.6604]  // KHUM
];
let map, ndfdLayer, cityLayer, stateLayer, countyLayer, cwaHaloLayer, cwaLayer;
let selectedDay = 1;
let activeDisplayLayerId = dailyMaxLayer[1].display;
let activeImageLayerId = dailyMaxLayer[1].identify;
let playTimer = null;
const forecastBaseDate = new Date();
forecastBaseDate.setHours(0,0,0,0);

const $ = id => document.getElementById(id);
const cityId = name => `city-val-${name.replace(/\s+/g,'-')}`;
window.addEventListener('DOMContentLoaded', init);

function createMapPane(name, zIndex){
  map.createPane(name);
  const pane = map.getPane(name);
  pane.style.zIndex = zIndex;
  pane.style.pointerEvents = 'none';
}

function init(){
  map = L.map('map', {center:[30.65,-90.25], zoom:7, zoomControl:false});
  createMapPane('ndfd-raster-pane', 350);
  createMapPane('county-boundary-pane', 430);
  createMapPane('cwa-boundary-pane', 460);
  setLayerStatus('loading', 'Loading daily max layer...');
  L.control.zoom({position:'topleft'}).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution:'© OpenStreetMap contributors © CARTO, NOAA/NWS', maxZoom:19
  }).addTo(map);

  ndfdLayer = L.esri.dynamicMapLayer({
    url:NDFD_URL,
    layers:activeRasterLayers(),
    opacity:0.80,
    pane:'ndfd-raster-pane',
    format:'png32',
    transparent:true,
    useCors:false,
    disableCache:true
  })
    .on('loading', () => setLayerStatus('loading', 'Loading daily max layer...'))
    .on('load', () => {
      const day = nearestDay(selectedDay);
      setLayerStatus('ready', `NDFD daily max temperature layer loaded (${forecastStatusLabel(day, selectedDay, day === selectedDay)}).`);
      bringOverlaysToFront();
    })
    .on('requesterror', handleNdfdLayerError)
    .addTo(map);

  loadForecastLayers();
  loadBoundaries();
  addCityLabels();
  wireControls();
  renderForecastControls();
  syncForecast();
  map.on('click', e => inspectPoint(e.latlng));
}

function activeRasterLayers(){
  return [activeDisplayLayerId].filter(id => id != null);
}

function wireControls(){
  $('forecast-days').addEventListener('click', e => {
    const btn = e.target.closest('button[data-day]');
    if(!btn) return;
    stopPlayback();
    setForecastDay(Number(btn.dataset.day));
  });
  $('prev-frame-btn').addEventListener('click', () => { stopPlayback(); stepForecast(-1); });
  $('next-frame-btn').addEventListener('click', () => { stopPlayback(); stepForecast(1); });
  $('opacity-slider').addEventListener('input', e => {
    $('opacity-readout').textContent = `${e.target.value}%`;
    if(ndfdLayer) ndfdLayer.setOpacity(Number(e.target.value)/100);
  });
  $('play-btn').addEventListener('click', togglePlayback);
}

function setForecastDay(day){
  selectedDay = Number(day);
  syncForecast();
}

function stepForecast(direction, wrap=false){
  const days = availableForecastDays();
  const current = nearestDay(selectedDay);
  const currentIndex = Math.max(0, days.indexOf(current));
  let nextIndex = currentIndex + direction;
  if(wrap){
    nextIndex = (nextIndex + days.length) % days.length;
  } else {
    nextIndex = Math.max(0, Math.min(days.length - 1, nextIndex));
  }
  setForecastDay(days[nextIndex]);
}

function syncForecast(){
  const requestedDay = selectedDay;
  const day = nearestDay(requestedDay);
  const exactMatch = day === requestedDay;
  const activeLayer = dailyMaxLayer[day];
  activeDisplayLayerId = activeLayer?.display;
  activeImageLayerId = activeLayer?.identify;
  const target = validDateForDay(day);
  const local = formatValidDate(target);
  $('offset-badge').textContent = dayLabel(target);
  $('hours-display').textContent = 'Daily Max Forecast';
  updateTimeButtonState(day);
  $('local-time').textContent = exactMatch ? local : `${local} (nearest available)`;

  if(ndfdLayer && activeDisplayLayerId != null && activeImageLayerId != null) {
    setLayerStatus('loading', `Loading NDFD daily max temperature layer (${forecastStatusLabel(day, requestedDay, exactMatch)})...`);
    ndfdLayer.setLayers(activeRasterLayers());
    ndfdLayer.bringToFront();
  } else {
    setLayerStatus('error', 'No NDFD daily max temperature layer is available for this forecast day.');
    console.error('No NDFD daily max temperature layer ids found for forecast day:', {requestedDay, resolvedDay:day, dailyMaxLayer});
  }
  bringOverlaysToFront();
  refreshCityValues();
}

function availableForecastDays(){
  return Object.keys(dailyMaxLayer).map(Number).sort((a,b) => a-b);
}
function nearestDay(day){
  const availableDays = availableForecastDays();
  return availableDays.reduce((best, step) => Math.abs(step-day) < Math.abs(best-day) ? step : best, availableDays[0]);
}
function forecastStatusLabel(day, requestedDay, exactMatch){
  const label = formatValidDate(validDateForDay(day));
  return exactMatch ? label : `${label}, nearest available`;
}
function updateTimeButtonState(day){
  document.querySelectorAll('.forecast-time-btn').forEach(btn => {
    btn.classList.toggle('selected', Number(btn.dataset.day) === day);
  });
}
function validDateForDay(day){
  return new Date(forecastBaseDate.getTime() + (day - 1)*24*3600*1000);
}
function formatValidDate(date){
  return date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
}
function dayKey(date){
  return date.toLocaleDateString(undefined,{year:'numeric',month:'2-digit',day:'2-digit'});
}
function dayLabel(date){
  return dayKey(date) === dayKey(new Date()) ? 'Today' : date.toLocaleDateString(undefined,{weekday:'short'});
}
function renderForecastControls(){
  const container = $('forecast-days');
  if(!container) return;
  container.innerHTML = '';

  const dayEl = document.createElement('div');
  dayEl.className = 'forecast-day-group';
  const header = document.createElement('div');
  header.className = 'forecast-day-label';
  header.textContent = 'Daily Max Forecast';
  const days = document.createElement('div');
  days.className = 'forecast-time-row';

  for(const day of availableForecastDays()){
    const validDate = validDateForDay(day);
    const btn = document.createElement('button');
    btn.className = 'forecast-time-btn';
    btn.type = 'button';
    btn.dataset.day = String(day);
    btn.title = formatValidDate(validDate);
    btn.textContent = dayLabel(validDate);
    days.appendChild(btn);
  }

  dayEl.append(header, days);
  container.appendChild(dayEl);
  updateTimeButtonState(nearestDay(selectedDay));
}

async function loadForecastLayers(){
  try{
    const metadata = await fetchJson(`${NDFD_URL}?f=pjson`);
    const discovered = discoverDailyMaxImageLayers(metadata.layers || []);
    if(Object.keys(discovered).length){
      dailyMaxLayer = {...DEFAULT_DAILY_MAX_LAYER, ...discovered};
      renderForecastControls();
      syncForecast();
      return;
    }
    console.warn('No daily max temperature image layers were discovered in NDFD metadata; using fallback layer ids.', metadata);
  }catch(err){
    console.warn('Could not load NDFD layer metadata; using fallback daily max temperature layer ids.', err);
  }
  dailyMaxLayer = {...DEFAULT_DAILY_MAX_LAYER};
  renderForecastControls();
  syncForecast();
}
function discoverDailyMaxImageLayers(layers){
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  return layers.reduce((acc, layer) => {
    const dayMatch = /^MaxTemp_Day([1-3])$/i.exec(layer.name || '');
    if(!dayMatch) return acc;

    const imageChild = (layer.subLayerIds || [])
      .map(id => byId.get(id))
      .find(child => /^Image$/i.test(child?.name || ''));
    const imageLayer = imageChild || layer;
    acc[Number(dayMatch[1])] = {display:imageLayer.id, identify:imageLayer.id};
    return acc;
  }, {});
}

async function loadBoundaries(){
  try{
    const [states,counties,cwa] = await Promise.all([
      fetchJson('assets/boundaries/lix_states.geojson'),
      fetchJson('assets/boundaries/lix_counties.geojson'),
      fetchJson('assets/boundaries/lix_cwa.geojson')
    ]);
    stateLayer = L.geoJSON(states, {
      interactive:false,
      pane:'county-boundary-pane',
      style:{color:'#e2e8f0',weight:1.1,opacity:.38,dashArray:'6 5',fillOpacity:0}
    }).addTo(map);
    countyLayer = L.geoJSON(counties, {
      interactive:false,
      pane:'county-boundary-pane',
      style:{color:'#f8fafc',weight:.8,opacity:.48,fillOpacity:0}
    }).addTo(map);
    cwaHaloLayer = L.geoJSON(cwa, {
      interactive:false,
      pane:'cwa-boundary-pane',
      style:{color:'#ffffff',weight:5,opacity:.68,fillOpacity:0,lineJoin:'round'}
    }).addTo(map);
    cwaLayer = L.geoJSON(cwa, {
      interactive:false,
      pane:'cwa-boundary-pane',
      style:{color:'#050505',weight:2.6,opacity:.95,fillOpacity:0,lineJoin:'round'}
    }).addTo(map);
    bringOverlaysToFront();
  }catch(err){
    console.error(err);
    toast('Boundary files did not load. Check GitHub Pages asset paths.');
  }
}
async function fetchJson(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function setLayerStatus(type, message){
  const el = $('layer-status');
  if(!el) return;
  el.textContent = message;
  el.className = `layer-status ${type}`;
}
function handleNdfdLayerError(err){
  console.error('NDFD daily max temperature layer failed to load:', err);
  setLayerStatus('error', 'NDFD daily max temperature layer failed to load. See console for details.');
  toast('NDFD daily max temperature layer failed to load.');
}

function bringOverlaysToFront(){
  setTimeout(() => {
    [stateLayer, countyLayer, cwaHaloLayer, cwaLayer, cityLayer].forEach(layer => { if(layer?.bringToFront) layer.bringToFront(); });
  }, 250);
}

function addCityLabels(){
  if(cityLayer) cityLayer.remove();
  cityLayer = L.layerGroup().addTo(map);
  for(const [name,lat,lng] of CITIES){
    L.marker([lat,lng], {
      interactive:false,
      icon:L.divIcon({className:'city-label-marker', html:`<div class="city-label"><div class="city-name">${name}</div><div id="${cityId(name)}" class="city-value">--°F</div></div>`, iconSize:null, iconAnchor:[35,16]})
    }).addTo(cityLayer);
    sampleValue(name, lat, lng, v => { const el=$(cityId(name)); if(el) el.textContent = Number.isFinite(v) ? `${Math.round(v)}°F` : 'N/A'; });
  }
  bringOverlaysToFront();
}
function refreshCityValues(){ if(cityLayer) addCityLabels(); }

function sampleValue(name, lat, lng, callback){
  L.esri.identifyFeatures({url:NDFD_URL}).on(map).at(L.latLng(lat,lng)).layers(`visible:${activeImageLayerId}`).tolerance(3).run((err, fc) => {
    if(err || !fc?.features?.length) return callback(NaN);
    callback(extractValue(fc.features[0].properties || {}));
  });
}
function extractValue(props){
  for(const key of ['Pixel Value','value','Value','ST_TEMP','ST_APPT','temp','apparent']){
    const v = parseFloat(props[key]);
    if(Number.isFinite(v) && v > -100 && v < 180) return v;
  }
  for(const key in props){
    const v = parseFloat(props[key]);
    if(Number.isFinite(v) && v > -100 && v < 180) return v;
  }
  return NaN;
}

function inspectPoint(latlng){
  $('inspect-empty').classList.add('hidden');
  $('inspect-data').classList.remove('hidden');
  $('inspect-coords').textContent = `LAT: ${latlng.lat.toFixed(4)} | LNG: ${latlng.lng.toFixed(4)}`;
  $('inspect-value').textContent = '--';
  $('inspect-risk').textContent = 'Consulting NDFD database...';
  $('inspect-risk').className = 'risk neutral';
  L.esri.identifyFeatures({url:NDFD_URL}).on(map).at(latlng).layers(`visible:${activeImageLayerId}`).tolerance(3).run((err, fc) => {
    if(err || !fc?.features?.length) return noInspectData();
    const val = extractValue(fc.features[0].properties || {});
    if(!Number.isFinite(val)) return noInspectData();
    const risk = classifyRisk(val);
    $('inspect-value').textContent = `${val.toFixed(1)}°F`;
    $('inspect-risk').textContent = risk.label;
    $('inspect-risk').className = `risk ${risk.cls}`;
    L.popup().setLatLng(latlng).setContent(`<div class="popup-meta">NDFD Daily Max Temperature</div><div class="popup-value">${val.toFixed(1)}°F</div><div class="popup-meta">Valid: ${formatValidDate(validDateForDay(nearestDay(selectedDay)))}</div>`).openOn(map);
  });
}
function noInspectData(){ $('inspect-value').textContent='N/A'; $('inspect-risk').textContent='Outside Forecast Grid'; $('inspect-risk').className='risk neutral'; }
function classifyRisk(t){
  if(t < 80) return {label:'No Alert / Normal Range', cls:'green-risk'};
  if(t < 90) return {label:'NWS Caution Range', cls:'yellow-risk'};
  if(t < 103) return {label:'NWS Extreme Caution', cls:'orange-risk'};
  if(t < 125) return {label:'NWS HEAT DANGER', cls:'red-risk'};
  return {label:'NWS EXTREME HEAT DANGER', cls:'purple-risk'};
}

function togglePlayback(){
  if(playTimer){ stopPlayback(); return; }
  $('play-btn').textContent = 'Ⅱ';
  playTimer = setInterval(() => stepForecast(1, true), 2200);
}
function stopPlayback(){ if(playTimer){ clearInterval(playTimer); playTimer=null; $('play-btn').textContent='▶'; } }

function toast(msg){
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg; $('toast').appendChild(t);
  setTimeout(()=>t.remove(),4000);
}
