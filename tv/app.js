let mqttClient = null;

function getWifiColor(rssi) {
  if (rssi === undefined || rssi === null || rssi === 0) return "var(--text-muted)";
  if (rssi >= -50) return "var(--status-running)"; // Excellent
  if (rssi >= -67) return "#34d399"; // Good
  if (rssi >= -75) return "var(--status-idle)"; // Fair
  if (rssi >= -85) return "#f97316"; // Poor
  return "var(--status-breakdown)"; // Weak
}

function getWifiSignalHTML(rssi) {
  if (rssi === undefined || rssi === null || rssi === 0) {
    return `<span class="wifi-signal-display" style="color: var(--text-muted); font-size: 0.8rem; margin-left: 10px; font-weight: normal;">📶 N/A</span>`;
  }
  
  let label = "Excellent";
  let color = "var(--status-running)";
  
  if (rssi >= -50) {
    label = "Excellent";
    color = "var(--status-running)";
  } else if (rssi >= -67) {
    label = "Good";
    color = "#34d399";
  } else if (rssi >= -75) {
    label = "Fair";
    color = "var(--status-idle)";
  } else if (rssi >= -85) {
    label = "Poor";
    color = "#f97316";
  } else {
    label = "Weak";
    color = "var(--status-breakdown)";
  }
  
  return `
    <span class="wifi-signal-display" style="display: inline-flex; align-items: center; gap: 6px; margin-left: 12px; color: ${color}; font-weight: 700; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 4px;" title="Signal Strength: ${rssi} dBm (${label})">
      <span style="font-size: 0.85rem;">📶</span>
      <span style="font-family: var(--font-mono); font-size: 0.85rem;">${rssi} dBm</span>
      <span style="font-size: 0.75rem; font-weight: 500; text-transform: uppercase; opacity: 0.9;">(${label})</span>
    </span>
  `;
}

// Initialize MQTT WebSockets connection
function initMQTT() {
  const isSecure = window.location.protocol === "https:";
  const broker = "broker.hivemq.com";
  const port = isSecure ? 8884 : 8000; // 8884 for secure WSS, 8000 for insecure WS
  const clientId = "ripple-dashboard-" + Math.floor(Math.random() * 10000);
  
  mqttClient = new Paho.MQTT.Client(broker, port, clientId);
  
  mqttClient.onConnectionLost = (responseObject) => {
    console.log("MQTT Connection Lost:", responseObject.errorMessage);
    addLog("MQTT", "Connection lost: " + responseObject.errorMessage, "alert");
    // Retry connection after 5 seconds
    setTimeout(initMQTT, 5000);
  };
  
  mqttClient.onMessageArrived = (message) => {
    handleIncomingMessage(message.destinationName, message.payloadString);
  };
  
  mqttClient.connect({
    onSuccess: () => {
      console.log("MQTT Connected");
      addLog("MQTT", `Connected to broker.hivemq.com:${port}`, "success");
      mqttClient.subscribe("CB_RN_IOT_DATA_OUT");
    },
    onFailure: (err) => {
      console.error("MQTT Connection Failed:", err);
      addLog("MQTT", "Failed to connect to broker: " + (err.errorMessage || JSON.stringify(err)), "alert");
      setTimeout(initMQTT, 5000);
    },
    useSSL: isSecure
  });
}

// Handle incoming JSON telemetry from Slave ESP32 nodes
function handleIncomingMessage(topic, payload) {
  try {
    const data = JSON.parse(payload);
    if (!data) return;
    
    const idKey = (data.device_id || data.id || "").toUpperCase();
    
    // Find the matching slave node in state by either ID (SL-001) or MAC Address
    const slave = state.slaves.find(s => 
      s.id.toUpperCase() === idKey || 
      s.mac.toUpperCase() === idKey
    );
    if (!slave) return;

    // Extract metadata from telemetry if present (e.g. from Slave 1)
    if (data.order_no) {
      let activeOrder = state.orders.find(o => o.active);
      if (!activeOrder && state.orders.length > 0) {
        activeOrder = state.orders[0];
        activeOrder.active = true;
      }
      if (activeOrder) {
        activeOrder.orderNumber = data.order_no;
        if (data.shift && data.shift !== "---") {
          activeOrder.shift = data.shift;
          state.shiftActive = true;
        }
      }
    }
    if (data.part_name && data.part_name !== "(---)") {
      state.activeItemName = data.part_name;
    }
    if (data.supervisor) {
      if (!state.shiftConfig) state.shiftConfig = {};
      state.shiftConfig.supervisor = data.supervisor;
    }
    if (data.pouch_qty) {
      if (!state.shiftConfig) state.shiftConfig = {};
      state.shiftConfig.pouchQty = parseInt(data.pouch_qty, 10) || 10;
    }
    if (data.outer_box) {
      if (!state.shiftConfig) state.shiftConfig = {};
      state.shiftConfig.outerBox = data.outer_box;
    }
    
    // Mark the slave as Connected and track telemetry timestamp
    slave.status = "Connected";
    slave.lastTelemetryTime = Date.now();
    slave.wifi_rssi = typeof data.wifi_rssi === 'number' ? data.wifi_rssi : (data.rssi !== undefined ? parseInt(data.rssi) : null);
    
    // If shift is active globally, check synchronization state of the slave
    if (state.shiftActive) {
      const activeOrder = state.orders.find(o => o.active);
      const activeShiftName = activeOrder ? activeOrder.shift : "Shift A";
      const slaveShiftName = data.shift || "";
      
      if (slaveShiftName.toUpperCase() === activeShiftName.toUpperCase()) {
        slave.shiftAcknowledged = true;
      } else if (!slave.shiftAcknowledged) {
        console.log(`Auto-triggering shift start config for slave: ${slave.id}`);
        const firstOp = slave.stations.length > 0 ? slave.stations[0].operator : state.operatorName;
        const stationOps = slave.stations.map(st => st.operator);
        publishDeviceConfig(slave.id, {
          shift: activeShiftName,
          operator: firstOp,
          operators: stationOps,
          pouch_qty: (state.shiftConfig && state.shiftConfig.pouchQty) ? state.shiftConfig.pouchQty : 10,
          outer_box: (state.shiftConfig && state.shiftConfig.outerBox) ? state.shiftConfig.outerBox : "10_12_48",
          maintenance: (state.shiftConfig && state.shiftConfig.maintenance) ? state.shiftConfig.maintenance : "",
          shift_start: true
        });
      }
    }
    
    // If stations array is present, update each station
    if (Array.isArray(data.stations)) {
      data.stations.forEach((incomingSt) => {
        const station = slave.stations.find(st => st.id === incomingSt.id);
        if (station) {
          if (state.shiftActive) {
            station.actualRaw = incomingSt.actual;
            if (station.id === 'st-10') {
              let qty_per_pouches = 10;
              let inner_box_qty = 1;
              let outer_box_qty = 1;
              if (state.shiftConfig && state.shiftConfig.outerBox) {
                const parts = state.shiftConfig.outerBox.split('_');
                qty_per_pouches = parseInt(parts[0]) || 10;
                inner_box_qty = parts[1] === 'Nill' ? 1 : (parseInt(parts[1]) || 1);
                outer_box_qty = parseInt(parts[2]) || 1;
              }
              const completed_boxes = Math.floor(incomingSt.actual / (inner_box_qty * outer_box_qty));
              const case_qty = qty_per_pouches * inner_box_qty * outer_box_qty;
              station.actual = completed_boxes * case_qty;
              station.actualRaw = completed_boxes;
              station.speed = incomingSt.speed || 0;
            } else {
              const mult = getStationMultiplier(station.id);
              station.actual = incomingSt.actual * mult;
              station.speed = (incomingSt.speed || 0) * mult;
            }
            station.status = incomingSt.status || "Running";
            if (typeof incomingSt.workingMins === 'number') station.workingMins = incomingSt.workingMins;
            if (typeof incomingSt.breakdownMins === 'number') station.breakdownMins = incomingSt.breakdownMins;
            if (incomingSt.operator) station.operator = incomingSt.operator;
            if (typeof incomingSt.target === 'number' && incomingSt.target > 0) station.target = incomingSt.target;
            if (typeof incomingSt.pending === 'number') station.pending = incomingSt.pending;
            if (typeof incomingSt.efficiency === 'number') station.efficiency = incomingSt.efficiency;
            if (incomingSt.breakdownReason !== undefined) {
              if (incomingSt.breakdownReason && incomingSt.breakdownReason !== station.breakdownReason) {
                addBreakdownLog(station, incomingSt.breakdownReason);
              }
              station.breakdownReason = incomingSt.breakdownReason;
            }
          } else {
            station.actualRaw = 0;
            station.actual = 0;
            station.speed = 0;
            station.status = "Idle";
          }
        }
      });
    }
    
    // Calculate and update virtual stations (Manual Pouching, Case Packing)
    updateVirtualStations();
    
    // Trigger dynamic dashboard view refresh
    renderSlaveSidebar();
    renderActiveSlaveView();
    updateGlobalStats();
    saveStateToLocalStorage();
    
  } catch (err) {
    console.error("Error parsing telemetry payload:", err);
  }
}

// Publish configuration to Slave nodes via MQTT
function publishDeviceConfig(deviceId, config) {
  if (!mqttClient || !mqttClient.isConnected()) {
    console.warn("MQTT client not connected, cannot publish config");
    return;
  }
  
  const payload = {
    id: deviceId,
    ...config
  };
  
  const message = new Paho.MQTT.Message(JSON.stringify(payload));
  message.destinationName = "CB_RN_IOT_DATA_IN";
  mqttClient.send(message);
  console.log("Published config to MQTT:", payload);
}

// Breakdown Log Helper Functions
function addBreakdownLog(station, reason) {
  if (!state.breakdownLogs) {
    state.breakdownLogs = [];
  }
  
  // Skip if consecutive duplicate entry for the same station and reason
  const stationLogs = state.breakdownLogs.filter(l => l.stationId === station.id);
  if (stationLogs.length > 0 && stationLogs[stationLogs.length - 1].reason === reason) {
    return;
  }

  // Format timestamp like "18:56:53" or similar local time format
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const bdMins = typeof station.breakdownMins === 'number' ? Math.round(station.breakdownMins) : 0;
  
  state.breakdownLogs.push({
    timestamp,
    stationId: station.id,
    stationName: station.name,
    reason,
    bdMins
  });
  renderBreakdownLogs();
}

function renderBreakdownLogs() {
  const tbody = document.getElementById('breakdown-log-table-body');
  const emptyMsg = document.getElementById('breakdown-log-empty-msg');
  if (!tbody) return;

  const logs = state.breakdownLogs || [];
  if (logs.length === 0) {
    tbody.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = 'block';
  } else {
    if (emptyMsg) emptyMsg.style.display = 'none';
    tbody.innerHTML = logs.map(log => `
      <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-white);">
        <td style="padding: 10px 8px; font-family: var(--font-mono); font-size: 0.8rem;">${log.timestamp}</td>
        <td style="padding: 10px 8px; font-weight: 500;">${log.stationName}</td>
        <td style="padding: 10px 8px; color: var(--accent-peach); font-weight: 500;">${log.reason}</td>
        <td style="padding: 10px 8px; color: var(--status-breakdown); font-weight: 600; font-family: var(--font-mono);">${log.bdMins} min</td>
      </tr>
    `).join('');
  }
}

function openBreakdownLogModal() {
  renderBreakdownLogs();
  document.getElementById('breakdown-log-modal').classList.add('open');
}

function closeBreakdownLogModal() {
  document.getElementById('breakdown-log-modal').classList.remove('open');
}

function clearBreakdownLogs() {
  state.breakdownLogs = [];
  renderBreakdownLogs();
  addLog('Breakdown Logs', 'Breakdown log history cleared.', 'warning');
  saveStateToLocalStorage();
}

// State Persistence Helpers
function saveStateToLocalStorage() {
  try {
    localStorage.setItem('ripple_iot_dashboard_state', JSON.stringify({
      activeSlaveId: state.activeSlaveId,
      simulationRunning: state.simulationRunning,
      shiftActive: state.shiftActive,
      logs: state.logs,
      breakdownLogs: state.breakdownLogs,
      activeItemName: state.activeItemName,
      operatorName: state.operatorName,
      shiftWorkingMins: state.shiftWorkingMins,
      shiftBreakdownMins: state.shiftBreakdownMins,
      shiftConfig: state.shiftConfig,
      shiftStartTime: state.shiftStartTime,
      shiftReports: state.shiftReports,
      orders: state.orders,
      slaves: state.slaves.map(slave => ({
        id: slave.id,
        status: slave.status,
        lastTelemetryTime: slave.lastTelemetryTime,
        shiftAcknowledged: slave.shiftAcknowledged,
        stations: slave.stations.map(st => ({
          id: st.id,
          target: st.target,
          actual: st.actual,
          actualRaw: st.actualRaw,
          status: st.status,
          speed: st.speed,
          breakdownReason: st.breakdownReason,
          notes: st.notes,
          operator: st.operator,
          workingMins: st.workingMins,
          breakdownMins: st.breakdownMins,
          rejectionQty: st.rejectionQty
        }))
      }))
    }));
  } catch (err) {
    console.error('Failed to save state to localStorage:', err);
  }
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem('ripple_iot_dashboard_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed) {
        state.activeSlaveId = parsed.activeSlaveId !== undefined ? parsed.activeSlaveId : 'all';
        state.simulationRunning = parsed.simulationRunning !== undefined ? parsed.simulationRunning : true;
        state.shiftActive = parsed.shiftActive !== undefined ? parsed.shiftActive : false;
        state.logs = Array.isArray(parsed.logs) ? parsed.logs : [];
        state.breakdownLogs = Array.isArray(parsed.breakdownLogs) ? parsed.breakdownLogs : [];
        state.activeItemName = parsed.activeItemName || 'T-light candle';
        state.operatorName = parsed.operatorName || 'SAGAR B.K';
        state.shiftWorkingMins = typeof parsed.shiftWorkingMins === 'number' ? parsed.shiftWorkingMins : 0.0;
        state.shiftBreakdownMins = typeof parsed.shiftBreakdownMins === 'number' ? parsed.shiftBreakdownMins : 0.0;
        state.shiftConfig = parsed.shiftConfig || null;
        state.shiftStartTime = parsed.shiftStartTime !== undefined ? parsed.shiftStartTime : null;
        state.shiftReports = Array.isArray(parsed.shiftReports) ? parsed.shiftReports : [];
        
        if (Array.isArray(parsed.orders)) {
          state.orders = parsed.orders;
        }
        
        if (Array.isArray(parsed.slaves)) {
          parsed.slaves.forEach(savedSlave => {
            const slave = state.slaves.find(s => s.id === savedSlave.id);
            if (slave) {
              slave.status = savedSlave.status || 'Disconnected';
              slave.lastTelemetryTime = savedSlave.lastTelemetryTime;
              slave.shiftAcknowledged = savedSlave.shiftAcknowledged !== undefined ? savedSlave.shiftAcknowledged : false;
              if (Array.isArray(savedSlave.stations)) {
                savedSlave.stations.forEach(savedSt => {
                  const station = slave.stations.find(st => st.id === savedSt.id);
                  if (station) {
                    station.target = typeof savedSt.target === 'number' ? savedSt.target : 0;
                    station.actual = typeof savedSt.actual === 'number' ? savedSt.actual : 0;
                    station.actualRaw = typeof savedSt.actualRaw === 'number' ? savedSt.actualRaw : 0;
                    station.status = savedSt.status || 'Idle';
                    station.speed = typeof savedSt.speed === 'number' ? savedSt.speed : 0;
                    station.breakdownReason = savedSt.breakdownReason || '';
                    station.notes = savedSt.notes || '';
                    station.operator = savedSt.operator || '';
                    station.workingMins = typeof savedSt.workingMins === 'number' ? savedSt.workingMins : 0;
                    station.breakdownMins = typeof savedSt.breakdownMins === 'number' ? savedSt.breakdownMins : 0;
                    if (savedSt.rejectionQty !== undefined) {
                      station.rejectionQty = savedSt.rejectionQty;
                    }
                  }
                });
              }
            }
          });
        }
        console.log('✅ State successfully loaded from localStorage');
      }
    }
  } catch (err) {
    console.error('Failed to load state from localStorage:', err);
  }
}

