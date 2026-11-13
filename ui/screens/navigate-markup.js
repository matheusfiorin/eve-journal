// The Haul plan's static markup, apart from ui/screens/navigate.js so the page can build every screen's DOM at boot and
// load the Navigate code only when the Star map or Haul plan first opens.
export const markup = {
  hauling:`<form id="haul-form" class="card market-controls">
  <div class="card-head"><div><h2>Haul plan</h2><p id="haul-status" class="hint">Add stops to plan a route.</p></div></div>
  <div id="haul-stops" class="stops"></div>
  <div class="actions"><button type="button" id="haul-add" class="secondary small">+ Add stop</button></div>
  <div class="row">
   <label>Cargo value (ISK)<input id="haul-value" type="number" min="0" step="1000000" value="100000000"></label>
   <label>Cargo volume (m³)<input id="haul-volume" type="number" min="0" step="100" value="5000"></label>
   <label>Ship<select id="haul-hull"><option value="">Suggest from cargo</option><option value="br">Blockade runner</option><option value="t1">T1 industrial</option><option value="dst">Deep space transport</option><option value="freighter">Freighter</option></select></label>
  </div>
  <div class="row">
   <label>Avoid systems<input id="haul-avoid" placeholder="Uedama, Sivala"></label>
   <label>Stop order<select id="haul-end"><option value="fixed">Keep the last stop last</option><option value="free">Any order</option><option value="return">Return to start</option></select></label>
  </div>
  <div class="row">
   <label class="check"><input id="haul-optimize" type="checkbox"> Find the best stop order</label>
   <label class="check"><input id="haul-lowsec" type="checkbox"> Allow low-sec</label>
   <button id="haul-plan">Plan route</button>
  </div>
 </form>
 <div id="haul-content"></div>`
};
