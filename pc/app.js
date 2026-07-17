let mqttClient = null;

function getWifiColor(rssi) {
  if (rssi === undefined || rssi === null || rssi === 0) return "var(--text-muted)";
  if (rssi >= -50) return "var(--status-running)"; // Excellent
  if (rssi >= -67) return "#34d399"; // Good
  if (rssi >= -75) return "var(--status-idle)"; // Fair
  if (rssi >= -85) return "#f97316"; // Poor
  return "var(--status-breakdown)"; // Weak
}

// Initialize MQTT WebSockets connection
function initMQTT() {
  const isSecure = window.location.protocol === "https:";
  const broker = "broker.hivemq.com";
  const port = isSecure ? 8884 : 8000;
  const clientId = "ripple-pc-monitor-" + Math.floor(Math.random() * 10000);
  
  mqttClient = new Paho.MQTT.Client(broker, port, clientId);
  
  mqttClient.onConnectionLost = (responseObject) => {
    console.log("MQTT Connection Lost:", responseObject.errorMessage);
    setTimeout(initMQTT, 5000);
  };
  
  mqttClient.onMessageArrived = (message) => {
    handleIncomingMessage(message.destinationName, message.payloadString);
  };
  
  mqttClient.connect({
    onSuccess: () => {
      console.log("MQTT Monitor Connected to broker.hivemq.com");
      mqttClient.subscribe("CB_RN_IOT_DATA_OUT");
    },
    onFailure: (err) => {
      console.error("MQTT Connection Failed:", err);
      setTimeout(initMQTT, 5000);
    },
    useSSL: isSecure
  });
}

// Telemetry live updates loop to handle node disconnections and evaluate active shift status
function startTelemetryLoop() {
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
          statusChanged = true;
        }
      }
    });

    const newShiftActive = state.slaves.some(s => s.status === "Connected" && s.shift && s.shift !== "---");
    if (newShiftActive !== state.shiftActive) {
      state.shiftActive = newShiftActive;
      statusChanged = true;
    }

    if (statusChanged) {
      renderActiveSlaveView();
      updateGlobalStats();
      saveStateToLocalStorage();
    }
  }, 3000);
}

