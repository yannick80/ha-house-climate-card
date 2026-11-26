// Card tests: `node --test tests/*.mjs` – no npm dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../dist/house-climate-card.js", import.meta.url), "utf8");

// ------------------------------------------------------------ minimal DOM stub

class FakeEl {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this._text = "";
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    const props = {};
    this.style = { setProperty: (k, v) => (props[k] = v), getPropertyValue: (k) => props[k] || "", _props: props };
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set innerHTML(v) { this.children = []; this._text = ""; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  click() { (this.listeners.click || []).forEach((fn) => fn({})); }
  appendChild(c) { this.children.push(c); return c; }
  matches(sel) {
    if (sel.startsWith(".")) return sel.slice(1).split(".").every((c) => this.className.split(" ").includes(c));
    return this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function makeContext(extra = {}) {
  const registry = new Map();
  class HTMLElement {
    constructor() { this.dispatched = []; this.children = []; }
    attachShadow() { this.shadowRoot = new FakeEl("#shadow"); return this.shadowRoot; }
    dispatchEvent(ev) { this.dispatched.push(ev); return true; }
    appendChild(c) { this.children.push(c); return c; }
  }
  const ctx = {
    console: { info() {}, error(...a) { ctx.__errors.push(a); }, warn() {} },
    __errors: [],
    HTMLElement,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    customElements: {
      get: (t) => registry.get(t),
      define: (t, c) => { if (registry.has(t)) throw new Error(`already defined: ${t}`); registry.set(t, c); },
      whenDefined: () => new Promise(() => {}),
    },
    document: { createElement: (t) => { const C = registry.get(t); return C ? new C() : new FakeEl(t); } },
    setInterval: () => 1,
    clearInterval: () => {},
    Intl, Date, Math, JSON, Number, String, Object, Array, Promise, Error, RegExp, Set, parseFloat, isFinite,
    ...extra,
  };
  ctx.window = ctx;
  return vm.createContext(ctx);
}

function loadCard() {
  const ctx = makeContext({ module: { exports: {} } });
  vm.runInContext(SOURCE, ctx, { filename: "house-climate-card.js" });
  return ctx;
}

// ------------------------------------------------------------ mock hass

const DC = { t: "temperature", h: "humidity", c: "carbon_dioxide" };
const UNIT = { t: "°C", h: "%", c: "ppm" };

// rooms: { area_id: { t: 21, h: 50, c: 800 } }; values may be arrays for several sensors
function mkHass(rooms, opts = {}) {
  const hass = {
    locale: { language: opts.lang || "de" }, language: opts.lang || "de",
    config: { unit_system: { temperature: "°C" } },
    areas: {}, devices: {}, entities: {}, states: {},
  };
  const names = { wohnen: "Wohnzimmer", kinder: "Kinderzimmer", bad: "Bad", schlafen: "Schlafzimmer", garten: "Garten", buero: "Büro" };
  for (const [area, values] of Object.entries(rooms)) {
    hass.areas[area] = { area_id: area, name: names[area] || area };
    for (const [k, v] of Object.entries(values)) {
      [].concat(v).forEach((val, i) => {
        const eid = `sensor.${area}_${DC[k]}${i ? "_" + i : ""}`;
        const dev = `dev_${area}_${i}`;
        hass.devices[dev] = { id: dev, area_id: area };
        hass.entities[eid] = { entity_id: eid, device_id: dev, platform: "zha" };
        hass.states[eid] = { entity_id: eid, state: String(val), attributes: { device_class: DC[k], unit_of_measurement: UNIT[k] } };
      });
    }
  }
  return hass;
}

function render(ctx, config, hass) {
  const Card = ctx.customElements.get("house-climate-card");
  const card = new Card();
  card.setConfig(config);
  card.hass = hass;
  const r = card.shadowRoot;
  const all = (s) => r.querySelectorAll(s);
  const one = (s) => r.querySelector(s);
  return {
    card,
    root: r,
    text: r.textContent,
    badge: one(".badge") && one(".badge").textContent,
    badgeClass: one(".badge") && one(".badge").className,
    rooms: all(".room").map((e) => e.querySelector(".room-title").textContent),
    roomEls: all(".room"),
    tiles: all(".tile-value").map((e) => e.textContent),
    tileSubs: all(".tile-sub").map((e) => e.textContent),
    hints: all(".hint").map((e) => e.textContent),
    outside: one(".outside") && one(".outside").textContent,
    warning: one(".warning") && one(".warning").textContent,
    empty: one(".hint-empty") && one(".hint-empty").textContent,
  };
}

const HOUSE = {
  wohnen: { t: 22.8, h: 48, c: 710 },
  kinder: { t: 21.3, h: 52, c: 1840 },
  schlafen: { t: 19.6, h: 55, c: 1310 },
  bad: { t: 22.1, h: 67 },
  garten: { t: 4.2, h: 81 },
};

// ------------------------------------------------------------ old WebViews

test("card evaluates as a classic script in one shared context, twice", () => {
  const ctx = makeContext();
  vm.runInContext(SOURCE, ctx);
  vm.runInContext(SOURCE, ctx);
  assert.ok(ctx.customElements.get("house-climate-card"));
  assert.ok(ctx.customElements.get("house-climate-card-editor"));
  assert.equal(ctx.window.customCards.filter((c) => c.type === "house-climate-card").length, 1);
});

test("source uses no syntax newer than ES2019", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const forbidden = [
    [/\?\.(?!\d)/, "optional chaining ?."],
    [/\?\?/, "nullish coalescing ??"],
    [/(\|\||&&)=/, "logical assignment"],
    [/\.at\(/, ".at()"],
    [/\.replaceAll\(/, "replaceAll"],
    [/\.replaceChildren\(/, "replaceChildren"],
    [/this\.#\w|^\s*(static\s+)?#\w+\s*[=(;]/m, "#private class members"],
  ];
  for (const [re, name] of forbidden) assert.doesNotMatch(code, re, `forbidden syntax: ${name}`);
});

test("whole file is wrapped in its own function scope", () => {
  const code = SOURCE.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "").trim();
  assert.match(code, /^\(function \(\) \{/);
  assert.match(code, /\}\)\(\);$/);
});

test("every color-mix() has a plain fallback right before it, no gap/inset", () => {
  const lines = SOURCE.split(";").map((s) => s.trim());
  lines.forEach((l, i) => {
    if (!/background:\s*color-mix/.test(l)) return;
    assert.match(lines[i - 1], /background:\s*rgba?\(/, `missing fallback before: ${l}`);
  });
  assert.doesNotMatch(SOURCE, /[\s{;]gap\s*:/);
  assert.doesNotMatch(SOURCE, /[\s{;]inset\s*:/);
});

// ------------------------------------------------------------ physics

test("absolute humidity matches reference values", () => {
  const { absoluteHumidity } = loadCard().module.exports;
  assert.ok(Math.abs(absoluteHumidity(20, 50) - 8.65) < 0.1);
  assert.ok(Math.abs(absoluteHumidity(0, 100) - 4.85) < 0.1);
  assert.ok(Number.isNaN(absoluteHumidity(NaN, 50)));
});

// ------------------------------------------------------------ discovery

test("finds sensors through device area and entity area override", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 21 }, bad: { h: 60 } });
  // entity sits on a device in the living room but is assigned to the bath itself
  hass.entities["sensor.wohnen_temperature"].area_id = "bad";
  const { rooms } = ctx.module.exports.discover(hass, {});
  assert.equal(rooms.length, 1);
  assert.deepEqual([...rooms[0].temperature], ["sensor.wohnen_temperature"]);
  assert.deepEqual([...rooms[0].humidity], ["sensor.bad_humidity"]);
});

test("ignores diagnostic, hidden, non-sensor and area-less entities", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: [21, 45] } });
  hass.entities["sensor.wohnen_temperature_1"].entity_category = "diagnostic";
  hass.entities["sensor.orphan"] = { entity_id: "sensor.orphan" };
  hass.states["sensor.orphan"] = { state: "20", attributes: { device_class: "temperature" } };
  hass.entities["climate.wohnen"] = { entity_id: "climate.wohnen", area_id: "wohnen" };
  hass.states["climate.wohnen"] = { state: "heat", attributes: { device_class: "temperature" } };
  hass.entities["sensor.hidden"] = { entity_id: "sensor.hidden", area_id: "wohnen", hidden: true };
  hass.states["sensor.hidden"] = { state: "99", attributes: { device_class: "temperature" } };
  const { rooms } = ctx.module.exports.discover(hass, {});
  assert.deepEqual([...rooms[0].temperature], ["sensor.wohnen_temperature"]);
});

