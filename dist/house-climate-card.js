/**
 * House Climate Card – a Home Assistant dashboard card that sums up the indoor
 * climate of the whole house: CO₂ per room, temperature and humidity ranges,
 * and hints on when airing helps.
 * https://github.com/yannick80/ha-house-climate-card
 *
 * Plain custom element, no build step and no dependencies. Sensors are found
 * through the areas of the entity and device registry and their device_class,
 * so the card needs no configuration at all.
 */

(function () {
"use strict";

const VERSION = "0.2.0";

const METRICS = ["temperature", "humidity", "co2"];
const DEVICE_CLASS = { temperature: "temperature", humidity: "humidity", carbon_dioxide: "co2" };

// Area names (and area_ids) treated as outdoors instead of as a room
const OUTDOOR_RE = /(au(ß|ss)en|outdoor|outside|exterior|garten|garden|terrasse|terrace|balkon|balcony|patio|hof\b|yard)/i;

// Temperature sensors that don't measure room air: heating circuits, appliances,
// chips. Matched against entity_id, name, friendly_name and translation_key.
const TECHNICAL_RE = new RegExp([
  "vorlauf", "r(ü|ue)cklauf", "flow", "return", "supply", "boiler", "kessel", "puffer", "buffer",
  "warmwasser", "hot.?water", "dhw", "heizkreis", "heating.?circuit", "solar",
  "cavity", "garraum", "core", "kern", "backofen", "oven", "dampfgar", "steam", "herd", "stove",
  "kaffee", "coffee", "espresso", "br(ü|ue)h", "brew", "milch", "milk",
  "k(ü|ue)hlschrank", "fridge", "refrigerator", "gefrier", "freezer",
  "aquarium", "pool", "sauna", "spa\\b", "target", "setpoint", "soll",
  "cpu", "chip", "processor", "soc\\b", "device.?temp", "ger(ä|ae)tetemp", "intern", "battery", "akku",
].join("|"), "i");

// Integrations whose temperature sensors belong to appliances
const TECHNICAL_PLATFORMS = ["miele_lan", "miele", "home_connect", "smartthings_appliance"];

// ... unless the name says it is indoors after all (no lookbehind: old Safari)
const INDOOR_RE = /(wintergarten|winter.?garden|conservatory|sunroom|innenhof)/i;

const DEFAULTS = {
  co2: [1000, 2000], // German UBA guide values: fine / conspicuous / unacceptable
  humidity: [40, 60], // comfort band
  humidity_dry: 30,
  humidity_mold: 70,
  dehumidify_margin: 1, // g/m³ the outside air must be drier for airing to help
  trend_minutes: 30,
  trend_ppm: 100,
};

const STRINGS = {
  de: {
    title: "Hausklima",
    temperature: "Temperatur",
    humidity: "Luftfeuchte",
    co2: "CO₂",
    outdoor: "außen",
    all_good: "Alles im grünen Bereich",
    air_one: "{r} lüften",
    air_many: "{n} Räume lüften",
    check: "Prüfen",
    no_rooms: "Keine Klimasensoren in Bereichen gefunden. Weise Temperatur-, Feuchte- oder CO₂-Sensoren einem Bereich zu.",
    hint_air: "Lüften: {r}",
    hint_dehumidify: "Lüften entfeuchtet: außen {o} g/m³, innen {i} g/m³ ({r})",
    hint_no_dehumidify: "Lüften entfeuchtet gerade nicht: außen {o} g/m³, innen {i} g/m³ ({r})",
    hint_mold: "Schimmelgefahr: {r}",
    hint_dry: "Sehr trockene Luft: {r}",
    rest_one: "1 weiterer Raum unauffällig",
    rest_many: "{n} weitere Räume unauffällig",
    trend_up: "steigt",
    trend_down: "fällt",
    editor: {
      title: "Titel",
      areas: "Nur diese Bereiche (leer = alle)",
      exclude_areas: "Bereiche ausblenden",
      exclude_entities: "Sensoren ignorieren",
      outdoor: "Außensensoren oder Wetter-Entität (leer = automatisch)",
      auto_exclude: "Technische Temperatursensoren ausblenden",
      outdoor_area: "Außenbereich",
      show_trend: "CO₂-Trend anzeigen",
      only_issues: "Nur auffällige Räume anzeigen",
    },
  },
  en: {
    title: "Indoor climate",
    temperature: "Temperature",
    humidity: "Humidity",
    co2: "CO₂",
    outdoor: "outside",
    all_good: "All good",
    air_one: "Air the {r}",
    air_many: "Air {n} rooms",
    check: "Check",
    no_rooms: "No climate sensors found in any area. Assign temperature, humidity or CO₂ sensors to an area.",
    hint_air: "Open a window: {r}",
    hint_dehumidify: "Airing dries the air: outside {o} g/m³, inside {i} g/m³ ({r})",
    hint_no_dehumidify: "Airing won't dry the air right now: outside {o} g/m³, inside {i} g/m³ ({r})",
    hint_mold: "Mold risk: {r}",
    hint_dry: "Very dry air: {r}",
    rest_one: "1 more room is fine",
    rest_many: "{n} more rooms are fine",
    trend_up: "rising",
    trend_down: "falling",
    editor: {
      title: "Title",
      areas: "Only these areas (empty = all)",
      exclude_areas: "Hide areas",
      exclude_entities: "Ignore sensors",
      outdoor: "Outdoor sensors or weather entity (empty = automatic)",
      auto_exclude: "Hide technical temperature sensors",
      outdoor_area: "Outdoor area",
      show_trend: "Show CO₂ trend",
      only_issues: "Only show rooms that need attention",
    },
  },
};

function langOf(hass) {
  const l = (hass && ((hass.locale && hass.locale.language) || hass.language)) || "en";
  return String(l).toLowerCase();
}

function strings(hass) {
  return STRINGS[langOf(hass).split("-")[0]] || STRINGS.en;
}

function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? values[k] : m));
}