// Handle incoming JSON telemetry from Slave ESP32 nodes
function handleIncomingMessage(topic, payload) {
  try {
    const data = JSON.parse(payload);
    if (!data) return;
    
    const idKey = (data.device_id || data.id || "").toUpperCase();
    
    // Find matching slave in local state
    const slave = state.slaves.find(s => 
      s.id.toUpperCase() === idKey || 
      s.mac.toUpperCase() === idKey
    );
    if (!slave) return;

    // Extract metadata from telemetry if present (e.g. from Slave 1)
    if (data.order_no && data.shift && data.shift !== "---") {
      let activeOrder = state.orders.find(o => o.active);
      if (!activeOrder && state.orders.length > 0) {
        activeOrder = state.orders[0];
        activeOrder.active = true;
      }
      if (activeOrder) {
        activeOrder.orderNumber = data.order_no;
        activeOrder.shift = data.shift;
        state.shiftActive = true;
        
        // Use st-01 target as the active order target
        if (Array.isArray(data.stations)) {
          const st01 = data.stations.find(st => st.id === 'st-01');
          if (st01 && typeof st01.target === 'number' && st01.target > 0) {
            activeOrder.targetQty = st01.target;
          }
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
    
    slave.status = "Connected";
    slave.lastTelemetryTime = Date.now();
    slave.wifi_rssi = typeof data.wifi_rssi === 'number' ? data.wifi_rssi : (data.rssi !== undefined ? parseInt(data.rssi) : null);
    
    // Update slave's shift status and evaluate global shiftActive state
    if (data.shift) {
      slave.shift = data.shift;
    }
    state.shiftActive = state.slaves.some(s => s.status === "Connected" && s.shift && s.shift !== "---");
    
    if (Array.isArray(data.stations)) {
      console.log(`[Telemetry] Parsing ${data.stations.length} stations for ${slave.id}`);
      data.stations.forEach((incomingSt) => {
        const station = slave.stations.find(st => st.id === incomingSt.id);
        if (station) {
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
            station.speed = Number(incomingSt.speed) || 0;
          } else {
            const mult = getStationMultiplier(station.id);
            station.actual = incomingSt.actual * mult;
            station.speed = (Number(incomingSt.speed) || 0) * mult;
          }
          station.status = incomingSt.status || "Running";
          if (incomingSt.workingMins !== undefined) {
            station.workingMins = Number(incomingSt.workingMins) || 0;
          }
          if (incomingSt.breakdownMins !== undefined) {
            station.breakdownMins = Number(incomingSt.breakdownMins) || 0;
          }
          if (incomingSt.operator) {
            station.operator = incomingSt.operator;
          }
          if (incomingSt.target !== undefined && Number(incomingSt.target) > 0) {
            station.target = Number(incomingSt.target) || 0;
          }
          if (incomingSt.pending !== undefined) {
            station.pending = Number(incomingSt.pending) || 0;
          }
          if (incomingSt.efficiency !== undefined) {
            station.efficiency = Number(incomingSt.efficiency) || 0;
          }
          if (incomingSt.breakdownReason !== undefined) {
            station.breakdownReason = incomingSt.breakdownReason;
          }
        }
      });
    }
    
    // Calculate and update virtual stations (Manual Pouching, Case Packing)
    updateVirtualStations();
    
    // Re-draw monitor cards and update strip headers
    applyActiveOrder();
    renderActiveSlaveView();
    updateGlobalStats();
    saveStateToLocalStorage();
    
  } catch (err) {
    console.error("Error parsing telemetry payload:", err);
  }
}

// State Persistence Helpers (Allows PC Monitor to load latest active supervisor/maintenance names from active localStorage)
function saveStateToLocalStorage() {
  try {
    localStorage.setItem('ripple_iot_dashboard_state', JSON.stringify({
      activeSlaveId: state.activeSlaveId,
      shiftActive: state.shiftActive,
      activeItemName: state.activeItemName,
      operatorName: state.operatorName,
      shiftWorkingMins: state.shiftWorkingMins,
      shiftBreakdownMins: state.shiftBreakdownMins,
      shiftConfig: state.shiftConfig,
      shiftStartTime: state.shiftStartTime,
      orders: state.orders,
      slaves: state.slaves.map(slave => ({
        id: slave.id,
        status: slave.status,
        lastTelemetryTime: slave.lastTelemetryTime,
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
          breakdownMins: st.breakdownMins
        }))
      }))
    }));
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem('ripple_iot_dashboard_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed) {
        state.shiftActive = parsed.shiftActive !== undefined ? parsed.shiftActive : false;
        state.activeItemName = parsed.activeItemName || 'T-light candle';
        state.operatorName = parsed.operatorName || 'SAGAR B.K';
        state.shiftWorkingMins = typeof parsed.shiftWorkingMins === 'number' ? parsed.shiftWorkingMins : 0.0;
        state.shiftBreakdownMins = typeof parsed.shiftBreakdownMins === 'number' ? parsed.shiftBreakdownMins : 0.0;
        state.shiftConfig = parsed.shiftConfig || null;
        state.shiftStartTime = parsed.shiftStartTime !== undefined ? parsed.shiftStartTime : null;
        
        if (Array.isArray(parsed.orders)) {
          state.orders = parsed.orders;
        }
        
        if (Array.isArray(parsed.slaves)) {
          parsed.slaves.forEach(savedSlave => {
            const slave = state.slaves.find(s => s.id === savedSlave.id);
            if (slave) {
              slave.status = savedSlave.status || 'Disconnected';
              slave.lastTelemetryTime = savedSlave.lastTelemetryTime;
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
                  }
                });
              }
            }
          });
        }
      }
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }
}