test("outdoor areas are recognised by name and not shown as rooms", () => {
  const r = render(loadCard(), {}, mkHass(HOUSE));
  assert.ok(!r.rooms.includes("Garten"));
  assert.match(r.outside, /außen: 4,2 °C · 81 %/);
});

test("areas restricts and orders, exclude_areas and exclude_entities hide", () => {
  const ctx = loadCard();
  const hass = mkHass(HOUSE);
  const only = ctx.module.exports.discover(hass, { areas: ["bad", "wohnen"] });
  assert.deepEqual(only.rooms.map((r) => r.id), ["bad", "wohnen"]);
  const hidden = ctx.module.exports.discover(hass, { exclude_areas: ["bad"], exclude_entities: ["sensor.kinder_carbon_dioxide"] });
  assert.ok(!hidden.rooms.some((r) => r.id === "bad"));
  assert.equal(hidden.rooms.find((r) => r.id === "kinder").co2.length, 0);
});

test("several sensors in a room: mean temperature, highest CO₂", () => {
  const ctx = loadCard();
  const data = ctx.module.exports.analyse(mkHass({ wohnen: { t: [20, 22], c: [600, 1200] } }), {});
  assert.equal(data.rooms[0].temperature, 21);
  assert.equal(data.rooms[0].co2, 1200);
  assert.equal(data.rooms[0].entity, "sensor.wohnen_carbon_dioxide_1");
});