function list(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

// ------------------------------------------------------------ physics

function toCelsius(value, unit) {
  return unit === "°F" ? ((value - 32) * 5) / 9 : value;
}

function fromCelsius(value, unit) {
  return unit === "°F" ? (value * 9) / 5 + 32 : value;
}

// Absolute humidity in g/m³ (Magnus formula, accurate to ~0.1 g/m³ for -30…50 °C)
function absoluteHumidity(tempC, rh) {
  if (!isFinite(tempC) || !isFinite(rh)) return NaN;
  const sat = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5)); // hPa
  return (sat * rh * 2.1674) / (273.15 + tempC);
}

function levelCo2(ppm, th) {
  if (!isFinite(ppm)) return "none";
  if (ppm >= th.co2[1]) return "bad";
  if (ppm >= th.co2[0]) return "warn";
  return "good";
}

function levelHumidity(rh, th) {
  if (!isFinite(rh)) return "none";
  if (rh >= th.humidity_mold || rh < th.humidity_dry) return "bad";
  if (rh > th.humidity[1] || rh < th.humidity[0]) return "warn";
  return "good";
}

const RANK = { none: 0, good: 1, warn: 2, bad: 3 };

function worst(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

function thresholds(config) {
  const th = { ...DEFAULTS };
  const user = (config && config.thresholds) || {};
  for (const k of Object.keys(DEFAULTS)) {
    if (user[k] !== undefined) th[k] = user[k];
  }
  return th;
}

// ------------------------------------------------------------ discovery

function numericState(hass, entityId) {
  const st = hass.states && hass.states[entityId];
  if (!st) return NaN;
  const v = parseFloat(st.state);
  return isFinite(v) ? v : NaN;
}

function metricOf(hass, entityId) {
  if (entityId.indexOf("sensor.") !== 0) return undefined;
  const st = hass.states && hass.states[entityId];
  const dc = st && st.attributes && st.attributes.device_class;
  return DEVICE_CLASS[dc];
}

// Why a sensor is skipped as not measuring room air, or "" if it is fine
function technicalReason(hass, id, ent) {
  if (TECHNICAL_PLATFORMS.indexOf(ent.platform) >= 0) return "platform";
  const st = hass.states && hass.states[id];
  const text = [id, ent.name, ent.translation_key, st && st.attributes && st.attributes.friendly_name]
    .filter(Boolean)
    .join(" ");
  return TECHNICAL_RE.test(text) ? "name" : "";
}

function areaOfEntity(hass, ent) {
  if (ent.area_id) return ent.area_id;
  const dev = ent.device_id && hass.devices ? hass.devices[ent.device_id] : undefined;
  return dev ? dev.area_id : undefined;
}

function isOutdoorArea(hass, areaId) {
  const area = hass.areas && hass.areas[areaId];
  const text = `${areaId} ${(area && area.name) || ""}`;
  return OUTDOOR_RE.test(text) && !INDOOR_RE.test(text);
}

// Groups all usable climate sensors by area. Returns
// { rooms: [{ id, name, temperature: [ids], humidity: [ids], co2: [ids] }], outdoor: {...} }
function discover(hass, config) {
  const only = list(config.areas);
  const hideAreas = new Set(list(config.exclude_areas));
  const hideEnts = new Set(list(config.exclude_entities));
  const outdoorArea = config.outdoor_area;
  const byArea = {};
  const outdoor = { temperature: [], humidity: [], co2: [] };

  const ents = hass.entities || {};
  for (const id of Object.keys(ents)) {
    const ent = ents[id];
    if (!ent || hideEnts.has(id)) continue;
    // Diagnostic sensors (chip temperature of a plug, ...) and hidden ones are not room climate
    if (ent.entity_category || ent.hidden || ent.hidden_by) continue;
    const metric = metricOf(hass, id);
    if (!metric) continue;
    if (metric === "temperature" && config.auto_exclude !== false && technicalReason(hass, id, ent)) continue;
    const areaId = areaOfEntity(hass, ent);
    if (!areaId) continue;

    // Outdoor areas are never rooms, unless listed in `areas` on purpose.
    // With `outdoor_area`, only that one gives the outdoor values.
    const listed = only.indexOf(areaId) >= 0;
    const isOutdoor = areaId === outdoorArea || (!listed && isOutdoorArea(hass, areaId));
    if (isOutdoor) {
      if (!outdoorArea || areaId === outdoorArea) outdoor[metric].push(id);
      continue;
    }
    if (hideAreas.has(areaId) || (only.length && only.indexOf(areaId) < 0)) continue;
    if (!byArea[areaId]) {
      const area = hass.areas && hass.areas[areaId];
      byArea[areaId] = { id: areaId, name: (area && area.name) || areaId, temperature: [], humidity: [], co2: [] };
    }
    byArea[areaId][metric].push(id);
  }

  let rooms = Object.keys(byArea).map((k) => byArea[k]);
  if (only.length) rooms.sort((a, b) => only.indexOf(a.id) - only.indexOf(b.id));
  return { rooms, outdoor };
}

function mean(values) {
  const v = values.filter((x) => isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

function max(values) {
  const v = values.filter((x) => isFinite(x));
  return v.length ? Math.max.apply(null, v) : NaN;
}

function tempC(hass, id) {
  const st = hass.states[id];
  return toCelsius(numericState(hass, id), st && st.attributes && st.attributes.unit_of_measurement);
}

// Current readings of one room: mean temperature and humidity, highest CO₂
function readRoom(hass, room, th) {
  const t = mean(room.temperature.map((id) => tempC(hass, id)));
  const h = mean(room.humidity.map((id) => numericState(hass, id)));
  const co2Values = room.co2.map((id) => numericState(hass, id));
  const c = max(co2Values);
  const co2Entity = room.co2[co2Values.indexOf(c)] || room.co2[0];
  const co2Level = levelCo2(c, th);
  const humLevel = levelHumidity(h, th);
  return {
    id: room.id,
    name: room.name,
    temperature: t,
    humidity: h,
    co2: c,
    abs: absoluteHumidity(t, h),
    co2Level,
    humLevel,
    level: worst(co2Level, humLevel),
    entity: co2Entity || room.humidity[0] || room.temperature[0],
    entities: room,
  };
}

// Outdoor values: the sensors or weather entity chosen in `outdoor`, else all
// sensors of the outdoor area(s), else the first weather entity. A weather
// entity only fills in what the chosen sensors don't measure.
function readOutdoor(hass, config, found) {
  const chosen = list(config.outdoor);
  let weather;
  if (chosen.length) {
    found = { temperature: [], humidity: [], co2: [] };
    for (const id of chosen) {
      if (String(id).indexOf("weather.") === 0) {
        if (!weather) weather = id;
        continue;
      }
      const metric = metricOf(hass, id);
      if (metric) found[metric].push(id);
    }
  } else {
    weather = Object.keys(hass.states || {}).filter((e) => e.indexOf("weather.") === 0).sort()[0];
  }
  let t = mean(found.temperature.map((e) => tempC(hass, e)));
  let h = mean(found.humidity.map((e) => numericState(hass, e)));
  let entity = found.temperature[0] || found.humidity[0];
  const w = weather && (!isFinite(t) || !isFinite(h)) ? readWeather(hass, weather) : undefined;
  if (w) {
    if (!isFinite(t)) t = w.temperature;
    if (!isFinite(h)) h = w.humidity;
    if (!entity) entity = weather;
  }
  if (!isFinite(t) && !isFinite(h)) return undefined;
  return { temperature: t, humidity: h, abs: absoluteHumidity(t, h), entity };
}

function readWeather(hass, id) {
  const st = hass.states[id];
  if (!st || !st.attributes) return undefined;
  const a = st.attributes;
  const t = toCelsius(parseFloat(a.temperature), a.temperature_unit);
  const h = parseFloat(a.humidity);
  if (!isFinite(t) && !isFinite(h)) return undefined;
  return { temperature: t, humidity: h, abs: absoluteHumidity(t, h), entity: id };
}

// Everything the card shows, independent of the DOM
function analyse(hass, config, trends) {
  const th = thresholds(config);
  const found = discover(hass, config);
  const rooms = found.rooms.map((r) => readRoom(hass, r, th));
  const outdoor = readOutdoor(hass, config, found.outdoor);

  for (const r of rooms) r.trend = trends && r.entities.co2.length ? trends[r.entity] : undefined;

  const extreme = (key, pick) => {
    const withValue = rooms.filter((r) => isFinite(r[key]));
    if (!withValue.length) return undefined;
    return withValue.reduce((a, b) => (pick(b[key], a[key]) ? b : a));
  };
  const range = (key) => {
    const lo = extreme(key, (x, y) => x < y);
    const hi = extreme(key, (x, y) => x > y);
    return lo ? { min: lo[key], max: hi[key], minRoom: lo, maxRoom: hi } : undefined;
  };

  const airCo2 = rooms.filter((r) => r.co2Level === "warn" || r.co2Level === "bad");
  const humid = rooms.filter((r) => isFinite(r.humidity) && r.humidity > th.humidity[1] && isFinite(r.abs));
  const dehumidifies = (r) => outdoor && isFinite(outdoor.abs) && outdoor.abs <= r.abs - th.dehumidify_margin;
  const airHumid = humid.filter(dehumidifies);
  const air = airCo2.concat(airHumid.filter((r) => airCo2.indexOf(r) < 0));

  const hints = [];
  const names = (rs) => rs.map((r) => r.name).join(", ");
  if (airCo2.length) hints.push({ kind: "air", rooms: airCo2 });
  if (humid.length && outdoor && isFinite(outdoor.abs)) {
    const ref = humid.reduce((a, b) => (b.abs > a.abs ? b : a));
    hints.push({
      kind: dehumidifies(ref) ? "dehumidify" : "no_dehumidify",
      rooms: dehumidifies(ref) ? airHumid : humid,
      outside: outdoor.abs,
      inside: ref.abs,
    });
  }
  const mold = rooms.filter((r) => r.humidity >= th.humidity_mold);
  if (mold.length) hints.push({ kind: "mold", rooms: mold });
  const dry = rooms.filter((r) => r.humidity < th.humidity_dry);
  if (dry.length) hints.push({ kind: "dry", rooms: dry });
  for (const h of hints) h.names = names(h.rooms);

  const overall = rooms.reduce((acc, r) => worst(acc, r.level), "none");

  const sorted = rooms.slice().sort((a, b) => {
    if (RANK[b.level] !== RANK[a.level]) return RANK[b.level] - RANK[a.level];
    const cb = isFinite(b.co2) ? b.co2 : -1;
    const ca = isFinite(a.co2) ? a.co2 : -1;
    if (cb !== ca) return cb - ca;
    return a.name.localeCompare(b.name);
  });

  return {
    rooms: sorted,
    outdoor,
    temperature: range("temperature"),
    humidity: range("humidity"),
    air,
    hints,
    overall,
    thresholds: th,
  };
}

// CO₂ change over the trend window, from the recorder history
function trendFromHistory(states, windowStart, current, th) {
  if (!states || !states.length || !isFinite(current)) return undefined;
  let past;
  for (const s of states) {
    const ts = s.lu !== undefined ? s.lu * 1000 : Date.parse(s.last_updated || s.last_changed);
    const v = parseFloat(s.s !== undefined ? s.s : s.state);
    if (!isFinite(v)) continue;
    if (ts <= windowStart || past === undefined) past = v;
    if (ts > windowStart) break;
  }
  if (past === undefined) return undefined;
  const delta = current - past;
  if (delta >= th.trend_ppm) return "up";
  if (delta <= -th.trend_ppm) return "down";
  return "flat";
}

// ------------------------------------------------------------ DOM helpers

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name, cls) {
  const i = el("ha-icon", cls);
  i.setAttribute("icon", name);
  return i;
}

const STYLE = `
  :host { display: block; }
  ha-card { padding: 14px 16px 12px; overflow: hidden; }
  .warning { color: var(--error-color, #db4437); }
  .hint-empty { color: var(--secondary-text-color); font-size: 14px; line-height: 1.5; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .title { display: flex; align-items: center; font-size: 16px; font-weight: 500; color: var(--primary-text-color); min-width: 0; }
  .title ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); margin-right: 8px; }
  .badge { font-size: 12px; padding: 3px 10px; border-radius: 10px; white-space: nowrap; margin-left: 8px;
    background: rgba(127,127,127,0.15); color: var(--secondary-text-color); }
  .badge.good { background: rgba(76,175,80,0.15); background: color-mix(in srgb, var(--hc-good) 15%, transparent); color: var(--hc-good); }
  .badge.warn { background: rgba(255,152,0,0.18); background: color-mix(in srgb, var(--hc-warn) 18%, transparent); color: var(--hc-warn); }
  .badge.bad { background: rgba(244,67,54,0.15); background: color-mix(in srgb, var(--hc-bad) 15%, transparent); color: var(--hc-bad); }
  .tiles { display: flex; margin: 0 -5px 12px; }
  .tile { flex: 1 1 0; min-width: 0; margin: 0 5px; padding: 9px 11px; border-radius: 10px; cursor: pointer;
    background: rgba(127,127,127,0.08); background: color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
  .tile-label { display: flex; align-items: center; font-size: 12px; color: var(--secondary-text-color); }
  .tile-label ha-icon { --mdc-icon-size: 15px; margin-right: 4px; }
  .tile-value { font-size: 19px; font-weight: 500; color: var(--primary-text-color); margin-top: 2px; white-space: nowrap; }
  .tile-sub { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .scale { position: relative; height: 6px; border-radius: 3px; margin-top: 7px; background: rgba(127,127,127,0.2); }
  .band { position: absolute; top: 0; height: 6px; border-radius: 3px; background: rgba(76,175,80,0.35);
    background: color-mix(in srgb, var(--hc-good) 35%, transparent); }
  .span { position: absolute; top: 2px; height: 2px; min-width: 2px; background: var(--primary-text-color); }
  .outside { font-size: 12px; color: var(--secondary-text-color); margin: -4px 0 10px; }
  .rooms-label { font-size: 12px; color: var(--secondary-text-color); margin-bottom: 4px; }
  .room { display: flex; align-items: center; padding: 5px 0; cursor: pointer; }
  .room-name { flex: 0 0 38%; min-width: 0; padding-right: 10px; }
  .room-title { font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .room-meta { font-size: 11px; color: var(--secondary-text-color); white-space: nowrap; }
  .room-meta .warn { color: var(--hc-warn); }
  .room-meta .bad { color: var(--hc-bad); }
  .bar { flex: 1 1 auto; height: 8px; border-radius: 4px; background: rgba(127,127,127,0.2); overflow: hidden; }
  .fill { height: 8px; border-radius: 4px; background: var(--hc-good); }
  .fill.warn { background: var(--hc-warn); }
  .fill.bad { background: var(--hc-bad); }
  .ppm { flex: 0 0 74px; text-align: right; font-size: 13px; color: var(--primary-text-color); white-space: nowrap; }
  .ppm ha-icon { --mdc-icon-size: 14px; color: var(--secondary-text-color); margin-left: 2px; vertical-align: -1px; }
  .no-co2 { flex: 1 1 auto; }
  .rooms-rest { font-size: 12px; color: var(--secondary-text-color); padding: 4px 0 2px; }
  .hints { border-top: 1px solid var(--divider-color, rgba(127,127,127,0.25)); margin-top: 8px; padding-top: 8px; }
  .hint { display: flex; align-items: flex-start; font-size: 13px; line-height: 1.45; color: var(--secondary-text-color); padding: 2px 0; }
  .hint ha-icon { --mdc-icon-size: 16px; margin-right: 6px; flex: none; margin-top: 1px; }
  .hint.mold ha-icon, .hint.dry ha-icon { color: var(--hc-warn); }
`;

const HINT_ICONS = {
  air: "mdi:window-open-variant",
  dehumidify: "mdi:weather-windy",
  no_dehumidify: "mdi:water-alert-outline",
  mold: "mdi:alert-outline",
  dry: "mdi:water-off-outline",
};

// ------------------------------------------------------------ card

class HouseClimateCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("house-climate-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._signature = "";
    this._trends = {};
    this._trendFetched = 0;
  }

  setConfig(config) {
    if (config === null || config === undefined) config = {};
    if (typeof config !== "object") throw new Error("Invalid configuration");
    for (const k of ["areas", "exclude_areas", "exclude_entities", "outdoor"]) {
      if (config[k] !== undefined && typeof config[k] !== "string" && !Array.isArray(config[k])) {
        throw new Error(`'${k}' must be a list`);
      }
    }
    if (config.thresholds !== undefined && (typeof config.thresholds !== "object" || Array.isArray(config.thresholds))) {
      throw new Error("'thresholds' must be a mapping");
    }
    this._config = { ...config };
    this._signature = "";
    if (this._hass) this._safeUpdate();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._safeUpdate();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 3 + (this._roomCount || 0);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  getLayoutOptions() {
    return { grid_columns: 4, grid_rows: "auto" };
  }

  connectedCallback() {
    this._timer = setInterval(() => {
      if (this._hass && this._config) this._maybeFetchTrends(true);
    }, 5 * 60000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  _safeUpdate() {
    try {
      this._update();
    } catch (e) {
      console.error("house-climate-card: render failed", e);
      this._showMessage(`house-climate-card: ${(e && e.message) || e}`, "warning");
    }
  }

  _update() {
    const data = analyse(this._hass, this._config, this._config.show_trend === false ? undefined : this._trends);
    this._data = data;
    this._roomCount = data.rooms.length;
    const sig = JSON.stringify([
      langOf(this._hass),
      this._config,
      data.rooms.map((r) => [r.id, r.name, r.temperature, r.humidity, r.co2, r.trend, r.level]),
      data.outdoor && [data.outdoor.temperature, data.outdoor.humidity],
      this._unit(),
    ]);
    if (sig !== this._signature) {
      this._signature = sig;
      this._render(data);
    }
    this._maybeFetchTrends(false);
  }

  _unit() {
    const cfg = this._hass && this._hass.config;
    return (cfg && cfg.unit_system && cfg.unit_system.temperature) || "°C";
  }

  _num(value, digits) {
    if (!isFinite(value)) return "–";
    try {
      return new Intl.NumberFormat(langOf(this._hass), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    } catch (e) {
      return value.toFixed(digits);
    }
  }

  _temp(c) {
    return `${this._num(fromCelsius(c, this._unit()), 1)} ${this._unit()}`;
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  _shell() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    const style = el("style");
    style.textContent = STYLE;
    root.appendChild(style);
    const card = el("ha-card");
    card.style.setProperty("--hc-good", "var(--success-color, #43a047)");
    card.style.setProperty("--hc-warn", "var(--warning-color, #ffa600)");
    card.style.setProperty("--hc-bad", "var(--error-color, #db4437)");
    root.appendChild(card);
    return card;
  }

  _showMessage(text, cls) {
    this._signature = "";
    const card = this._shell();
    card.appendChild(el("div", cls, text));
  }

  _render(data) {
    const t = strings(this._hass);
    const th = data.thresholds;
    const card = this._shell();

    // header
    const head = card.appendChild(el("div", "head"));
    const title = head.appendChild(el("div", "title"));
    title.appendChild(icon("mdi:home-thermometer-outline"));
    title.appendChild(el("span", "", this._config.title || t.title));

    if (!data.rooms.length) {
      card.appendChild(el("div", "hint-empty", t.no_rooms));
      return;
    }

    let status;
    if (data.air.length === 1) status = fmt(t.air_one, { r: data.air[0].name });
    else if (data.air.length > 1) status = fmt(t.air_many, { n: data.air.length });
    else if (data.overall === "warn" || data.overall === "bad") status = t.check;
    else status = t.all_good;
    const level = data.air.length ? worst("warn", data.overall) : data.overall;
    head.appendChild(el("span", `badge ${level}`, status));

    // range tiles
    const tiles = el("div", "tiles");
    if (data.temperature) {
      const r = data.temperature;
      tiles.appendChild(
        this._tile("mdi:thermometer", t.temperature,
          `${this._num(fromCelsius(r.min, this._unit()), 1)} – ${this._temp(r.max)}`,
          `${r.minRoom.name} · ${r.maxRoom.name}`, r.maxRoom.entities.temperature[0])
      );
    }
    if (data.humidity) {
      const r = data.humidity;
      const tile = this._tile("mdi:water-percent", t.humidity,
        `${this._num(r.min, 0)} – ${this._num(r.max, 0)} %`,
        `${r.minRoom.name} · ${r.maxRoom.name}`, r.maxRoom.entities.humidity[0]);
      const scale = tile.appendChild(el("div", "scale"));
      const band = scale.appendChild(el("div", "band"));
      band.style.setProperty("left", `${th.humidity[0]}%`);
      band.style.setProperty("width", `${th.humidity[1] - th.humidity[0]}%`);
      const span = scale.appendChild(el("div", "span"));
      span.style.setProperty("left", `${Math.max(0, Math.min(100, r.min))}%`);
      span.style.setProperty("width", `${Math.max(0, Math.min(100, r.max) - Math.max(0, r.min))}%`);
      tiles.appendChild(tile);
    }
    if (tiles.children.length) card.appendChild(tiles);

    if (data.outdoor) {
      const o = data.outdoor;
      const parts = [];
      if (isFinite(o.temperature)) parts.push(this._temp(o.temperature));
      if (isFinite(o.humidity)) parts.push(`${this._num(o.humidity, 0)} %`);
      if (isFinite(o.abs)) parts.push(`${this._num(o.abs, 1)} g/m³`);
      const line = card.appendChild(el("div", "outside", `${t.outdoor}: ${parts.join(" · ")}`));
      line.addEventListener("click", () => this._moreInfo(o.entity));
    }

    // rooms; with only_issues just those with CO₂ or humidity outside the limits
    const shown = this._config.only_issues
      ? data.rooms.filter((r) => r.level === "warn" || r.level === "bad")
      : data.rooms;
    if (shown.length) {
      const hasCo2 = shown.some((r) => isFinite(r.co2));
      card.appendChild(el("div", "rooms-label", hasCo2 ? `${t.co2} · ppm` : ""));
      const scaleMax = Math.max(th.co2[1] * 1.25, max(shown.map((r) => r.co2)));
      for (const r of shown) card.appendChild(this._room(r, t, scaleMax));
    }
    const rest = data.rooms.length - shown.length;
    if (rest) card.appendChild(el("div", "rooms-rest", fmt(rest === 1 ? t.rest_one : t.rest_many, { n: rest })));

    // hints
    if (data.hints.length) {
      const box = card.appendChild(el("div", "hints"));
      for (const h of data.hints) {
        const text = fmt(t[`hint_${h.kind}`], {
          r: h.names,
          o: this._num(h.outside, 1),
          i: this._num(h.inside, 1),
        });
        const row = box.appendChild(el("div", `hint ${h.kind}`));
        row.appendChild(icon(HINT_ICONS[h.kind]));
        row.appendChild(el("span", "", text));
      }
    }
  }

  _tile(iconName, label, value, sub, entity) {
    const tile = el("div", "tile");
    const l = tile.appendChild(el("div", "tile-label"));
    l.appendChild(icon(iconName));
    l.appendChild(el("span", "", label));
    tile.appendChild(el("div", "tile-value", value));
    tile.appendChild(el("div", "tile-sub", sub));
    tile.addEventListener("click", () => this._moreInfo(entity));
    return tile;
  }

  _room(r, t, scaleMax) {
    const row = el("div", `room ${r.level}`);
    const name = row.appendChild(el("div", "room-name"));
    name.appendChild(el("div", "room-title", r.name));
    const meta = name.appendChild(el("div", "room-meta"));
    if (isFinite(r.temperature)) meta.appendChild(el("span", "", this._temp(r.temperature)));
    if (isFinite(r.temperature) && isFinite(r.humidity)) meta.appendChild(el("span", "", " · "));
    if (isFinite(r.humidity)) meta.appendChild(el("span", r.humLevel, `${this._num(r.humidity, 0)} %`));

    if (isFinite(r.co2)) {
      const bar = row.appendChild(el("div", "bar"));
      const fill = bar.appendChild(el("div", `fill ${r.co2Level}`));
      fill.style.setProperty("width", `${Math.round(Math.min(1, r.co2 / scaleMax) * 100)}%`);
      const ppm = row.appendChild(el("div", "ppm", this._num(r.co2, 0)));
      if (r.trend === "up" || r.trend === "down") {
        const i = ppm.appendChild(icon(r.trend === "up" ? "mdi:trending-up" : "mdi:trending-down"));
        i.setAttribute("title", r.trend === "up" ? t.trend_up : t.trend_down);
      }
    } else {
      row.appendChild(el("div", "no-co2"));
    }
    row.addEventListener("click", () => this._moreInfo(r.entity));
    return row;
  }

  // ---------------------------------------------------------------- trends

  async _maybeFetchTrends(force) {
    if (this._config.show_trend === false || this._fetching) return;
    if (!this._hass || typeof this._hass.callWS !== "function" || !this._data) return;
    const now = Date.now();
    if (!force && now - this._trendFetched < 5 * 60000) return;
    const ids = this._data.rooms.filter((r) => r.entities.co2.length).map((r) => r.entity);
    if (!ids.length) return;
    this._fetching = true;
    this._trendFetched = now;
    const th = this._data.thresholds;
    const windowStart = now - th.trend_minutes * 60000;
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(windowStart - 10 * 60000).toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const trends = {};
      for (const id of ids) {
        trends[id] = trendFromHistory(res && res[id], windowStart, numericState(this._hass, id), th);
      }
      this._trends = trends;
      this._safeUpdate();
    } catch (e) {
      console.warn("house-climate-card: history unavailable", e);
    } finally {
      this._fetching = false;
    }
  }
}

// -------------------------------------------------------------------- editor

class HouseClimateCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    this._ensureForm();
  }

  async _ensureForm() {
    if (customElements.get("ha-form")) return;
    // ha-form is loaded lazily by HA; loading the editor of a built-in card pulls it in.
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "button", entity: "sun.sun" });
      if (card && card.constructor && card.constructor.getConfigElement) {
        await card.constructor.getConfigElement();
      }
    } catch (e) {
      /* ignore – the form will appear once ha-form is defined */
    }
    await customElements.whenDefined("ha-form");
    this._render();
  }

  _schema() {
    return [
      { name: "title", selector: { text: {} } },
      { name: "areas", selector: { area: { multiple: true } } },
      { name: "exclude_areas", selector: { area: { multiple: true } } },
      {
        name: "exclude_entities",
        selector: {
          entity: {
            multiple: true,
            filter: [
              { domain: "sensor", device_class: "temperature" },
              { domain: "sensor", device_class: "humidity" },
              { domain: "sensor", device_class: "carbon_dioxide" },
            ],
          },
        },
      },
      {
        name: "outdoor",
        selector: {
          entity: {
            multiple: true,
            filter: [
              { domain: "weather" },
              { domain: "sensor", device_class: "temperature" },
              { domain: "sensor", device_class: "humidity" },
            ],
          },
        },
      },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "only_issues", selector: { boolean: {} } },
          { name: "show_trend", selector: { boolean: {} } },
          { name: "auto_exclude", selector: { boolean: {} } },
        ],
      },
    ];
  }

  _render() {
    if (!this._hass || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => strings(this._hass).editor[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => this._onFormValue(ev.detail.value));
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = this._schema();
    const outdoor = list(this._config.outdoor);
    this._form.data = { show_trend: true, auto_exclude: true, ...this._config, outdoor };
  }

  _onFormValue(value) {
    const config = { ...this._config, ...value };
    for (const k of Object.keys(config)) {
      const v = config[k];
      if (v === "" || v === undefined || v === null || (Array.isArray(v) && !v.length)) delete config[k];
    }
    if (config.show_trend === true) delete config.show_trend;
    if (config.auto_exclude === true) delete config.auto_exclude;
    if (config.only_issues === false) delete config.only_issues;
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get("house-climate-card")) customElements.define("house-climate-card", HouseClimateCard);
if (!customElements.get("house-climate-card-editor")) {
  customElements.define("house-climate-card-editor", HouseClimateCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "house-climate-card")) {
  window.customCards.push({
    type: "house-climate-card",
    name: "House Climate Card",
    description: "CO₂, temperature and humidity of every room at a glance, found through your areas",
    preview: true,
    documentationURL: "https://github.com/yannick80/ha-house-climate-card",
  });
}

console.info(`%c house-climate-card %c ${VERSION} `, "color:#fff;background:#555;font-weight:700", "color:#555;background:#eee");

// Test hook: only active when evaluated with a CommonJS-style `module` (node tests)
if (typeof module !== "undefined" && module && module.exports) {
  module.exports = {
    HouseClimateCard: HouseClimateCard,
    HouseClimateCardEditor: HouseClimateCardEditor,
    absoluteHumidity: absoluteHumidity,
    analyse: analyse,
    discover: discover,
    technicalReason: technicalReason,
    trendFromHistory: trendFromHistory,
  };
}
})();