const state = {
  activeSlaveId: 'all', // Initially 'all' to show all stations in a single screen
  simulationRunning: true,
  shiftActive: false,
  logs: [],
  breakdownLogs: [],
  activeItemName: 'T-light candle',
  operatorName: 'SAGAR B.K',
  shiftWorkingMins: 0.0,
  shiftBreakdownMins: 0.0,
  shiftConfig: null,
  shiftStartTime: null,
  shiftReports: [],
  orders: [
    { id: 'ord-01', orderNumber: 'ORD-2026-001', date: '2026-06-15', shift: 'Shift A', targetQty: 80000, active: false },
    { id: 'ord-02', orderNumber: 'ORD-2026-002', date: '2026-06-15', shift: 'Shift B', targetQty: 100000, active: false }
  ],
  slaves: [
    {
      id: 'SL-001',
      name: 'Slave 1: Pressing & Cupping',
      mac: '00:E0:4C:53:11:A2',
      status: 'Connected',
      stations: [
        { id: 'st-01', name: 'Pressing_1', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'SAGAR B.K', workingMins: 0, breakdownMins: 0 },
        { id: 'st-02', name: 'Cupping 5', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'SHIVKUMAR', workingMins: 0, breakdownMins: 0 },
        { id: 'st-03', name: 'Cupping 4', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'LIKITH.B', workingMins: 0, breakdownMins: 0 }
      ]
    },
    {
      id: 'SL-002',
      name: 'Slave 2: Cupping Station',
      mac: '00:E0:4C:53:11:B3',
      status: 'Connected',
      stations: [
        { id: 'st-04', name: 'Cupping 3', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'MANJULA.S', workingMins: 0, breakdownMins: 0 },
        { id: 'st-05', name: 'Cupping 2', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'PRIYANKA', workingMins: 0, breakdownMins: 0 },
        { id: 'st-06', name: 'Cupping 1', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'SRIDEVI', workingMins: 0, breakdownMins: 0 }
      ]
    },
    {
      id: 'SL-003',
      name: 'Slave 3: Pouching & Sealing',
      mac: '00:E0:4C:53:11:C4',
      status: 'Connected',
      stations: [
        { id: 'st-08', name: 'Pouching Station 1', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'VANI SRI.T.R', workingMins: 0, breakdownMins: 0 },
        { id: 'st-11', name: 'Pouching Station 2', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'YASHWINI', workingMins: 0, breakdownMins: 0 },
        { id: 'st-12', name: 'Manual Pouching', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'MANUAL', workingMins: 0, breakdownMins: 0 }
      ]
    },
    {
      id: 'SL-004',
      name: 'Slave 4: Lebelling and box packaging',
      mac: '00:E0:4C:53:11:D5',
      status: 'Connected',
      stations: [
        { id: 'st-09', name: 'Labelling', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'MUBINA', workingMins: 0, breakdownMins: 0 },
        { id: 'st-10', name: 'Case Packing', target: 0, actual: 0, status: 'Idle', speed: 0, breakdownReason: '', notes: '', operator: 'MUBINA', workingMins: 0, breakdownMins: 0 }
      ]
    }
  ]
};

// Preset Breakdown Reasons for Dropdowns
const breakdownReasons = [
  'Motor issue',
  'Conveyer issue',
  'Press mould issue',
  'Press pin issue',
  'Press brass issue',
  'Sensor not working',
  'V belt damage',
  'Compressor Air issue',
  'Power issue',
  'Label machine issue',
  'Shrink tunnel issue'
];

// Active Modal Trackers
let currentModalStationId = null;
let editingOrderId = null;

// Zoom level state
let defaultZoom = 1.0;
if (window.screen.width >= 3840 || window.innerWidth >= 3840) {
  defaultZoom = 2.0; // 4K ST650K display default
} else if (window.screen.width >= 2560 || window.innerWidth >= 2560) {
  defaultZoom = 1.5; // 2K display default
}
let currentZoom = parseFloat(localStorage.getItem('tv_dashboard_zoom')) || defaultZoom;

function applyZoom(zoomVal) {
  currentZoom = Math.max(0.4, Math.min(2.5, parseFloat(zoomVal.toFixed(2))));
  
  // Set zoom on body
  document.body.style.zoom = currentZoom;
  // Also expose as a CSS variable for other components if needed
  document.documentElement.style.setProperty('--zoom-level', currentZoom);
  
  // Update the UI indicator text
  const zoomValSpan = document.getElementById('zoom-value');
  if (zoomValSpan) {
    zoomValSpan.textContent = Math.round(currentZoom * 100) + '%';
  }
  
  // Store the zoom setting in local storage
  localStorage.setItem('tv_dashboard_zoom', currentZoom);
}

// Slideshow Autocycling state
let autoCycleInterval = null;
let autoCycleActive = true;
const cycleList = ['all', 'SL-001', 'SL-002', 'SL-003', 'SL-004'];

// Update Shift Control Buttons state based on whether shift is active
function updateShiftButtons() {
  const btnStart = document.getElementById('btn-shift-start');
  const btnEnd = document.getElementById('btn-shift-end');
  if (btnStart && btnEnd) {
    btnStart.disabled = state.shiftActive;
    btnEnd.disabled = !state.shiftActive;
  }
}

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadStateFromLocalStorage();

  // Check for auto-submit if shift was left active from a previous day
  if (state.shiftActive) {
    const activeOrder = state.orders.find(o => o.active);
    const todayStr = new Date().toISOString().split('T')[0];
    if (activeOrder && activeOrder.date && activeOrder.date !== todayStr) {
      console.warn("⚠️ Previous shift active: auto-submitting...");
      addLog('System', 'Active shift left running from previous day (' + activeOrder.date + '). Auto-submitting report.', 'warning');
      doneShiftEnd();
    }
  }

  addLog('System', 'IRIS Ripple IoT Master online.', 'info');
  updateClock();
  setInterval(updateClock, 1000);
  
  // Initialize Orders
  applyActiveOrder();
  renderOrderDirectory();

  renderSlaveSidebar();
  renderActiveSlaveView();
  startTelemetryLoop();
  startAutoCycle();
  setupEventListeners();
  initMQTT();
  updateShiftButtons();
  
  // Initialize Zoom scaling
  applyZoom(currentZoom);
});

// Live Clock Updater
function updateClock() {
  const dateEl = document.getElementById('live-date');
  const timeEl = document.getElementById('live-time');
  if (dateEl && timeEl) {
    const now = new Date();
    const dateOptions = { year: 'numeric', month: 'short', day: 'numeric' };
    dateEl.innerText = now.toLocaleDateString('en-US', dateOptions);
    timeEl.innerText = now.toLocaleTimeString('en-US', { hour12: false });
  }
}

// Start auto-cycling slideshow pages
function startAutoCycle() {
  if (autoCycleInterval) clearInterval(autoCycleInterval);
  const duration = state.activeSlaveId === 'all' ? 10000 : 3000;
  autoCycleInterval = setInterval(() => {
    if (!autoCycleActive) return;
    
    let currentIndex = cycleList.indexOf(state.activeSlaveId);
    if (currentIndex === -1) currentIndex = 0;
    
    const nextIndex = (currentIndex + 1) % cycleList.length;
    selectSlave(cycleList[nextIndex], false); // false to indicate programmatic switch
  }, duration);
}

// Event Listeners Configuration
function setupEventListeners() {
  // Selected Slave Connection Status / Slideshow Toggle
  document.getElementById('slave-connection-toggle').addEventListener('change', (e) => {
    if (state.activeSlaveId === 'all') {
      autoCycleActive = e.target.checked;
      document.getElementById('slave-connection-label').innerText = autoCycleActive ? 'Slideshow: Playing (10s)' : 'Slideshow: Paused';
      addLog('Slideshow', `Auto-cycling slideshow ${autoCycleActive ? 'Resumed' : 'Paused'}.`, 'info');
      renderSlaveSidebar();
    } else {
      const activeSlave = state.slaves.find(s => s.id === state.activeSlaveId);
      if (activeSlave) {
        activeSlave.status = e.target.checked ? 'Connected' : 'Disconnected';
        document.getElementById('slave-connection-label').innerText = `Gateway Status: ${activeSlave.status}`;
        addLog(activeSlave.id, `Slave Node ${activeSlave.id} went ${activeSlave.status.toUpperCase()}.`, activeSlave.status === 'Connected' ? 'info' : 'alert');
        renderSlaveSidebar();
        renderActiveSlaveView();
        updateGlobalStats();
      }
    }
  });

  // Modal Buttons
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-save-btn').addEventListener('click', saveModalBreakdown);

  // Shift Control Buttons
  document.getElementById('btn-shift-start').addEventListener('click', openShiftStartModal);
  document.getElementById('btn-shift-end').addEventListener('click', openShiftEndModal);
  document.getElementById('btn-bd-reason').addEventListener('click', openBDReasonModal);
  document.getElementById('btn-bd-log').addEventListener('click', openBreakdownLogModal);

  // Breakdown Log Modal Buttons
  document.getElementById('bd-log-close-btn').addEventListener('click', closeBreakdownLogModal);
  document.getElementById('bd-log-done-btn').addEventListener('click', closeBreakdownLogModal);
  document.getElementById('bd-log-clear-btn').addEventListener('click', clearBreakdownLogs);

  document.getElementById('shift-start-close-btn').addEventListener('click', closeShiftStartModal);
  document.getElementById('shift-start-cancel-btn').addEventListener('click', closeShiftStartModal);
  document.getElementById('shift-start-done-btn').addEventListener('click', doneShiftStart);

  document.getElementById('shift-end-close-btn').addEventListener('click', closeShiftEndModal);
  document.getElementById('shift-end-cancel-btn').addEventListener('click', closeShiftEndModal);
  document.getElementById('shift-end-done-btn').addEventListener('click', doneShiftEnd);

  document.getElementById('bd-reason-close-btn').addEventListener('click', closeBDReasonModal);
  document.getElementById('bd-reason-cancel-btn').addEventListener('click', closeBDReasonModal);
  document.getElementById('bd-reason-done-btn').addEventListener('click', doneBDReason);

  // Create Order Listeners
  document.getElementById('create-order-close-btn').addEventListener('click', closeCreateOrderModal);
  document.getElementById('create-order-cancel-btn').addEventListener('click', closeCreateOrderModal);
  document.getElementById('create-order-done-btn').addEventListener('click', doneCreateOrder);

  // AI Suggestions buttons
  document.getElementById('ai-suggestions-close-btn').addEventListener('click', closeAISuggestionsModal);
  document.getElementById('ai-suggestions-ok-btn').addEventListener('click', closeAISuggestionsModal);

  // Zoom Controls Listeners
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    applyZoom(currentZoom - 0.05);
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    applyZoom(currentZoom + 0.05);
  });
  document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    let resetZoom = 1.0;
    if (window.screen.width >= 3840 || window.innerWidth >= 3840) {
      resetZoom = 2.0; // 4K default
    } else if (window.screen.width >= 2560 || window.innerWidth >= 2560) {
      resetZoom = 1.5; // 2K default
    }
    applyZoom(resetZoom);
  });

  // Mouse move listener to redirect to all stations overview page
  document.addEventListener('mousemove', () => {
    if (state.activeSlaveId !== 'all') {
      selectSlave('all');
    }
  });
}

// Show Premium Glassmorphic Loading Screen
function showLoading(text, durationMs, callback) {
  const overlay = document.getElementById('loading-overlay');
  const textEl = document.getElementById('loading-text');
  if (overlay) {
    if (textEl) textEl.innerText = text;
    overlay.classList.add('active');
    setTimeout(() => {
      overlay.classList.remove('active');
      if (callback) callback();
    }, durationMs);
  } else {
    if (callback) callback();
  }
}

// Log Event Message
function addLog(source, message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  state.logs.unshift({ time, source, message, type });
  
  // Cap logs at 30 entries
  if (state.logs.length > 30) state.logs.pop();
  saveStateToLocalStorage();

  const logListEl = document.getElementById('log-list');
  if (logListEl) {
    logListEl.innerHTML = state.logs.map(log => `
      <li class="log-item">
        <span class="log-time">[${log.time}]</span>
        <span class="log-message"><strong>${log.source}</strong>: ${log.message}</span>
        <span class="log-tag ${log.type}">${log.type.toUpperCase()}</span>
      </li>
    `).join('');
  }
}

