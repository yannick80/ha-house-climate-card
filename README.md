# House Climate Card

A Home Assistant dashboard card that sums up the indoor climate of the whole
house: CO₂ per room, temperature and humidity ranges, and short hints on when
opening a window actually helps.

**No configuration needed.** The card finds every temperature, humidity and
CO₂ sensor through the areas you have assigned in Home Assistant.

![Preview](docs/preview.png)

## What it shows

- **Status badge**: the worst room sets the colour. It also says how many
  rooms should be aired.
- **Temperature and humidity ranges**: the coldest and warmest room, the
  driest and most humid room. The humidity bar marks the comfort band
  (40–60 %).
- **Outdoor values**, including absolute humidity in g/m³.
- **Rooms**, worst first: CO₂ as a bar with the German UBA guide values
  (below 1000 ppm fine, 1000–2000 ppm conspicuous, above 2000 ppm bad), the
  trend of the last 30 minutes, and temperature and humidity.
- **Hints**:
  - which rooms need fresh air;
  - whether airing dries a humid room. The card compares absolute humidity
    inside and outside, so it knows that on a muggy summer day a window
    makes things worse;
  - mold risk (≥ 70 %) and very dry air (< 30 %).

Tapping a room, tile or the outdoor line opens the sensor's more-info dialog.

## Installation

HACS → *Dashboard* → ⋮ → *Custom repositories* →
`https://github.com/yannick80/ha-house-climate-card`, category *Dashboard*.
Install *House Climate Card* and reload the browser.

## Configuration

```yaml
type: custom:house-climate-card
```

That's all. Everything below is optional:

| Option | Default | Meaning |
| --- | --- | --- |
| `title` | *Indoor climate* (localised) | Card title |
| `areas` | all | Only these area IDs, in this order |
| `exclude_areas` | – | Area IDs to hide |
| `exclude_entities` | – | Sensors to ignore that the automatic filter misses |
| `outdoor` | auto | Outdoor sensors and/or a `weather.*` entity to use |
| `outdoor_area` | auto | Use only this area's sensors as outdoor values |
| `auto_exclude` | `true` | Skip technical temperature sensors (see below) |
| `show_trend` | `true` | CO₂ trend arrows (reads the recorder history) |
| `thresholds` | see below | Override single limits |

```yaml
thresholds:
  co2: [1000, 2000]       # warn, bad (ppm)
  humidity: [40, 60]      # comfort band (%)
  humidity_dry: 30
  humidity_mold: 70
  dehumidify_margin: 1    # g/m³ the outside air must be drier
  trend_minutes: 30
  trend_ppm: 100
```

### How sensors are found

- `sensor.*` entities with `device_class` `temperature`, `humidity` or
  `carbon_dioxide`;
- in the entity's own area, otherwise in its device's area;
- not diagnostic (so the chip temperature of a smart plug does not count),
  not hidden, not disabled;
- temperature sensors that obviously don't measure room air are skipped:
  heating flow and return, boiler and hot water, ovens, steam ovens, coffee
  machines, fridges, aquarium, sauna, set points, CPU and battery
  temperatures. They are recognised by their name, entity ID or
  translation key, and every sensor of the appliance integrations
  `miele_lan`, `miele` and `home_connect` is skipped. Turn this off with
  `auto_exclude: false`. Add anything it misses to `exclude_entities`, and
  hide whole rooms such as the garage, cellar or server cabinet with
  `exclude_areas`.

Several sensors in one room: the card shows the mean temperature and humidity
and the highest CO₂ value.

**Outdoors**: areas whose name contains *Außen, Outdoor, Garten, Garden,
Terrasse, Balkon, …* are treated as outdoors and never shown as rooms
(a *Wintergarten* counts as a room). Without `outdoor`, the card averages all
of their sensors. If none has sensors, it uses the first `weather.*` entity.

With several outdoor spots (terrace, two balconies) pick the one that
represents the outside air best, usually the shady one:

```yaml
outdoor:
  - sensor.balkon_nord_temperatur
  - sensor.balkon_nord_luftfeuchte
```

A `weather.*` entity in that list only fills in the values the chosen
sensors don't measure.

## Development

Single file, no build step: [`dist/house-climate-card.js`](dist/house-climate-card.js).

```sh
node --test tests/*.mjs
sh docs/render-previews.sh   # README images, needs Chrome and python3
```

## License

MIT