test("unavailable sensors are skipped, not counted as zero", () => {
  const ctx = loadCard();
  const data = ctx.module.exports.analyse(mkHass({ wohnen: { t: ["unavailable", 22], c: "unknown" } }), {});
  assert.equal(data.rooms[0].temperature, 22);
  assert.ok(Number.isNaN(data.rooms[0].co2));
});

test("Fahrenheit sensors are converted for the physics", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 68, h: 50 } });
  hass.states["sensor.wohnen_temperature"].attributes.unit_of_measurement = "°F";
  const data = ctx.module.exports.analyse(hass, {});
  assert.ok(Math.abs(data.rooms[0].temperature - 20) < 0.01);
});

test("weather entity is the outdoor fallback, explicit outdoor wins", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 21, h: 50 }, terrasse_x: {} });
  hass.states["weather.home"] = { state: "rainy", attributes: { temperature: 7, humidity: 90 } };
  const data = ctx.module.exports.analyse(hass, {});
  assert.equal(data.outdoor.temperature, 7);
  hass.states["sensor.aussen"] = { state: "3", attributes: { device_class: "temperature" } };
  const explicit = ctx.module.exports.analyse(hass, { outdoor: "sensor.aussen" });
  assert.equal(explicit.outdoor.temperature, 3);
});

test("several outdoor areas: chosen outdoor sensors win over the average", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 21, h: 50 }, terrasse: { t: 18, h: 60 }, balkon_sued: { t: 26, h: 40 }, balkon_nord: { t: 10, h: 80 } });
  const auto = ctx.module.exports.analyse(hass, {});
  assert.equal(auto.rooms.length, 1, "balconies and terrace are not rooms");
  assert.equal(auto.outdoor.temperature, 18);
  const chosen = ctx.module.exports.analyse(hass, { outdoor: ["sensor.balkon_nord_temperature", "sensor.balkon_nord_humidity"] });
  assert.equal(chosen.outdoor.temperature, 10);
  assert.equal(chosen.outdoor.humidity, 80);
  assert.equal(chosen.outdoor.entity, "sensor.balkon_nord_temperature");
});

test("chosen temperature sensor plus weather entity: weather fills in humidity only", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 21 }, terrasse: { t: 18, h: 60 } });
  hass.states["weather.home"] = { state: "sunny", attributes: { temperature: 30, humidity: 35 } };
  const data = ctx.module.exports.analyse(hass, { outdoor: ["sensor.terrasse_temperature", "weather.home"] });
  assert.equal(data.outdoor.temperature, 18);
  assert.equal(data.outdoor.humidity, 35);
});

