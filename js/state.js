// Shared constants
const COLS       = 6;
const MAX_ROWS   = 10;    // hard ceiling — the starter toggle doesn't change it
const MAX_X2_SLOTS = 3;

// Base grid height — 5 normally, 4 in starter mode. MAX_EXPAND is derived from it
// so the row ceiling holds either way: 5 base → 12 expansions, 4 base → 18.
let BASE_ROWS  = 5;
let MAX_EXPAND = (MAX_ROWS - BASE_ROWS) * COLS;

// Data loaded from tablets.json
let TABLETS_DATA = null;
let TABLET_MAP   = {};   // "anything that can occupy a cell" — tablets, merges and items

// Data loaded from items.json. Items occupy a cell and emit no buff; they're only
// active when the cell they sit on reaches their own bracket value.
let ITEMS_DATA   = null;

// Grid state
let expandedSlots  = 0;
let gridPlacements = {};  // "row,col" -> { tabletId, rotation }
let collection     = {};  // tabletId  -> count

// Cell marks — same "row,col" key convention as gridPlacements
let x2Slots     = {};  // "row,col" -> true               (buff value doubled)
let slotTargets = {};  // "row,col" -> { value, op }      op: 'gte' | 'eq'

// Selection state
let selectedTabletId = null;
let selectedCellKey  = null;
let selectedRotation = 0;

// Solver state
let solverResults    = [];   // every distinct layout found, best first
let solveMode        = 'coverage';
let appliedResultIdx = -1;

// How long the solver is allowed to search. Every attempt yields a distinct layout,
// so this is effectively "how many options do you want" — but bounded by construction.
// Quick keeps the old snappy feel while still finding far more than the previous 3.
let searchBudgetMs  = 1000;
let solverCancelled = false;

// Results table view state (js/results.js). Default sort is solver order, which is
// already best-first — the raw score is never shown, it means nothing to a player.
let resultsTableSort = { key: 'rank', dir: 'asc' };
let resultsFilters   = {
  minBuff: null, minCovered: null, rulesOnly: false, itemsOnly: false, collapseTies: true,
  // "at least <slotCount> slots with buff <slotOp> <slotValue>"; inactive while slotValue is null
  slotOp: 'gte', slotValue: null, slotCount: 1,
};

// Ruleset engine — an alternative to the global solveMode. Rules ask for a *count*
// of slots at a value without pinning which ones, so the solver keeps its freedom
// of placement and doesn't spend buff on slots no rule cares about.
let solverEngine = 'ruleset';   // 'legacy' | 'ruleset' — Rulesets is the default:
                                // it keeps the solver's placement freedom and stops it
                                // spending buff on slots nothing asked about.
let rules        = [];  // { id, countOp, count, valueOp, value }
                        // countOp: 'exactly' | 'atleast' | 'atmost'
                        // valueOp: 'eq' | 'gte' | 'lte'
let restMode     = 'maximize';  // 'maximize' | 'coverage' | 'target' — scores the
                                // leftover cells no rule claimed (lowest priority)
let restTarget   = 3;           // only read when restMode === 'target'

// Items the solver should place, one entry per copy the player owns.
// { uid, itemId, enforceSelf: 'hard'|'soft', selfValue, phase, pinValues[], regionMode }
// The uid — not itemId — identifies a copy, so two Cold Locks stay distinguishable.
let solverItems = [];
let itemNextUid = 1;

// UI state
let markMode       = null;   // null | 'x2' | 'target' — grid cell marking tool
let pickerExpanded = false;
let starterGrid    = false;  // 6×4 base grid instead of 6×5
let tabletSortMode = 'id';

// Merged tablets (created via merge dialog)
let mergedTablets = [];
