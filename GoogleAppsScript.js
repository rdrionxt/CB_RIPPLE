/**
 * Google Apps Script Reference Implementation
 * 
 * Paste this code into your Google Sheets Apps Script Editor (Extensions > Apps Script).
 * Make sure to deploy it as a Web App:
 * - Click Deploy > New Deployment.
 * - Select type: Web App.
 * - Set "Execute as": Me.
 * - Set "Who has access": Anyone.
 * - Copy the Web App URL and use it in app.js.
 */

// Global config
var ENABLE_EMAIL_REPORT = false; // Set to false to STOP sending email reports
var RECIPIENT_EMAIL = "riontechnologies2021@gmail.com";

// Optional: Paste your new Google Sheet ID here (from URL: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit)
// Leave empty ("") to automatically use the active bound spreadsheet.
var SPREADSHEET_ID = "";

function getTargetSpreadsheet() {
  if (typeof SPREADSHEET_ID !== "undefined" && SPREADSHEET_ID && SPREADSHEET_ID.trim() !== "") {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
    } catch (err) {
      console.error("Failed to open spreadsheet by SPREADSHEET_ID: " + err.toString());
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function doGet(e) {
  if (e && e.parameter) {
    // 1. Handle device logging GET request from ESP32
    if (e.parameter.date && e.parameter.shift && e.parameter.device_id) {
      try {
        var activeSs = getTargetSpreadsheet();
        var sheet = activeSs ? activeSs.getActiveSheet() : null;
        if (!sheet) return ContentService.createTextOutput("Error: Target Sheet not found");
        if (sheet.getLastRow() === 0) {
          sheet.appendRow([
            "Date", "Shift", "Part information", "Station", "Operator",
            "Target count", "Actual count", "Speed", "Production efficiency",
            "Working hours", "Breakdown hours", "Machine efficiency", "Remarks"
          ]);
          sheet.getRange("A1:M1").setFontWeight("bold");
        }

        var date = e.parameter.date || "";
        var shift = e.parameter.shift || "";
        var partInfo = e.parameter.part_info || e.parameter.part_information || e.parameter.part_name || "";
        var station = e.parameter.station || e.parameter.device_name || e.parameter.device_id || "";
        var operator = e.parameter.operator || e.parameter.operator_name || "";
        var targetCount = Number(e.parameter.target_count || e.parameter.target) || 0;
        var actualCount = Number(e.parameter.actual_count || e.parameter.shift_count || e.parameter.actual) || 0;
        var speed = Number(e.parameter.speed || e.parameter.actual_speed) || 0;
        
        var prodEffRaw = e.parameter.production_efficiency || e.parameter.prod_efficiency || e.parameter.Prod_efficiency || 0;
        var prodEffStr = typeof prodEffRaw === "string" && prodEffRaw.includes("%") ? prodEffRaw : (Number(prodEffRaw) + "%");

        var workingHours = 0;
        if (e.parameter.working_hours !== undefined) {
          workingHours = Number(e.parameter.working_hours);
        } else {
          var workingMins = Number(e.parameter.working_mins) || 0;
          workingHours = Number((workingMins / 60.0).toFixed(2));
        }

        var bdHours = 0;
        if (e.parameter.breakdown_hours !== undefined) {
          bdHours = Number(e.parameter.breakdown_hours);
        } else {
          var bdMins = Number(e.parameter.bd_mins) || 0;
          bdHours = Number((bdMins / 60.0).toFixed(2));
        }

        var machineEffRaw = e.parameter.machine_efficiency || e.parameter.efficiency || 0;
        var machineEffStr = typeof machineEffRaw === "string" && machineEffRaw.includes("%") ? machineEffRaw : (Number(machineEffRaw).toFixed(2) + "%");
        
        var remarks = e.parameter.remarks || "Shift ended successfully. Checked box counts.";

        sheet.appendRow([
          date,
          shift,
          partInfo,
          station,
          operator,
          targetCount,
          actualCount,
          speed,
          prodEffStr,
          workingHours,
          bdHours,
          machineEffStr,
          remarks
        ]);

        return ContentService.createTextOutput("OK");
      } catch (err) {
        return ContentService.createTextOutput("Error: " + err.toString());
      }
    }

    // 2. Handle OTA check_update GET request
    if (e.parameter.action === "check_update") {
      var deviceId = e.parameter.device_id || "SL-001";
      var scriptProperties = PropertiesService.getScriptProperties();
      var latestVersion = scriptProperties.getProperty("firmware_version_" + deviceId) || "1.0.0";
      var fileId = scriptProperties.getProperty("firmware_file_id_" + deviceId) || "";

      var response = {
        version: latestVersion,
        firmware_url: fileId ? "https://drive.google.com/uc?export=download&id=" + fileId : ""
      };

      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Handle get_versions GET request
    if (e.parameter.action === "get_versions") {
      var scriptProperties = PropertiesService.getScriptProperties();
      var response = {};
      var deviceIds = ["SL-001", "SL-002", "SL-003", "SL-004"];
      deviceIds.forEach(function (id) {
        response[id] = {
          version: scriptProperties.getProperty("firmware_version_" + id) || "1.0.0",
          file_id: scriptProperties.getProperty("firmware_file_id_" + id) || ""
        };
      });

      if (e.parameter.callback) {
        return ContentService.createTextOutput(e.parameter.callback + "(" + JSON.stringify(response) + ")")
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }

      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput("Google Apps Script for Ripple IoT is active. Send POST requests to write data or send reports.");
}

function doPost(e) {
  try {
    var payloadString = e.postData.contents;
    var data = JSON.parse(payloadString);

    // Check if the request is to upload a new firmware binary
    if (data && data.action === "upload_firmware") {
      var deviceId = data.device_id;
      var newVersion = data.version;
      var fileContentBase64 = data.file_content;
      var fileName = data.file_name || (deviceId + "_v" + newVersion + ".bin");

      if (!deviceId || !newVersion || !fileContentBase64) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Missing device_id, version, or file_content"
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var decodedBlob = Utilities.newBlob(Utilities.base64Decode(fileContentBase64), "application/octet-stream", fileName);

      var folder;
      var folders = DriveApp.getFoldersByName("Ripple_IoT_Firmware");
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder("Ripple_IoT_Firmware");
      }

      var file = folder.createFile(decodedBlob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      var scriptProperties = PropertiesService.getScriptProperties();
      scriptProperties.setProperty("firmware_version_" + deviceId, newVersion);
      scriptProperties.setProperty("firmware_file_id_" + deviceId, file.getId());

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Firmware for " + deviceId + " uploaded successfully to folder 'Ripple_IoT_Firmware'",
        file_id: file.getId(),
        version: newVersion,
        download_url: "https://drive.google.com/uc?export=download&id=" + file.getId()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Check if the request is to email the Excel shift summary & log to Google Sheet
    if (data && data.action === "send_email_report") {
      // Log all stations rows directly to the active Google Sheet tab
      logAllStationsToMasterSheet(data);

      var emailSuccess = true;
      var emailError = "";
      if (typeof ENABLE_EMAIL_REPORT !== "undefined" && ENABLE_EMAIL_REPORT) {
        try {
          sendEmailReport(data);
          emailSuccess = true;
        } catch (err) {
          emailSuccess = false;
          emailError = err.toString();
          console.error("Email report failed: " + emailError);
        }
      } else {
        console.log("Email report sending is disabled (ENABLE_EMAIL_REPORT = false).");
      }

      var telegramSuccess = false;
      var telegramError = "";
      if (data.telegram_text) {
        try {
          sendTelegramReport(data.telegram_text);
          telegramSuccess = true;
        } catch (err) {
          telegramError = err.toString();
          console.error("Telegram report failed: " + telegramError);
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Report processing complete.",
        email_sent: emailSuccess,
        email_error: emailError,
        telegram_sent: telegramSuccess,
        telegram_error: telegramError
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Fallback: If it's a standard parameter write or telemetry logging, place your existing sheet write logic here:
    // ...

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Data logged"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error("Error in doPost:", error);
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Logs all station records directly to the bound Google Sheet tab in 13-column format upon Shift End.
 */
function logAllStationsToMasterSheet(data) {
  try {
    var activeSs = getTargetSpreadsheet();
    if (!activeSs) return;
    var sheet = activeSs.getActiveSheet();
    if (!sheet) return;

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Date", "Shift", "Part information", "Station", "Operator",
        "Target count", "Actual count", "Speed", "Production efficiency",
        "Working hours", "Breakdown hours", "Machine efficiency", "Remarks"
      ]);
      sheet.getRange("A1:M1").setFontWeight("bold");
    }

    var dateStr = data.shift_info ? (data.shift_info.date || new Date().toISOString().split('T')[0]) : new Date().toISOString().split('T')[0];
    var shiftName = data.shift_info ? (data.shift_info.shift || "Shift A") : "Shift A";

    if (Array.isArray(data.stations)) {
      data.stations.forEach(function (st) {
        var dateVal = st.date || dateStr;
        var shiftVal = st.shift || shiftName;
        var partVal = st.part_info || st.part_information || (data.shift_info ? ("Size - " + (data.shift_info.cup_size || "13mm") + ", P-" + (data.shift_info.pouch_qty || "30") + ", Box - " + (data.shift_info.outer_box || "12 * 20")) : "T-light candle");
        var stationVal = st.station || st.name || st.id;
        var operatorVal = st.operator || "";
        var targetVal = st.target_count !== undefined ? st.target_count : (st.target !== undefined ? st.target : 0);
        var actualVal = st.actual_count !== undefined ? st.actual_count : (st.actual !== undefined ? st.actual : 0);
        var speedVal = st.speed !== undefined ? st.speed : 0;
        
        var prodEffVal = "";
        if (st.prod_efficiency !== undefined) {
          prodEffVal = typeof st.prod_efficiency === "number" ? (st.prod_efficiency + "%") : String(st.prod_efficiency);
        } else if (st.production_efficiency !== undefined) {
          prodEffVal = typeof st.production_efficiency === "number" ? (st.production_efficiency + "%") : String(st.production_efficiency);
        } else {
          prodEffVal = "0%";
        }
        if (!prodEffVal.endsWith("%")) prodEffVal += "%";

        var workingHrsVal = st.working_hours !== undefined ? st.working_hours : (st.working_hrs !== undefined ? st.working_hrs : 0);
        var breakdownHrsVal = st.breakdown_hours !== undefined ? st.breakdown_hours : (st.breakdown_hrs !== undefined ? st.breakdown_hrs : 0);
        
        var machEffVal = "";
        if (st.machine_efficiency !== undefined) {
          machEffVal = typeof st.machine_efficiency === "number" ? (st.machine_efficiency.toFixed(2) + "%") : String(st.machine_efficiency);
        } else {
          machEffVal = "100%";
        }
        if (!machEffVal.endsWith("%")) machEffVal += "%";

        var remarksVal = st.remarks || (st.bd_reason ? ("Breakdown: " + st.bd_reason) : "Shift ended successfully. Checked box counts.");

        sheet.appendRow([
          dateVal,
          shiftVal,
          partVal,
          stationVal,
          operatorVal,
          targetVal,
          actualVal,
          speedVal,
          prodEffVal,
          workingHrsVal,
          breakdownHrsVal,
          machEffVal,
          remarksVal
        ]);
      });
    }
  } catch (err) {
    console.error("Master sheet logging error: " + err.toString());
  }
}

/**
 * Creates a temporary spreadsheet, writes shift details, exports to Excel, emails it, and deletes the temp file.
 */
function sendEmailReport(data) {
  var dateStr = data.shift_info.date || new Date().toISOString().split('T')[0];
  var shiftName = data.shift_info.shift || "Shift A";

  // 1. Create a temporary spreadsheet on Google Drive
  var ss = SpreadsheetApp.create("Shift_End_Report_" + dateStr + "_" + shiftName.replace(/\s+/g, "_"));
  var sheet = ss.getActiveSheet();
  sheet.setName("Shift Summary");

  // Enable grid lines visibility
  sheet.setHiddenGridlines(false);

  // 2. Add Header block
  sheet.appendRow(["📋 SHIFT END PRODUCTION SUMMARY"]);
  sheet.appendRow(["Date", dateStr, "Shift", shiftName]);
  sheet.appendRow(["Cup Size", data.shift_info.cup_size, "Qty/Pouch", data.shift_info.pouch_qty]);
  sheet.appendRow(["Outer Box Case", data.shift_info.outer_box]);
  sheet.appendRow(["Supervisor", data.shift_info.supervisor || "N/A", "Maintenance", data.shift_info.maintenance || "N/A"]);
  if (data.shift_info.manpower !== undefined) {
    sheet.appendRow(["Manpower Count", data.shift_info.manpower]);
  }
  sheet.appendRow([""]); // empty spacer row

  // 3. Format header block
  sheet.getRange("A1").setFontWeight("bold").setFontSize(14);
  sheet.getRange("A2:D5").setFontWeight("bold");

  // 4. Append station details table
  sheet.appendRow(["Station Details Table"]);
  sheet.getRange(sheet.getLastRow(), 1).setFontWeight("bold").setFontSize(12);

  var tableHeaders = [
    "Date", "Shift", "Part information", "Station", "Operator",
    "Target count", "Actual count", "Speed", "Production efficiency",
    "Working hours", "Breakdown hours", "Machine efficiency", "Remarks"
  ];
  sheet.appendRow(tableHeaders);

  // Style table headers
  var headerRange = sheet.getRange(sheet.getLastRow(), 1, 1, tableHeaders.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#334155"); // Dark charcoal theme matching IRIS
  headerRange.setFontColor("#ffffff");

  // Write station records
  if (Array.isArray(data.stations)) {
    data.stations.forEach(function (st) {
      var dateVal = st.date || dateStr;
      var shiftVal = st.shift || shiftName;
      var partVal = st.part_info || st.part_information || (data.shift_info ? ("Size - " + (data.shift_info.cup_size || "13mm") + ", P-" + (data.shift_info.pouch_qty || "30") + ", Box - " + (data.shift_info.outer_box || "12 * 20")) : "T-light candle");
      var stationVal = st.station || st.name || st.id;
      var operatorVal = st.operator || "";
      var targetVal = st.target_count !== undefined ? st.target_count : (st.target !== undefined ? st.target : 0);
      var actualVal = st.actual_count !== undefined ? st.actual_count : (st.actual !== undefined ? st.actual : 0);
      var speedVal = st.speed !== undefined ? st.speed : 0;
      
      var prodEffVal = "";
      if (st.prod_efficiency !== undefined) {
        prodEffVal = typeof st.prod_efficiency === "number" ? (st.prod_efficiency + "%") : String(st.prod_efficiency);
      } else if (st.production_efficiency !== undefined) {
        prodEffVal = typeof st.production_efficiency === "number" ? (st.production_efficiency + "%") : String(st.production_efficiency);
      } else {
        prodEffVal = "0%";
      }
      if (!prodEffVal.endsWith("%")) prodEffVal += "%";

      var workingHrsVal = st.working_hours !== undefined ? st.working_hours : (st.working_hrs !== undefined ? st.working_hrs : 0);
      var breakdownHrsVal = st.breakdown_hours !== undefined ? st.breakdown_hours : (st.breakdown_hrs !== undefined ? st.breakdown_hrs : 0);
      
      var machEffVal = "";
      if (st.machine_efficiency !== undefined) {
        machEffVal = typeof st.machine_efficiency === "number" ? (st.machine_efficiency.toFixed(2) + "%") : String(st.machine_efficiency);
      } else {
        machEffVal = "100%";
      }
      if (!machEffVal.endsWith("%")) machEffVal += "%";

      var remarksVal = st.remarks || (st.bd_reason ? ("Breakdown: " + st.bd_reason) : "Shift ended successfully. Checked box counts.");

      sheet.appendRow([
        dateVal,
        shiftVal,
        partVal,
        stationVal,
        operatorVal,
        targetVal,
        actualVal,
        speedVal,
        prodEffVal,
        workingHrsVal,
        breakdownHrsVal,
        machEffVal,
        remarksVal
      ]);
    });
  }

  sheet.appendRow([""]); // Spacer row

  // 5. Append Overall KPI block
  sheet.appendRow(["🏆 OVERALL PERFORMANCE INDICATORS"]);
  sheet.getRange(sheet.getLastRow(), 1).setFontWeight("bold").setFontSize(12);

  sheet.appendRow(["Line Availability (%)", data.metrics.availability + "%"]);
  sheet.appendRow(["Performance Rate (%)", data.metrics.performance + "%"]);
  sheet.appendRow(["Overall Production Efficiency (%)", data.metrics.overall_prod_eff + "%"]);
  sheet.appendRow(["Overall Machine Efficiency (%)", data.metrics.overall_mach_eff + "%"]);
  sheet.appendRow(["Overall OEE (%)", data.metrics.overall_oee + "%"]);

  // Format overall KPIs
  var kpiStartRow = sheet.getLastRow() - 4;
  sheet.getRange(kpiStartRow, 1, 5, 2).setFontWeight("bold");

  // Add some border styling and auto-resize columns
  var lastRow = sheet.getLastRow();
  var totalCols = tableHeaders.length;
  sheet.getRange(1, 1, lastRow, totalCols).setHorizontalAlignment("left");

  for (var col = 1; col <= totalCols; col++) {
    sheet.autoResizeColumn(col);
  }

  // Flush all changes to ensure spreadsheet is generated
  SpreadsheetApp.flush();

  // 6. Convert Google Sheet to Microsoft Excel (.xlsx) file blob using Google Drive API
  var url = "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=xlsx";
  var token = ScriptApp.getOAuthToken();

  var response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + token
    },
    muteHttpExceptions: true
  });

  var blob = response.getBlob().setName("Shift_End_Report_" + dateStr + "_" + shiftName.replace(/\s+/g, "_") + ".xlsx");

  // 7. Send the email with the Excel attachment
  var recipientList = data.email || RECIPIENT_EMAIL;
  var subject = "📊 Shift End Production Excel Report: " + dateStr + " (" + shiftName + ")";
  var body = "Hello Team,\n\nPlease find attached the Shift End Production Summary Excel Spreadsheet for " + dateStr + ", " + shiftName + ".\n\nBest Regards,\nIRIS Ripple IoT Operations System";

  MailApp.sendEmail({
    to: recipientList,
    subject: subject,
    body: body,
    attachments: [blob]
  });

  console.log("Email report dispatched successfully.");

  // 8. Delete the temporary spreadsheet to avoid space clutter in Google Drive
  DriveApp.getFileById(ss.getId()).setTrashed(true);
}

/**
 * Sends a HTML message to Telegram channel using UrlFetchApp.
 * This runs server-side on Google servers, bypassing factory network firewalls and CORS blocks.
 */
function sendTelegramReport(messageText) {
  var token = "8786500968:AAFoDJA1m_uoOIQ1zSPBAfAJne9Xk-KmBb0";
  var chatId = "-5005894782";
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";

  var payload = {
    "chat_id": chatId,
    "text": messageText,
    "parse_mode": "HTML"
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  var response = UrlFetchApp.fetch(url, options);
  var responseText = response.getContentText();
  console.log("Telegram Response: " + responseText);

  var resObj = JSON.parse(responseText);
  if (!resObj || !resObj.ok) {
    console.warn("HTML parse failed on Telegram. Retrying without HTML formatting...");
    var plainText = messageText.replace(/<[^>]*>/g, "");
    payload.text = plainText;
    delete payload.parse_mode;

    options.payload = JSON.stringify(payload);
    var fallbackRes = UrlFetchApp.fetch(url, options);
    var fallbackText = fallbackRes.getContentText();
    console.log("Telegram Plain Text Fallback Response: " + fallbackText);
    var fallbackObj = JSON.parse(fallbackText);
    if (!fallbackObj || !fallbackObj.ok) {
      var desc = fallbackObj && fallbackObj.description ? fallbackObj.description : "Unknown API error";
      throw new Error("Telegram API - " + desc);
    }
  }
}