test("a single outdoor entity as a string still works", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 21 }, terrasse: { t: 18 } });
  assert.equal(ctx.module.exports.analyse(hass, { outdoor: "sensor.terrasse_temperature" }).outdoor.temperature, 18);
});

test("outdoor_area: the other outdoor areas are still not rooms", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 21 }, terrasse: { t: 18 }, balkon_nord: { t: 10 } });
  const data = ctx.module.exports.analyse(hass, { outdoor_area: "balkon_nord" });
  assert.deepEqual(data.rooms.map((r) => r.id), ["wohnen"]);
  assert.equal(data.outdoor.temperature, 10);
});

test("areas list: outdoor areas still give outdoor values unless listed", () => {
  const ctx = loadCard();
  const hass = mkHass({ wohnen: { t: 21 }, bad: { t: 23 }, terrasse: { t: 18 } });
  const data = ctx.module.exports.analyse(hass, { areas: ["wohnen"] });
  assert.deepEqual(data.rooms.map((r) => r.id), ["wohnen"]);
  assert.equal(data.outdoor.temperature, 18);
  const listed = ctx.module.exports.analyse(hass, { areas: ["wohnen", "terrasse"] });
  assert.deepEqual(listed.rooms.map((r) => r.id).sort(), ["terrasse", "wohnen"]);
});

test("a Wintergarten is a room, not outdoors", () => {
  const ctx = loadCard();
  const hass = mkHass({ wintergarten: { t: 24 } });
  assert.equal(ctx.module.exports.discover(hass, {}).rooms.length, 1);
});

function addSensor(hass, area, id, value, extra = {}) {
  hass.entities[id] = { entity_id: id, area_id: area, ...extra.ent };
  hass.states[id] = { entity_id: id, state: String(value), attributes: { device_class: "temperature", ...extra.attrs } };
}

test("technical temperature sensors are skipped automatically", () => {
  const ctx = loadCard();
  const hass = mkHass({ kueche: { t: 21 }, technik: { t: 20 } });
  addSensor(hass, "kueche", "sensor.kaffeemaschine_boiler_temperatur", 93, { attrs: { friendly_name: "Kaffeemaschine Boilertemperatur" } });
  addSensor(hass, "kueche", "sensor.eg_kuche_backofen_cavity_temperature", 20, { ent: { platform: "miele_lan", translation_key: "cavity_temperature" } });
  addSensor(hass, "kueche", "sensor.eg_kuche_dampfgarer_temperatur", 20, { ent: { platform: "miele_lan" } });
  addSensor(hass, "technik", "sensor.heizkreis_1", 42, { attrs: { friendly_name: "Heizung Vorlauftemperatur" } });
  addSensor(hass, "technik", "sensor.heizung_ruecklauf", 35);
  const rooms = ctx.module.exports.discover(hass, {}).rooms;
  assert.deepEqual([...rooms.find((r) => r.id === "kueche").temperature], ["sensor.kueche_temperature"]);
  assert.deepEqual([...rooms.find((r) => r.id === "technik").temperature], ["sensor.technik_temperature"]);
  const off = ctx.module.exports.discover(hass, { auto_exclude: false }).rooms;
  assert.equal(off.find((r) => r.id === "kueche").temperature.length, 4);
});

test("ordinary room sensors are not mistaken for technical ones", () => {
  const { technicalReason } = loadCard().module.exports;
  const names = ["sensor.kinderzimmer_temperatur", "sensor.wohnzimmer_temperature", "sensor.buero_temperatur",
    "sensor.herrenzimmer_temperatur", "sensor.kueche_temperatur", "sensor.esszimmer_temperature",
    "sensor.schlafzimmer_raumtemperatur", "sensor.flur_eg_temperature", "sensor.lumi_weather_temperature"];
  for (const id of names) assert.equal(technicalReason({ states: {} }, id, { platform: "zha" }), "", id);
});

test("humidity sensors are never dropped by the technical filter", () => {
  const ctx = loadCard();
  const hass = mkHass({ bad: { h: 70 } });
  hass.states["sensor.bad_humidity"].attributes.friendly_name = "Bad Feuchte (intern)";
  assert.equal(ctx.module.exports.discover(hass, {}).rooms[0].humidity.length, 1);
});

