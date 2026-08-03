// Shared constants
const COLS       = 6;
const MAX_ROWS   = 7;    // hard ceiling — the starter toggle doesn't change it
const MAX_X2_SLOTS = 3;

// Base grid height — 5 normally, 4 in starter mode. MAX_EXPAND is derived from it
// so the row ceiling holds either way: 5 base → 12 expansions, 4 base → 18.
let BASE_ROWS  = 5;
let MAX_EXPAND = (MAX_ROWS - BASE_ROWS) * COLS;

// Data loaded from tablets.json
let TABLETS_DATA = null;
let TABLET_MAP   = {};

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
let solverResults    = [];
let solveMode        = 'coverage';
let appliedResultIdx = -1;

// UI state
let markMode       = null;   // null | 'x2' | 'target' — grid cell marking tool
let pickerExpanded = false;
let starterGrid    = false;  // 6×4 base grid instead of 6×5
let tabletSortMode = 'id';

// Merged tablets (created via merge dialog)
let mergedTablets = [];