// Render the Sidebar node list
function renderSlaveSidebar() {
  const listEl = document.getElementById('slave-list');
  
  const allActive = state.activeSlaveId === 'all' ? 'active' : '';
  let html = `
    <li class="slave-nav-item ${allActive}" onclick="selectSlave('all')">
      <div class="slave-nav-header">
        <span class="slave-name">All Stations Overview</span>
        <span class="slave-id-badge">ALL</span>
      </div>
      <div class="slave-meta">
        <span>Combined screen dashboard</span>
      </div>
      <div class="connection-indicator">
        <span class="pulse-dot ${autoCycleActive ? 'connected' : 'disconnected'}"></span>
        <span>Slideshow: ${autoCycleActive ? 'Cycling' : 'Stopped'}</span>
      </div>
    </li>
  `;

  html += state.slaves.map(slave => {
    const activeClass = slave.id === state.activeSlaveId ? 'active' : '';
    const alarmCount = slave.stations.filter(s => s.status === 'Major Breakdown').length;
    const isConn = slave.status === 'Connected';
    const activeCount = isConn ? slave.stations.filter(s => s.status === 'Running').length : 0;
    
    return `
      <li class="slave-nav-item ${activeClass}" onclick="selectSlave('${slave.id}')">
        <div class="slave-nav-header">
          <span class="slave-name">${slave.name.split(':')[1] || slave.name}</span>
          <span class="slave-id-badge">${slave.id}</span>
        </div>
        <div class="slave-meta">
          <span>MAC: ${slave.mac}</span>
          <span>Stations: ${slave.stations.length} (${activeCount} Active)</span>
        </div>
        <div class="connection-indicator">
          <span class="pulse-dot ${isConn ? 'connected' : 'disconnected'}"></span>
          <span>
            Gateway: ${slave.status}${isConn && slave.wifi_rssi !== undefined && slave.wifi_rssi !== null ? ` <span style="color: ${getWifiColor(slave.wifi_rssi)}; font-weight: 600; margin-left: 4px;">📶 ${slave.wifi_rssi} dBm</span>` : ''}
            ${alarmCount > 0 && isConn ? `<strong style="color: var(--status-breakdown); margin-left: 10px;">(${alarmCount} ALARM)</strong>` : ''}
          </span>
        </div>
        ${state.shiftActive ? `
        <div class="connection-indicator" style="margin-top: 4px;">
          <span class="pulse-dot ${slave.shiftAcknowledged ? 'connected' : 'disconnected'}" style="width: 6px; height: 6px; box-shadow: none;"></span>
          <span style="color: ${slave.shiftAcknowledged ? 'var(--status-running)' : 'var(--status-idle)'}; font-size: 0.75rem;">
            Shift: ${slave.shiftAcknowledged ? 'Synced' : 'Waiting Sync'}
          </span>
        </div>
        ` : ''}
      </li>
    `;
  }).join('');
  
  listEl.innerHTML = html;
}

// Select Active Slave Node
window.selectSlave = function(slaveId, resetTimer = true) {
  state.activeSlaveId = slaveId;
  
  // Always restart the cycle to apply the correct duration (10s for 'all', 3s for specific node)
  if (autoCycleActive) {
    startAutoCycle();
  }
  
  renderSlaveSidebar();
  renderActiveSlaveView();
};

// Find both slave and station globally from station ID
function findStationGlobal(stationId) {
  for (let s of state.slaves) {
    let st = s.stations.find(st => st.id === stationId);
    if (st) return { slave: s, station: st };
  }
  return { slave: null, station: null };
}

// Calculate station-specific math multiplier based on active shift configuration
function getStationMultiplier(stationId) {
  if (stationId === 'st-08' || stationId === 'st-11') {
    return (state.shiftConfig && state.shiftConfig.pouchQty) ? state.shiftConfig.pouchQty : 10;
  }
  if (stationId === 'st-09') {
    let qty_per_pouches = 10;
    if (state.shiftConfig && state.shiftConfig.outerBox) {
      const parts = state.shiftConfig.outerBox.split('_');
      qty_per_pouches = parseInt(parts[0]) || 10;
    } else if (state.shiftConfig && state.shiftConfig.pouchQty) {
      qty_per_pouches = state.shiftConfig.pouchQty;
    }
    return qty_per_pouches;
  }
  return 1;
}

// Calculate live machine efficiency based on linear elapsed shift time
function calculateLiveEfficiency(station) {
  if (typeof station.efficiency === 'number') {
    return station.efficiency;
  }
  if (!state.shiftActive || !state.shiftStartTime || station.target <= 0) {
    return 0;
  }
  const elapsedMinutes = (Date.now() - state.shiftStartTime) / 60000;
  const activeMins = Math.min(480, Math.max(1, elapsedMinutes));
  const expectedTargetSoFar = (station.target / 480) * activeMins;
  if (expectedTargetSoFar <= 0) return 0;
  return Math.min(100, Math.round((station.actual / expectedTargetSoFar) * 100));
}

