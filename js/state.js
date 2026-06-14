// Shared constants
const BASE_ROWS  = 5;
const COLS       = 6;
const MAX_EXPAND = 12;

// Data loaded from tablets.json
let TABLETS_DATA = null;
let TABLET_MAP   = {};

// Grid state
let expandedSlots  = 0;
let gridPlacements = {};  // "row,col" -> { tabletId, rotation }
let collection     = {};  // tabletId  -> count

// Selection state
let selectedTabletId = null;
let selectedCellKey  = null;
let selectedRotation = 0;

// Solver state
let solverResults    = [];
let solveMode        = 'total';
let appliedResultIdx = -1;

// UI state
let pickerExpanded = false;
let tabletSortMode = 'id';

// Merged tablets (created via merge dialog)
let mergedTablets = [];
