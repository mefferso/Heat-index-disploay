const NDFD_URL = 'https://mapservices.weather.noaa.gov/raster/rest/services/NDFD/NDFD_temp/MapServer';
const DEFAULT_FORECAST_APT_LAYER = {
  0:{display:46, identify:49},
  3:{display:50, identify:53},
  6:{display:54, identify:57},
  9:{display:58, identify:61},
  12:{display:62, identify:65},
  15:{display:66, identify:69},
  18:{display:70, identify:73},
  21:{display:74, identify:77},
  24:{display:78, identify:81}
};
let forecastAptLayer = {...DEFAULT_FORECAST_APT_LAYER};
const CITIES = [
  ['Baton Rouge',30.4515,-91.1871],['New Orleans',29.9511,-90.0715],['Gulfport',30.3674,-89.0928],['McComb',31.2446,-90.4532],['Woodville',31.1046,-91.2990],['Hammond',30.5044,-90.4612],['Bogalusa',30.7910,-89.8487],['Houma',29.5958,-90.7195]
];
let map, ndfdLayer, cityLayer, stateLayer, countyLayer, cwaHaloLayer, cwaLayer;
let selectedHour = 0;
let activeDisplayLayerId = forecastAptLayer[0].display;
let activeImageLayerId = forecastAptLayer[0].identify;
let playTimer = null;
const forecastBaseTime = new Date();
forecastBaseTime.setMinutes(0,0,0);

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
  setLayerStatus('loading', 'Loading NDFD apparent temperature layer…');
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
    .on('loading', () => setLayerStatus('loading', 'Loading NDFD apparent temperature layer…'))
    .on('load', () => {
      const step = nearestStep(selectedHour);
      setLayerStatus('ready', `NDFD apparent temperature layer loaded (${forecastStatusLabel(step, selectedHour, step === selectedHour)}).`);
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
  return [activeDisplayLayerId, activeImageLayerId].filter(id => id != null);
}

function wireControls(){
  $('forecast-days').addEventListener('click', e => {
    const btn = e.target.closest('button[data-hour]');
    if(!btn) return;
    stopPlayback();
    setForecastHour(Number(btn.dataset.hour));
  });
  $('prev-frame-btn').addEventListener('click', () => { stopPlayback(); stepForecast(-1); });
  $('next-frame-btn').addEventListener('click', () => { stopPlayback(); stepForecast(1); });
  $('opacity-slider').addEventListener('input', e => {
    $('opacity-readout').textContent = `${e.target.value}%`;
    if(ndfdLayer) ndfdLayer.setOpacity(Number(e.target.value)/100);
  });
  $('play-btn').addEventListener('click', togglePlayback);
  $('reset-btn').addEventListener('click', () => map.setView([30.65,-90.25],7));
}

function setForecastHour(hour){
  selectedHour = Number(hour);
  syncForecast();
}

function stepForecast(direction, wrap=false){
  const hours = availableForecastHours();
  const current = nearestStep(selectedHour);
  const currentIndex = Math.max(0, hours.indexOf(current));
  let nextIndex = currentIndex + direction;
  if(wrap){
    nextIndex = (nextIndex + hours.length) % hours.length;
  } else {
    nextIndex = Math.max(0, Math.min(hours.length - 1, nextIndex));
  }
  setForecastHour(hours[nextIndex]);
}

function syncForecast(){
  const requestedHour = selectedHour;
  const step = nearestStep(requestedHour);
  const exactMatch = step === requestedHour;
  const activeLayer = forecastAptLayer[step];
  activeDisplayLayerId = activeLayer?.display;
  activeImageLayerId = activeLayer?.identify;
  const target = validTimeForHour(step);
  const local = formatValidTime(target);
  $('offset-badge').textContent = compactValidTime(target);
  $('hours-display').textContent = forecastTitle(step, requestedHour, exactMatch);
  updateTimeButtonState(step);
  $('local-time').textContent = local;
  $('date-display').textContent = local;

  if(ndfdLayer && activeDisplayLayerId != null && activeImageLayerId != null) {
    setLayerStatus('loading', `Loading NDFD apparent temperature layer (${forecastStatusLabel(step, requestedHour, exactMatch)})…`);
    ndfdLayer.setLayers(activeRasterLayers());
    ndfdLayer.bringToFront();
  } else {
    setLayerStatus('error', 'No NDFD apparent temperature layer is available for this forecast hour.');
    console.error('No NDFD apparent temperature layer ids found for forecast hour:', {requestedHour, resolvedHour:step, forecastAptLayer});
  }
  bringOverlaysToFront();
  refreshCityValues();
}

function availableForecastHours(){
  return Object.keys(forecastAptLayer).map(Number).sort((a,b) => a-b);
}
function nearestStep(hour){
  const availableHours = availableForecastHours();
  return availableHours.reduce((best, step) => Math.abs(step-hour) < Math.abs(best-hour) ? step : best, availableHours[0]);
}
function forecastTitle(step, requestedHour, exactMatch){
  const label = compactValidTime(validTimeForHour(step));
  return exactMatch ? `Valid ${label}` : `Nearest Available: ${label}`;
}
function forecastStatusLabel(step, requestedHour, exactMatch){
  const label = formatValidTime(validTimeForHour(step));
  return exactMatch ? label : `${label}, nearest available`;
}
function updateTimeButtonState(step){
  document.querySelectorAll('.forecast-time-btn').forEach(btn => {
    btn.classList.toggle('selected', Number(btn.dataset.hour) === step);
  });
}
function validTimeForHour(hour){
  return new Date(forecastBaseTime.getTime() + hour*3600*1000);
}
function formatValidTime(date){
  return date.toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
}
function compactValidTime(date){
  const day = dayLabel(date);
  return `${day} ${timeButtonLabel(date)}`;
}
function dayKey(date){
  return date.toLocaleDateString(undefined,{year:'numeric',month:'2-digit',day:'2-digit'});
}
function dayLabel(date){
  return dayKey(date) === dayKey(new Date()) ? 'Today' : date.toLocaleDateString(undefined,{weekday:'short'});
}
function timeButtonLabel(date){
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if(minutes === 0 && hours === 0) return 'Midnight';
  if(minutes === 0 && hours === 12) return 'Noon';
  return date.toLocaleTimeString(undefined,{hour:'numeric',minute:minutes ? '2-digit' : undefined});
}
function renderForecastControls(){
  const container = $('forecast-days');
  if(!container) return;
  container.innerHTML = '';
  const groups = new Map();
  for(const hour of availableForecastHours()){
    const validTime = validTimeForHour(hour);
    const key = dayKey(validTime);
    if(!groups.has(key)) groups.set(key, {label:dayLabel(validTime), items:[]});
    groups.get(key).items.push({hour, validTime});
  }
  for(const group of groups.values()){
    const dayEl = document.createElement('div');
    dayEl.className = 'forecast-day-group';
    const header = document.createElement('div');
    header.className = 'forecast-day-label';
    header.textContent = group.label;
    const times = document.createElement('div');
    times.className = 'forecast-time-row';
    for(const item of group.items){
      const btn = document.createElement('button');
      btn.className = 'forecast-time-btn';
      btn.type = 'button';
      btn.dataset.hour = String(item.hour);
      btn.title = formatValidTime(item.validTime);
      btn.textContent = timeButtonLabel(item.validTime);
      times.appendChild(btn);
    }
    dayEl.append(header, times);
    container.appendChild(dayEl);
  }
  updateTimeButtonState(nearestStep(selectedHour));
}

async function loadForecastLayers(){
  try{
    const metadata = await fetchJson(`${NDFD_URL}?f=pjson`);
    const discovered = discoverApparentTemperatureImageLayers(metadata.layers || []);
    if(Object.keys(discovered).length){
      forecastAptLayer = discovered;
      renderForecastControls();
      syncForecast();
      return;
    }
    console.warn('No apparent temperature image layers were discovered in NDFD metadata; using fallback layer ids.', metadata);
  }catch(err){
    console.warn('Could not load NDFD layer metadata; using fallback apparent temperature layer ids.', err);
  }
  forecastAptLayer = {...DEFAULT_FORECAST_APT_LAYER};
  renderForecastControls();
  syncForecast();
}
function discoverApparentTemperatureImageLayers(layers){
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  return layers.reduce((acc, layer) => {
    const groupMatch = /^AptTemp_(\d{2})Hr$/i.exec(layer.name || '');
    if(!groupMatch) return acc;

    const imageChild = (layer.subLayerIds || [])
      .map(id => byId.get(id))
      .find(child => /^Image$/i.test(child?.name || ''));
    if(imageChild){
      acc[Number(groupMatch[1])] = {display:layer.id, identify:imageChild.id};
    }
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
      style:{color:'#f8fafc',weight:1,opacity:.58,fillOpacity:0}
    }).addTo(map);
    cwaHaloLayer = L.geoJSON(cwa, {
      interactive:false,
      pane:'cwa-boundary-pane',
      style:{color:'#020617',weight:7,opacity:.82,fillOpacity:0,lineJoin:'round'}
    }).addTo(map);
    cwaLayer = L.geoJSON(cwa, {
      interactive:false,
      pane:'cwa-boundary-pane',
      style:{color:'#fbbf24',weight:3,opacity:.96,fillOpacity:0,lineJoin:'round'}
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
  console.error('NDFD apparent temperature layer failed to load:', err);
  setLayerStatus('error', 'NDFD apparent temperature layer failed to load. See console for details.');
  toast('NDFD apparent temperature layer failed to load.');
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
    L.popup().setLatLng(latlng).setContent(`<div class="popup-meta">NDFD Apparent Temp</div><div class="popup-value">${val.toFixed(1)}°F</div><div class="popup-meta">Valid: ${formatValidTime(validTimeForHour(nearestStep(selectedHour)))}</div>`).openOn(map);
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