// Render Main active slave view area
function renderActiveSlaveView() {
  const gridEl = document.getElementById('machine-grid');
  const connToggle = document.getElementById('slave-connection-toggle');
  const connLabel = document.getElementById('slave-connection-label');
  const mainViewEl = document.querySelector('main.dashboard-view');

  if (state.activeSlaveId === 'all') {
    // Lock viewport scroll and configure CSS classes
    document.body.classList.add('overview-mode-active');
    mainViewEl.classList.add('overview-mode');
    gridEl.classList.add('overview-mode');
    gridEl.classList.remove('single-station-view', 'stations-count-2', 'stations-count-3');

    document.getElementById('active-slave-name').innerText = "All Stations Overview";
    document.getElementById('active-slave-meta').innerText = "Master telemetry monitor | 4 Slaves Node Cluster";
    
    connToggle.checked = autoCycleActive;
    connLabel.innerText = autoCycleActive ? 'Slideshow: Playing (10s)' : 'Slideshow: Paused';

    let html = '';
    state.slaves.forEach(slave => {
      const isSlaveConnected = slave.status === 'Connected';
      
      slave.stations.forEach(station => {
        const pending = typeof station.pending === 'number' ? station.pending : Math.max(0, station.target - station.actual);
        const efficiency = calculateLiveEfficiency(station);
        
        let statClass = 'running';
        if (station.status === 'Idle') statClass = 'idle';
        if (station.status === 'Major Breakdown') statClass = 'breakdown';
        if (!isSlaveConnected) statClass = 'offline';

        const finalSpeed = (isSlaveConnected && state.shiftActive) ? station.speed : 0;

        html += `
          <div class="machine-card ${!isSlaveConnected ? 'offline' : ''}">
            <div class="machine-card-header">
              <div>
                <h3 class="machine-title" style="margin-bottom: 2px;">${station.name}</h3>
                <span style="font-size:0.6rem; color:var(--text-muted); font-family:var(--font-mono); font-weight: normal;">
                  ${slave.id} | MAC: ${slave.mac}${isSlaveConnected && slave.wifi_rssi !== undefined && slave.wifi_rssi !== null ? ` | RSSI: <strong style="color: ${getWifiColor(slave.wifi_rssi)}">${slave.wifi_rssi} dBm</strong>` : ''}
                </span>
              </div>
              <div class="status-pill-container">
                <span class="status-badge ${statClass}" onclick="toggleStationStatus('${station.id}')">
                  ${isSlaveConnected ? station.status : 'Offline'}
                </span>
              </div>
            </div>

            <!-- Metric Outputs -->
            <div class="metrics-row">
              <div class="metric-box">
                <span class="metric-label">Target</span>
                <span class="metric-num" style="cursor: pointer;" onclick="promptEditTarget('${station.id}')">${station.target.toLocaleString()}</span>
              </div>
              <div class="metric-box">
                <span class="metric-label">Actual</span>
                <span class="metric-num" id="actual-${station.id}">${Math.floor(station.actual).toLocaleString()}</span>
                ${(station.id === 'st-08' || station.id === 'st-11') ? `
                  <span class="metric-sub-label" style="font-size: 0.65rem; color: var(--accent-peach); display: block; margin-top: 2px;">
                    Pouches: ${(station.actualRaw || 0).toLocaleString()}
                  </span>
                ` : ''}
                ${station.id === 'st-09' ? `
                  <span class="metric-sub-label" style="font-size: 0.65rem; color: var(--accent-peach); display: block; margin-top: 2px;">
                    Pouches: ${(station.actualRaw || 0).toLocaleString()}
                  </span>
                ` : ''}
                ${station.id === 'st-10' ? `
                  <span class="metric-sub-label" style="font-size: 0.65rem; color: var(--accent-peach); display: block; margin-top: 2px;">
                    Box Cases: ${(station.actualRaw || 0).toLocaleString()}
                  </span>
                ` : ''}
              </div>
              <div class="metric-box">
                <span class="metric-label">Pending</span>
                <span class="metric-num" id="pending-${station.id}">${pending.toLocaleString()}</span>
              </div>
              <div class="metric-box">
                <span class="metric-label">Speed</span>
                <div class="speed-value-container">
                  <span class="speed-value" id="speed-${station.id}">${finalSpeed}</span>
                  <span class="speed-unit">${station.id === 'st-10' ? 'B/M' : 'P/M'}</span>
                </div>
              </div>
            </div>

            <!-- Production Efficiency Panel -->
            <div class="efficiency-panel">
              <div class="efficiency-header">
                <span class="efficiency-label">Efficiency</span>
                <span class="efficiency-percent" id="eff-${station.id}">${efficiency}%</span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill" id="fill-${station.id}" style="width: ${efficiency}%;"></div>
              </div>
            </div>

            <!-- Compact Shift Metadata inside card (Overview) -->
            <div class="compact-shift-meta" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px 8px; font-size:1.1rem; color:var(--text-muted); border-top:1px solid rgba(245,214,198,0.08); padding-top:6px; margin-top:4px; width:100%;">
              <span style="font-weight: 500; min-width: fit-content;" title="${station.operator}">Op: <strong style="color:var(--text-white); font-weight:600; font-size:1.15rem;">${station.operator}</strong></span>
              <span>Work: <strong style="color:var(--status-running); font-family:var(--font-mono); font-weight:600; font-size:1.3rem;">${station.workingMins.toFixed(1)}m</strong></span>
              <span>BD: <strong style="color:var(--status-breakdown); font-family:var(--font-mono); font-weight:600; font-size:1.3rem;">${station.breakdownMins.toFixed(1)}m</strong></span>
            </div>
          </div>
        `;
      });
    });

    gridEl.innerHTML = html;
    updateGlobalStats();
    return;
  }

  // Remove overview CSS classes when in a page slave view
  document.body.classList.remove('overview-mode-active');
  mainViewEl.classList.remove('overview-mode');
  gridEl.classList.remove('overview-mode');

  // Load active slave node
  const activeSlave = state.slaves.find(s => s.id === state.activeSlaveId);
  if (!activeSlave) return;

  // Toggle focused layout classes if there is only 1 station card on the screen
  if (activeSlave.stations.length === 1) {
    gridEl.classList.add('single-station-view');
  } else {
    gridEl.classList.remove('single-station-view');
  }
  gridEl.classList.remove('stations-count-2', 'stations-count-3');
  if (activeSlave.stations.length === 2) {
    gridEl.classList.add('stations-count-2');
  } else if (activeSlave.stations.length === 3) {
    gridEl.classList.add('stations-count-3');
  }

  const displayName = activeSlave.name.includes(':') ? activeSlave.name.split(':')[1].trim() : activeSlave.name;
  document.getElementById('active-slave-name').innerText = `${displayName} Monitoring`;
  document.getElementById('active-slave-meta').innerText = `ID: ${activeSlave.id} | MAC Address: ${activeSlave.mac}`;
  
  connToggle.checked = activeSlave.status === 'Connected';
  const isSlaveConnected = activeSlave.status === 'Connected';
  if (isSlaveConnected && activeSlave.wifi_rssi !== undefined && activeSlave.wifi_rssi !== null) {
    connLabel.innerHTML = `Gateway Status: Connected ${getWifiSignalHTML(activeSlave.wifi_rssi)}`;
  } else {
    connLabel.innerText = `Gateway Status: ${activeSlave.status}`;
  }

  if (activeSlave.stations.length === 0) {
    gridEl.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px 0;">No machines assigned to this Slave node.</p>`;
    return;
  }

  gridEl.innerHTML = activeSlave.stations.map(station => {
    const pending = typeof station.pending === 'number' ? station.pending : Math.max(0, station.target - station.actual);
    const efficiency = calculateLiveEfficiency(station);
    
    let statClass = 'running';
    if (station.status === 'Idle') statClass = 'idle';
    if (station.status === 'Major Breakdown') statClass = 'breakdown';
    if (!isSlaveConnected) statClass = 'offline';

    const finalSpeed = (isSlaveConnected && state.shiftActive) ? station.speed : 0;
    const speedClass = finalSpeed > 150 ? 'fast' : (finalSpeed > 0 ? '' : 'slow');
    const gearAnimationClass = !isSlaveConnected || finalSpeed === 0 ? 'stopped' : speedClass;

    const dropdownOptions = breakdownReasons.map(r => 
      `<option value="${r}" ${station.breakdownReason === r ? 'selected' : ''}>${r}</option>`
    ).join('');

    return `
      <div class="machine-card ${!isSlaveConnected ? 'offline' : ''}">
        <div class="machine-card-header">
          <div>
            <h3 class="machine-title">${station.name}</h3>
            <span style="font-size:0.65rem; color:var(--text-muted); font-family:var(--font-mono);">STATION: ${station.id}</span>
          </div>
          <div class="status-pill-container">
            <span class="status-badge ${statClass}" onclick="toggleStationStatus('${station.id}')">
              ${isSlaveConnected ? station.status : 'Offline'}
            </span>
          </div>
        </div>

        <!-- Metric Outputs -->
        <div class="metrics-row">
          <div class="metric-box">
            <span class="metric-label">Target Count</span>
            <span class="metric-num" style="cursor: pointer;" onclick="promptEditTarget('${station.id}')">${station.target.toLocaleString()}</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Actual Output</span>
            <span class="metric-num" id="actual-${station.id}">${Math.floor(station.actual).toLocaleString()}</span>
            ${(station.id === 'st-08' || station.id === 'st-11') ? `
              <span class="metric-sub-label" style="font-size: 0.65rem; color: var(--accent-peach); display: block; margin-top: 2px;">
                Pouches: ${(station.actualRaw || 0).toLocaleString()}
              </span>
            ` : ''}
            ${station.id === 'st-09' ? `
              <span class="metric-sub-label" style="font-size: 0.65rem; color: var(--accent-peach); display: block; margin-top: 2px;">
                Pouches: ${(station.actualRaw || 0).toLocaleString()}
              </span>
            ` : ''}
            ${station.id === 'st-10' ? `
              <span class="metric-sub-label" style="font-size: 0.65rem; color: var(--accent-peach); display: block; margin-top: 2px;">
                Box Cases: ${(station.actualRaw || 0).toLocaleString()}
              </span>
            ` : ''}
          </div>
          <div class="metric-box">
            <span class="metric-label">Pending Qty</span>
            <span class="metric-num" id="pending-${station.id}">${pending.toLocaleString()}</span>
          </div>
          <div class="metric-box">
            <span class="metric-label">Station Speed</span>
            <div class="speed-value-container">
              <span class="speed-value" id="speed-${station.id}">${finalSpeed}</span>
              <span class="speed-unit">${station.id === 'st-10' ? 'B/M' : 'P/M'}</span>
            </div>
          </div>
        </div>

        <!-- Production Efficiency Panel -->
        <div class="efficiency-panel">
          <div class="efficiency-header">
            <span class="efficiency-label">Efficiency</span>
            <span class="efficiency-percent" id="eff-${station.id}">${efficiency}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" id="fill-${station.id}" style="width: ${efficiency}%;"></div>
          </div>
        </div>

        <!-- Station Speed Gear & Telemetry -->
        <div class="speed-panel">
          <div class="speed-info">
            <span class="metric-label">Telemetry Stream</span>
            <span style="font-size:0.75rem; color:${isSlaveConnected ? 'var(--status-running)' : 'var(--status-offline)'}; display:flex; align-items:center; gap:4px;">
              <span style="width:6px; height:6px; background:currentColor; border-radius:50%;"></span>
              ${isSlaveConnected ? 'Live Connection Active' : 'Node Link Dropped'}
            </span>
          </div>
          <div class="speed-gauge-mock">
            <div class="speed-gear ${gearAnimationClass}"></div>
          </div>
        </div>

        <!-- Detailed Card Shift Meta (Inside card layout) -->
        <div class="card-shift-meta">
          <div class="shift-meta-item">
            <span class="shift-meta-label">Operator</span>
            <span class="shift-meta-val" onclick="promptEditStationOperator('${station.id}')" title="Click to edit operator">${station.operator}</span>
          </div>
          <div class="shift-meta-item">
            <span class="shift-meta-label">Working Mins</span>
            <span class="shift-meta-val highlight-green" id="work-mins-${station.id}">${station.workingMins.toFixed(1)} Min</span>
          </div>
          <div class="shift-meta-item">
            <span class="shift-meta-label">Breakdown Mins</span>
            <span class="shift-meta-val highlight-red" id="break-mins-${station.id}">${station.breakdownMins.toFixed(1)} Min</span>
          </div>
        </div>

        <!-- Inline Breakdown Reason Selector -->
        ${isSlaveConnected && station.status === 'Major Breakdown' ? `
          <div class="breakdown-selector-wrapper">
            <div class="breakdown-dropdown-container">
              <div class="breakdown-dropdown-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span class="breakdown-dropdown-label">🚨 Major Breakdown Logged</span>
                <span style="font-size:0.65rem; color:var(--text-muted); cursor:pointer; text-decoration:underline;" onclick="openDetailedModal('${station.id}')">Add Notes</span>
              </div>
              <div style="display:flex; gap: 8px; width: 100%;">
                <select class="breakdown-select" style="flex:1;" onchange="changeBreakdownReason('${station.id}', this.value)">
                  <option value="" disabled ${!station.breakdownReason ? 'selected' : ''}>-- Choose Reason --</option>
                  ${dropdownOptions}
                </select>
              </div>
              ${station.breakdownReason ? `
                <div class="breakdown-active-reason">
                  <span>Selected:</span> ${station.breakdownReason}
                  ${station.notes ? `<p style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">Notes: ${station.notes}</p>` : ''}
                </div>
              ` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  updateGlobalStats();
}

// Universal toggler (works for specific page and combined overview)
window.toggleStationStatus = function(stationId) {
  const { slave, station } = findStationGlobal(stationId);
  if (!slave || !station || slave.status === 'Disconnected') return;

  if (station.status === 'Running') {
    station.status = 'Idle';
    station.speed = 0;
    addLog(station.name, 'Station set to IDLE.', 'info');
  } else if (station.status === 'Idle') {
    station.status = 'Major Breakdown';
    station.speed = 0;
    station.breakdownReason = ''; 
    addLog(station.name, 'Alert: Major Breakdown logged.', 'alert');
    
    // Auto-open modal in overview mode since dropdown is hidden to fit screen height
    if (state.activeSlaveId === 'all') {
      openDetailedModal(stationId);
    }
  } else {
    station.status = 'Running';
    station.speed = Math.floor(Math.random() * 80) + 60;
    station.breakdownReason = '';
    station.notes = '';
    addLog(station.name, 'Station restored. Running normally.', 'info');
  }

  renderActiveSlaveView();
};

// Universal change breakdown reason
window.changeBreakdownReason = function(stationId, reason) {
  const { slave, station } = findStationGlobal(stationId);
  if (!station) return;

  if (reason && reason !== station.breakdownReason) {
    addBreakdownLog(station, reason);
  }
  station.breakdownReason = reason;
  addLog(station.name, `Breakdown Reason logged: ${reason}`, 'alert');
  renderActiveSlaveView();

  if (slave) {
    publishDeviceConfig(slave.id, { bd_reason: reason, station_id: stationId });
  }
};

// Universal prompt target editor
window.promptEditTarget = function(stationId) {
  const { slave, station } = findStationGlobal(stationId);
  if (!station) return;

  const newTarget = prompt(`Enter new target count for ${station.name}:`, station.target);
  if (newTarget !== null) {
    const val = parseInt(newTarget, 10);
    if (!isNaN(val) && val >= 0) {
      station.target = val;
      addLog(station.name, `Target updated to ${val.toLocaleString()}`, 'info');
      renderActiveSlaveView();
      if (slave) {
        publishDeviceConfig(slave.id, { targets: slave.stations.map(st => st.target) });
      }
    } else {
      alert('Please enter a valid positive number.');
    }
  }
};

// Universal modal notes editor
window.openDetailedModal = function(stationId) {
  const { station } = findStationGlobal(stationId);
  if (!station) return;

  currentModalStationId = stationId;
  document.getElementById('modal-title').innerText = `Breakdown Log: ${station.name}`;
  document.getElementById('modal-station-desc').innerText = `Report diagnostic details for ${station.name}.`;
  
  const reasonSelect = document.getElementById('modal-reason-select');
  reasonSelect.value = station.breakdownReason || 'Mechanical Jam';
  document.getElementById('modal-notes').value = station.notes || '';

  document.getElementById('breakdown-modal').classList.add('open');
};

function closeModal() {
  document.getElementById('breakdown-modal').classList.remove('open');
  currentModalStationId = null;
}

function saveModalBreakdown() {
  if (!currentModalStationId) return;

  const { slave, station } = findStationGlobal(currentModalStationId);
  if (!station) return;

  const reason = document.getElementById('modal-reason-select').value;
  const notes = document.getElementById('modal-notes').value;

  if (reason && reason !== station.breakdownReason) {
    addBreakdownLog(station, reason);
  }
  station.breakdownReason = reason;
  station.notes = notes;

  addLog(station.name, `Breakdown confirmed: ${reason}. Notes: ${notes.substring(0, 30)}${notes.length > 30 ? '...' : ''}`, 'alert');
  
  closeModal();
  renderActiveSlaveView();

  if (slave) {
    publishDeviceConfig(slave.id, { bd_reason: reason, station_id: currentModalStationId });
  }
}

// Telemetry live updates loop (No simulation, values read directly from MQTT hardware nodes)
function startTelemetryLoop() {
  // Initialize lastTelemetryTime for each slave on loop startup
  state.slaves.forEach(slave => {
    if (slave.lastTelemetryTime === undefined) {
      slave.lastTelemetryTime = Date.now();
    }
  });

  setInterval(() => {
    const now = Date.now();
    const disconnectThreshold = 10000; // 10 seconds timeout
    let statusChanged = false;

    state.slaves.forEach(slave => {
      if (slave.status === "Connected") {
        const lastTime = slave.lastTelemetryTime || 0;
        if (now - lastTime > disconnectThreshold) {
          slave.status = "Disconnected";
          addLog(slave.id, `Slave Node ${slave.id} has disconnected (no telemetry received for 10s).`, 'alert');
          statusChanged = true;
        }
      }
    });

    updateGlobalStats();

    if (statusChanged) {
      renderSlaveSidebar();
      renderActiveSlaveView();
    } else {
      // Periodically redraw active view to ensure OEE and other states match incoming MQTT data
      if (state.activeSlaveId === 'all') {
        renderActiveSlaveView();
      }
    }
  }, 3000);
}

// Calculate and update global numbers
function updateGlobalStats() {
  let totalMachines = 0;
  let runningMachines = 0;
  let alarmCount = 0;
  let activeSlaves = 0;

  state.slaves.forEach(slave => {
    const isConn = slave.status === 'Connected';
    if (isConn) activeSlaves++;

    slave.stations.forEach(station => {
      totalMachines++;
      if (isConn && station.status === 'Running') runningMachines++;
      if (isConn && station.status === 'Major Breakdown') alarmCount++;
    });
  });

  // Calculate global shift working/breakdown mins from connected stations
  let maxWorkingMins = 0;
  let maxBreakdownMins = 0;
  state.slaves.forEach(slave => {
    if (slave.status === 'Connected') {
      slave.stations.forEach(station => {
        if (station.workingMins > maxWorkingMins) {
          maxWorkingMins = station.workingMins;
        }
        if (station.breakdownMins > maxBreakdownMins) {
          maxBreakdownMins = station.breakdownMins;
        }
      });
    }
  });
  
  if (maxWorkingMins > 0) state.shiftWorkingMins = maxWorkingMins;
  if (maxBreakdownMins > 0) state.shiftBreakdownMins = maxBreakdownMins;

  // Update Meta Strip displays in DOM
  const workingEl = document.getElementById('shift-working-mins');
  const breakdownEl = document.getElementById('shift-breakdown-mins');
  if (workingEl) workingEl.innerText = state.shiftWorkingMins.toFixed(1) + ' Min';
  if (breakdownEl) breakdownEl.innerText = state.shiftBreakdownMins.toFixed(1) + ' Min';

  // Total Output is the actual output of the final packaging unit (st-09)
  const labelingStation = findStationGlobal('st-09').station;
  const totalOutput = labelingStation ? Math.floor(labelingStation.actual) : 0;

  // Target Count is defined by the active production order
  const activeOrder = state.orders.find(o => o.active);
  const totalTarget = activeOrder ? activeOrder.targetQty : 0;

  const availability = totalMachines > 0 ? (runningMachines / (totalMachines - alarmCount)) * 100 : 0;
  const performance = totalTarget > 0 ? (totalOutput / totalTarget) * 100 : 0;
  const oee = totalMachines > 0 ? Math.min(100, Math.round((performance * 0.985 + availability * 0.015))) : 0;

  const oeeEl = document.getElementById('global-oee');
  const activeSlavesEl = document.getElementById('global-active-slaves');
  const outputEl = document.getElementById('global-total-output');
  const targetEl = document.getElementById('global-order-target');
  const alarmsEl = document.getElementById('global-alarms');

  if (oeeEl) oeeEl.innerText = `${state.shiftActive && oee > 0 ? oee : 0}%`;
  if (activeSlavesEl) activeSlavesEl.innerText = `${activeSlaves}/${state.slaves.length}`;
  if (outputEl) outputEl.innerText = totalOutput.toLocaleString();
  if (targetEl) targetEl.innerText = totalTarget.toLocaleString();
  if (alarmsEl) alarmsEl.innerText = alarmCount;
}

// Simulation Fault Generator
function triggerRandomFault() {
  const runningStations = [];
  state.slaves.forEach(sl => {
    if (sl.status === 'Connected') {
      sl.stations.forEach(st => {
        if (st.status === 'Running') {
          runningStations.push({ slave: sl, station: st });
        }
      });
    }
  });

  if (runningStations.length === 0) {
    addLog('Simulator', 'No active running machines to fault.', 'info');
    return;
  }

  const selected = runningStations[Math.floor(Math.random() * runningStations.length)];
  const randomReason = breakdownReasons[Math.floor(Math.random() * breakdownReasons.length)];

  selected.station.status = 'Major Breakdown';
  selected.station.speed = 0;
  selected.station.breakdownReason = randomReason;
  selected.station.notes = 'System auto-generated simulation alert.';

  addLog(selected.station.name, `Fault Triggered: Major Breakdown - ${randomReason}`, 'alert');
  
  renderActiveSlaveView();
}

// Interactive Meta-strip controllers
window.changeActiveItem = function() {
  const newItem = prompt("Enter active item/product name:", state.activeItemName);
  if (newItem !== null && newItem.trim() !== '') {
    state.activeItemName = newItem.trim();
    document.getElementById('active-item-name').innerText = state.activeItemName;
    addLog('System', `Active item changed to: ${state.activeItemName}`, 'info');
  }
};

window.changeOperatorName = function() {
  const newOp = prompt("Enter operator name:", state.operatorName);
  if (newOp !== null && newOp.trim() !== '') {
    state.operatorName = newOp.trim();
    document.getElementById('operator-name').innerText = state.operatorName;
    addLog('System', `Operator changed to: ${state.operatorName}`, 'info');
  }
};

// Interactive card-specific operator modifier
window.promptEditStationOperator = function(stationId) {
  const { slave, station } = findStationGlobal(stationId);
  if (!station) return;
  
  const newOp = prompt(`Enter operator name for ${station.name}:`, station.operator);
  if (newOp !== null && newOp.trim() !== '') {
    station.operator = newOp.trim();
    addLog(station.name, `Operator changed to: ${station.operator}`, 'info');
    renderActiveSlaveView();
    if (slave) {
      const stationIdx = slave.stations.findIndex(st => st.id === stationId);
      publishDeviceConfig(slave.id, { 
        operator: station.operator,
        station_id: stationId,
        station_index: stationIdx
      });
    }
  }
};

/* ==========================================================================
   SHIFT START / END & BD REASON DIALOG MODAL LOGIC
   ========================================================================== */

const operatorList = [
  'SAGAR B.K',
  'SHIVKUMAR',
  'LIKITH.B',
  'MANJULA.S',
  'PRIYANKA',
  'SRIDEVI',
  'VANI SRI.T.R',
  'YASHWINI',
  'MUBINA',
  'JAYALAKSHMI',
  'VINA.N',
  'YASHODHA',
  'KASTHURI',
  'NIVEDITHA',
  'BHAVANI.C.N',
  'PUNYAVATHI',
  'SONU.P',
  'JYOTHI.N',
  'MANGALAGOWRI.M.S',
  'RANJINI',
  'PADMA',
  'RUKMINI',
  'JANIFER',
  'SHILPA',
  'SUSHMA',
  'LAKSHMI',
  'ANITHA',
  'LATHA',
  'KAMAKSHI',
  'GEETHA',
  'SUNITHA',
  'NISARGA',
  'THAYAMMA',
  'LAVANYA',
  'JASHPIN',
  'MANJULA B.R',
  'RATHNA',
  'SHASHIKALA N',
  'PADMA',
  'RAJESHWARI',
  'BHAGYA',
  'NANDHINI',
  'GAYATHRI',
  'MANJULA M',
  'GEETHA B.R',
  'JYOTHI',
  'SATHYA P',
  'KUMARI',
  'PRAVEENA B.C',
  'C B RANI',
  'RANI',
  'NIRMALA N',
  'ASHA M.V',
  'MAHESHWARI G.M',
  'SUMATHI',
  'PAVITHRA',
  'NAGARATHNA',
  'JAYAMALA',
  'JYOTHI Y.R',
  'ROOPA N',
  'SHILPA B',
  'HEMAVATHI R',
  'SUMA M',
  'PREMA D',
  'SOWMYA',
  'NANDHINI ROHITH',
  'NAGARATHNAMMA',
  'MANGALAGOWRI',
  'PRABHAVATHI',
  'MEENA',
  'ROJA',
  'RATHNAMMA',
  'KUMARI',
  'SAMPIGE',
  'CHANNI',
  'SHIVAKUMARI',
  'JAYASUNDARI',
  'MANJULA',
  'MALAGAMMA',
  'SUCHITHRA',
  'VEDAVATHI',
  'RENUKAMMA',
  'GYATHRI',
  'MANOJ S',
  'CHARAN'
];

window.filterOperatorDropdown = function(stationId, filterText) {
  const select = document.querySelector(`.operator-dropdown[data-station-id="${stationId}"]`);
  if (!select) return;
  
  const currentVal = select.value;
  const filter = filterText.toUpperCase();
  
  // Clear select
  select.innerHTML = '';
  
  // Filter matching operators
  const filtered = operatorList.filter(op => op.toUpperCase().includes(filter));
  
  // Re-populate select
  filtered.forEach(op => {
    const opt = document.createElement('option');
    opt.value = op;
    opt.textContent = op;
    if (op === currentVal) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  
  // If the previous value is not selected or matching, select the first match
  if (filtered.length > 0 && select.value === "") {
    select.value = filtered[0];
  }
};

function openShiftStartModal() {
  if (state.shiftActive) {
    alert("A shift is already active! Please end the current shift first.");
    return;
  }
  const listContainer = document.getElementById('shift-start-stations-list');
  listContainer.innerHTML = '';

  const skipCheckbox = document.getElementById('skip-operators-checkbox');
  skipCheckbox.checked = false;

  const allStations = [];
  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      allStations.push({ slave, station });
    });
  });

  allStations.forEach(({ slave, station }) => {
    let options = `<option value="" disabled ${!station.operator ? 'selected' : ''}>Select Operator</option>`;
    options += operatorList.map(op => 
      `<option value="${op}" ${station.operator === op ? 'selected' : ''}>${op}</option>`
    ).join('');

    const stationRow = document.createElement('div');
    stationRow.style.display = 'flex';
    stationRow.style.justifyContent = 'space-between';
    stationRow.style.alignItems = 'center';
    stationRow.style.padding = '8px 12px';
    stationRow.style.background = 'var(--bg-dark-accent)';
    stationRow.style.border = '1px solid var(--border-color)';
    stationRow.style.borderRadius = 'var(--radius-sm)';

    stationRow.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px; max-width: 50%;">
        <span style="font-weight:600; font-size:0.9rem;">${station.name}</span>
        <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);">${slave.id} | Current Op: ${station.operator}</span>
      </div>
      <div class="search-select-wrapper" style="display: flex; flex-direction: column; gap: 4px; width: 180px;">
        <input type="text" class="operator-search-input" data-station-id="${station.id}" placeholder="🔍 Search operator..." style="width: 100%; padding: 4px 8px; font-size: 0.75rem; background: var(--bg-dark); border: 1px solid var(--border-color); color: var(--text-white); border-radius: var(--radius-sm); outline: none;" oninput="filterOperatorDropdown('${station.id}', this.value)">
        <select class="breakdown-select operator-dropdown" data-station-id="${station.id}" style="width: 100%; padding: 6px 10px; margin: 0;">
          ${options}
        </select>
      </div>
    `;
    listContainer.appendChild(stationRow);
  });

  // Toggle dropdown and search state based on checkbox
  skipCheckbox.onchange = (e) => {
    const dropdowns = listContainer.querySelectorAll('.operator-dropdown');
    dropdowns.forEach(dd => dd.disabled = e.target.checked);
    const searchInputs = listContainer.querySelectorAll('.operator-search-input');
    searchInputs.forEach(input => input.disabled = e.target.checked);
  };

  document.getElementById('shift-start-modal').classList.add('open');

  // Prepopulate form inputs with existing shiftConfig
  if (state.shiftConfig) {
    const cupSizeEl = document.getElementById('shift-cup-size');
    const pouchQtyEl = document.getElementById('shift-pouch-qty');
    const outerBoxEl = document.getElementById('shift-outer-box');
    const supervisorEl = document.getElementById('shift-supervisor');
    const maintenanceEl = document.getElementById('shift-maintenance');
    if (cupSizeEl) cupSizeEl.value = state.shiftConfig.cupSize;
    if (pouchQtyEl) pouchQtyEl.value = state.shiftConfig.pouchQty;
    if (outerBoxEl) outerBoxEl.value = state.shiftConfig.outerBox;
    if (supervisorEl && state.shiftConfig.supervisor) supervisorEl.value = state.shiftConfig.supervisor;
    if (maintenanceEl && state.shiftConfig.maintenance) maintenanceEl.value = state.shiftConfig.maintenance;
  }
}

function closeShiftStartModal() {
  document.getElementById('shift-start-modal').classList.remove('open');
}

function doneShiftStart() {
  // 1. Validate Active Order Selection
  const activeOrder = state.orders.find(o => o.active);
  if (!activeOrder) {
    alert("INTERLOCK BLOCKED: Please select or create an active Production Order in the sidebar before starting the shift!");
    return;
  }

  // 2. Validate Target Quantity
  if (!activeOrder.targetQty || isNaN(activeOrder.targetQty) || activeOrder.targetQty <= 0) {
    alert("INTERLOCK BLOCKED: The active Production Order has no valid Target Quantity! Please edit the order to set a target quantity greater than 0 before starting the shift.");
    return;
  }

  // 3. Validate Parts Details / Active Item Name
  if (!state.activeItemName || state.activeItemName.trim() === "" || state.activeItemName === "---" || state.activeItemName.toUpperCase().includes("SELECT")) {
    alert("INTERLOCK BLOCKED: Active Item/Part name is not specified! Please click on the Active Item strip at the top to set the active product detail first.");
    return;
  }

  // 4. Validate Supervisor Selection
  const supervisorEl = document.getElementById('shift-supervisor');
  if (supervisorEl && (!supervisorEl.value || supervisorEl.value.trim() === "")) {
    alert("INTERLOCK BLOCKED: Please select a Supervisor Name before starting the shift!");
    return;
  }

  // 5. Validate Maintenance Selection
  const maintenanceEl = document.getElementById('shift-maintenance');
  if (maintenanceEl && (!maintenanceEl.value || maintenanceEl.value.trim() === "")) {
    alert("INTERLOCK BLOCKED: Please select a Maintenance Name before starting the shift!");
    return;
  }

  const skipCheckbox = document.getElementById('skip-operators-checkbox');
  const skip = skipCheckbox.checked;

  // Temp object to hold and validate operator assignments
  let tempOperators = {};

  if (!skip) {
    const dropdowns = document.querySelectorAll('.operator-dropdown');
    dropdowns.forEach(dd => {
      const stationId = dd.getAttribute('data-station-id');
      tempOperators[stationId] = dd.value;
    });
  }

  // 6. Validate Operators Name assigned to all stations
  let unassignedStations = [];
  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      const op = skip ? station.operator : tempOperators[station.id];
      if (!op || op.trim() === "" || op === "---" || op.toUpperCase().includes("SELECT")) {
        unassignedStations.push(`${station.name} (${slave.id})`);
      }
    });
  });

  if (unassignedStations.length > 0) {
    alert("INTERLOCK BLOCKED: Please assign a valid Operator Name to all stations before starting the shift!\n\nUnassigned stations:\n- " + unassignedStations.join("\n- "));
    return;
  }

  // If all validation interlocks pass, perform assignments:
  if (!skip) {
    const dropdowns = document.querySelectorAll('.operator-dropdown');
    dropdowns.forEach(dd => {
      const stationId = dd.getAttribute('data-station-id');
      const selectedOp = dd.value;
      const { station } = findStationGlobal(stationId);
      if (station) {
        station.operator = selectedOp;
      }
    });
  }

  // Retrieve shift configuration details
  const cupSizeEl = document.getElementById('shift-cup-size');
  const pouchQtyEl = document.getElementById('shift-pouch-qty');
  const outerBoxEl = document.getElementById('shift-outer-box');

  state.shiftConfig = {
    cupSize: cupSizeEl ? cupSizeEl.value : '9mm',
    pouchQty: pouchQtyEl ? parseInt(pouchQtyEl.value, 10) : 10,
    outerBox: outerBoxEl ? outerBoxEl.value : '10_12_48',
    supervisor: supervisorEl ? supervisorEl.value : '',
    maintenance: maintenanceEl ? maintenanceEl.value : ''
  };

  // Automatically distribute and fetch latest target plan & counts to stations
  applyActiveOrder();

  // Reset shift production metrics & status
  state.shiftActive = true;
  state.shiftStartTime = Date.now();
  state.shiftWorkingMins = 0;
  state.shiftBreakdownMins = 0;
  state.breakdownLogs = [];
  saveStateToLocalStorage();

  state.slaves.forEach(slave => {
    slave.shiftAcknowledged = false;
    slave.stations.forEach(station => {
      station.actual = 0;
      station.actualRaw = 0;
      station.workingMins = 0;
      station.breakdownMins = 0;
      station.status = 'Running';
      station.speed = Math.floor(Math.random() * 80) + 70;
      station.breakdownReason = '';
      station.notes = '';
      delete station.rejectionQty;
    });
  });

  // Broadcast shift_start to MQTT for all active slaves
  state.slaves.forEach(slave => {
    const firstOp = slave.stations.length > 0 ? slave.stations[0].operator : state.operatorName;
    const activeOrder = state.orders.find(o => o.active);
    const shiftName = activeOrder ? activeOrder.shift : "Shift A";
    const stationOps = slave.stations.map(st => st.operator);
    publishDeviceConfig(slave.id, {
      shift: shiftName,
      order_no: activeOrder ? activeOrder.orderNumber : "",
      part_name: state.activeItemName || "T-light candle",
      supervisor: (state.shiftConfig && state.shiftConfig.supervisor) ? state.shiftConfig.supervisor : "",
      operator: firstOp,
      operators: stationOps,
      targets: slave.stations.map(st => st.target),
      pouch_qty: (state.shiftConfig && state.shiftConfig.pouchQty) ? state.shiftConfig.pouchQty : 10,
      outer_box: (state.shiftConfig && state.shiftConfig.outerBox) ? state.shiftConfig.outerBox : "10_12_48",
      maintenance: (state.shiftConfig && state.shiftConfig.maintenance) ? state.shiftConfig.maintenance : "",
      shift_start: true
    });
  });

  addLog('Shift Control', 'New shift started. Production metrics reset.', 'success');
  closeShiftStartModal();
  const endManpowerEl = document.getElementById('shift-end-manpower');
  if (endManpowerEl) endManpowerEl.value = 0;
  updateShiftButtons();

  showLoading('Initializing Devices & Resetting Metrics...', 2000, () => {
    updateActiveOrderStrip();
    renderActiveSlaveView();
    updateGlobalStats();
  });
}

