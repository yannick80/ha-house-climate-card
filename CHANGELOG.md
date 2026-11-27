# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed

- The temperature and humidity sensor chosen in an area's settings are now
  used for that area. Before, the card averaged every matching sensor in the
  area, so a room could show a value no sensor reported.

## 0.2.0 - 2026-11-26

### Added

- Option `only_issues`: only list rooms whose CO₂ or humidity is outside
  the limits, the others are summed up in one line. Also in the editor.

## 0.1.0 - 2026-11-26

### Added

- House climate card (`custom:house-climate-card`): status badge,
  temperature and humidity ranges, outdoor values with absolute humidity,
  rooms sorted by severity with CO₂ bar and trend arrow, and hints on
  airing, dehumidifying, mold risk and dry air.
- Zero configuration: temperature, humidity and CO₂ sensors are found
  through the areas of entities and devices and their `device_class`.
  Diagnostic and hidden sensors are skipped.
- Technical temperature sensors (heating flow and return, boiler, oven,
  steam oven, coffee machine, fridge, chip, …) are skipped automatically;
  `auto_exclude: false` turns this off.
- Outdoor areas (terrace, balcony, garden, …) are recognised by name and
  never shown as rooms; `outdoor` picks the sensors or weather entity to
  use when there are several.
- Options `title`, `areas`, `exclude_areas`, `exclude_entities`, `outdoor`,
  `outdoor_area`, `show_trend` and `thresholds`; visual editor.
- English and German.
