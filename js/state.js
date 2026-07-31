// Shared constants
const BASE_ROWS  = 5;
const COLS       = 6;
const MAX_EXPAND = 12;
const MAX_X2_SLOTS = 3;

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
let tabletSortMode = 'id';

// Merged tablets (created via merge dialog)
let mergedTablets = [];