// ------------------------------------------------------------ rendering

test("whole house: ranges, sorting by severity, status badge and hints", () => {
  const r = render(loadCard(), {}, mkHass(HOUSE));
  assert.equal(r.warning, null);
  assert.deepEqual(r.rooms, ["Kinderzimmer", "Schlafzimmer", "Bad", "Wohnzimmer"]);
  assert.deepEqual(r.tiles, ["19,6 – 22,8 °C", "48 – 67 %"]);
  assert.deepEqual(r.tileSubs, ["Schlafzimmer · Wohnzimmer", "Wohnzimmer · Bad"]);
  assert.equal(r.badge, "3 Räume lüften");
  assert.match(r.badgeClass, /bad/);
  assert.ok(r.hints[0].startsWith("Lüften: Kinderzimmer, Schlafzimmer"));
  assert.match(r.hints[1], /^Lüften entfeuchtet: außen 5,\d g\/m³, innen 13,\d g\/m³ \(Bad\)$/);
});

test("only_issues: only rooms with CO₂ or humidity outside the limits", () => {
  const r = render(loadCard(), { only_issues: true }, mkHass(HOUSE));
  assert.deepEqual(r.rooms, ["Kinderzimmer", "Schlafzimmer", "Bad"]);
  assert.equal(r.root.querySelector(".rooms-rest").textContent, "1 weiterer Raum unauffällig");
  assert.deepEqual(r.tiles, ["19,6 – 22,8 °C", "48 – 67 %"], "ranges still cover every room");
});

test("only_issues: all fine shows a single line instead of the room list", () => {
  const r = render(loadCard(), { only_issues: true }, mkHass({ wohnen: { t: 21, h: 50, c: 600 }, bad: { t: 22, h: 55 } }));
  assert.deepEqual(r.rooms, []);
  assert.equal(r.root.querySelector(".rooms-label"), null);
  assert.equal(r.root.querySelector(".rooms-rest").textContent, "2 weitere Räume unauffällig");
  const en = render(loadCard(), { only_issues: true }, mkHass({ wohnen: { c: 600 }, bad: { h: 50 }, buero: { h: 66 } }, { lang: "en" }));
  assert.equal(en.root.querySelector(".rooms-rest").textContent, "2 more rooms are fine");
});

test("without only_issues every room is listed and there is no rest line", () => {
  const r = render(loadCard(), {}, mkHass(HOUSE));
  assert.equal(r.rooms.length, 4);
  assert.equal(r.root.querySelector(".rooms-rest"), null);
});

test("all good", () => {
  const r = render(loadCard(), {}, mkHass({ wohnen: { t: 21, h: 50, c: 600 } }));
  assert.equal(r.badge, "Alles im grünen Bereich");
  assert.equal(r.hints.length, 0);
});

test("humid inside but wetter outside: airing does not help", () => {
  const r = render(loadCard(), {}, mkHass({ bad: { t: 20, h: 65 }, garten: { t: 28, h: 70 } }));
  assert.match(r.hints[0], /^Lüften entfeuchtet gerade nicht/);
  assert.equal(r.badge, "Prüfen");
});

test("mold and dry air hints, custom thresholds", () => {
  const r = render(loadCard(), {}, mkHass({ bad: { t: 20, h: 74 }, buero: { t: 22, h: 25 } }));
  assert.ok(r.hints.some((h) => h === "Schimmelgefahr: Bad"));
  assert.ok(r.hints.some((h) => h === "Sehr trockene Luft: Büro"));
  const custom = render(loadCard(), { thresholds: { co2: [800, 1500] } }, mkHass({ wohnen: { c: 900 } }));
  assert.equal(custom.badge, "Wohnzimmer lüften");
});

test("English strings", () => {
  const r = render(loadCard(), {}, mkHass({ kinder: { c: 1500 } }, { lang: "en-GB" }));
  assert.equal(r.badge, "Air the Kinderzimmer");
  assert.match(r.text, /Indoor climate/);
});

test("no sensors in any area shows a hint, not an empty card", () => {
  const r = render(loadCard(), {}, { language: "de", states: {}, entities: {}, areas: {}, devices: {} });
  assert.match(r.empty, /Keine Klimasensoren/);
});

