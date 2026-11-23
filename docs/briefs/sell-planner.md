# Sell planner: shared design (read fully)

Goal: given items to sell and the ships flying them, choose where to sell each item and the route for each ship. Get
the most ISK for the fewest jumps, after taxes and expected gank loss. Typical case: two Coercers (Amarr destroyer,
375 m³ cargo each), one per pilot.

Where the items are:
- in a ship's cargo
- in the item hangar of the station the pilot is docked in
The user can change the pickup station by hand (any station; it defaults to where the pilot is docked).

## Data shapes (the interface between the parts)
lots: [{type, qty, m3, from:{kind:'ship', pilot} | {kind:'hangar', station}}]
  - m3 is the PACKAGED volume of one unit (ESI types packaged_volume, falling back to volume).
ships: [{pilot, name, shipType, capacity, system, station|null}]
  - capacity is the cargo m³ (ESI types capacity for the hull; the user can override it).
quotes: Map type → [{order, loc, system, region, price, volume, minVolume, range}]
  - These are live BUY orders.
  - range is one of 'station' | 'solarsystem' | 'region' | 1|2|3|4|5|10|20|30|40 (jumps, as numbers).
stations: Map loc → {system, name, region}   (from the market book / universe map)
g: the route graph from route.js graph(); systems carry sec and region.

## Market rule (important)
You sell while docked at a station S. You can fill a buy order O placed at station O.loc when:
- range 'station': S === O.loc
- range 'solarsystem': same system
- range n: jumps(system(S), system(O.loc)) ≤ n
- range 'region': same region
min_volume: a single sale into O must be at least minVolume units (or all of O's remaining volume, if that is less).

Net per unit = price × (1 − salesTax). There's no broker fee for instant sells.
Two ships share one order book, so filled volume must never be counted twice.
