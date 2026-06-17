document.addEventListener('DOMContentLoaded', () => {
  /* ==========================================================================
     HMI STATE VARIABLES
     ========================================================================== */
  let operatorName = 'Naveen Kumar';
  let machineName = 'RION-FRAG-3000 MULTI-FILL SYSTEM';
  let targetCount = 10000;
  let currentCount = 4250;
  let totalCount = 4250;
  let targetSpeed = 85; // units per minute setpoint
  let currentSpeed = 85; // actual speed (fluctuating)
  let machineState = 'RUNNING'; // 'RUNNING', 'BREAKDOWN', 'IDLE'
  
  let breakdownTimeSeconds = 0;
  let breakdownInterval = null;
  
  // Real-time speed history for HMI line chart (last 25 ticks)
  const speedHistory = Array(25).fill(85);
  const maxHistoryPoints = 25;
  const maxSpeedLimit = 150; // Max speed for gauge/chart scaling
  
  // Dynamic fraction accumulator for count increment simulation
  let fractionalCountAccumulator = 0;

  /* ==========================================================================
     DOM ELEMENTS BINDINGS
     ========================================================================== */
  // Header Info
  const liveDateEl = document.getElementById('live-date');
  const liveTimeEl = document.getElementById('live-time');
  const machineNameDisplay = document.getElementById('machine-name-display');
  const headerStatusBadge = document.getElementById('header-status-badge');

  // Operator Subheader
  const operatorNameDisplay = document.getElementById('operator-name-display');
  const machineStatusPill = document.getElementById('machine-status-pill');
  const machineStatusText = document.getElementById('machine-status-text');

  // Telemetry Cards
  const valCurrentCount = document.getElementById('val-current-count');
  const valTotalCount = document.getElementById('val-total-count');
  const valTargetCount = document.getElementById('val-target-count');
  const targetProgressBar = document.getElementById('target-progress-bar');
  const targetProgressPct = document.getElementById('target-progress-pct');
  const targetRemainingCount = document.getElementById('target-remaining-count');
  const valMachineSpeed = document.getElementById('val-machine-speed');
  const gaugeFillArc = document.getElementById('gauge-fill-arc');
  const valBreakdownTime = document.getElementById('val-breakdown-time');
  const breakdownStatusLabel = document.getElementById('breakdown-status-label');
  const breakdownCard = document.querySelector('.breakdown-card');

  // Simulation Controls Input
  const inputOperator = document.getElementById('input-operator');
  const inputMachine = document.getElementById('input-machine');
  const inputTarget = document.getElementById('input-target');
  const inputSpeedSetpoint = document.getElementById('input-speed-setpoint');
  const speedSetpointLabel = document.getElementById('speed-setpoint-label');

  // Buttons
  const btnSimulateBreakdown = document.getElementById('btn-simulate-breakdown');
  const btnResumeNormal = document.getElementById('btn-resume-normal');
  const btnResetCounter = document.getElementById('btn-reset-counter');
  const clearLogsBtn = document.getElementById('clear-logs-btn');
  const logConsole = document.getElementById('log-console');

  // Canvas
  const canvas = document.getElementById('live-telemetry-chart');
  const ctx = canvas.getContext('2d');

  /* ==========================================================================
     INITIAL CONFIGURATION & CLOCK
     ========================================================================== */
  
  // Live Ticking System Clock
  function updateClock() {
    const now = new Date();
    
    // Format Date: e.g. "05 JUN 2026"
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const dateStr = `${now.getDate().toString().padStart(2, '0')} ${months[now.getMonth()]} ${now.getFullYear()}`;
    
    // Format Time: e.g. "04:21:05 PM"
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // convert 0 to 12
    const hoursStr = hours.toString().padStart(2, '0');
    const timeStr = `${hoursStr}:${minutes}:${seconds} ${ampm}`;

    liveDateEl.textContent = dateStr;
    liveTimeEl.textContent = timeStr;
  }

  // Get timestamp string for HMI Console Log
  function getLogTimestamp() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    return `[${h}:${m}:${s}]`;
  }

  // Write a message into the HMI log list
  function writeLog(message, type = 'info') {
    const logItem = document.createElement('div');
    logItem.className = `log-item log-${type}`;
    logItem.textContent = `${getLogTimestamp()} ${message}`;
    logConsole.appendChild(logItem);
    
    // Auto scroll to bottom
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  // Formatting helper (adds thousands separator)
  function formatNumber(num) {
    return Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Format seconds to HH:MM:SS format
  function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  /* ==========================================================================
     DYNAMIC TELEMETRY CALCULATIONS
     ========================================================================== */

  // Update DOM widgets with current states
  function updateWidgets() {
    // Current & Total Count
    valCurrentCount.textContent = formatNumber(currentCount);
    valTotalCount.textContent = formatNumber(totalCount);
    
    // Target Count
    valTargetCount.textContent = formatNumber(targetCount);
    
    // Target Progress Calculation
    const progressPct = Math.min((currentCount / targetCount) * 100, 100);
    targetProgressBar.style.width = `${progressPct}%`;
    targetProgressPct.textContent = `${progressPct.toFixed(1)}%`;
    
    const remaining = Math.max(targetCount - currentCount, 0);
    targetRemainingCount.textContent = `${formatNumber(remaining)} left`;

    // Speed display
    valMachineSpeed.textContent = Math.round(currentSpeed);
    
    // Speedometer Gauge Arc Update (Semi-circle length = 125.6px)
    // 125.6 is dashoffset for 0 speed, 0 is dashoffset for max speed (150 U/min)
    const strokeDashOffset = 125.6 - (Math.min(currentSpeed, maxSpeedLimit) / maxSpeedLimit) * 125.6;
    gaugeFillArc.style.strokeDashoffset = strokeDashOffset;
  }

  // Set HMI screen state and class designations
  function setMachineState(newState) {
    if (machineState === newState) return;
    
    const prevState = machineState;
    machineState = newState;

    // Reset status pill and badge CSS classes
    machineStatusPill.className = 'status-pill';
    const statusPulse = headerStatusBadge.querySelector('.status-pulse');
    statusPulse.className = 'status-pulse';

    if (newState === 'RUNNING') {
      machineStatusPill.classList.add('status-running');
      machineStatusText.textContent = 'RUNNING';
      statusPulse.classList.add('pulse-running');
      
      // Remove breakdown alarm classes
      breakdownCard.classList.remove('alarm-active');
      valBreakdownTime.classList.add('status-normal');
      breakdownStatusLabel.textContent = 'No active faults';

      // Clear breakdown ticking
      if (breakdownInterval) {
        clearInterval(breakdownInterval);
        breakdownInterval = null;
      }
      
      writeLog(`Machine operations resumed normal at target speed setpoint ${targetSpeed} U/Min.`, 'success');
    } 
    else if (newState === 'BREAKDOWN') {
      machineStatusPill.classList.add('status-breakdown');
      machineStatusText.textContent = 'CRITICAL FAULT';
      statusPulse.classList.add('pulse-breakdown');
      
      // Trigger alarm active layout
      breakdownCard.classList.add('alarm-active');
      valBreakdownTime.classList.remove('status-normal');
      breakdownStatusLabel.textContent = 'EMERGENCY SHUTDOWN';
      
      currentSpeed = 0;
      
      // Start breakdown ticking timer
      if (!breakdownInterval) {
        breakdownInterval = setInterval(() => {
          breakdownTimeSeconds++;
          valBreakdownTime.textContent = formatTime(breakdownTimeSeconds);
        }, 1000);
      }
      
      writeLog(`CRITICAL SYSTEM ALARM: Emergency breakdown triggered. Process halted.`, 'error');
    }
  }

  // Periodic Telemetry Fluctuation & production simulation
  function tickSimulation() {
    if (machineState === 'RUNNING') {
      // Fluctuate actual speed slightly (±3% of setpoint)
      const maxDelta = targetSpeed * 0.03;
      const fluctuation = (Math.random() * 2 - 1) * maxDelta;
      currentSpeed = Math.max(targetSpeed + fluctuation, 10); // stay above 10 CPM

      // Calculate production increment
      // speed is units/minute. In a 1-second interval, we produce (speed / 60) units.
      const unitsPerSec = currentSpeed / 60;
      fractionalCountAccumulator += unitsPerSec;

      // When accumulator exceeds 1, add whole integer parts
      if (fractionalCountAccumulator >= 1) {
        const wholeUnits = Math.floor(fractionalCountAccumulator);
        currentCount += wholeUnits;
        totalCount += wholeUnits;
        fractionalCountAccumulator -= wholeUnits;
        
        // Auto stop if target reached
        if (currentCount >= targetCount) {
          currentCount = targetCount;
          setMachineState('RUNNING'); // Stay running but stop production or set to idle
          currentSpeed = 0;
          writeLog(`Target count of ${formatNumber(targetCount)} successfully achieved. Production completed.`, 'success');
        }
      }
    } else {
      currentSpeed = 0;
    }

    // Push speed to trendline history
    speedHistory.push(currentSpeed);
    if (speedHistory.length > maxHistoryPoints) {
      speedHistory.shift();
    }

    // Update displays and redraw chart
    updateWidgets();
    drawChart();
  }

  /* ==========================================================================
     CANVAS REAL-TIME CHART RENDERING
     ========================================================================== */
  
  // Set correct physical resolution of canvas
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    drawChart();
  }

  // Redraw HMI trendline graph inside Canvas
  function drawChart() {
    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (width === 0 || height === 0) return;

    // Draw background grid lines
    ctx.strokeStyle = 'rgba(65, 105, 225, 0.08)';
    ctx.lineWidth = 1;
    
    const verticalGridLines = 5;
    for (let i = 1; i < verticalGridLines; i++) {
      const y = (height / verticalGridLines) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      
      // Draw grid markers
      ctx.fillStyle = '#475569';
      ctx.font = '10px "JetBrains Mono"';
      const speedVal = Math.round(maxSpeedLimit - (maxSpeedLimit / verticalGridLines) * i);
      ctx.fillText(speedVal, 10, y - 4);
    }

    // Draw horizontal grid lines (ticks)
    const horizontalGridLines = 10;
    for (let i = 1; i < horizontalGridLines; i++) {
      const x = (width / horizontalGridLines) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw speed path
    ctx.beginPath();
    const stepX = width / (maxHistoryPoints - 1);
    
    for (let i = 0; i < speedHistory.length; i++) {
      const x = i * stepX;
      // map speed to pixel height (y=0 is top, y=height is bottom)
      const ratio = speedHistory[i] / maxSpeedLimit;
      const y = height - (ratio * (height - 20)) - 10;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    // Render stroke with glow
    ctx.strokeStyle = '#00b4d8';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0, 180, 216, 0.8)';
    ctx.stroke();
    
    // Render gradient fill under line
    ctx.shadowBlur = 0; // reset shadow glow
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < speedHistory.length; i++) {
      const x = i * stepX;
      const ratio = speedHistory[i] / maxSpeedLimit;
      const y = height - (ratio * (height - 20)) - 10;
      ctx.lineTo(x, y);
    }
    ctx.lineTo((speedHistory.length - 1) * stepX, height);
    ctx.closePath();

    const chartFillGrad = ctx.createLinearGradient(0, 0, 0, height);
    chartFillGrad.addColorStop(0, 'rgba(0, 180, 216, 0.25)');
    chartFillGrad.addColorStop(1, 'rgba(0, 180, 216, 0.0)');
    ctx.fillStyle = chartFillGrad;
    ctx.fill();

    // Draw actual pointer circle at the last coordinate
    if (speedHistory.length > 0) {
      const lastIdx = speedHistory.length - 1;
      const ratio = speedHistory[lastIdx] / maxSpeedLimit;
      const pointerX = lastIdx * stepX;
      const pointerY = height - (ratio * (height - 20)) - 10;

      ctx.fillStyle = '#00b4d8';
      ctx.beginPath();
      ctx.arc(pointerX, pointerY, 5, 0, Math.PI * 2);
      ctx.fill();

      // Outer pulsing ring around pointer
      ctx.strokeStyle = 'rgba(0, 180, 216, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pointerX, pointerY, 8 + Math.sin(Date.now() / 150) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* ==========================================================================
     INTERACTIONS & HANDLERS
     ========================================================================= */

  // Change Operator Name dynamically
  inputOperator.addEventListener('input', (e) => {
    operatorName = e.target.value.trim() || 'Naveen Kumar';
    operatorNameDisplay.textContent = operatorName;
  });

  inputOperator.addEventListener('change', () => {
    writeLog(`Operator console profile updated: active operator assigned to "${operatorName}".`);
  });

  // Change Machine Name dynamically
  inputMachine.addEventListener('input', (e) => {
    machineName = e.target.value.trim() || 'RION-FRAG-3000 MULTI-FILL SYSTEM';
    machineNameDisplay.textContent = machineName.toUpperCase();
  });

  inputMachine.addEventListener('change', () => {
    writeLog(`IoT machine context updated: system label set to "${machineName.toUpperCase()}".`);
  });

  // Change Target Count limit dynamically
  inputTarget.addEventListener('input', (e) => {
    const val = parseInt(e.target.value) || 100;
    targetCount = val;
    updateWidgets();
  });

  inputTarget.addEventListener('change', () => {
    writeLog(`Production target configuration updated: set count set to ${formatNumber(targetCount)} Units.`);
  });

  // Speed setpoint slider controller
  inputSpeedSetpoint.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    targetSpeed = val;
    speedSetpointLabel.textContent = val;
    if (machineState === 'RUNNING') {
      currentSpeed = val;
    }
    updateWidgets();
  });

  inputSpeedSetpoint.addEventListener('change', () => {
    writeLog(`Motor target speed setpoint changed to ${targetSpeed} U/Min.`);
  });

  // Action: Trigger Breakdown
  btnSimulateBreakdown.addEventListener('click', () => {
    setMachineState('BREAKDOWN');
  });

  // Action: Resume Running
  btnResumeNormal.addEventListener('click', () => {
    setMachineState('RUNNING');
  });

  // Action: Reset Count parameters
  btnResetCounter.addEventListener('click', () => {
    currentCount = 0;
    fractionalCountAccumulator = 0;
    updateWidgets();
    writeLog(`Production counters reset to zero by operator.`, 'warning');
  });

  // Action: Clear log panel list
  clearLogsBtn.addEventListener('click', () => {
    logConsole.innerHTML = '';
  });

  /* ==========================================================================
     SCHEDULING TICKERS & RESIZE LISTENER
     ========================================================================== */
  
  // Set layout initially
  updateClock();
  updateWidgets();
  
  // Window listeners
  window.addEventListener('resize', resizeCanvas);
  
  // Clock ticks every 1000ms
  setInterval(updateClock, 1000);
  
  // Simulation updates every 1000ms
  setInterval(tickSimulation, 1000);

  // Initial resize and render
  setTimeout(() => {
    resizeCanvas();
  }, 100);

  // Write welcome logs
  writeLog(`RION Technologies SCADA core host initialized.`, 'success');
  writeLog(`System context loaded: Ripple Fragrence manufacturing network.`, 'info');
});
