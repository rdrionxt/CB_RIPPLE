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
var RECIPIENT_EMAIL = "riontechnologies2021@gmail.com";

function doGet(e) {
  if (e && e.parameter && e.parameter.action === "check_update") {
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
  
  if (e && e.parameter && e.parameter.action === "get_versions") {
    var scriptProperties = PropertiesService.getScriptProperties();
    var response = {};
    var deviceIds = ["SL-001", "SL-002", "SL-003", "SL-004"];
    deviceIds.forEach(function(id) {
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
    
    // Check if the request is to email the Excel shift summary
    if (data && data.action === "send_email_report") {
      sendEmailReport(data);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Email dispatched successfully"
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
  sheet.setGridlines(true);
  
  // 2. Add Header block
  sheet.appendRow(["📋 SHIFT END PRODUCTION SUMMARY"]);
  sheet.appendRow(["Date", dateStr, "Shift", shiftName]);
  sheet.appendRow(["Cup Size", data.shift_info.cup_size, "Qty/Pouch", data.shift_info.pouch_qty]);
  sheet.appendRow(["Outer Box Case", data.shift_info.outer_box]);
  sheet.appendRow(["Supervisor", data.shift_info.supervisor || "N/A", "Maintenance", data.shift_info.maintenance || "N/A"]);
  sheet.appendRow([]); // empty spacer row
  
  // 3. Format header block
  sheet.getRange("A1").setFontWeight("bold").setFontSize(14);
  sheet.getRange("A2:D5").setFontWeight("bold");
  
  // 4. Append station details table
  sheet.appendRow(["Station Details Table"]);
  sheet.getRange(sheet.getLastRow(), 1).setFontWeight("bold").setFontSize(12);
  
  var tableHeaders = [
    "Station ID", "Station Name", "Operator", "Target Count", "Actual Output", 
    "Rejections", "Net Output", "Avg Speed (P/M)", "Working Hrs", "Breakdown Hrs", 
    "Prod. Efficiency (%)", "Machine Efficiency (%)", "Breakdown Reason"
  ];
  sheet.appendRow(tableHeaders);
  
  // Style table headers
  var headerRange = sheet.getRange(sheet.getLastRow(), 1, 1, tableHeaders.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#334155"); // Dark charcoal theme matching IRIS
  headerRange.setFontColor("#ffffff");
  
  // Write station records
  if (Array.isArray(data.stations)) {
    data.stations.forEach(function(st) {
      sheet.appendRow([
        st.id,
        st.name,
        st.operator,
        st.target,
        st.actual,
        st.rejections,
        st.net,
        st.speed,
        st.working_hrs,
        st.breakdown_hrs,
        st.prod_efficiency,
        st.machine_efficiency,
        st.bd_reason || ""
      ]);
    });
  }
  
  sheet.appendRow([]); // Spacer row
  
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
