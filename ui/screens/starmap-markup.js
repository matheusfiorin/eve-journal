// The Star map's static markup and overlay list. Apart from ui/screens/starmap.js so the page can build every screen's DOM at
// boot and load the map code (and its drawing, gesture and state modules) only when the map first opens.
// Overlays: label, halo colour (sovereignty is coloured per owner), and which live feed it needs.
export const OVERLAYS = {
  security:{label:'Security'},
  danger:{label:'Danger to haulers', color:'#FF4D4D', feed:'risk'},
  shipKills:{label:'Ship kills (last hour)', color:'#FF7E70', feed:'kills'},
  podKills:{label:'Pod kills (last hour)', color:'#FFA26B', feed:'kills'},
  npcKills:{label:'NPC kills (last hour)', color:'#F4C55A', feed:'kills'},
  jumps:{label:'Jumps (last hour)', color:'#5CD3DE', feed:'jumps'},
  kills24:{label:'Ship kills (~24 h)', color:'#FF5C8A', feed:'risk'},
  kills7:{label:'Ship kills (~7 days)', color:'#E0457B', feed:'risk'},
  jumps24:{label:'Jumps (~24 h)', color:'#3FB8C9', feed:'traffic'},
  sov:{label:'Sovereignty', color:'#C3B9FF', feed:'sov'},
  fw:{label:'Faction warfare', color:'#B8E05A', feed:'fw'},
  incursion:{label:'Incursions', color:'#FF4FD8', feed:'incursions'},
  industry:{label:'Manufacturing index', color:'#8FB2FF', feed:'industry'},
  belts:{label:'Asteroid belts', color:'#E8956A'},
  stations:{label:'NPC stations', color:'#62D99B'}
};
const VIEW_OPTIONS = [['region', 'Region map'], ['region3d', 'Region in 3D'], ['universe', 'New Eden in 3D'], ['list', 'List']];
const JUMP_OPTIONS = [['', 'Off'], ...Object.entries({blops:'Black Ops · 8 ly', jf:'Jump freighter · 10 ly', capital:'Carrier, Dread, FAX · 7 ly', super:'Super, Titan · 6 ly'})];
const options = list => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
const icon = n => `<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;

export const markup = {map:`<div id="map-controls-home" class="map-controls-home"><div id="map-controls" class="map-toolbar">
   <nav id="map-crumbs" class="map-crumbs" aria-label="Map location"></nav>
   <div class="map-selects">
    <label>Region<select id="map-region"></select></label>
    <label>View<select id="map-view">${options(VIEW_OPTIONS)}</select></label>
    <label>Overlay<select id="map-overlay">${options(Object.entries(OVERLAYS).map(([k, v]) => [k, v.label]))}</select></label>
    <label>Jump range<select id="map-jump">${options(JUMP_OPTIONS)}</select></label>
   </div>
  </div></div>
 <p id="map-status" class="hint map-status" role="status">Loading the map…</p>
 <div class="map-layout">
  <div id="map-stage" class="map-stage">
   <form id="map-find" class="map-find" role="search"><label><span class="sr-only">Find system</span><input id="map-search" list="systems" data-filter placeholder="Find a system" autocomplete="off" enterkeyhint="go"></label><button class="secondary small" aria-label="Go to system">Go</button></form>
   <button type="button" id="map-layers-open" class="secondary map-layers-btn" aria-haspopup="dialog">${icon('navigate')}Layers</button>
   <div id="map-route" class="map-route" hidden></div>
   <div id="map-canvas-wrap" class="map-canvas-wrap"></div>
   <div class="map-zoom" role="group" aria-label="Zoom"><button type="button" class="secondary" data-zoom="0.75" aria-label="Zoom in">+</button><button type="button" class="secondary" data-zoom="1.33" aria-label="Zoom out">−</button><button type="button" class="secondary" data-zoom="0" aria-label="Fit the whole region">Fit</button><button type="button" class="secondary" data-locate aria-label="Show my location">◎</button></div>
   <div id="map-tip" class="map-tip" role="tooltip" hidden></div>
   <div id="map-legend" class="map-legend"></div>
  </div>
  <aside id="map-panel" class="map-panel" aria-label="System details" data-snap="peek"><button type="button" class="sheet-handle" id="map-sheet-handle" aria-label="Expand the details sheet" aria-expanded="false"></button><div id="map-panel-body" class="map-panel-body"></div></aside>
 </div>`};
