// The Haul plan's route searches, off the main thread (see ui/haulplan.js). One message sets up the market snapshot's gate
// map, kill history and traffic; each later message plans one trip and answers with the plan of every mode.
import {planModes, forWorker, workerGraph} from './haulplan.js';

let snapshot = null;
self.onmessage = ({data}) => {
  if (data.setup) { try { snapshot = {...workerGraph(data.setup), key:data.setup.key}; } catch (error) { snapshot = null; } return; }
  const {id, key, stops, ctx, options} = data;
  try {
    if (snapshot?.key !== key) throw new Error('The route planner has no map yet.');
    const plans = planModes(snapshot.g, stops, {history:snapshot.history, traffic:snapshot.traffic, ...ctx}, options);
    self.postMessage({id, plans:forWorker(plans)});
  } catch (error) { self.postMessage({id, error:String(error?.message || error)}); }
};
