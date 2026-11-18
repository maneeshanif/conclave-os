// How many tiles each picture covers: [width, height]. Used by the map script (to block the tiles a piece stands on) and by the
// importers (to size the picture), so the two always agree.

/** The things you use (they open a panel), by object type. */
export const OBJECT_FOOT = {
  'approvals-desk': [2, 1],
  whiteboard: [2, 1],
  screen: [2, 1],
  mailbox: [1, 1],
  jobboard: [2, 1],
  'boardroom-table': [4, 2],
  'task-board': [2, 1],
  'needs-you-board': [1, 1],
  'brief-desk': [2, 1],
  'pipeline-board': [1, 1],
  'campaign-board': [1, 1],
  'signal-radio': [1, 1],
  'idea-wall': [2, 1],
  terminal: [2, 1],
  'dept-board': [2, 1],
  'dept-table': [2, 2],
  'deploy-board': [2, 1],
  'meetings-board': [2, 1],
  'channels-board': [2, 1],
  'network-board': [2, 1],
};

/** Pictures drawn upright that have to lie the other way to fit their footprint, by object type: turn them this many degrees. */
export const OBJECT_TURN = { 'boardroom-table': 90 };

/** Pieces for conferences, job fairs and sports, drawn in code by scripts/make-events-art.mjs. */
export const EVENT_FOOT = {
  lectern: [1, 1],
  'screen-wide': [3, 1],
  booth: [2, 1],
  booth2: [2, 1],
  booth3: [2, 1],
  regdesk: [2, 1],
  banner: [1, 2],
  banner2: [1, 2],
  seat: [1, 1],
  banquet: [2, 2],
  signboard: [2, 1],
  stage: [8, 3],
  court: [8, 5],
  track: [12, 6],
};

/** Scenery that is only there to look right, by picture name. */
export const DECOR_FOOT = {
  ...EVENT_FOOT,
  chair: [1, 1],
  desk: [1, 1],
  armchair: [1, 1],
  sofa: [2, 1],
  coffee: [2, 1],
  fridge: [1, 2],
  arcade: [1, 2],
  bookshelf: [2, 1],
  'cafe-table': [2, 1],
  pingpong: [3, 2],
  printer: [1, 1],
  bin: [1, 1],
  rug: [4, 3],
  plant: [1, 1],
  clock: [1, 1],
  tree: [2, 2],
};
