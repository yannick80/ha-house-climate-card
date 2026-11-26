# Changelog

## Unreleased

- First version: CO₂ per room, temperature and humidity ranges, outdoor
  values, airing, dehumidifying, mold and dry-air hints, CO₂ trend from the
  recorder history. Sensors found through areas, no configuration needed.
- Technical temperature sensors are skipped automatically (heating
  flow/return, boiler, oven, steam oven, coffee machine, fridge, …);
  `auto_exclude: false` turns this off.
- `outdoor` takes a list of sensors and/or a weather entity, for houses with
  several outdoor spots.
