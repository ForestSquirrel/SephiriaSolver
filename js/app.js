// Entry point — loads data and wires up the app.
// Depends on: state.js, engine.js, solver.js, ui.js

async function bootstrap() {
  const overlay = document.getElementById('loading-overlay');
  const msg     = document.getElementById('loading-msg');
  try {
    const res = await fetch('tablets.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    TABLETS_DATA = await res.json();
    if (!TABLETS_DATA.items || !Array.isArray(TABLETS_DATA.items)) {
      throw new Error('tablets.json: expected { items: [...] }');
    }
    TABLETS_DATA.items.forEach(t => TABLET_MAP[t.id] = t);
    overlay.style.display = 'none';
    init();
  } catch (err) {
    msg.className = 'err';
    msg.innerHTML =
      `<b>Could not load tablets.json</b><br>${err.message}<br><br>` +
      `Place <code>tablets.json</code> in the same folder as this HTML file and reload.<br>` +
      `(If running locally, use a local server or browser with file:// access.)`;
  }
}

function init() {
  renderPicker();
  renderCollection();
  renderGrid();
  updateActiveBar();
  updateMarkUI();
  updateEngineUI();
}

bootstrap();