const state = {
  activeSlaveId: 'all',
  shiftActive: false,
  activeItemName: 'T-light candle',
  operatorName: 'SAGAR B.K',
  shiftWorkingMins: 0.0,
  shiftBreakdownMins: 0.0,
  shiftConfig: null,
  shiftStartTime: null,
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

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadStateFromLocalStorage();
  updateClock();
  setInterval(updateClock, 1000);
  
  applyActiveOrder();
  renderActiveSlaveView();
  initMQTT();
  startTelemetryLoop();
  
  // Hide loading spinner after initial render
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    setTimeout(() => overlay.classList.remove('active'), 1000);
  }
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

// Calculate live machine efficiency based on linear elapsed shift time
function calculateLiveEfficiency(station) {
  if (typeof station.efficiency === 'number' && station.efficiency > 0) {
    return station.efficiency;
  }
  if (station.target <= 0) {
    return 0;
  }
  if (!state.shiftActive || !state.shiftStartTime) {
    if (station.actual > 0) {
      return Math.min(100, Math.round((station.actual / station.target) * 100));
    }
    return 0;
  }
  const elapsedMinutes = (Date.now() - state.shiftStartTime) / 60000;
  const activeMins = Math.min(480, Math.max(1, elapsedMinutes));
  const expectedTargetSoFar = (station.target / 480) * activeMins;
  if (expectedTargetSoFar <= 0) return 0;
  return Math.min(100, Math.round((station.actual / expectedTargetSoFar) * 100));
}

// Render All Stations Overview grid
function renderActiveSlaveView() {
  const gridEl = document.getElementById('machine-grid');
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

      const finalSpeed = isSlaveConnected ? station.speed : 0;

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
              <span class="status-badge ${statClass}" onclick="showReadOnlyAlert()">
                ${isSlaveConnected ? station.status : 'Offline'}
              </span>
            </div>
          </div>

          <!-- Metric Outputs -->
          <div class="metrics-row">
            <div class="metric-box">
              <span class="metric-label">Target</span>
              <span class="metric-num" onclick="showReadOnlyAlert()">${station.target.toLocaleString()}</span>
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
}

// Update Header stats bar
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
        if (station.workingMins > maxWorkingMins) maxWorkingMins = station.workingMins;
        if (station.breakdownMins > maxBreakdownMins) maxBreakdownMins = station.breakdownMins;
      });
    }
  });
  
  if (maxWorkingMins > 0) state.shiftWorkingMins = maxWorkingMins;
  if (maxBreakdownMins > 0) state.shiftBreakdownMins = maxBreakdownMins;

  // Total Output is the actual output of final packaging unit st-09
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

// Apply active order data to DOM strip
function applyActiveOrder() {
  const activeOrder = state.orders.find(o => o.active);
  const container = document.getElementById('active-order-strip');
  const itemLabel = document.getElementById('active-item-name');
  if (itemLabel && state.activeItemName) {
    itemLabel.innerText = state.activeItemName;
  }
  if (container) {
    if (activeOrder) {
      container.innerHTML = `
        <span><strong style="color: var(--accent-peach);">ORDER:</strong> ${activeOrder.orderNumber}</span>
        <span><strong style="color: var(--accent-peach);">DATE:</strong> ${activeOrder.date}</span>
        <span><strong style="color: var(--accent-peach);">SHIFT:</strong> ${activeOrder.shift}</span>
        <span><strong style="color: var(--accent-peach);">TARGET:</strong> ${activeOrder.targetQty.toLocaleString()} Qty</span>
        <span><strong style="color: var(--accent-peach);">SUPERVISOR:</strong> ${state.shiftConfig ? state.shiftConfig.supervisor : 'N/A'}</span>
      `;
    } else {
      container.innerHTML = `<span><strong style="color: var(--status-idle);">NO ACTIVE SHIFT / ORDER RUNNING</strong></span>`;
    }
  }
  updateVirtualStations();
}

// Alert for read-only user actions
window.showReadOnlyAlert = function() {
  alert("This PC Dashboard is for Monitoring only. To start/end shifts, configure orders, or log faults, please use the TV Dashboard.");
};

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
    if (state.shiftActive && state.shiftStartTime) {
      manual.workingMins = (Date.now() - state.shiftStartTime) / 60000;
    } else {
      manual.workingMins = 0;
    }
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