function openShiftEndModal() {
  if (!state.shiftActive) {
    alert("No active shift is running to end!");
    return;
  }
  const listContainer = document.getElementById('shift-end-stations-list');
  listContainer.innerHTML = '';

  const allStations = [];
  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      allStations.push({ slave, station });
    });
  });

  allStations.forEach(({ slave, station }) => {
    const stationRow = document.createElement('div');
    stationRow.style.display = 'flex';
    stationRow.style.justifyContent = 'space-between';
    stationRow.style.alignItems = 'center';
    stationRow.style.padding = '8px 12px';
    stationRow.style.background = 'var(--bg-dark-accent)';
    stationRow.style.border = '1px solid var(--border-color)';
    stationRow.style.borderRadius = 'var(--radius-sm)';

    stationRow.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px; max-width: 50%;">
        <span style="font-weight:600; font-size:0.9rem;">${station.name}</span>
        <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);">${slave.id} | Actual: ${Math.floor(station.actual).toLocaleString()}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <input type="number" class="rejection-input" data-station-id="${station.id}" value="0" min="0" max="${Math.floor(station.actual)}" style="width: 100px; padding: 6px; background:var(--bg-dark); border:1px solid var(--border-color); color:var(--text-white); border-radius:var(--radius-sm); font-family:var(--font-mono); outline:none;">
        <span style="font-size:0.75rem; color:var(--text-muted);">${station.id === 'st-10' ? 'Boxes' : 'Units'}</span>
      </div>
    `;
    listContainer.appendChild(stationRow);
  });

  document.getElementById('shift-end-modal').classList.add('open');
}

function closeShiftEndModal() {
  document.getElementById('shift-end-modal').classList.remove('open');
}

function closeAISuggestionsModal() {
  document.getElementById('ai-suggestions-modal').classList.remove('open');
}

function escapeHTML(val) {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sendTelegramSummary(messageText) {
  const token = "8786500968:AAFoDJA1m_uoOIQ1zSPBAfAJne9Xk-KmBb0";
  const chatId = "-5005894782";
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: "HTML"
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.ok) {
      console.log("✅ Telegram shift summary sent successfully");
      addLog("Telegram", "Shift summary sent to bot channel", "success");
    } else {
      console.error("❌ Telegram API error:", data);
      addLog("Telegram", "Failed to send summary: " + data.description, "alert");
    }
  })
  .catch(err => {
    console.error("❌ Telegram network error:", err);
    addLog("Telegram", "Network error sending summary", "alert");
  });
}

function sendEmailReportViaAppsScript(emailData) {
  const url = "https://script.google.com/macros/s/AKfycbyE6X67hqtHbPr9PXzxGWQQDMyF5Bq3TCyI_VDxwrStKk0PNdCrlfisUqlaBR0zs8sz/exec";
  
  fetch(url, {
    method: "POST",
    body: JSON.stringify(emailData)
  })
  .then(res => res.json())
  .then(data => {
    console.log("📨 Excel email report response received:", data);
    if (data.status === "success") {
      if (data.email_sent && data.telegram_sent) {
        addLog("Email", "Excel report and Telegram summary dispatched successfully", "success");
      } else {
        if (!data.email_sent) {
          console.warn("⚠️ Email report failed on Google Apps Script: " + data.email_error);
          addLog("Email", "Excel report failed to send: " + data.email_error, "alert");
        } else {
          addLog("Email", "Excel report dispatched successfully", "success");
        }
        
        if (!data.telegram_sent) {
          console.warn("⚠️ Telegram report failed on Apps Script: " + data.telegram_error + ". Falling back to client-side...");
          addLog("Telegram", "Apps Script Telegram failed: " + data.telegram_error + ". Triggering client-side fallback...", "warning");
          sendTelegramDirectFallback(emailData.telegram_text);
        } else {
          addLog("Telegram", "Telegram summary dispatched successfully", "success");
        }
      }
    } else {
      console.error("❌ Apps Script error:", data.message);
      addLog("Email", "Apps Script dispatch error: " + data.message, "alert");
      addLog("Telegram", "Attempting client-side direct Telegram fallback...", "warning");
      sendTelegramDirectFallback(emailData.telegram_text);
    }
  })
  .catch(err => {
    console.error("❌ Email dispatch error:", err);
    addLog("Email", "Network error dispatching Excel report, attempting client-side direct Telegram fallback...", "alert");
    
    // Direct fallback for Telegram report in case Google Apps Script web app is unreachable or blocked
    sendTelegramDirectFallback(emailData.telegram_text);
  });
}

function sendTelegramDirectFallback(messageText) {
  const token = "8786500968:AAFoDJA1m_uoOIQ1zSPBAfAJne9Xk-KmBb0";
  const chatId = "-5005894782";
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML'
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.ok) {
      console.log("✅ Fallback Telegram report sent successfully client-side!");
      addLog("Telegram", "Fallback Telegram summary sent successfully", "success");
    } else {
      console.error("❌ Fallback Telegram API error:", data);
      addLog("Telegram", `API error sending fallback: ${data.description}`, "alert");
    }
  })
  .catch(err => {
    console.error("❌ Fallback Telegram connection error:", err);
    addLog("Telegram", "Network error sending fallback Telegram summary", "alert");
  });
}

function generateAISuggestions(currentReport, historicalReports) {
  const suggestions = [];

  const avgOee = historicalReports && historicalReports.length > 0
    ? historicalReports.reduce((acc, r) => acc + (r.oee || 0), 0) / historicalReports.length
    : 85.0;

  if (currentReport.oee < 80) {
    suggestions.push({
      category: "Line OEE Performance Warning",
      icon: "⚠️",
      impact: "High",
      impactColor: "var(--status-breakdown)",
      detail: `OEE is at ${currentReport.oee}%, which is below the target 80%. Main driver is ${currentReport.availability < currentReport.performance ? 'Line Availability (' + currentReport.availability.toFixed(1) + '%)' : 'Performance Rate (' + currentReport.performance.toFixed(1) + '%)'}. Focus on minimizing minor stops.`,
      basis: `OEE is below 80% threshold (Current: ${currentReport.oee}% vs Historical Avg: ${avgOee.toFixed(1)}%)`
    });
  } else if (currentReport.oee < avgOee) {
    suggestions.push({
      category: "Efficiency Decline",
      icon: "📉",
      impact: "Medium",
      impactColor: "var(--status-idle)",
      detail: `OEE of ${currentReport.oee}% is below the historical average of ${avgOee.toFixed(1)}%. Review changeover times and check for any startup delays at the beginning of the shift.`,
      basis: `OEE is below historical average`
    });
  } else {
    suggestions.push({
      category: "Excellent OEE Performance",
      icon: "🏆",
      impact: "Positive",
      impactColor: "var(--status-running)",
      detail: `Great job! This shift achieved ${currentReport.oee}% OEE, which meets or exceeds the historical average of ${avgOee.toFixed(1)}%. Maintain the current pacing and process settings.`,
      basis: `OEE met historical standards`
    });
  }

  currentReport.stations.forEach(st => {
    if (st.actual > 0) {
      const rejRate = (st.rejections / st.actual) * 100;
      if (rejRate > 2.0) {
        suggestions.push({
          category: `High Rejections at ${st.name}`,
          icon: "❌",
          impact: "High",
          impactColor: "var(--status-breakdown)",
          detail: `Station ${st.name} has a rejection rate of ${rejRate.toFixed(1)}% (${st.rejections} rejections out of ${st.actual} produced). Operator ${st.operator || 'N/A'} should inspect the mould alignment, feed settings, or raw material consistency.`,
          basis: `Rejection rate ${rejRate.toFixed(1)}% exceeds standard 2.0% limit`
        });
      }
    }
  });

  currentReport.stations.forEach(st => {
    const bdMins = Math.round(st.breakdown_hrs * 60);
    if (st.breakdown_hrs > 0.5) {
      let remedy = "Schedule a preventative maintenance check on electrical and mechanical components before the next run.";
      if (st.bd_reason) {
        if (st.bd_reason.toLowerCase().includes("mould") || st.bd_reason.toLowerCase().includes("pin")) {
          remedy = `Inspect mold alignment, check pins and brass components for wear, and apply lubrication.`;
        } else if (st.bd_reason.toLowerCase().includes("motor") || st.bd_reason.toLowerCase().includes("conveyer")) {
          remedy = `Inspect motor wiring, check belt tensioning, and check conveyor bearings.`;
        } else if (st.bd_reason.toLowerCase().includes("sensor")) {
          remedy = `Clean sensor optical path, check sensor alignment, and verify electrical connection stability.`;
        }
      }
      suggestions.push({
        category: `Extended Downtime - ${st.name}`,
        icon: "🛠️",
        impact: "High",
        impactColor: "var(--status-breakdown)",
        detail: `Downtime of ${bdMins} minutes was recorded at ${st.name} due to "${st.bd_reason || 'Unknown breakdown'}". ${remedy}`,
        basis: `Breakdown time exceeded 30 minutes`
      });
    }
  });

  if (currentReport.stations.length > 1) {
    let lowestSt = null;
    let lowestEff = 100;
    currentReport.stations.forEach(st => {
      if (st.prod_efficiency < lowestEff && st.target > 0) {
        lowestEff = st.prod_efficiency;
        lowestSt = st;
      }
    });

    if (lowestSt && lowestEff < 85) {
      suggestions.push({
        category: `Process Bottleneck - ${lowestSt.name}`,
        icon: "⚡",
        impact: "Medium",
        impactColor: "var(--status-idle)",
        detail: `Station ${lowestSt.name} is the primary production bottleneck, achieving only ${lowestEff}% of its target (${lowestSt.net.toLocaleString()} net output vs ${lowestSt.target.toLocaleString()} target). Analyze operator pacing or check if upstream material supply is choking this station.`,
        basis: `Lowest production efficiency on the line (${lowestEff}%)`
      });
    }
  }

  // 1. Identify best operator based on production efficiency
  let bestOp = null;
  let bestOpEff = -1;
  let bestOpStation = "";
  currentReport.stations.forEach(st => {
    if (st.target > 0 && st.prod_efficiency > bestOpEff && st.operator) {
      bestOpEff = st.prod_efficiency;
      bestOp = st.operator;
      bestOpStation = st.name;
    }
  });
  if (bestOp && bestOpEff > 0) {
    suggestions.push({
      category: "Best Operator of the Shift",
      icon: "👤",
      impact: "Positive",
      impactColor: "var(--status-running)",
      detail: `Operator ${bestOp} at ${bestOpStation} maintained the best production efficiency of ${bestOpEff}% in this shift. Recognize their high performance!`,
      basis: `Highest production efficiency among all active stations`
    });
  }

  // 2. Identify best performing station (highest efficiency to breakdown ratio)
  let bestStation = null;
  let bestStationScore = -1;
  currentReport.stations.forEach(st => {
    if (st.target > 0) {
      const bdMins = st.breakdown_hrs * 60;
      const score = st.prod_efficiency - (bdMins * 0.5);
      if (score > bestStationScore) {
        bestStationScore = score;
        bestStation = st;
      }
    }
  });
  if (bestStation) {
    suggestions.push({
      category: "Best Performing Station",
      icon: "⭐",
      impact: "Positive",
      impactColor: "var(--status-running)",
      detail: `Station ${bestStation.name} performed exceptionally well, achieving ${bestStation.prod_efficiency}% efficiency with ${bestStation.actual.toLocaleString()} output and only ${(bestStation.breakdown_hrs * 60).toFixed(0)} minutes of breakdown.`,
      basis: `Highest efficiency-to-downtime ratio`
    });
  }

  // 3. Analyze repeated breakdowns and prescribe solutions
  const currentBreakdowns = currentReport.breakdownLogs || [];
  if (currentBreakdowns.length > 0 && historicalReports && historicalReports.length > 0) {
    const historyLogCounts = {};
    historicalReports.forEach(r => {
      const pastLogs = r.breakdownLogs || [];
      pastLogs.forEach(log => {
        const key = `${(log.stationId || "").toUpperCase()}||${(log.reason || "").toUpperCase()}`;
        historyLogCounts[key] = (historyLogCounts[key] || 0) + 1;
      });
    });

    currentBreakdowns.forEach(log => {
      const key = `${(log.stationId || "").toUpperCase()}||${(log.reason || "").toUpperCase()}`;
      const count = historyLogCounts[key] || 0;
      if (count >= 1) {
        let solution = "Conduct a root cause analysis (RCA) and check for component wear or loose connections.";
        const reasonLower = log.reason.toLowerCase();
        if (reasonLower.includes("mould") || reasonLower.includes("pin") || reasonLower.includes("cupping")) {
          solution = "Replace the guide pins, verify brass bushings tolerance, and recalibrate the locking alignment.";
        } else if (reasonLower.includes("motor") || reasonLower.includes("conveyor")) {
          solution = "Replace the conveyor motor brushes/gearbox, check bearing play, and ensure belt tension is within limits.";
        } else if (reasonLower.includes("sensor") || reasonLower.includes("miss")) {
          solution = "Relocate the sensor away from dust/vibration, check for shielded cabling to avoid EMF noise, or replace the photo-reflective sensor.";
        } else if (reasonLower.includes("jam")) {
          solution = "Adjust guide rails clearance, check feed hopper gating, and ensure feed materials conform to sizing specifications.";
        }
        
        suggestions.push({
          category: `Recurring Breakdown - ${log.stationName}`,
          icon: "🚨",
          impact: "Critical",
          impactColor: "var(--status-breakdown)",
          detail: `Breakdown "${log.reason}" has occurred ${count + 1} times in recent shifts at ${log.stationName}. SOLUTION: ${solution}`,
          basis: `Breakdown matches recurring pattern in historical shift logs`
        });
      }
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      category: "Standard Line Maintenance",
      icon: "⚙️",
      impact: "Info",
      impactColor: "var(--status-offline)",
      detail: "Line performance is nominal and stable. Perform routine cleaning and safety check sheets before beginning the next shift.",
      basis: "No critical anomalies or bottlenecks detected"
    });
  }

  return suggestions;
}

function doneShiftEnd() {
  const inputs = document.querySelectorAll('.rejection-input');
  let totalRejections = 0;
  let totalOutput = 0;

  // Calculate live machine counts and status BEFORE modifying them to Idle
  let totalMachines = 0;
  let runningMachines = 0;
  let alarmCount = 0;
  state.slaves.forEach(slave => {
    const isConn = slave.status === 'Connected';
    slave.stations.forEach(station => {
      totalMachines++;
      if (isConn && station.status === 'Running') runningMachines++;
      if (isConn && station.status === 'Major Breakdown') alarmCount++;
    });
  });

  const availability = totalMachines > 0 ? (runningMachines / (totalMachines - alarmCount)) * 100 : 0;

  if (inputs.length === 0) {
    state.slaves.forEach(slave => {
      slave.stations.forEach(station => {
        station.rejectionQty = 0;
        totalOutput += Math.floor(station.actual);
        station.status = 'Idle';
        station.speed = 0;
      });
    });
  } else {
    inputs.forEach(input => {
      const stationId = input.getAttribute('data-station-id');
      const rejectionQty = parseInt(input.value) || 0;
      const { station } = findStationGlobal(stationId);
      if (station) {
        station.rejectionQty = rejectionQty;
        totalRejections += rejectionQty;
        totalOutput += Math.floor(station.actual);
        
        // Stop the station
        station.status = 'Idle';
        station.speed = 0;
      }
    });
  }

  // End active shift
  state.shiftActive = false;

  // Broadcast shift_end to MQTT for all active slaves
  state.slaves.forEach(slave => {
    publishDeviceConfig(slave.id, {
      shift_end: true
    });
  });

  // Target Count is defined by the active production order
  const activeOrder = state.orders.find(o => o.active);
  const totalTarget = activeOrder ? activeOrder.targetQty : 80000;
  const shiftName = activeOrder ? activeOrder.shift : "Shift A";
  const orderDate = activeOrder ? activeOrder.date : new Date().toISOString().split('T')[0];

  // Retrieve Manpower Count
  const manpowerEl = document.getElementById('shift-end-manpower');
  const manpowerCount = manpowerEl ? parseFloat(manpowerEl.value) || 0 : 0;

  // Format Timestamps
  const formatDateTime = (ts) => {
    if (!ts) return "N/A";
    const d = new Date(ts);
    return d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  const startTimeStr = formatDateTime(state.shiftStartTime);
  const endTimeStr = formatDateTime(Date.now());

  // Calculate exit output and performance rate
  const labelingStation = findStationGlobal('st-09').station;
  const exitOutput = labelingStation ? Math.floor(labelingStation.actual) : 0;
  const performance = totalTarget > 0 ? (exitOutput / totalTarget) * 100 : 0;
  const oee = totalMachines > 0 ? Math.min(100, Math.round((performance * 0.985 + availability * 0.015))) : 0;

  // Construct complete shift end message text
  let summaryText = `<b>📋 SHIFT END PRODUCTION SUMMARY</b>\n`;
  summaryText += `----------------------------------\n`;
  summaryText += `<b>Date:</b> ${escapeHTML(orderDate)} | <b>Shift:</b> ${escapeHTML(shiftName)}\n`;
  summaryText += `<b>Start Time:</b> ${startTimeStr}\n`;
  summaryText += `<b>End Time:</b> ${endTimeStr}\n`;
  summaryText += `<b>Manpower:</b> ${manpowerCount}\n`;
  if (state.shiftConfig) {
    const boxLabels = {
      "10_12_48": "pouch: 10, inner: 12, outer: 48",
      "24_8_32": "pouch: 24, inner: 8, outer: 32",
      "30_Nill_30": "pouch: 30, inner: Nill, outer: 30",
      "50_Nill_20": "pouch: 50, inner: Nill, outer: 20",
      "50_8_16": "pouch: 50, inner: 8, outer: 16",
      "100_4_8": "pouch: 100, inner: 4, outer: 8"
    };
    const boxLabel = boxLabels[state.shiftConfig.outerBox] || state.shiftConfig.outerBox;
    summaryText += `<b>Cup Size:</b> ${escapeHTML(state.shiftConfig.cupSize)} | <b>Qty/Pouch:</b> ${state.shiftConfig.pouchQty}\n`;
    summaryText += `<b>Box Case:</b> ${escapeHTML(boxLabel)}\n`;
    if (state.shiftConfig.supervisor) summaryText += `<b>Supervisor:</b> ${escapeHTML(state.shiftConfig.supervisor)}\n`;
    if (state.shiftConfig.maintenance) summaryText += `<b>Maintenance:</b> ${escapeHTML(state.shiftConfig.maintenance)}\n`;
  }
  summaryText += `<b>Total Output:</b> ${totalOutput.toLocaleString()} / Target: ${totalTarget.toLocaleString()}\n`;
  summaryText += `<b>Total Rejections:</b> ${totalRejections.toLocaleString()}\n`;
  summaryText += `----------------------------------\n\n`;

  let totalStationTargets = 0;
  let totalStationNet = 0;
  let totalStationWorkingMins = 0;
  let totalStationMins = 0;

  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      const actualInt = Math.floor(station.actual);
      const targetInt = station.target;
      const rejInt = station.rejectionQty || 0;
      const netInt = actualInt - rejInt;
      const prodEff = targetInt > 0 ? Math.min(100, Math.round((netInt / targetInt) * 100)) : 0;
      
      const totalMins = station.workingMins + station.breakdownMins;
      const machEff = totalMins > 0 ? Math.min(100, Math.round((station.workingMins / totalMins) * 100)) : 100;
      
      totalStationTargets += targetInt;
      totalStationNet += netInt;
      totalStationWorkingMins += station.workingMins;
      totalStationMins += totalMins;

      const workHrs = (station.workingMins / 60).toFixed(2);
      const bdHrs = (station.breakdownMins / 60).toFixed(2);

      summaryText += `<b>Station: ${escapeHTML(station.name)} (${escapeHTML(station.id)})</b>\n`;
      summaryText += `👤 Op: ${escapeHTML(station.operator)} | ⚡ Spd: ${station.speed} ${station.id === 'st-10' ? 'B/M' : 'P/M'}\n`;
      summaryText += `🎯 Tar: ${targetInt.toLocaleString()} | 📦 Act: ${actualInt.toLocaleString()} | ❌ Rej: ${rejInt.toLocaleString()} (Net: ${netInt.toLocaleString()})\n`;
      summaryText += `📈 Eff: Prod ${prodEff}% / Mach ${machEff}%\n`;
      summaryText += `⏳ Work: ${workHrs}h | ⚠️ BD: ${bdHrs}h${station.breakdownReason ? ` [🚨 ${escapeHTML(station.breakdownReason)}]` : ''}\n`;
      summaryText += `----------------------------------\n\n`;
    });
  });

  const overallProdEff = totalStationTargets > 0 ? Math.min(100, (totalStationNet / totalStationTargets) * 100) : 0;
  const overallMachEff = totalStationMins > 0 ? Math.min(100, (totalStationWorkingMins / totalStationMins) * 100) : 100;

  // Append overall performance indicators and OEE to the end
  summaryText += `<b>🏆 OVERALL PERFORMANCE INDICATORS</b>\n`;
  summaryText += `----------------------------------\n`;
  summaryText += `<b>📈 Line Availability:</b> ${availability.toFixed(1)}%\n`;
  summaryText += `<b>📉 Performance Rate:</b> ${performance.toFixed(1)}%\n`;
  summaryText += `<b>🎯 Overall Production Efficiency:</b> ${overallProdEff.toFixed(1)}%\n`;
  summaryText += `<b>⚙️ Overall Machine Efficiency:</b> ${overallMachEff.toFixed(1)}%\n`;
  summaryText += `<b>⚡ Overall OEE (Efficiency):</b> ${oee}%\n`;
  summaryText += `----------------------------------\n`;

  // Append Breakdown Logs to Telegram Report
  summaryText += `\n<b>🛠 BREAKDOWN LOGS</b>\n`;
  summaryText += `----------------------------------\n`;
  const logs = state.breakdownLogs || [];
  if (logs.length === 0) {
    summaryText += `No breakdowns logged in this shift.\n`;
  } else {
    logs.forEach(log => {
      summaryText += `• [${escapeHTML(log.timestamp)}] <b>${escapeHTML(log.stationName)}:</b> ${escapeHTML(log.reason)} (${log.bdMins} min)\n`;
    });
  }
  summaryText += `----------------------------------\n`;

  // Compile stations data for the Excel email report
  const stationsData = [];
  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      const actualInt = Math.floor(station.actual);
      const targetInt = station.target;
      const rejInt = station.rejectionQty || 0;
      const netInt = actualInt - rejInt;
      const prodEff = targetInt > 0 ? Math.min(100, Math.round((netInt / targetInt) * 100)) : 0;
      
      const totalMins = station.workingMins + station.breakdownMins;
      const machEff = totalMins > 0 ? Math.min(100, Math.round((station.workingMins / totalMins) * 100)) : 100;
      
      const workHrs = (station.workingMins / 60).toFixed(2);
      const bdHrs = (station.breakdownMins / 60).toFixed(2);

      stationsData.push({
        id: station.id,
        name: station.name,
        operator: station.operator,
        target: targetInt,
        actual: actualInt,
        rejections: rejInt,
        net: netInt,
        speed: station.speed,
        working_hrs: parseFloat(workHrs),
        breakdown_hrs: parseFloat(bdHrs),
        prod_efficiency: prodEff,
        machine_efficiency: machEff,
        bd_reason: station.breakdownReason || ""
      });
    });
  });

  const boxLabels = {
    "10_12_48": "10 (Inner: 12, Outer: 48)",
    "24_8_32": "24 (Inner: 8, Outer: 32)",
    "30_Nill_30": "30 (Inner: Nill, Outer: 30)",
    "50_Nill_20": "50 (Inner: Nill, Outer: 20)",
    "50_8_16": "50 (Inner: 8, Outer: 16)",
    "100_4_8": "100 (Inner: 4, Outer: 8)"
  };
  const boxLabel = state.shiftConfig ? (boxLabels[state.shiftConfig.outerBox] || state.shiftConfig.outerBox) : "N/A";

  const currentReport = {
    date: orderDate,
    shift: shiftName,
    cupSize: state.shiftConfig ? state.shiftConfig.cupSize : "N/A",
    pouchQty: state.shiftConfig ? state.shiftConfig.pouchQty : 0,
    boxLabel: boxLabel,
    totalOutput: totalOutput,
    totalRejections: totalRejections,
    availability: availability,
    performance: performance,
    oee: oee,
    overallProdEff: overallProdEff,
    overallMachEff: overallMachEff,
    breakdownLogs: JSON.parse(JSON.stringify(state.breakdownLogs || [])),
    stations: JSON.parse(JSON.stringify(stationsData))
  };

  if (!state.shiftReports) {
    state.shiftReports = [];
  }
  state.shiftReports.push(currentReport);
  if (state.shiftReports.length > 30) {
    state.shiftReports.shift();
  }
  saveStateToLocalStorage();

  const aiSuggestions = generateAISuggestions(currentReport, state.shiftReports.slice(0, -1));

  // Append suggestions to Telegram summary text
  summaryText += `\n<b>✨ AI PRODUCTION RECOMMENDATIONS</b>\n`;
  summaryText += `----------------------------------\n`;
  aiSuggestions.slice(0, 3).forEach(s => {
    summaryText += `${s.icon} <b>[${escapeHTML(s.category)}]</b> (Impact: ${escapeHTML(s.impact)})\n`;
    summaryText += `• Suggestion: ${escapeHTML(s.detail)}\n`;
  });
  summaryText += `----------------------------------\n`;

  // Render suggestions in UI modal
  const recommendationsList = document.getElementById('ai-recommendations-list');
  if (recommendationsList) {
    recommendationsList.innerHTML = aiSuggestions.map(s => `
      <div class="ai-suggestion-card" style="background: rgba(36, 30, 27, 0.5); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 15px; display: flex; flex-direction: column; gap: 8px; transition: var(--transition-smooth);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <h4 style="color: var(--accent-peach); font-size: 0.95rem; margin: 0; display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 1.1rem;">${s.icon}</span> ${s.category}
          </h4>
          <span style="background: rgba(232, 155, 126, 0.15); color: ${s.impactColor}; font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; font-weight: 500;">Impact: ${s.impact}</span>
        </div>
        <p style="color: var(--text-white); font-size: 0.85rem; margin: 0; line-height: 1.4;">
          ${s.detail}
        </p>
        <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 10px; border-top: 1px solid rgba(245, 214, 198, 0.05); padding-top: 6px; margin-top: 4px;">
          <span><strong>Basis:</strong> ${s.basis}</span>
        </div>
      </div>
    `).join('');
  }

  const emailData = {
    action: "send_email_report",
    email: "riontechnologies2021@gmail.com",
    telegram_text: summaryText, // Triggers server-side Telegram post via Apps Script
    shift_info: {
      date: orderDate,
      shift: shiftName,
      cup_size: state.shiftConfig ? state.shiftConfig.cupSize : "N/A",
      pouch_qty: state.shiftConfig ? state.shiftConfig.pouchQty : 0,
      outer_box: boxLabel,
      supervisor: state.shiftConfig ? state.shiftConfig.supervisor : "N/A",
      maintenance: state.shiftConfig ? state.shiftConfig.maintenance : "N/A",
      manpower: manpowerCount
    },
    stations: stationsData,
    metrics: {
      availability: parseFloat(availability.toFixed(1)),
      performance: parseFloat(performance.toFixed(1)),
      overall_prod_eff: parseFloat(overallProdEff.toFixed(1)),
      overall_mach_eff: parseFloat(overallMachEff.toFixed(1)),
      overall_oee: oee
    },
    ai_suggestions: aiSuggestions.map(s => `[${s.category}] ${s.detail}`).join('\n')
  };

  // Dispatch the email request (which now also sends the Telegram notification server-side)
  sendEmailReportViaAppsScript(emailData);

  // Open the AI suggestions popup modal dialog
  document.getElementById('ai-suggestions-modal').classList.add('open');

  // Reset all stations information
  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      station.actual = 0;
      station.actualRaw = 0;
      station.target = 0;
      station.rejectionQty = 0;
      station.speed = 0;
      station.workingMins = 0;
      station.breakdownMins = 0;
      station.status = 'Idle';
      station.breakdownReason = '';
      station.notes = '';
    });
  });

  // Reset shift timing values & configurations
  state.shiftWorkingMins = 0;
  state.shiftBreakdownMins = 0;
  state.shiftConfig = null;
  state.breakdownLogs = [];

  // Reset production orders to inactive state
  state.orders.forEach(o => o.active = false);

  addLog('Shift Control', `Shift ended. Output: ${totalOutput.toLocaleString()}, Rejections: ${totalRejections.toLocaleString()}, Net: ${(totalOutput - totalRejections).toLocaleString()}`, 'warning');
  closeShiftEndModal();
  updateShiftButtons();

  showLoading('Compiling Production Report & Sending Email...', 2500, () => {
    updateActiveOrderStrip();
    renderOrderDirectory();
    renderActiveSlaveView();
    updateGlobalStats();
  });
}

function openBDReasonModal() {
  const listContainer = document.getElementById('bd-reason-stations-list');
  listContainer.innerHTML = '';

  const bdIdleStations = [];
  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      if (station.status === 'Major Breakdown' || station.status === 'Idle') {
        bdIdleStations.push({ slave, station });
      }
    });
  });

  if (bdIdleStations.length === 0) {
    listContainer.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding: 20px 0; font-size: 0.85rem;">No stations are currently in Breakdown or Idle status.</p>`;
    document.getElementById('bd-reason-done-btn').style.display = 'none';
  } else {
    document.getElementById('bd-reason-done-btn').style.display = 'inline-block';
    
    bdIdleStations.forEach(({ slave, station }) => {
      const options = breakdownReasons.map(r => 
        `<option value="${r}" ${station.breakdownReason === r ? 'selected' : ''}>${r}</option>`
      ).join('');

      const stationRow = document.createElement('div');
      stationRow.style.display = 'flex';
      stationRow.style.justifyContent = 'space-between';
      stationRow.style.alignItems = 'center';
      stationRow.style.padding = '8px 12px';
      stationRow.style.background = 'var(--bg-dark-accent)';
      stationRow.style.border = '1px solid var(--border-color)';
      stationRow.style.borderRadius = 'var(--radius-sm)';

      const statusColor = station.status === 'Major Breakdown' ? 'var(--status-breakdown)' : 'var(--status-idle)';

      stationRow.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px; max-width: 45%;">
          <span style="font-weight:600; font-size:0.9rem;">${station.name}</span>
          <span style="font-size:0.75rem; color:${statusColor}; font-weight:500;">Status: ${station.status}</span>
        </div>
        <select class="breakdown-select station-bd-dropdown" data-station-id="${station.id}" style="width: 220px; padding: 6px 10px;">
          <option value="" disabled ${!station.breakdownReason ? 'selected' : ''}>-- Choose Reason --</option>
          ${options}
        </select>
      `;
      listContainer.appendChild(stationRow);
    });
  }

  document.getElementById('bd-reason-modal').classList.add('open');
}

function closeBDReasonModal() {
  document.getElementById('bd-reason-modal').classList.remove('open');
}

function doneBDReason() {
  const dropdowns = document.querySelectorAll('.station-bd-dropdown');
  dropdowns.forEach(dd => {
    const stationId = dd.getAttribute('data-station-id');
    const selectedReason = dd.value;
    if (selectedReason) {
      const { slave, station } = findStationGlobal(stationId);
      if (station) {
        if (selectedReason !== station.breakdownReason) {
          addBreakdownLog(station, selectedReason);
        }
        station.breakdownReason = selectedReason;
        addLog(station.name, `Breakdown Reason logged: ${selectedReason}`, 'alert');
        if (slave) {
          publishDeviceConfig(slave.id, { bd_reason: selectedReason, station_id: stationId });
        }
      }
    }
  });

  closeBDReasonModal();
  renderActiveSlaveView();
}

/* ==========================================================================
   PRODUCTION ORDER MANAGEMENT LOGIC
   ========================================================================== */

function updateActiveOrderStrip() {
  const activeOrder = state.orders.find(o => o.active);
  const activeOrderStrip = document.getElementById('active-order-strip');
  
  if (!activeOrderStrip) return;
  
  if (!activeOrder) {
    activeOrderStrip.innerHTML = `<span><strong style="color: var(--status-breakdown);">NO ACTIVE ORDER</strong></span>`;
    return;
  }
  
  const ordNumStr = activeOrder.orderNumber ? `<span><strong style="color: var(--accent-peach);">ORDER NO:</strong> ${activeOrder.orderNumber}</span>` : `<span><strong style="color: var(--accent-peach);">ORDER NO:</strong> --</span>`;
  let html = `
    ${ordNumStr}
    <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">ORDER DATE:</strong> ${activeOrder.date}</span>
    <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">SHIFT:</strong> ${activeOrder.shift}</span>
    <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">ORDER TARGET:</strong> ${activeOrder.targetQty.toLocaleString()} Units</span>
  `;
  
  if (state.shiftConfig) {
    const boxLabels = {
      "10_12_48": "10 (Inner: 12, Outer: 48)",
      "24_8_32": "24 (Inner: 8, Outer: 32)",
      "30_Nill_30": "30 (Inner: Nill, Outer: 30)",
      "50_Nill_20": "50 (Inner: Nill, Outer: 20)",
      "50_8_16": "50 (Inner: 8, Outer: 16)",
      "100_4_8": "100 (Inner: 4, Outer: 8)"
    };
    const boxLabel = boxLabels[state.shiftConfig.outerBox] || state.shiftConfig.outerBox;
    
    html += `
      <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">CUP SIZE:</strong> ${state.shiftConfig.cupSize}</span>
      <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">QTY/POUCH:</strong> ${state.shiftConfig.pouchQty}</span>
      <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">BOX CASE:</strong> ${boxLabel}</span>
      <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">SUPERVISOR:</strong> ${state.shiftConfig.supervisor || 'N/A'}</span>
      <span style="border-left: 1px solid var(--border-color); padding-left: 10px;"><strong style="color: var(--accent-peach);">MAINTENANCE:</strong> ${state.shiftConfig.maintenance || 'N/A'}</span>
    `;
  }
  
  activeOrderStrip.innerHTML = html;
}

function applyActiveOrder() {
  const activeOrder = state.orders.find(o => o.active);
  
  if (!activeOrder) {
    updateActiveOrderStrip();
    return;
  }
  
  // Update strip display
  updateActiveOrderStrip();
  
  // Distribute target quantity based on manufacturing line splits:
  // - Pressing (st-01): Same as Order Target (T)
  // - Cupping (st-02, st-03, st-04, st-05, st-06): Order Target / 5 (T / 5)
  // - Pouching (st-08, st-11): Order Target / 2 (T / 2)
  // - Labelling & Box Packaging (st-09): Same as Order Target (T)
  const T = activeOrder.targetQty;
  state.slaves.forEach(slave => {
    slave.stations.forEach(station => {
      if (station.id === 'st-01') {
        station.target = T;
      } else if (station.id === 'st-02' || station.id === 'st-03' || station.id === 'st-04' || station.id === 'st-05' || station.id === 'st-06') {
        station.target = Math.round(T / 5);
      } else if (station.id === 'st-08' || station.id === 'st-11') {
        station.target = Math.round(T * 0.25);
      } else if (station.id === 'st-12') {
        station.target = Math.round(T * 0.50);
      } else if (station.id === 'st-09') {
        station.target = T;
      } else if (station.id === 'st-10') {
        station.target = T;
      }
    });
  });

  updateVirtualStations();

  // Broadcast new order configuration targets to MQTT for all active slaves
  state.slaves.forEach(slave => {
    const targets = slave.stations.map(st => st.target);
    publishDeviceConfig(slave.id, {
      shift: activeOrder.shift,
      targets: targets,
      order_target: T
    });
  });
}

function renderOrderDirectory() {
  const sidebar = document.querySelector('aside.sidebar');
  if (!sidebar) return;
  
  // Check if order list container exists in sidebar, if not create it
  let orderSection = document.getElementById('sidebar-orders-section');
  if (!orderSection) {
    orderSection = document.createElement('div');
    orderSection.id = 'sidebar-orders-section';
    orderSection.style.marginTop = '20px';
    orderSection.style.display = 'flex';
    orderSection.style.flexDirection = 'column';
    orderSection.style.gap = '12px';
    orderSection.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 class="sidebar-title">Production Orders</h3>
        <button id="btn-create-order" style="background:transparent; border:1px solid var(--accent-peach); color:var(--accent-peach); border-radius:4px; padding:2px 8px; font-size:0.7rem; font-weight:600; cursor:pointer; text-transform:uppercase; transition:var(--transition-smooth); margin:0;">+ New</button>
      </div>
      <ul class="slave-nav-list" id="order-list" style="max-height: 320px; overflow-y: auto; list-style:none;">
        <!-- Rendered dynamically -->
      </ul>
    `;
    sidebar.appendChild(orderSection);
    
    // Add event listener to the "+ New" button we just created
    document.getElementById('btn-create-order').addEventListener('click', openCreateOrderModal);
  }
  
  const listEl = document.getElementById('order-list');
  if (!listEl) return;
  
  listEl.innerHTML = state.orders.map(order => {
    const activeClass = order.active ? 'active' : '';
    const ordNumStr = order.orderNumber ? `<div style="font-size:0.65rem; font-weight:bold; color:var(--accent-peach); margin-bottom: 2px;"># ${order.orderNumber}</div>` : '';
    return `
      <li class="slave-nav-item ${activeClass}" onclick="selectOrder('${order.id}')" style="padding: 12px; margin-bottom: 8px; border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor:pointer;">
        <div class="slave-nav-header" style="margin-bottom: 2px; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; flex-direction:column;">
            ${ordNumStr}
            <span class="slave-name" style="font-size:0.8rem; font-weight:600;">${order.shift}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.85rem; cursor:pointer;" onclick="event.stopPropagation(); openEditOrderModal('${order.id}')" title="Edit Order">✏️</span>
            <span class="slave-id-badge" style="font-size:0.6rem; padding: 2px 6px; border-radius: 4px; background:${order.active ? 'var(--status-running)' : 'rgba(255,255,255,0.05)'}; color:${order.active ? 'var(--bg-dark)' : 'var(--text-muted)'}; font-weight:bold;">${order.active ? 'ACTIVE' : 'PENDING'}</span>
          </div>
        </div>
        <div class="slave-meta" style="font-size:0.65rem; color:var(--text-muted); display:flex; justify-content:space-between; width:100%;">
          <span>Date: ${order.date}</span>
          <span>Target: ${order.targetQty.toLocaleString()}</span>
        </div>
      </li>
    `;
  }).join('');
}

window.selectOrder = function(orderId) {
  state.orders.forEach(o => o.active = (o.id === orderId));
  applyActiveOrder();
  renderOrderDirectory();
  renderActiveSlaveView();
  updateGlobalStats();
  const activeOrder = state.orders.find(o => o.active);
  const orderRef = activeOrder.orderNumber ? `${activeOrder.orderNumber} (${activeOrder.shift})` : activeOrder.shift;
  addLog('Order Control', `Production order activated: ${orderRef}`, 'info');
};

function openCreateOrderModal() {
  editingOrderId = null;
  document.getElementById('order-modal-title').innerText = "Create Production Order";
  document.getElementById('create-order-done-btn').innerText = "Done & Create Order";
  
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('order-number-input').value = "";
  document.getElementById('order-date-input').value = today;
  document.getElementById('order-target-input').value = 80000;
  document.getElementById('order-shift-input').value = "Shift A";
  
  document.getElementById('create-order-modal').classList.add('open');
}

window.openEditOrderModal = function(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  
  editingOrderId = orderId;
  document.getElementById('order-modal-title').innerText = "Edit Production Order";
  document.getElementById('create-order-done-btn').innerText = "Save Changes";
  
  document.getElementById('order-number-input').value = order.orderNumber || "";
  document.getElementById('order-date-input').value = order.date;
  document.getElementById('order-shift-input').value = order.shift;
  document.getElementById('order-target-input').value = order.targetQty;
  
  document.getElementById('create-order-modal').classList.add('open');
};

function closeCreateOrderModal() {
  document.getElementById('create-order-modal').classList.remove('open');
}

function doneCreateOrder() {
  const orderNumberVal = document.getElementById('order-number-input').value.trim();
  const dateVal = document.getElementById('order-date-input').value;
  const shiftVal = document.getElementById('order-shift-input').value;
  const targetVal = parseInt(document.getElementById('order-target-input').value);
  
  if (!orderNumberVal) {
    alert("Please enter a valid Order Number.");
    return;
  }
  if (!dateVal) {
    alert("Please enter a valid date.");
    return;
  }
  if (isNaN(targetVal) || targetVal <= 0) {
    alert("Please enter a valid Target Quantity greater than 0.");
    return;
  }
  
  if (editingOrderId) {
    const order = state.orders.find(o => o.id === editingOrderId);
    if (order) {
      order.orderNumber = orderNumberVal || ('ORD-' + Date.now().toString().slice(-6));
      order.date = dateVal;
      order.shift = shiftVal;
      order.targetQty = targetVal;
      addLog('Order Control', `Updated order: ${order.orderNumber} - ${shiftVal} (Target: ${targetVal.toLocaleString()})`, 'success');
    }
  } else {
    const newOrder = {
      id: 'ord-' + (state.orders.length + 1) + '-' + Date.now().toString().slice(-4),
      orderNumber: orderNumberVal || ('ORD-' + Date.now().toString().slice(-6)),
      date: dateVal,
      shift: shiftVal,
      targetQty: targetVal,
      active: true
    };
    
    // Deactivate others
    state.orders.forEach(o => o.active = false);
    
    // Add to start of list
    state.orders.unshift(newOrder);
    
    addLog('Order Control', `Created and activated new order: ${newOrder.orderNumber} - ${shiftVal} (Target: ${targetVal.toLocaleString()})`, 'success');
  }
  
  closeCreateOrderModal();
  applyActiveOrder();
  renderOrderDirectory();
  renderActiveSlaveView();
  updateGlobalStats();
}

function updateVirtualStations() {
  const p1 = findStationGlobal('st-08').station;
  const p2 = findStationGlobal('st-11').station;
  const manual = findStationGlobal('st-12').station;
  const label = findStationGlobal('st-09').station;
  const packing = findStationGlobal('st-10').station;
  
  const activeOrder = state.orders.find(o => o.active);
  const T = activeOrder ? activeOrder.targetQty : 80000;
  
  if (p1) p1.target = Math.round(T * 0.25);
  if (p2) p2.target = Math.round(T * 0.25);
  if (manual) {
    manual.target = Math.round(T * 0.50);
    if (p1 && p2 && label) {
      manual.actual = Math.max(0, label.actual - p1.actual - p2.actual);
      manual.status = (p1.status === 'Running' || p2.status === 'Running') ? 'Running' : 'Idle';
      manual.speed = Math.max(0, label.speed - p1.speed - p2.speed);
    }
  }
  
  if (packing && label) {
    let qty_per_pouches = 10;
    let inner_box_qty = 1;
    let outer_box_qty = 1;
    if (state.shiftConfig && state.shiftConfig.outerBox) {
      const parts = state.shiftConfig.outerBox.split('_');
      qty_per_pouches = parseInt(parts[0]) || 10;
      inner_box_qty = parts[1] === 'Nill' ? 1 : (parseInt(parts[1]) || 1);
      outer_box_qty = parseInt(parts[2]) || 1;
    }
    const case_qty = qty_per_pouches * inner_box_qty * outer_box_qty;
    
    const completed_boxes = Math.floor(label.actual / case_qty);
    packing.actual = completed_boxes * case_qty;
    packing.actualRaw = completed_boxes;
    packing.speed = label.speed > 0 ? (label.speed / case_qty) : 0;
  }
}