test("room names are set as text, never parsed as HTML", () => {
  const hass = mkHass({ wohnen: { t: 21 } });
  hass.areas.wohnen.name = "<img src=x onerror=alert(1)>";
  const r = render(loadCard(), {}, hass);
  assert.equal(r.rooms[0], "<img src=x onerror=alert(1)>");
});

test("tap on a room opens more-info of its CO₂ sensor", () => {
  const r = render(loadCard(), {}, mkHass(HOUSE));
  r.roomEls[0].click();
  const ev = r.card.dispatched.find((e) => e.type === "hass-more-info");
  assert.equal(ev.detail.entityId, "sensor.kinder_carbon_dioxide");
});

test("render errors are shown inside the card", () => {
  const hass = mkHass({ wohnen: { t: 21 } });
  Object.defineProperty(hass, "areas", { get() { throw new Error("boom"); } });
  const r = render(loadCard(), {}, hass);
  assert.match(r.warning, /boom/);
});

test("invalid config is rejected, empty config is fine", () => {
  const Card = loadCard().customElements.get("house-climate-card");
  assert.throws(() => new Card().setConfig({ areas: 5 }), /must be a list/);
  assert.throws(() => new Card().setConfig({ thresholds: [1] }), /mapping/);
  assert.throws(() => new Card().setConfig({ outdoor: 5 }), /must be a list/);
  assert.doesNotThrow(() => new Card().setConfig({ type: "custom:house-climate-card" }));
  assert.deepEqual({ ...Card.getStubConfig() }, {});
});

test("grid and layout options", () => {
  const Card = loadCard().customElements.get("house-climate-card");
  const c = new Card();
  assert.equal(c.getGridOptions().columns, 12);
  assert.equal(c.getLayoutOptions().grid_columns, 4);
});

// ------------------------------------------------------------ trend

test("trend from recorder history (compressed and full format)", () => {
  const { trendFromHistory } = loadCard().module.exports;
  const th = { trend_ppm: 100 };
  const now = Date.now();
  const start = now - 30 * 60000;
  const hist = [
    { s: "700", lu: (start - 5 * 60000) / 1000 },
    { s: "900", lu: (start + 5 * 60000) / 1000 },
  ];
  assert.equal(trendFromHistory(hist, start, 1100, th), "up");
  assert.equal(trendFromHistory(hist, start, 650, th), "flat");
  assert.equal(trendFromHistory([{ state: "1500", last_changed: new Date(start - 1).toISOString() }], start, 1200, th), "down");
  assert.equal(trendFromHistory([], start, 1200, th), undefined);
});

test("trend is fetched via callWS and shown as an arrow", async () => {
  const ctx = loadCard();
  const hass = mkHass({ kinder: { c: 1500 } });
  let request;
  hass.callWS = async (msg) => {
    request = msg;
    return { "sensor.kinder_carbon_dioxide": [{ s: "900", lu: (Date.now() - 3600000) / 1000 }] };
  };
  const r = render(ctx, {}, hass);
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(request.type, "history/history_during_period");
  assert.deepEqual([...request.entity_ids], ["sensor.kinder_carbon_dioxide"]);
  const arrow = r.root.querySelectorAll("ha-icon").find((i) => i.getAttribute("icon") === "mdi:trending-up");
  assert.ok(arrow, "rising arrow shown");
});

test("show_trend: false never calls the history API", async () => {
  const hass = mkHass({ kinder: { c: 1500 } });
  let called = false;
  hass.callWS = async () => { called = true; return {}; };
  render(loadCard(), { show_trend: false }, hass);
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(called, false);
});

// ------------------------------------------------------------ editor

test("editor works without ha-form and drops empty values", () => {
  const ctx = loadCard();
  const Editor = ctx.customElements.get("house-climate-card-editor");
  const ed = new Editor();
  ed.setConfig({ title: "X" });
  ed.hass = mkHass({});
  ed._onFormValue({ title: "", areas: [], outdoor: [], show_trend: true, auto_exclude: true, only_issues: false, exclude_areas: ["bad"] });
  const cfg = ed.dispatched.pop().detail.config;
  assert.deepEqual({ ...cfg }, { exclude_areas: ["bad"] });
});
