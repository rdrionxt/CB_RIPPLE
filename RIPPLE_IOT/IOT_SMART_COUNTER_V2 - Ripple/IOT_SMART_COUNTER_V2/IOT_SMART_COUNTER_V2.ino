/**
 * @file IOT_SMART_COUNTER_V2.ino
 * @brief Firmware for ESP32-based IOT Smart Counter Board with FRAM storage and WhatsApp/Telegram alerts.
 * 
 * This firmware reads sensor inputs, calculates machine speeds, efficiencies, and handles
 * breakdowns. It logs data to Google Sheets, publishes state via MQTT, updates a DWIN HMI display,
 * and sends alerts/summaries to WhatsApp and Telegram based on feature activation macros.
 * 
 * Migration from EEPROM to FRAM (FM25CL65B) Drop-in API is handled over SPI.
 */

/* ========================================================================== */
/* SECTION 0: DEVICE PROFILE SELECTOR                                         */
/* ========================================================================== */

// Choose active device here (uncomment exactly one)
// #define DEVICE_SLAVE1
// #define DEVICE_SLAVE2
// #define DEVICE_SLAVE3
#define DEVICE_SLAVE4

#if defined(DEVICE_SLAVE1)
  #define NUM_INPUTS 3
  #define IN1_PIN 6
  #define IN2_PIN 7
  #define IN3_PIN 17
  #define IN4_PIN 19
  #define DEVICE_NAME_DEFAULT "Slave 1: Pressing & Cupping"
  #define DEVICE_ID_DEFAULT "SL-001"
#elif defined(DEVICE_SLAVE2)
  #define NUM_INPUTS 3
  #define IN1_PIN 6
  #define IN2_PIN 7
  #define IN3_PIN 17
  #define IN4_PIN 19
  #define DEVICE_NAME_DEFAULT "Slave 2: Cupping Station"
  #define DEVICE_ID_DEFAULT "SL-002"
#elif defined(DEVICE_SLAVE3)
  #define NUM_INPUTS 2
  #define IN1_PIN 6
  #define IN2_PIN 7
  #define IN3_PIN -1
  #define IN4_PIN -1
  #define DEVICE_NAME_DEFAULT "Slave 3: Pouching & Sealing"
  #define DEVICE_ID_DEFAULT "SL-003"
#elif defined(DEVICE_SLAVE4)
  #define NUM_INPUTS 1
  #define IN1_PIN 6
  #define IN2_PIN -1
  #define IN3_PIN -1
  #define IN4_PIN -1
  #define DEVICE_NAME_DEFAULT "Slave 4: Lebelling and box packaging"
  #define DEVICE_ID_DEFAULT "SL-004"
#else
  #error "Please define exactly one DEVICE_SLAVEx macro at the top of the sketch!"
#endif

#define count2_add1 530
#define count2_add2 531
#define count3_add1 532
#define count3_add2 533
#define t_s_count2_add1 534
#define t_s_count2_add2 535
#define t_s_count3_add1 536
#define t_s_count3_add2 537

/* ========================================================================== */
/* SECTION 1: SYSTEM MACROS & FEATURE ACTIVATION                              */
/* ========================================================================== */

/**
 * @def ENABLE_WHATSAPP
 * @brief Enable (1) or Disable (0) WhatsApp alert sending via Twilio.
 */
#define ENABLE_WHATSAPP 0

/**
 * @def ENABLE_TELEGRAM
 * @brief Enable (1) or Disable (0) Telegram alert sending via Telegram Bot API.
 */
#define ENABLE_TELEGRAM 0

/**
 * @def STORE
 * @brief Option flag to trigger initial configuration writes to FRAM.
 */
#define STORE 1

/**
 * @def CURRENT_VERSION
 * @brief Current firmware version string.
 */
#define CURRENT_VERSION "2.7"

/**
 * @name Google Sheets Queue Memory Addresses
 * @{
 */
#define GS_HEAD_ADDR 600
#define GS_TAIL_ADDR 602
#define GS_DATA_ADDR 610
#define GS_MAX_ITEMS 10
#define GS_ITEM_SIZE 220
/** @} */

/**
 * @name WhatsApp Queue Memory Addresses
 * @{
 */
#define WA_HEAD_ADDR 3000
#define WA_TAIL_ADDR 3002
#define WA_DATA_ADDR 3010
#define WA_MAX_ITEMS 5
#define WA_ITEM_SIZE 300
/** @} */

/**
 * @name EEPROM/FRAM Migration Memory Map Addresses
 * @{
 */
#define t_count_add1 1
#define t_count_add2 2
#define t_count_add3 3
#define t_count_add4 4
#define t_w_hrs_add1 5
#define t_w_hrs_add2 6
#define t_bd_hrs_add1 7
#define t_bd_hrs_add2 8
#define count_add1 9
#define count_add2 10
#define day_add 11
#define bd_count_add1 12
#define bd_count_add2 13
#define up_state_add 14
#define run_time_add1 15
#define run_time_add2 16
#define start_time_add1 17
#define start_time_add2 18
#define start_time_add3 19
#define stop_time_add1 20
#define stop_time_add2 21
#define stop_time_add3 22
#define sense_bd_time1 23
#define sense_bd_time2 24
#define bd_reason_add 25
#define main_start_time_add1 26
#define main_start_time_add2 27
#define main_start_time_add3 28
#define t_w_s_hrs_add1 29
#define t_w_s_hrs_add2 30
#define t_bd_s_hrs_add1 31
#define t_bd_s_hrs_add2 32
#define t_s_count_add1 33
#define t_s_count_add2 34
#define shift_data_update 35
#define unit_name_add 40
#define operator_name_add 60
#define maintenance_name_add 80
#define shift_add 100
#define device_name_add 130
#define date_add 160
#define eff_add 175
#define bypass_add 190
#define DEVICE_ID_ADDR 200
#define DEVICE_NAME_ADD 213
#define GOOGLE_SCRIPT_ID_ADDR 260
#define PART_NAME_ADD_ADDR 350
#define IS_GENERAL_SHIFT_ADDR 520
#define ITEM_CHANGE_ACTIVE_ADDR 522
#define ITEM_CHANGE_START_ADDR 524
#define PART_SPEED_L_ADDR 430
#define PART_SPEED_H_ADDR 431
#define SHIFT_LOSS_L_ADDR 434
#define SHIFT_LOSS_H_ADDR 435
#define ITEM_CO_L_ADDR 440
#define ITEM_CO_H_ADDR 441
#define PART_RUN_CNT_ADDR 444
#define SHIFT_START_TIME_ADDR 500
#define TWS_MIN_L 29
#define TWS_MIN_H 30
#define TBS_MIN_L 31
#define TBS_MIN_H 32
#define STATION1_OP_ADDR 2850
#define STATION2_OP_ADDR 2870
#define STATION3_OP_ADDR 2890
#define POUCH_QTY_ADDR 542
#define INNER_QTY_ADDR 544
#define OUTER_QTY_ADDR 546
/** @} */

/**
 * @name GPIO Pin Configuration
 * @{
 */
#define SENSOR IN1_PIN
#define DEVICE_STATE 7
#define DEVICE_STATE_OUT 1
#define PIN_POWER_SHUTDOWN 41
#define PIN_DWIN_RX 20
#define PIN_DWIN_TX 9
/** @} */

/**
 * @name FRAM SPI Driver Pin & Command Configuration
 * @{
 */
#define FRAM_CS 14
#define FRAM_SCK 12
#define FRAM_MISO 13
#define FRAM_MOSI 11
#define FRAM_HOLD 15
#define FRAM_WP 16

#define FR_CMD_WREN 0x06
#define FR_CMD_WRDI 0x04
#define FR_CMD_RDSR 0x05
#define FR_CMD_WRSR 0x01
#define FR_CMD_READ 0x03
#define FR_CMD_WRITE 0x02
/** @} */

/**
 * @def TINY_GSM_MODEM_SIM800
 * @brief Modem type flag for TinyGSM library (if used).
 */
#define TINY_GSM_MODEM_SIM800

/**
 * @def WIFI_RETRY_INTERVAL
 * @brief Period in milliseconds between Wi-Fi reconnection attempts.
 */
#define WIFI_RETRY_INTERVAL 5000UL

/**
 * @def MQTT_RETRY_INTERVAL
 * @brief Period in milliseconds between MQTT connection retries.
 */
#define MQTT_RETRY_INTERVAL 5000UL

#if defined(DEVICE_SLAVE3)
  #define STATION_INACTIVITY_LIMIT 50000UL
#else
  #define STATION_INACTIVITY_LIMIT 5000UL
#endif

/**
 * @def TIME_SCALE
 * @brief Scaler used to represent float times with 0.1 minute resolution in FRAM.
 */
#define TIME_SCALE 10.0f


/* ========================================================================== */
/* SECTION 2: USER CONFIGURABLE VARIABLES                                     */
/* ========================================================================== */

// --- Wi-Fi Credentials ---
const char *ssid = "RIPPLE-WIFI";
const char *pass = "5533##@@";

// --- Device Details ---
uint8_t board_no = 0;
String device_id = "RXT22V2001";

// --- Twilio WhatsApp Configuration ---
String accountSID = "AC6a09df836c61ef7e7b3bd2a6e3142483";
String authToken = "4dc207e7ebaf868e200f160c9c084c5d";
String fromNumber = "whatsapp:+14155238886";
String toNumbers[] = {
  "whatsapp:+918124196701", 
  "whatsapp:+919980519067",
  "whatsapp:+919611930262", 
  "whatsapp:+919945781099",
  "whatsapp:+919845122629"
};
int numRecipients = 1;


// --- Telegram configuration ---
String botToken = "8786500968:AAFoDJA1m_uoOIQ1zSPBAfAJne9Xk-KmBb0";
String chatID   = "-5005894782";

// --- NTP Configuration ---
const char *ntpServer1 = "pool.ntp.org";
const char *ntpServer2 = "time.nist.gov";
const char *ntpServer3 = "asia.pool.ntp.org";
const char *ntpServer = "pool.ntp.org";
const long gmtOffset_sec = 19800; // UTC +5:30
const int daylightOffset_sec = 0;

// --- Google Drive (OTA Version Checks) ---
const char *version_url = "https://script.google.com/macros/s/AKfycby9v13iLxYlGoY-d9HaoiU-CgEBKNL4c6a2VukQTbJLtB5VBRjMxcBtDQdfs-YNEyWC/exec";

// --- Google App Scripts IDs ---
String GOOGLE_SCRIPT_ID;
String GOOGLE_SCRIPT_ID1 = "AKfycbylLPHDt9SRMVsamNftahqmVVpP3hEiQDnQjE2Zdqf7cDaA9lQ_7kvNsrkOEV2M_7EyGA";

// --- MQTT Configuration ---
const char *mqtt_broker = "broker.hivemq.com";
const int mqtt_port = 1883;
const char *mqtt_username = "";
const char *mqtt_password = "";
char client_name[32] = {0};
const char *topic_in = "CB_RN_IOT_DATA_IN";
const char *topic_out = "CB_RN_IOT_DATA_OUT";

// --- Shift Times Configuration ---
String shift1 = "14:00";
String shift2 = "22:00";
String shift3 = "06:00";

// --- MQTT Send/Data Update Interval (ms) ---
const unsigned long values_update_interval = 3000UL;


/* ========================================================================== */
/* SECTION 3: SYSTEM LIBRARIES & INCLUDES                                    */
/* ========================================================================== */

#include "time.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <base64.h>
#include <SPI.h>
#include <ArduinoOTA.h>


/* ========================================================================== */
/* SECTION 4: DATA STRUCTURES & LOOKUP TABLES                                 */
/* ========================================================================== */

/**
 * @struct ShiftSummary
 * @brief Structure containing metrics and details of a single shift.
 */
struct ShiftSummary {
  String device_id;
  String device_name;
  String unit_name;
  String part_name;
  String operator_name;
  String shift;
  String date;
  String shift_start_time;
  String shift_end_time;
  uint32_t shift_count;
  float working_mins;
  float bd_mins;
  float efficiency;
  float current_machine_speed;
  uint16_t machine_speed;
  uint16_t target_count;
  float production_efficiency;
  String wastage;
  String bd_reason;
  uint16_t rejection_qty;
  float rejection_percentage;
  float change_over_loss_mins;
  String S_remarks;
  uint16_t S_good_qty = 0;
  float S_manpower_count = 0.0f;
  bool valid;
};

/**
 * @struct PartSpeed
 * @brief Association mapping a product part name to its production speed (pcs/min).
 */
struct PartSpeed {
  const char *part;
  uint16_t speed;
};

// --- Part Speed Configuration mapping ---
// MET unit
// const PartSpeed partSpeedMap[] = {
//   { "RR-Three_in_one_with_SF-Rs55-9\"-72N-98g", 24 },
//   { "RR-Three_in_one_with_SF-Rs55-9\"-62N-86g", 25 },
//   { "RR-AG-SDP55-SANDALUM_-9\"-85g-62N_BR", 22 },
//   { "RR-RHYTHM_AMBER-23CM-9\"-97g-70N_BK-Impr", 21 },
//   { "RR-Rhythm_Orient-23CM-9\"-97g-70N_BK-Impr", 21 },
//   { "RR-Rhythm_Saroja-23CM-9\"-97G-70N-BK", 21 },
//   { "RR-Rhythm_Sandal-23CM-9\"-97G-70N-BK", 21 },
//   { "RR-CSM55-CY_SUG_MALLIKA-9\"-95g-70N-BR", 21 },
//   { "RR-Heritage_RadiantRose-23CM-9\"-82G-60NBR", 22 },
//   { "RR-Heritage_Regular-23CM-9\"-92G-66N-BR", 22 },
//   { "RR-BIHU_KONGALI-23CM-9\"-97G-70N-BK", 21 },
//   { "RR-Bihu_Rongali-23CM-9\"-97g-70N-MM-Black", 21 },
//   { "RR-TINM-3IN1-9\"-88g", 25 },
//   { "RR-Cycle_Godhuli-23CM-9\"-97G-70N-BK", 21 },
//   { "RR-Cycle_Prestige-23CM-9\"-97G-70N-BK", 21 },
//   { "RR-Good_Luck_Pineapple-23CM-9\"-97g-70-BR", 21 },
//   { "RR-HONEY_ROSE-23CM-9\"-97G-70N-BK", 21 },
//   { "RR-MTN125-Lily-9\"-69g-50N", 30 },
//   { "RR-MTN125-Fancy-9\"-69g-50N", 30 },
//   { "RR-MTN125-Intimate-9\"-78g-56N", 26 },
//   { "GOOD_LUCK_MUSK_IS_₹70_PU_100G_82N", 18 },
//   { "GOOD_LUCK_GUGGAL_IS_₹70_PU_100G_82N", 18 },
//   { "GOOD_LUCK_LAVENDER_IS_₹70_PU_100G_82N", 18 },
//   { "GOOD_LUCK_PINEAPPLE_IS_₹70_PU_100G_82N", 18 },
//   { "GOOD_LUCK_SANDAL_IS_₹70_PU_100G_82N", 18 },
//   { "GOOD_LUCK_SHIVULI_IS_₹70_PU_100G_82N", 18 }
// };

// unit - wallmart (commented out)
/*
const PartSpeed partSpeedMap[] = {
  {"RR_25.4CM-10\"_WM_BLACKCHERRY_40N_INCENSE", 35},
  {"RR_25.4CM-10\"_WM_DRAGONBLOOD_40N_INCENSE", 35},
  {"RR_25.4CM-10\"_WM_FRANKINCENSE40N_INCENSE", 35},
  {"RR_25.4CM-_10\"_WM_LAVENDER_40N_INCENSE", 35},
  {"RR_25.4CM-10\"_WM_Myrrh_40N_Incense", 35},
  {"RR_25.4-10\"_WM_NAG_CHAMPA_40N_INCENSE", 35},
  {"RR_25.4CM-10\"_WM_PATCHOULI_40N_INCENSE", 35},
  {"RR_25.4CM_10\"_WM_SAGE_40N_INCENSE", 35},
  {"RR_25.4CM-10\"_WM_SANDALWOOD_40N_INCENSE", 35},
  {"RR_25.4CM-10\"_WM_STRAWBERRY_40N_INCENSE", 35},
  {"RR_25.4CM-10\"_WM_DRAGONBLOOD_20N_INCENSE", 50},
  {"RR_25.4CM-10\"_WM_LAVENDER_10N_INCENSE", 60},
  {"RR_25.4CM-10\"_WM_SANDALWOOD_10N_INCENSE", 60},
  {"RR_25.4CM-10\"_WM_NAG_CHAMPA_10N_INCENSE", 60},
  {"RR_WM_Back_Flow_Cones_2.5CM_Lavender_40N", 5},
  {"RR_WM_Back_Flow_Cone_2.5CM_Full_Moon_40N", 5},
  {"RR_WM_Back_Flow_Cones_2.5CM_D.Blood_40N", 5},
  {"RR_WM_Incense_Cones_3.5CM_D.Blood_40N", 5},
  {"RR_WM_Incense_Cones_3.5CM_Ng-champa_40N", 5},
  {"RR-WM_Back_Flow_Cones_2.5CM_D.Blood_20N", 8},
  {"RR-WM_BF_CONES_2.5CM_LAVENDER_20N", 8},
  {"RR-Sandalum_Cone-4cm-1.6\"-8N-Br", 8},
  {"RR-Incense_Cone_3.5CM_Jatamansi_20N", 8},
  {"RR_Cones-Cycle_Sandalum-3.18CM-20N", 8},
  {"RR_9\"_Natural_INC-_Kasturi_Musk_20_NOS", 50},
  {"RR-Incense_Cone_1.25\"_Mogra_40N", 35},
  {"RR-9\"_N_Incense-Atrae_Clientes_20N", 50},
  {"RR_AM-_9\"_Bergamot_&_Rose_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Vanilla_-_25N_INCENSE", 45},
  {"RR-NATYA_KESARI-20CM-37G-30N-MM-BK", 45},
  {"RR_AM-_9\"_Jasmine_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Mint_&_Rosemary_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Eucalyptus_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Watermelon_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Mandarin_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Sandalwood_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Lavender_-_25N_INCENSE", 45},
  {"RR_AM-_9\"_Red_Sorbet_AQ_-25N_INCENSE", 45},
  {"RR_AM-_9\"_Aqua_Cool_-_25N_INCENSE", 45},
  {"RR_AM-_9\"Apple_Cinnamon_AQ_-25N_INCENSE", 45},
  {"RR_AM-_9\"_Patchouli_-_25N_INCENSE", 45},
  {"RR-Three_in_one_with_SF-Rs55-9\"-62N-86g", 22},
  {"RR_23CM_9\"_AM-_Copal_-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Citronella_-BK-20N", 50},
  {"RR_23CM_9\"_AM-Lavender-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Apple_Cinnamon_AQ_-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Mint&Rosemary_-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Palo_Santo_-BK-20N", 50},
  {"RR_23CM_9\"_AM-Red_Sorbet_AQ_-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Watermelon_-BK-20N", 50},
  {"RR_23CM_9\"_AM-Cucumber_-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Coconut_Cinnamon_-BK-20N", 50},
  {"RR_23CM_9\"_AM-Myrrh_-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Sandalwood_-BK-20N", 50},
  {"RR_23CM_9\"_AM-_Mandarin_-BK-20N", 50},
  {"RR_AM-_9\"_-COPAL_25N_INCENSE", 45},
  {"RR_AM-_9\"_-Myrrh-_25N_INCENSE", 45},
  {"RR_AM-_9\"_-PALO_SANTO_25N_INCENSE", 45},
  {"RR_AM-_9\"_-Coconut_Cinnamon_25N_INCENSE", 45},
  {"RR_23CM_9\"_AM-_Bergamot_&_Rose-BK-20N", 50},
  {"RR_23CM_9\"_AM-Red_Sorbet_AQ_-BK-18N", 50},
  {"RR_23CM_9\"_AM-_Vanilla_-BK-20_N", 50},
  {"RR_CY_8\"_LIA_SANDAL_20N_NB", 50},
  {"RR_CY_9\"_RHYTHM_AMBER_20_STICKS", 50},
  {"RR_CY_8\"_LIA_SANDAL_20N-NB", 50},
  {"RR_9\"_RHYTHM_ORIENT_20_STICKS", 50},
  {"RR_CY_8\"_AMBER_ROSE_10N-NB", 65}
};
*/

// unit - RIPPLE
const PartSpeed partSpeedMap[] = {
  {"T-light candle", 88}
};

const uint16_t PART_SPEED_COUNT = sizeof(partSpeedMap) / sizeof(partSpeedMap[0]);

// --- Breakdown Reasons ---
const char *const breakdownReasons[] PROGMEM = {
  "MOTOR_PROBLEM",
  "CONVEYER_PROBLEM",
  "PRESS_MOULD_ISSUE",
  "PRESS_PIN_ISSUE",
  "PRESS_BRASS_ISSUE",
  "SENSOR_NOT_WORKING",
  "V_BELT_DAMAGE",
  "COMPRESSOR_AIR_ISSUE"
};

// --- Part Names List ---
// met unit
// const char* const partNames[] PROGMEM = {
// "RR-Three_in_one_with_SF-Rs55-9\"-72N-98g",
//                                           "RR-Three_in_one_with_SF-Rs55-9\"-62N-86g",
//                                           "RR-AG-SDP55-SANDALUM_-9\"-85g-62N_BR",
//                                           "RR-RHYTHM_AMBER-23CM-9\"-97g-70N_BK-Impr",
//                                           "RR-Rhythm_Orient-23CM-9\"-97g-70N_BK-Impr",
//                                           "RR-Rhythm_Saroja-23CM-9\"-97G-70N-BK",
//                                           "RR-Rhythm_Sandal-23CM-9\"-97G-70N-BK",
//                                           "RR-CSM55-CY_SUG_MALLIKA-9\"-95g-70N-BR",
//                                           "RR-Heritage_RadiantRose-23CM-9\"-82G-60NBR",
//                                           "RR-Heritage_Regular-23CM-9\"-92G-66N-BR",
//                                           "RR-BIHU_KONGALI-23CM-9\"-97G-70N-BK",
//                                           "RR-Bihu_Rongali-23CM-9\"-97g-70N-MM-Black",
//                                           "RR-TINM-3IN1-9\"-88g",
//                                           "RR-Cycle_Godhuli-23CM-9\"-97G-70N-BK",
//                                           "RR-Cycle_Prestige-23CM-9\"-97G-70N-BK",
//                                           "RR-Good_Luck_Pineapple-23CM-9\"-97g-70-BR",
//                                           "RR-HONEY_ROSE-23CM-9\"-97G-70N-BK",
//                                           "RR-MTN125-Lily-9\"-69g-50N",
//                                           "RR-MTN125-Fancy-9\"-69g-50N",
//                                           "RR-MTN125-Intimate-9\"-78g-56N",
//                                           "GOOD_LUCK_MUSK_IS_₹70_PU_100G_82N",
//                                           "GOOD_LUCK_GUGGAL_IS_₹70_PU_100G_82N",
//                                           "GOOD_LUCK_LAVENDER_IS_₹70_PU_100G_82N",
//                                           "GOOD_LUCK_PINEAPPLE_IS_₹70_PU_100G_82N",
//                                           "GOOD_LUCK_SANDAL_IS_₹70_PU_100G_82N",
//                                           "GOOD_LUCK_SHIVULI_IS_₹70_PU_100G_82N"
//                                           };

// unit - wallmart (commented out)
/*
const char *const partNames[] PROGMEM = {
  "RR_25.4CM-10\"_WM_BLACKCHERRY_40N_INCENSE", "RR_25.4CM-10\"_WM_DRAGONBLOOD_40N_INCENSE",
  "RR_25.4CM-10\"_WM_FRANKINCENSE40N_INCENSE", "RR_25.4CM-_10\"_WM_LAVENDER_40N_INCENSE",
  "RR_25.4CM-10\"_WM_Myrrh_40N_Incense", "RR_25.4-10\"_WM_NAG_CHAMPA_40N_INCENSE",
  "RR_25.4CM-10\"_WM_PATCHOULI_40N_INCENSE", "RR_25.4CM_10\"_WM_SAGE_40N_INCENSE",
  "RR_25.4CM-10\"_WM_SANDALWOOD_40N_INCENSE", "RR_25.4CM-10\"_WM_STRAWBERRY_40N_INCENSE",
  "RR_25.4CM-10\"_WM_DRAGONBLOOD_20N_INCENSE", "RR_25.4CM-10\"_WM_LAVENDER_10N_INCENSE",
  "RR_25.4CM-10\"_WM_SANDALWOOD_10N_INCENSE", "RR_25.4CM-10\"_WM_NAG_CHAMPA_10N_INCENSE",
  "RR_WM_Back_Flow_Cones_2.5CM_Lavender_40N", "RR_WM_Back_Flow_Cone_2.5CM_Full_Moon_40N",
  "RR_WM_Back_Flow_Cones_2.5CM_D.Blood_40N", "RR_WM_Incense_Cones_3.5CM_D.Blood_40N",
  "RR_WM_Incense_Cones_3.5CM_Ng-champa_40N", "RR-WM_Back_Flow_Cones_2.5CM_D.Blood_20N",
  "RR-WM_BF_CONES_2.5CM_LAVENDER_20N", "RR-Sandalum_Cone-4cm-1.6\"-8N-Br",
  "RR-Incense_Cone_3.5CM_Jatamansi_20N", "RR_Cones-Cycle_Sandalum-3.18CM-20N",
  "RR_9\"_Natural_INC-_Kasturi_Musk_20_NOS", "RR-Incense_Cone_1.25\"_Mogra_40N",
  "RR-9\"_N_Incense-Atrae_Clientes_20N", "RR_AM-_9\"_Bergamot_&_Rose_-_25N_INCENSE",
  "RR_AM-_9\"_Vanilla_-_25N_INCENSE", "RR-NATYA_KESARI-20CM-37G-30N-MM-BK",
  "RR_AM-_9\"_Jasmine_-_25N_INCENSE", "RR_AM-_9\"_Mint_&_Rosemary_-_25N_INCENSE",
  "RR_AM-_9\"_Eucalyptus_-_25N_INCENSE", "RR_AM-_9\"_Watermelon_-_25N_INCENSE",
  "RR_AM-_9\"_Mandarin_-_25N_INCENSE", "RR_AM-_9\"_Sandalwood_-_25N_INCENSE",
  "RR_AM-_9\"_Lavender_-_25N_INCENSE", "RR_AM-_9\"_Red_Sorbet_AQ_-25N_INCENSE",
  "RR_AM-_9\"_Aqua_Cool_-_25N_INCENSE", "RR_AM-_9\"Apple_Cinnamon_AQ_-25N_INCENSE",
  "RR_AM-_9\"_Patchouli_-_25N_INCENSE", "RR-Three_in_one_with_SF-Rs55-9\"-62N-86g",
  "RR_23CM_9\"_AM-_Copal_-BK-20N", "RR_23CM_9\"_AM-_Citronella_-BK-20N",
  "RR_23CM_9\"_AM-Lavender-BK-20N", "RR_23CM_9\"_AM-_Apple_Cinnamon_AQ_-BK-20N",
  "RR_23CM_9\"_AM-_Mint&Rosemary_-BK-20N", "RR_23CM_9\"_AM-_Palo_Santo_-BK-20N",
  "RR_23CM_9\"_AM-Red_Sorbet_AQ_-BK-20N", "RR_23CM_9\"_AM-_Watermelon_-BK-20N",
  "RR_23CM_9\"_AM-Cucumber_-BK-20N", "RR_23CM_9\"_AM-_Coconut_Cinnamon_-BK-20N",
  "RR_23CM_9\"_AM-Myrrh_-BK-20N", "RR_23CM_9\"_AM-_Sandalwood_-BK-20N",
  "RR_23CM_9\"_AM-_Mandarin_-BK-20N", "RR_AM-_9\"_-COPAL_25N_INCENSE",
  "RR_AM-_9\"_-Myrrh-_25N_INCENSE", "RR_AM-_9\"_-PALO_SANTO_25N_INCENSE",
  "RR_AM-_9\"_-Coconut_Cinnamon_25N_INCENSE", "RR_23CM_9\"_AM-_Bergamot_&_Rose-BK-20N",
  "RR_23CM_9\"_AM-Red_Sorbet_AQ_-BK-18N", "RR_23CM_9\"_AM-_Vanilla_-BK-20_N",
  "RR_CY_8\"_LIA_SANDAL_20N_NB", "RR_CY_9\"_RHYTHM_AMBER_20_STICKS",
  "RR_CY_8\"_LIA_SANDAL_20N-NB", "RR_9\"_RHYTHM_ORIENT_20_STICKS",
  "RR_CY_8\"_AMBER_ROSE_10N-NB"
};
*/

// unit - RIPPLE
const char *const partNames[] PROGMEM = {
  "T-light candle"
};

// --- Operators List ---
// unit - Met
// const char* const operators[] PROGMEM = { "LALITHA", "SUKRUTHA",
// "VANAJAKSHI", "PUSHPALATHA", "MAHADEVAMMA", "PAVITHRA",
//                                           "JYOTHI", "NAGARAJA", "SHARATH",
//                                           "SHANKARA", "HANDRIKA", "BHAVYA",
//                                           "MANJULA", "MAHENDRA" };

// unit - wallmart
const char *const operators[] PROGMEM = {
  "IFRAN"
};

// --- Units List ---
const char *const units[] PROGMEM = {
  "MET", "TN_PURA", "WALLMART", "HILL_VIEW", "GINGEE", "RIPPLE"
};


/* ========================================================================== */
/* SECTION 5: GLOBAL OBJECTS & VARIABLES                                      */
/* ========================================================================== */

extern PubSubClient mqtt;
WiFiServer telnetServer(23);
WiFiClient telnetClient;

class DualSerial : public Stream {
  private:
    String logBuffer;
    bool isLogging = false;
    String macAddr;

    void handleMqttLogChar(uint8_t c) {
      if (isLogging) {
        return;
      }
      isLogging = true;
      logBuffer += (char)c;
      if (c == '\n' || logBuffer.length() >= 250) {
        if (mqtt.connected()) {
          if (macAddr.length() == 0) {
            macAddr = WiFi.macAddress();
          }
          String topic = "CB_RN_IOT_LOGS/" + macAddr;
          mqtt.publish(topic.c_str(), logBuffer.c_str());
        }
        logBuffer = "";
      }
      isLogging = false;
    }

  public:
    void begin(unsigned long baud) {
      Serial.begin(baud);
    }
    void begin(unsigned long baud, uint32_t config, int8_t rxPin, int8_t txPin) {
      Serial.begin(baud, config, rxPin, txPin);
    }
    size_t write(uint8_t c) override {
      size_t len = Serial.write(c);
      if (telnetClient && telnetClient.connected()) {
        telnetClient.write(c);
      }
      handleMqttLogChar(c);
      return len;
    }
    size_t write(const uint8_t *buffer, size_t size) override {
      size_t len = Serial.write(buffer, size);
      if (telnetClient && telnetClient.connected()) {
        telnetClient.write(buffer, size);
      }
      for (size_t i = 0; i < size; i++) {
        handleMqttLogChar(buffer[i]);
      }
      return len;
    }
    int available() override { return Serial.available(); }
    int read() override { return Serial.read(); }
    int peek() override { return Serial.peek(); }
    void flush() override { Serial.flush(); }
};

DualSerial LogSerial;
#define Serial LogSerial

// --- Network & Server Objects ---
WebServer server(80);
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

IPAddress local_IP(192, 168, 4, 50);
IPAddress gateway(192, 168, 4, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);

// --- JSON Parser Document buffers ---
StaticJsonDocument<2048> rcv_data;

// --- Shift Summary Instance ---
ShiftSummary shiftSummary;

// --- Globals ---
volatile uint32_t total_count = 0;
#ifdef NUM_INPUTS
  #define MAX_STATIONS 3
#else
  #define MAX_STATIONS 1
#endif

volatile uint16_t station_counts[MAX_STATIONS] = {0};
volatile bool sensor_flags[MAX_STATIONS] = {true, true, true};
volatile uint32_t station_shift_counts[MAX_STATIONS] = {0};
volatile unsigned long last_pulse_time_st[MAX_STATIONS] = {0};

volatile uint16_t &sense = station_counts[0];
volatile bool &sense_flag = sensor_flags[0];
volatile uint32_t &shift_count = station_shift_counts[0];

volatile bool motor1_status = false;
bool motor2_status = false;
bool button_state = false;

String shift_start_time;
String shift_stop_time;

bool upload_state = 1;
bool mqtt_enable = 0;

uint16_t spm = 0;
uint16_t bd_count = 0;
uint16_t read_m1_speed = 0;
uint8_t MAX_DUTY_CYCLE = 0;
uint32_t led_millis = 0;
byte day_val = 0;

float efficiency_percent = 0.0;
float bd_min_set = 5;
float bd_major_set = 30.0;

// --- Timing Helpers ---
String dateStr;
String Time;
String current_date;
String Time1;
struct tm timeinfo;
bool start_time_fetch_flag = 0;

// --- Shift & Device details ---
String unit_name = "RIPPLE";
String operator_name = "IFRAN";
String maintenance_name = "";
String shift = "";
String device_name = "Cupping_S1";
String device_name_saved = "";
String wastage;
bool is_wastage_updated = false;

// --- Breakdown details ---
String bd_reason2 = "";
String spare_detail = "";
String spare_qty = "";
String bd_remarks = "";
String bd_reason = "power_cut";
bool is_bd_reason_updated = false;
bool is_major_bd = false;
bool is_min_bd = false;
bool is_general_shift = false;

String part_name = "";

// --- System State & Loss Trackers ---
bool set_time_flag = false;
// volatile uint16_t sense = 0; // Configured as macro alias
volatile uint16_t presense = 0;
volatile uint32_t last_seen_sense = 0;
volatile uint32_t last_pulse_time = 0;
volatile uint16_t last_seen_counts[MAX_STATIONS] = {0};
uint32_t start_millis1 = 0;
uint32_t working_millis = 0;
uint32_t bd_millis = 0;
uint32_t working_shift_millis = 0;
uint32_t bd_shift_millis = 0;
float total_working_hrs = 0.0;
float total_bd_hrs = 0.0;
float total_working_shift_hrs = 0.0;
float total_bd_shift_hrs = 0.0;

float total_working_hrs1 = 0.0;
float total_bd_hrs1 = 0.0;
float total_working_shift_hrs1 = 0.0;
float total_bd_shift_hrs1 = 0.0;

// volatile uint32_t shift_count = 0; // Configured as macro alias

uint32_t running_time = 0;
uint32_t bd_time = 0;

String start_time = "";
String stop_time = "";
String machine_state = "";
String shift_temp = "";
uint32_t stop_millis = 0;

String main_start_time;
String main_start_time_with_sl;

bool data_pick = false;
bool is_shift_data_updated = false;
bool is_day_change = false;
bool is_machine_running = false;
bool first_start = true;
bool shift_to_sheet = false;
bool reset_flag = false;
bool shift_update_received = false;
bool shift_data_requested_activated_flag = false;
bool bd_reason_data_requested_activated_flag = false;
bool is_shift_completed = false;
uint8_t tvals[10];
uint16_t temp_total_shift_working_hrs = 0;
uint16_t temp_total_shift_bd_hrs = 0;
uint16_t temp_total_working_hrs = 0;
uint16_t temp_total_bd_hrs = 0;

String bd_reason_local;
String current_log_sl_no_str;
uint16_t current_log_sl_no = 0;
uint32_t values_update_last = 0;
unsigned long values_update_millis = 0;
wl_status_t last_wifi_status = WL_IDLE_STATUS;

uint8_t bypass_signal = 0;
uint8_t bypass_signal_flag = 0;

uint8_t button_count = 0;
uint32_t start_millis = 0;
bool manual_check = false;
bool one_time_flag = 0;

uint16_t qty_per_pouch = 10;
uint16_t box_pouch_qty = 10;
uint16_t box_inner_qty = 1;
uint16_t box_outer_qty = 1;

float total_working_shift_mins = 0.0f;
float total_bd_shift_mins = 0.0f;
float base_working_shift_mins = 0.0f;
float base_bd_shift_mins = 0.0f;

uint32_t state_start_millis = 0;
bool last_machine_state = false;

uint16_t part_speed = 0;

uint32_t shift_change_start_millis = 0;
float shift_change_loss_mins = 0.0f;
bool shift_change_active = false;

uint8_t part_run_count = 0;
bool item_change_active = false;
time_t item_change_start_time = 0;
float item_changeover_mins = 0.0f;

String remarks;
uint16_t good_qty = 0;
float manpower_count = 0.0f;
uint8_t temp_hour = 0;

uint16_t gsHead = 0, gsTail = 0;
uint16_t waHead = 0, waTail = 0;

bool wa_shift_pending = false;
unsigned long wa_trigger_time = 0;

SPISettings framSPI(20000000, MSBFIRST, SPI_MODE0);

// --- WiFi / MQTT reconnect counters ---
unsigned long lastWiFiAttempt = 0;
unsigned long lastMQTTAttempt = 0;
uint32_t lastReconnectAttempt = 0;

// --- DWIN Display Variables ---
unsigned long last_dwin_update = 0;
const unsigned long DWIN_UPDATE_INTERVAL = 3000UL;
bool dwin_is_operator_screen = true;
uint16_t dwin_shift_page = 1;
uint16_t dwin_shift_selection = 1;
String dwin_temp_part_name = "";
String dwin_temp_operator_name = "";
uint16_t dwin_unit_page = 1;
uint16_t dwin_unit_selection = 1;
uint16_t dwin_reason_page = 1;
uint16_t dwin_selection = 1;
uint16_t dwin_wastage = 0;
uint16_t dwin_rejection_qty = 0;
uint16_t dwin_manpower = 0;
 
volatile uint8_t dwin_active_station_idx = 0;
volatile uint8_t dwin_active_bd_station_idx = 0;
String station_bd_reasons[MAX_STATIONS];
String station_operators[MAX_STATIONS];
float station_working_mins[MAX_STATIONS] = {0.0f};
float station_breakdown_mins[MAX_STATIONS] = {0.0f};
uint32_t station_targets[3] = {0};
String order_no = "";
String supervisor_name = "";
String shift_bd_log = "";
 
#if defined(DEVICE_SLAVE1)
  const char* const dwin_station_names[] = {"PRESSING 1", "CUPPING 5", "CUPPING 4"};
#elif defined(DEVICE_SLAVE2)
  const char* const dwin_station_names[] = {"CUPPING 3", "CUPPING 2", "CUPPING 1"};
#elif defined(DEVICE_SLAVE3)
  const char* const dwin_station_names[] = {"POUCHING 1", "POUCHING 2"};
#elif defined(DEVICE_SLAVE4)
  const char* const dwin_station_names[] = {"LABELLING", "CASE PACKING"};
#else
  const char* const dwin_station_names[] = {"STATION 1"};
#endif
 
const uint8_t NUM_ACTUAL_STATIONS = sizeof(dwin_station_names) / sizeof(dwin_station_names[0]);


/* ========================================================================== */
/* SECTION 6: FUNCTION PROTOTYPES (FORWARD DECLARATIONS)                      */
/* ========================================================================== */

void initFRAM();
void framWriteEnable();
void framWrite8(uint16_t addr, uint8_t data);
uint8_t framRead8(uint16_t addr);
void framWriteArray(uint16_t addr, const uint8_t *buf, uint16_t len);
void framReadArray(uint16_t addr, uint8_t *buf, uint16_t len);
void framWriteString(uint16_t addr, const String &s);
String framReadString(uint16_t addr);

void pin_mode_init();
void IRAM_ATTR sensor_count();
void IRAM_ATTR sensor_count_2();
void IRAM_ATTR sensor_count_3();
void wifi_connect();
void ensureWiFi();
void ensureMQTT();
void showNotification(const String &message);
void trackNetworkStatus();
boolean mqttConnect();
void mqtt_reconnect();
void mqttCallback(char *topic, byte *payload, unsigned int len);
void send_mqtt();

void eeprom_store();
void eeprom_read1();
void eeprom_read2();
void eeprom_read3();
void writeStringToEEPROM(int addrOffset, const String &strToWrite);
String readStringFromEEPROM(int addrOffset);

void data_fetch();
void write_to_google_sheet(String params);
void data_fetch1();
bool write_shift_summary_to_google_sheet(const ShiftSummary &s);
bool write_to_google_sheet_post(const String &jsonPayload);
void sendShiftSummary();

#if ENABLE_WHATSAPP == 1
void sendWhatsAppMessage(String message);
#endif

#if ENABLE_TELEGRAM == 1
void sendTelegramMessage(String message);
#endif

#if ENABLE_WHATSAPP == 1 || ENABLE_TELEGRAM == 1
String buildWhatsAppMessage(const ShiftSummary &s);
#endif

void queueGoogleSheet(const String &url);
void flushGoogleSheetQueue();
void queueWhatsApp(const String &msg);
void flushWhatsAppQueue();

void run_reset();
void shift_reset();
void efficiency();

void updateShiftTime(bool current_state);
void computeLiveShiftTime();
void storeShiftTimeToFRAM();
void restoreShiftTimeFromFRAM(bool current_machine_state);
String getShiftLabelFromTime(int hour, int minute);
String urlEncode(const String &str);
uint16_t getPartSpeed(const String &part);

void setColor(uint8_t r, uint8_t g, uint8_t b);
void red();
void red_blink();
void green();
void green_blink();
void blue();
void blue_blink();
void off_led();
void all_led();
void purple_led();

void dwinWriteInt(uint16_t vpAddr, uint16_t value);
void dwinWriteLong(uint16_t vpAddr, uint32_t value);
void dwinSwitchPage(uint16_t pageId);
void dwinWriteString(uint16_t vpAddr, const String &str, int padLen = 0);
void updateDWINDisplay();
void updateBreakdownPage(uint16_t pageNum);
void submitBreakdownDWIN(uint16_t choice);
void updateShiftStartPage(uint16_t pageNum);
void dwinStartShift(const String &selected_part, const String &selected_operator);
void parseDWIN();
void updateUnitSettingPage(uint16_t pageNum);
void submitUnitSettingDWIN(uint16_t choice);

void startWebServer();
void handleRoot();
void handleBreakdown();
void handleShift();
void handleWastage();
void handleSettings();
void handleCheckUpdate();
void checkForUpdate();
void performOTA(String firmwareURL);


/* ========================================================================== */
/* SECTION 7: DRIVERS & HARDWARE CONTROL                                      */
/* ========================================================================== */

/**
 * @brief Initialize pins and SPI connection for FRAM (FM25CL65B).
 */
void initFRAM() {
  pinMode(FRAM_CS, OUTPUT);
  digitalWrite(FRAM_CS, HIGH);
  pinMode(FRAM_HOLD, OUTPUT);
  digitalWrite(FRAM_HOLD, HIGH);
  pinMode(FRAM_WP, OUTPUT);
  digitalWrite(FRAM_WP, HIGH);
  SPI.begin(FRAM_SCK, FRAM_MISO, FRAM_MOSI, FRAM_CS);
}

/**
 * @brief Sends write enable command to FRAM.
 */
void framWriteEnable() {
  SPI.beginTransaction(framSPI);
  digitalWrite(FRAM_CS, LOW);
  SPI.transfer(FR_CMD_WREN);
  digitalWrite(FRAM_CS, HIGH);
  SPI.endTransaction();
}

/**
 * @brief Writes an 8-bit byte to the specified address in FRAM.
 * @param addr Memory address to write to.
 * @param data 8-bit value to write.
 */
void framWrite8(uint16_t addr, uint8_t data) {
  framWriteEnable();
  SPI.beginTransaction(framSPI);
  digitalWrite(FRAM_CS, LOW);
  SPI.transfer(FR_CMD_WRITE);
  SPI.transfer(addr >> 8);
  SPI.transfer(addr & 0xFF);
  SPI.transfer(data);
  digitalWrite(FRAM_CS, HIGH);
  SPI.endTransaction();
}

/**
 * @brief Reads an 8-bit byte from the specified address in FRAM.
 * @param addr Memory address to read from.
 * @return The 8-bit value read from the memory address.
 */
uint8_t framRead8(uint16_t addr) {
  uint8_t data;
  SPI.beginTransaction(framSPI);
  digitalWrite(FRAM_CS, LOW);
  SPI.transfer(FR_CMD_READ);
  SPI.transfer(addr >> 8);
  SPI.transfer(addr & 0xFF);
  data = SPI.transfer(0x00);
  digitalWrite(FRAM_CS, HIGH);
  SPI.endTransaction();
  return data;
}

/**
 * @brief Writes an array of bytes starting at the specified address in FRAM.
 * @param addr Start memory address.
 * @param buf Pointer to the source buffer.
 * @param len Number of bytes to write.
 */
void framWriteArray(uint16_t addr, const uint8_t *buf, uint16_t len) {
  framWriteEnable();
  SPI.beginTransaction(framSPI);
  digitalWrite(FRAM_CS, LOW);
  SPI.transfer(FR_CMD_WRITE);
  SPI.transfer(addr >> 8);
  SPI.transfer(addr & 0xFF);
  for (uint16_t i = 0; i < len; i++) {
    SPI.transfer(buf[i]);
  }
  digitalWrite(FRAM_CS, HIGH);
  SPI.endTransaction();
}

/**
 * @brief Reads an array of bytes from the specified address in FRAM.
 * @param addr Start memory address.
 * @param buf Pointer to the destination buffer.
 * @param len Number of bytes to read.
 */
void framReadArray(uint16_t addr, uint8_t *buf, uint16_t len) {
  SPI.beginTransaction(framSPI);
  digitalWrite(FRAM_CS, LOW);
  SPI.transfer(FR_CMD_READ);
  SPI.transfer(addr >> 8);
  SPI.transfer(addr & 0xFF);
  for (uint16_t i = 0; i < len; i++) {
    buf[i] = SPI.transfer(0x00);
  }
  digitalWrite(FRAM_CS, HIGH);
  SPI.endTransaction();
}

/**
 * @brief Writes a String to FRAM starting with its length byte.
 * @param addr Memory address.
 * @param s String to write.
 */
void framWriteString(uint16_t addr, const String &s) {
  uint8_t len = s.length();
  framWrite8(addr, len);
  for (uint8_t i = 0; i < len; i++) {
    framWrite8(addr + 1 + i, s[i]);
  }
}

/**
 * @brief Reads a String from FRAM.
 * @param addr Memory address.
 * @return The String read from memory.
 */
String framReadString(uint16_t addr) {
  uint8_t len = framRead8(addr);
  if (len == 0 || len == 0xFF) {
    return "";
  }
  char buf[len + 1];
  for (uint8_t i = 0; i < len; i++) {
    buf[i] = (char)framRead8(addr + 1 + i);
  }
  buf[len] = '\0';
  return String(buf);
}

// --- Stub/Dummy implementations for status LEDs ---
void setColor(uint8_t r, uint8_t g, uint8_t b) {}
void red() {}
void red_blink() {}
void green() {}
void green_blink() {}
void blue() {}
void blue_blink() {}
void off_led() {}
void all_led() {}
void purple_led() {}


/* ========================================================================== */
/* SECTION 8: NETWORK & WEB SERVICES                                          */
/* ========================================================================== */

/**
 * @brief Establish initial Wi-Fi connection.
 */
/**
 * @brief Displays a message on the HMI Notification page (Page ID 9).
 * @param message The notification message to write.
 */
void showNotification(const String &message) {
  dwinSwitchPage(9);
  delay(150); 
  dwinWriteString(0x6070, message, 32);
}

/**
 * @brief Checks Wi-Fi connection state and triggers HMI notification pages on transition.
 */
void trackNetworkStatus() {
  wl_status_t current_status = WiFi.status();
  if (current_status != last_wifi_status) {
    if (current_status == WL_CONNECTED) {
      showNotification("Wi-Fi Connected");
      delay(2000);
      dwinSwitchPage(1); // Return to menu
    } else if (current_status == WL_CONNECT_FAILED || current_status == WL_CONNECTION_LOST || current_status == WL_DISCONNECTED) {
      if (last_wifi_status == WL_CONNECTED) {
        showNotification("No Internet Available\nReconnecting...");
      }
    }
    last_wifi_status = current_status;
  }
}

void wifi_connect() {
  Serial.println("Scanning networks...");
  showNotification("Scanning Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  
  int n = WiFi.scanNetworks();
  bool ssid_found = false;
  for (int i = 0; i < n; ++i) {
    if (WiFi.SSID(i) == ssid) {
      ssid_found = true;
      break;
    }
  }
  
  if (!ssid_found) {
    Serial.println("SSID not found. No WiFi signal at startup.");
    showNotification("No Wi-Fi Signal");
    delay(3000);
  }
  
  showNotification("Connecting to Internet");
  WiFi.begin(ssid, pass);
  Serial.print("connecting to wifi...");
  unsigned long startAttemptTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 10000) {
    delay(500);
    blue();
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nConnected!");
    showNotification("Wi-Fi Connected");
    delay(1000);
    Serial.println(WiFi.localIP());
    device_name.replace(' ', '_');
    if (MDNS.begin(device_name.c_str())) {
      Serial.println("Access via: http://" + device_name + ".local");
    }
  } else {
    Serial.println("\nFailed to connect to Wi-Fi.");
    showNotification("Connecting to Internet\nFailed!");
    delay(2000);
  }
}

/**
 * @brief Verification function called periodically to reconnect Wi-Fi if lost.
 */
void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  if (millis() - lastWiFiAttempt < WIFI_RETRY_INTERVAL) {
    return;
  }
  lastWiFiAttempt = millis();
  Serial.println("🔄 WiFi reconnecting...");
  showNotification("Connecting to Internet");
  WiFi.disconnect(true);
  WiFi.begin(ssid, pass);
}

/**
 * @brief Reconnects to MQTT broker and registers subscriptions.
 */
void ensureMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  if (mqtt.connected()) {
    return;
  }
  if (millis() - lastMQTTAttempt < MQTT_RETRY_INTERVAL) {
    return;
  }
  lastMQTTAttempt = millis();
  Serial.println("🔄 MQTT reconnecting...");
  if (mqtt.connect(client_name)) {
    Serial.println("✅ MQTT connected");
    mqtt.subscribe(topic_in);
  } else {
    Serial.print("❌ MQTT failed, rc=");
    Serial.println(mqtt.state());
  }
}

/**
 * @brief Attempt connection to MQTT broker.
 * @return True if connected, false otherwise.
 */
boolean mqttConnect() {
  boolean status = mqtt.connect(client_name);
  if (!status) {
    Serial.println("==== Mqtt not connected ====");
    return false;
  }
  Serial.println("==== Mqtt connected =====");
  return mqtt.connected();
}

/**
 * @brief Force blocking attempt to reconnect to MQTT.
 */
void mqtt_reconnect() {
  if (mqtt.connected()) {
    return;
  }
  Serial.println("=== MQTT not connected, attempting reconnect ===");
  uint32_t start = millis();
  while ((millis() - start) < 5000UL) {
    if (mqttConnect()) {
      Serial.println("MQTT reconnected and subscribed");
      return;
    }
    delay(200);
  }
  lastReconnectAttempt = millis();
}

void addCalculatedStationMetrics(JsonObject st, uint32_t target, uint32_t count, float station_work) {
  st["target"] = target;
  st["pending"] = target > count ? (target - count) : 0;
  
  float capped_mins = station_work > 480.0f ? 480.0f : (station_work > 1.0f ? station_work : 1.0f);
  float expected = (target / 480.0f) * capped_mins;
  st["efficiency"] = (expected > 0.1f) ? (uint8_t)fmin(100.0f, (count / expected) * 100.0f) : 0;
}

/**
 * @brief Serializes current machine state and statistics and sends over MQTT.
 */
void send_mqtt() {
  if (!mqtt.connected()) {
    return;
  }
  if ((millis() - values_update_millis) > values_update_interval) {
    StaticJsonDocument<1536> values_json;
    char send_json[1536];

    String id_cap = WiFi.macAddress(); id_cap.toUpperCase();
    String unit_cap = unit_name; unit_cap.toUpperCase();
    String dev_cap = device_name; dev_cap.toUpperCase();

    String shift_cap, part_cap, op_cap, state_cap;
    if (!is_shift_data_updated) {
      shift_cap = "---";
      part_cap = "(---)";
      op_cap = "(---)";
      state_cap = "WAIT";
    } else {
      shift_cap = shift; shift_cap.toUpperCase();
      part_cap = part_name; part_cap.toUpperCase();
      op_cap = operator_name; op_cap.toUpperCase();
      state_cap = machine_state; state_cap.toUpperCase();
    }

    values_json["FW_V"] = CURRENT_VERSION;
    values_json["c_date"] = current_date;
    values_json["time"] = Time;
    values_json["id"] = id_cap;
    values_json["Unit"] = unit_cap;
    values_json["shift"] = shift_cap;
    values_json["device_name"] = dev_cap;
    values_json["device_id"] = device_id;
    values_json["part_name"] = part_cap;
    values_json["order_no"] = order_no;
    values_json["supervisor"] = supervisor_name;
    values_json["m_state"] = state_cap;
    values_json["t_w_mins"] = ((int)(total_working_shift_mins * 100)) / 100.0;
    values_json["t_bd_mins"] = ((int)(total_bd_shift_mins * 100)) / 100.0;
    JsonArray stations = values_json.createNestedArray("stations");
#if defined(DEVICE_SLAVE1)
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-01";
      st["actual"] = station_shift_counts[0];
      st["t_count"] = station_shift_counts[0];
      float station_work = station_working_mins[0];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[0] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[0] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[0].length() > 0 ? station_operators[0] : op_cap;
      st["workingMins"] = station_working_mins[0];
      st["breakdownMins"] = station_breakdown_mins[0];
      st["breakdownReason"] = station_bd_reasons[0];
      addCalculatedStationMetrics(st, station_targets[0], station_shift_counts[0], station_work);
    }
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-02";
      st["actual"] = station_shift_counts[1];
      st["t_count"] = station_shift_counts[1];
      float station_work = station_working_mins[1];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[1] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[1] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[1].length() > 0 ? station_operators[1] : op_cap;
      st["workingMins"] = station_working_mins[1];
      st["breakdownMins"] = station_breakdown_mins[1];
      st["breakdownReason"] = station_bd_reasons[1];
      addCalculatedStationMetrics(st, station_targets[1], station_shift_counts[1], station_work);
    }
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-03";
      st["actual"] = station_shift_counts[2];
      st["t_count"] = station_shift_counts[2];
      float station_work = station_working_mins[2];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[2] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[2] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[2].length() > 0 ? station_operators[2] : op_cap;
      st["workingMins"] = station_working_mins[2];
      st["breakdownMins"] = station_breakdown_mins[2];
      st["breakdownReason"] = station_bd_reasons[2];
      addCalculatedStationMetrics(st, station_targets[2], station_shift_counts[2], station_work);
    }
#elif defined(DEVICE_SLAVE2)
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-04";
      st["actual"] = station_shift_counts[0];
      st["t_count"] = station_shift_counts[0];
      float station_work = station_working_mins[0];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[0] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[0] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[0].length() > 0 ? station_operators[0] : op_cap;
      st["workingMins"] = station_working_mins[0];
      st["breakdownMins"] = station_breakdown_mins[0];
      st["breakdownReason"] = station_bd_reasons[0];
      addCalculatedStationMetrics(st, station_targets[0], station_shift_counts[0], station_work);
    }
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-05";
      st["actual"] = station_shift_counts[1];
      st["t_count"] = station_shift_counts[1];
      float station_work = station_working_mins[1];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[1] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[1] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[1].length() > 0 ? station_operators[1] : op_cap;
      st["workingMins"] = station_working_mins[1];
      st["breakdownMins"] = station_breakdown_mins[1];
      st["breakdownReason"] = station_bd_reasons[1];
      addCalculatedStationMetrics(st, station_targets[1], station_shift_counts[1], station_work);
    }
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-06";
      st["actual"] = station_shift_counts[2];
      st["t_count"] = station_shift_counts[2];
      float station_work = station_working_mins[2];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[2] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[2] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[2].length() > 0 ? station_operators[2] : op_cap;
      st["workingMins"] = station_working_mins[2];
      st["breakdownMins"] = station_breakdown_mins[2];
      st["breakdownReason"] = station_bd_reasons[2];
      addCalculatedStationMetrics(st, station_targets[2], station_shift_counts[2], station_work);
    }
#elif defined(DEVICE_SLAVE3)
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-08";
      st["actual"] = station_shift_counts[0];
      st["t_count"] = station_shift_counts[0];
      float station_work = station_working_mins[0];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[0] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[0] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[0].length() > 0 ? station_operators[0] : op_cap;
      st["workingMins"] = station_working_mins[0];
      st["breakdownMins"] = station_breakdown_mins[0];
      st["breakdownReason"] = station_bd_reasons[0];
      addCalculatedStationMetrics(st, station_targets[0], station_shift_counts[0], station_work);
    }
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-11";
      st["actual"] = station_shift_counts[1];
      st["t_count"] = station_shift_counts[1];
      float station_work = station_working_mins[1];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[1] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[1] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[1].length() > 0 ? station_operators[1] : op_cap;
      st["workingMins"] = station_working_mins[1];
      st["breakdownMins"] = station_breakdown_mins[1];
      st["breakdownReason"] = station_bd_reasons[1];
      addCalculatedStationMetrics(st, station_targets[1], station_shift_counts[1], station_work);
    }
#elif defined(DEVICE_SLAVE4)
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-09";
      st["actual"] = station_shift_counts[0];
      st["t_count"] = station_shift_counts[0];
      float station_work = station_working_mins[0];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[0] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[0] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[0].length() > 0 ? station_operators[0] : op_cap;
      st["workingMins"] = station_working_mins[0];
      st["breakdownMins"] = station_breakdown_mins[0];
      st["breakdownReason"] = station_bd_reasons[0];
      addCalculatedStationMetrics(st, station_targets[0], station_shift_counts[0], station_work);
    }
    {
      JsonObject st = stations.createNestedObject();
      st["id"] = "st-10";
      st["actual"] = station_shift_counts[0];
      st["t_count"] = station_shift_counts[0];
      float station_work = station_working_mins[0];
      st["speed"] = station_work > 0.1 ? (uint16_t)(station_shift_counts[0] / station_work) : 0;
      st["status"] = (millis() - last_pulse_time_st[0] < STATION_INACTIVITY_LIMIT) ? "Running" : (is_major_bd ? "Major Breakdown" : "Idle");
      st["operator"] = station_operators[1].length() > 0 ? station_operators[1] : op_cap;
      st["workingMins"] = station_working_mins[0];
      st["breakdownMins"] = station_breakdown_mins[0];
      st["breakdownReason"] = station_bd_reasons[0];
      addCalculatedStationMetrics(st, station_targets[1], station_shift_counts[0], station_work);
    }
#endif

    serializeJson(values_json, send_json, sizeof(send_json));
    mqtt.publish(topic_out, send_json);
    Serial.println(send_json);

    eeprom_store();
    values_update_millis = millis();
  }
}

/**
 * @brief MQTT Subscription callback logic.
 */
void mqttCallback(char *topic, byte *payload, unsigned int len) {
  if (strcmp(topic, topic_in) != 0) {
    return;
  }
  
  // Deserialize payload
  unsigned int copyLen = len > 2047 ? 2047 : len;
  char buf[2048];
  memcpy(buf, payload, copyLen);
  buf[copyLen] = '\0';
  
  rcv_data.clear();
  deserializeJson(rcv_data, buf);

  if (!rcv_data.containsKey("id")) {
    return;
  }
  
  String incomingId = String((const char *)rcv_data["id"].as<const char *>());
  if (device_id != incomingId) {
    return;
  }

  if (rcv_data.containsKey("targets")) {
    JsonArray tgs = rcv_data["targets"].as<JsonArray>();
    for (int i = 0; i < tgs.size() && i < MAX_STATIONS; i++) {
      station_targets[i] = tgs[i].as<uint32_t>();
      Serial.printf("⚙ Saved station_targets[%d] via MQTT: %d\n", i, station_targets[i]);
    }
  }

  if (rcv_data.containsKey("order_no")) {
    order_no = rcv_data["order_no"].as<String>();
    Serial.println("⚙ Saved order_no via MQTT: " + order_no);
  }

  if (rcv_data.containsKey("supervisor")) {
    supervisor_name = rcv_data["supervisor"].as<String>();
    Serial.println("⚙ Saved supervisor via MQTT: " + supervisor_name);
  }

  if (rcv_data.containsKey("part_name")) {
    part_name = rcv_data["part_name"].as<String>();
    framWriteString(PART_NAME_ADD_ADDR, part_name);
    Serial.println("⚙ Saved part_name via MQTT: " + part_name);
  }

  if (rcv_data.containsKey("operators")) {
    JsonArray ops = rcv_data["operators"].as<JsonArray>();
    for (int i = 0; i < ops.size() && i < MAX_STATIONS; i++) {
      station_operators[i] = ops[i].as<String>();
      Serial.printf("⚙ Saved station_operators[%d] via MQTT: %s\n", i, station_operators[i].c_str());
    }
    if (ops.size() > 0) {
      operator_name = ops[0].as<String>();
      framWriteString(operator_name_add, operator_name);
    }
  } else if (rcv_data.containsKey("operator")) {
    operator_name = rcv_data["operator"].as<String>();
    framWriteString(operator_name_add, operator_name);
    Serial.println("⚙ Saved operator_name via MQTT: " + operator_name);
    
    int stationIdx = -1;
    if (rcv_data.containsKey("station_index")) {
      stationIdx = rcv_data["station_index"].as<int>();
    } else if (rcv_data.containsKey("station_id")) {
      String incomingStId = rcv_data["station_id"].as<String>();
      #if defined(DEVICE_SLAVE1)
        if (incomingStId == "st-01") stationIdx = 0;
        else if (incomingStId == "st-02") stationIdx = 1;
        else if (incomingStId == "st-03") stationIdx = 2;
      #elif defined(DEVICE_SLAVE2)
        if (incomingStId == "st-04") stationIdx = 0;
        else if (incomingStId == "st-05") stationIdx = 1;
        else if (incomingStId == "st-06") stationIdx = 2;
      #elif defined(DEVICE_SLAVE3)
        if (incomingStId == "st-08") stationIdx = 0;
        else if (incomingStId == "st-11") stationIdx = 1;
      #elif defined(DEVICE_SLAVE4)
        if (incomingStId == "st-09") stationIdx = 0;
        else if (incomingStId == "st-10") stationIdx = 1;
      #endif
    }
    if (stationIdx >= 0 && stationIdx < MAX_STATIONS) {
      station_operators[stationIdx] = operator_name;
    } else {
      for (int i = 0; i < MAX_STATIONS; i++) {
        station_operators[i] = operator_name;
      }
    }
  }

  if (rcv_data.containsKey("pouch_qty")) {
    qty_per_pouch = rcv_data["pouch_qty"].as<uint16_t>();
    framWrite8(POUCH_QTY_ADDR, (uint8_t)qty_per_pouch);
    Serial.printf("⚙ Saved qty_per_pouch via MQTT: %d\n", qty_per_pouch);
  }

  if (rcv_data.containsKey("outer_box")) {
    String outerBoxStr = rcv_data["outer_box"].as<String>();
    int firstUnderscore = outerBoxStr.indexOf('_');
    int secondUnderscore = outerBoxStr.indexOf('_', firstUnderscore + 1);
    if (firstUnderscore > 0 && secondUnderscore > 0) {
      String pStr = outerBoxStr.substring(0, firstUnderscore);
      String iStr = outerBoxStr.substring(firstUnderscore + 1, secondUnderscore);
      String oStr = outerBoxStr.substring(secondUnderscore + 1);
      
      box_pouch_qty = pStr.toInt();
      box_inner_qty = (iStr == "Nill" || iStr == "NILL" || iStr == "nill") ? 1 : iStr.toInt();
      box_outer_qty = oStr.toInt();
      
      framWrite8(POUCH_QTY_ADDR, (uint8_t)box_pouch_qty);
      framWrite8(INNER_QTY_ADDR, (uint8_t)box_inner_qty);
      framWrite8(OUTER_QTY_ADDR, (uint8_t)box_outer_qty);
      Serial.printf("⚙ Saved outer box config via MQTT: pouch=%d, inner=%d, outer=%d\n", box_pouch_qty, box_inner_qty, box_outer_qty);
    }
  }

  if (rcv_data.containsKey("shift")) {
    shift = rcv_data["shift"].as<String>();
    framWriteString(shift_add, shift);
    Serial.println("⚙ Saved shift via MQTT: " + shift);
  }

  if (rcv_data.containsKey("maintenance")) {
    maintenance_name = rcv_data["maintenance"].as<String>();
    framWriteString(maintenance_name_add, maintenance_name);
    Serial.println("⚙ Saved maintenance_name via MQTT: " + maintenance_name);
  }

  if (rcv_data.containsKey("shift_start")) {
    is_shift_data_updated = true;
    is_shift_completed = false;
    shift_update_received = 1;
    shift_data_requested_activated_flag = 1;
    shift_reset();
    eeprom_store();
    Serial.println("⚙ Shift Start triggered via MQTT");
  }

  if (rcv_data.containsKey("shift_end")) {
    is_shift_completed = false;
    is_shift_data_updated = false;
    shift_update_received = 1;
    for (int i = 0; i < MAX_STATIONS; i++) {
      last_pulse_time_st[i] = millis() - (STATION_INACTIVITY_LIMIT + 10000);
    }
    shift_reset();
    eeprom_store();
    Serial.println("⚙ Shift End and reset triggered via MQTT");
  }

  if ((rcv_data.containsKey("unit_name")) && (is_shift_data_updated == false)) {
    shift_data_requested_activated_flag = 1;
  }

  if (rcv_data.containsKey("bd_bypass")) {
    bypass_signal_flag = 1;
    bypass_signal = rcv_data["bd_bypass"];
  }

  if (rcv_data.containsKey("bd_reason")) {
    String incomingReason = rcv_data["bd_reason"].as<String>();
    int stationIdx = -1;
    if (rcv_data.containsKey("station_id")) {
      String incomingStId = rcv_data["station_id"].as<String>();
      #if defined(DEVICE_SLAVE1)
        if (incomingStId == "st-01") stationIdx = 0;
        else if (incomingStId == "st-02") stationIdx = 1;
        else if (incomingStId == "st-03") stationIdx = 2;
      #elif defined(DEVICE_SLAVE2)
        if (incomingStId == "st-04") stationIdx = 0;
        else if (incomingStId == "st-05") stationIdx = 1;
        else if (incomingStId == "st-06") stationIdx = 2;
      #elif defined(DEVICE_SLAVE3)
        if (incomingStId == "st-08") stationIdx = 0;
        else if (incomingStId == "st-11") stationIdx = 1;
      #elif defined(DEVICE_SLAVE4)
        if (incomingStId == "st-09") stationIdx = 0;
        else if (incomingStId == "st-10") stationIdx = 1;
      #endif
    } else {
      stationIdx = dwin_active_bd_station_idx;
    }

    if (stationIdx >= 0 && stationIdx < MAX_STATIONS) {
      station_bd_reasons[stationIdx] = incomingReason;
      bd_reason2 = incomingReason;
      bd_millis = millis();
      bd_time = 0;
      is_bd_reason_updated = true;
      bd_reason_data_requested_activated_flag = 1;
      Serial.printf("⚙ Saved breakdown reason via MQTT for station idx %d: %s\n", stationIdx, incomingReason.c_str());
    }
  }
  if (rcv_data.containsKey("reset")) {
    reset_flag = 1;
  }

  if (rcv_data.containsKey("trigger_ota")) {
    if (rcv_data["trigger_ota"].as<bool>()) {
      Serial.println("⚙ Remote OTA trigger received via MQTT!");
      checkForUpdate();
    }
  }
}

// --- DWIN Display Driver Implementation ---

/**
 * @brief Write integer values back to the DWIN display over serial.
 * @param vpAddr Destination VP (Variable Pointer) address.
 * @param value Integer value to send.
 */
void dwinWriteInt(uint16_t vpAddr, uint16_t value) {
  uint8_t frame[] = {
    0x5A, 0xA5,
    0x05,
    0x82,
    (uint8_t)(vpAddr >> 8), (uint8_t)(vpAddr & 0xFF),
    (uint8_t)(value >> 8), (uint8_t)(value & 0xFF)
  };
  Serial1.write(frame, sizeof(frame));
}

/**
 * @brief Write 32-bit (double word) integer values back to the DWIN display over serial.
 * @param vpAddr Variable Pointer address.
 * @param value 32-bit integer value.
 */
void dwinWriteLong(uint16_t vpAddr, uint32_t value) {
  uint8_t frame[] = {
    0x5A, 0xA5,
    0x07, // 7 bytes to follow
    0x82,
    (uint8_t)(vpAddr >> 8), (uint8_t)(vpAddr & 0xFF),
    (uint8_t)(value >> 24), (uint8_t)((value >> 16) & 0xFF),
    (uint8_t)((value >> 8) & 0xFF), (uint8_t)(value & 0xFF)
  };
  Serial1.write(frame, sizeof(frame));
}

/**
 * @brief Sends page switch command to DWIN display.
 * @param pageId Destination Page ID on display.
 */
void dwinSwitchPage(uint16_t pageId) {
  uint8_t frame[] = {
    0x5A, 0xA5,
    0x07,
    0x82,
    0x00, 0x84,
    0x5A, 0x01,
    (uint8_t)(pageId >> 8), (uint8_t)(pageId & 0xFF)
  };
  Serial1.write(frame, sizeof(frame));
  Serial.printf("dwinSwitchPage: switched to Page ID %d\n", pageId);
}

/**
 * @brief Writes String text onto DWIN display.
 * @param vpAddr Destination VP address.
 * @param str Message text string.
 */
void dwinWriteString(uint16_t vpAddr, const String &str, int padLen) {
  String upperStr = str;
  upperStr.toUpperCase();
  
  int strLen = upperStr.length();
  
  if (padLen > 0) {
    int maxChars = padLen - 2;
    if (maxChars < 0) maxChars = 0;
    if (strLen > maxChars) {
      upperStr = upperStr.substring(0, maxChars);
      strLen = upperStr.length();
    }
  }
  Serial.printf("dwinWriteString: VP=0x%04X, padLen=%d, strLen=%d, val='%s'\n", vpAddr, padLen, strLen, upperStr.c_str());
  
  // We need at least 1 null terminator, and the total data bytes must be even (word-aligned)
  int dataLen = (padLen > strLen + 1) ? padLen : (strLen + 1);
  if (dataLen % 2 != 0) {
    dataLen++;
  }
  
  uint8_t packet[6 + dataLen];
  packet[0] = 0x5A;
  packet[1] = 0xA5;
  packet[2] = 3 + dataLen; // Length of packet after this byte
  packet[3] = 0x82;        // Write command
  packet[4] = (uint8_t)(vpAddr >> 8);
  packet[5] = (uint8_t)(vpAddr & 0xFF);
  
  for (int i = 0; i < dataLen; i++) {
    if (i < strLen) {
      packet[6 + i] = (uint8_t)upperStr[i];
    } else {
      packet[6 + i] = 0x00;
    }
  }
  
  Serial1.write(packet, 6 + dataLen);
}

/**
 * @brief Periodically refresh data shown on the DWIN HMI display.
 */
void updateDWINDisplay() {
  if (millis() - last_dwin_update > DWIN_UPDATE_INTERVAL) {
    last_dwin_update = millis();
    
    dwinWriteString(0x2000, current_date, 32);
    dwinWriteString(0x2010, Time, 32);
    dwinWriteString(0x2020, unit_name, 32);
    dwinWriteString(0x2030, String(dwin_station_names[dwin_active_station_idx]), 32);
    dwinWriteString(0x2090, String(dwin_station_names[dwin_active_station_idx]), 32);
    dwinWriteString(0x6300, String(dwin_station_names[dwin_active_bd_station_idx]), 32);
    dwinWriteString(0x2040, CURRENT_VERSION, 32);
    
    String dwin_machine_state;
    if (!is_shift_data_updated) {
      dwin_machine_state = "WAIT";
    } else {
      bool is_st_running = (millis() - last_pulse_time_st[dwin_active_station_idx] < STATION_INACTIVITY_LIMIT);
      if (is_st_running) {
        dwin_machine_state = "On";
      } else if (is_major_bd) {
        dwin_machine_state = "major_BD";
      } else if (is_min_bd) {
        dwin_machine_state = "minor_bd";
      } else {
        dwin_machine_state = "Off";
      }
    }
    
    if (!is_shift_data_updated) {
      dwinWriteString(0x2050, "---", 32);     // Shift
      dwinWriteString(0x2060, "(---)", 32);   // Operator name
      dwinWriteString(0x2070, "WAIT", 32);    // Machine state
      dwinWriteString(0x2080, "(---)", 64);   // Item name
    } else {
      dwinWriteString(0x2050, shift, 32);
      String active_operator = (dwin_active_station_idx < MAX_STATIONS && station_operators[dwin_active_station_idx].length() > 0) 
                                ? station_operators[dwin_active_station_idx] 
                                : operator_name;
      dwinWriteString(0x2060, active_operator, 32);
      dwinWriteString(0x2070, dwin_machine_state, 32);
      dwinWriteString(0x2080, part_name, 64);
    }
 
    if (dwin_is_operator_screen) {
      dwinWriteString(0x4090, "Cancel", 32);
      dwinWriteString(0x5000, "Next", 32);
    } else {
      dwinWriteString(0x4090, "Back", 32);
      dwinWriteString(0x5000, "Done", 32);
    }
    
#if defined(DEVICE_SLAVE3)
    uint16_t multiplier = qty_per_pouch;
    uint32_t divisor = 1;
#elif defined(DEVICE_SLAVE4)
    uint16_t multiplier = 1;
    uint32_t divisor = 1;
#else
    uint16_t multiplier = 1;
    uint32_t divisor = 1;
#endif

    float cur_speed = 0.0f;
    if (is_shift_data_updated) {
#if defined(DEVICE_SLAVE4)
      float station_work = station_working_mins[0];
      if (station_work > 0.1f) {
        if (dwin_active_station_idx == 0) {
          cur_speed = ((float)station_shift_counts[0] * box_pouch_qty) / station_work;
        } else {
          uint32_t inner_outer = (uint32_t)box_inner_qty * box_outer_qty;
          if (inner_outer == 0) inner_outer = 1;
          uint32_t case_qty = (uint32_t)box_pouch_qty * inner_outer;
          uint32_t completed_boxes = station_shift_counts[0] / inner_outer;
          cur_speed = ((float)completed_boxes * case_qty) / station_work;
        }
      }
#else
      float station_work = (dwin_active_station_idx < MAX_STATIONS) ? station_working_mins[dwin_active_station_idx] : total_working_shift_mins;
      if (station_work > 0.1f) {
        cur_speed = (((float)station_shift_counts[dwin_active_station_idx] * multiplier) / divisor) / station_work;
      }
#endif
    }
    String speedStr = String(cur_speed, 2);
    dwinWriteString(0x3000, speedStr, 16);

    uint16_t active_work_mins = 0;
    uint16_t active_bd_mins = 0;
    if (is_shift_data_updated) {
#if defined(DEVICE_SLAVE4)
      active_work_mins = (uint16_t)(station_working_mins[0]);
      active_bd_mins = (uint16_t)(station_breakdown_mins[0]);
#else
      if (dwin_active_station_idx < MAX_STATIONS) {
        active_work_mins = (uint16_t)(station_working_mins[dwin_active_station_idx]);
        active_bd_mins = (uint16_t)(station_breakdown_mins[dwin_active_station_idx]);
      } else {
        active_work_mins = (uint16_t)(total_working_shift_mins);
        active_bd_mins = (uint16_t)(total_bd_shift_hrs);
      }
#endif
    }

    dwinWriteInt(0x3010, active_work_mins);
    dwinWriteInt(0x3020, active_bd_mins);
#if defined(DEVICE_SLAVE4)
    uint32_t inner_outer = (uint32_t)box_inner_qty * box_outer_qty;
    if (inner_outer == 0) inner_outer = 1;
    uint32_t case_qty = (uint32_t)box_pouch_qty * inner_outer;
    
    uint32_t act_count = 0;
    uint32_t sh_count = 0;
    if (dwin_active_station_idx == 0) {
      act_count = (uint32_t)station_counts[0] * box_pouch_qty;
      sh_count = (uint32_t)station_shift_counts[0] * box_pouch_qty;
    } else {
      act_count = (uint32_t)(station_counts[0] / inner_outer) * case_qty;
      sh_count = (uint32_t)(station_shift_counts[0] / inner_outer) * case_qty;
    }
    dwinWriteString(0x3030, is_shift_data_updated ? String(act_count) : "0", 16);
    dwinWriteInt(0x3040, is_shift_data_updated ? (uint16_t)(bd_time) : 0);
    dwinWriteString(0x3050, is_shift_data_updated ? String(sh_count) : "0", 16);
#else
    dwinWriteString(0x3030, is_shift_data_updated ? String((uint32_t)((station_counts[dwin_active_station_idx] * multiplier) / divisor)) : "0", 16);
    dwinWriteInt(0x3040, is_shift_data_updated ? (uint16_t)(bd_time) : 0);
    dwinWriteString(0x3050, is_shift_data_updated ? String((uint32_t)((station_shift_counts[dwin_active_station_idx] * multiplier) / divisor)) : "0", 16);
#endif
  }
}

/**
 * @brief Redraw reasons pages on DWIN breakdown screen.
 * @param pageNum Page number.
 */
void updateBreakdownPage(uint16_t pageNum) {
  const int totalReasons = sizeof(breakdownReasons) / sizeof(breakdownReasons[0]);
  int totalPages = (totalReasons + 2) / 3;
  
  if (pageNum < 1) pageNum = 1;
  if (pageNum > totalPages) pageNum = totalPages;
  
  dwin_reason_page = pageNum;
  dwinWriteInt(0x3060, pageNum);
  
  int idx1 = (pageNum - 1) * 3;
  int idx2 = idx1 + 1;
  int idx3 = idx1 + 2;
  
  String r1 = (idx1 < totalReasons) ? String(breakdownReasons[idx1]) : "";
  String r2 = (idx2 < totalReasons) ? String(breakdownReasons[idx2]) : "";
  String r3 = (idx3 < totalReasons) ? String(breakdownReasons[idx3]) : "";
  
  dwinWriteString(0x3070, r1, 32);
  dwinWriteString(0x3080, r2, 32);
  dwinWriteString(0x3090, r3, 32);
}

/**
 * @brief Submits a breakdown selection received from DWIN.
 * @param choice Breakdown choice item index.
 */
void submitBreakdownDWIN(uint16_t choice) {
  const int totalReasons = sizeof(breakdownReasons) / sizeof(breakdownReasons[0]);
  int idx = (dwin_reason_page - 1) * 3 + (choice - 1);
  if (idx >= 0 && idx < totalReasons) {
    String selectedReason = String(breakdownReasons[idx]);
    if (dwin_active_bd_station_idx < MAX_STATIONS) {
      station_bd_reasons[dwin_active_bd_station_idx] = selectedReason;
    }
    bd_reason2 = selectedReason;
    is_bd_reason_updated = true;
    Serial.printf("📉 Breakdown selected via DWIN: %s for station: %s\n", selectedReason.c_str(), dwin_station_names[dwin_active_bd_station_idx]);
    send_mqtt(); // Publish immediately to master
  }
}

/**
 * @brief Redraw operator or parts start list on DWIN.
 * @param pageNum Page index.
 */
void updateShiftStartPage(uint16_t pageNum) {
  Serial.printf("DEBUG: updateShiftStartPage called with pageNum = %d, dwin_is_operator_screen = %d\n", pageNum, dwin_is_operator_screen);
  int totalItems = 0;
  if (dwin_is_operator_screen) {
    totalItems = sizeof(operators) / sizeof(operators[0]);
  } else {
    totalItems = sizeof(partNames) / sizeof(partNames[0]);
  }
  int totalPages = (totalItems + 2) / 3;
  
  if (pageNum < 1) pageNum = 1;
  if (pageNum > totalPages) pageNum = totalPages;
  
  dwin_shift_page = pageNum;
  dwinWriteInt(0x4040, pageNum);
  
  if (dwin_is_operator_screen) {
    dwinWriteString(0x4030, "Select Operator Name", 32);
    
    int idx1 = (pageNum - 1) * 3;
    int idx2 = idx1 + 1;
    int idx3 = idx1 + 2;
    
    String o1 = (idx1 < totalItems) ? String(operators[idx1]) : "";
    String o2 = (idx2 < totalItems) ? String(operators[idx2]) : "";
    String o3 = (idx3 < totalItems) ? String(operators[idx3]) : "";
    
    dwinWriteString(0x6100, o1, 96);
    dwinWriteString(0x6150, o2, 96);
    dwinWriteString(0x6200, o3, 96);
    
    dwinWriteString(0x4090, "Cancel", 32);
    dwinWriteString(0x5000, "Next", 32);
  } else {
    dwinWriteString(0x4030, "Select Item Name", 32);
    
    int idx1 = (pageNum - 1) * 3;
    int idx2 = idx1 + 1;
    int idx3 = idx1 + 2;
    
    String p1 = (idx1 < totalItems) ? String(partNames[idx1]) : "";
    String p2 = (idx2 < totalItems) ? String(partNames[idx2]) : "";
    String p3 = (idx3 < totalItems) ? String(partNames[idx3]) : "";
    
    dwinWriteString(0x6100, p1, 96);
    dwinWriteString(0x6150, p2, 96);
    dwinWriteString(0x6200, p3, 96);
    
    dwinWriteString(0x4090, "Back", 32);
    dwinWriteString(0x5000, "Done", 32);
  }
}

/**
 * @brief Registers and starts shift via DWIN.
 */
void dwinStartShift(const String &selected_part, const String &selected_operator) {
  if ((is_shift_data_updated == false) && (is_wastage_updated == false)) {
    start_time_fetch_flag = 1;
    
    operator_name = selected_operator;
    part_name = selected_part;
    part_name.replace(" ", "_");
    part_speed = getPartSpeed(part_name);
    
    framWriteString(unit_name_add, unit_name);
    framWriteString(operator_name_add, operator_name);
    framWrite8(IS_GENERAL_SHIFT_ADDR, (uint8_t)is_general_shift);

    for (int i = 0; i < MAX_STATIONS; i++) {
      station_operators[i] = operator_name;
    }

    struct tm nowTime;
    time_t now_t = time(nullptr);
    localtime_r(&now_t, &nowTime);
    bool ok = (nowTime.tm_year > 70);

    if (ok) {
      char buf[9];
      snprintf(buf, sizeof(buf), "%02d:%02d:%02d", nowTime.tm_hour, nowTime.tm_min, nowTime.tm_sec);
      shift_start_time = String(buf);
      framWriteString(SHIFT_START_TIME_ADDR, shift_start_time);
      Serial.println("🕒 DWIN Shift start time captured: " + shift_start_time);
    } else {
      Serial.println("⚠️ DWIN Failed to read time for shift start");
    }

    is_major_bd = false;
    is_min_bd = false;
    is_bd_reason_updated = false;
    bd_millis = millis();      
    bd_shift_millis = millis(); 

    framWriteString(PART_NAME_ADD_ADDR, part_name);

    if (item_change_active && part_run_count >= 1 && item_change_start_time > 0) {
      time_t now_ts = time(NULL);
      float delta = difftime(now_ts, item_change_start_time) / 60.0f;
      if (delta > 0 && delta < 1440.0f) {
        item_changeover_mins = delta;
      } else {
        item_changeover_mins = 0.0f;
      }
    } else {
      item_changeover_mins = 0.0f;
    }

    part_run_count++;
    item_change_active = false;
    item_change_start_time = 0;

    framWrite8(ITEM_CHANGE_ACTIVE_ADDR, 0);
    framWriteArray(ITEM_CHANGE_START_ADDR, (uint8_t *)&item_change_start_time, sizeof(item_change_start_time));
    framWrite8(PART_RUN_CNT_ADDR, part_run_count);
    framWrite8(PART_SPEED_L_ADDR, part_speed & 0xFF);
    framWrite8(PART_SPEED_H_ADDR, part_speed >> 8);

    uint16_t item_store = (uint16_t)(item_changeover_mins * 10.0f + 0.5f);
    framWrite8(ITEM_CO_L_ADDR, item_store & 0xFF);
    framWrite8(ITEM_CO_H_ADDR, item_store >> 8);

    is_shift_data_updated = true;
    shift_data_requested_activated_flag = 1;
    shift_update_received = 1;
    framWrite8(shift_data_update, 1);
    
    Serial.println("   ➤ Operator: " + operator_name);
    Serial.println("   ➤ Part: " + part_name);
  }
}

/**
 * @brief Parser reading serial packet stream from DWIN display.
 */
void parseDWIN() {
  while (Serial1.available() > 0) {
    static uint8_t state = 0;
    static uint8_t len = 0;
    static uint8_t cmd = 0;
    static uint16_t vp = 0;
    static uint8_t buffer[64];
    static uint8_t bufIdx = 0;
    
    uint8_t b = Serial1.read();
    
    switch (state) {
      case 0:
        if (b == 0x5A) state = 1;
        break;
      case 1:
        if (b == 0xA5) {
          state = 2;
        } else {
          state = 0;
        }
        break;
      case 2:
        len = b;
        bufIdx = 0;
        state = 3;
        break;
      case 3:
        buffer[bufIdx++] = b;
        if (bufIdx >= len) {
          if (len >= 4) {
            cmd = buffer[0];
            vp = (buffer[1] << 8) | buffer[2];
            
            if (cmd == 0x82 || cmd == 0x83) {
              uint16_t rawVal = 0;
              if (cmd == 0x83 && len >= 6) {
                rawVal = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                rawVal = (buffer[3] << 8) | buffer[4];
              }
              Serial.printf("👉 [DWIN Press/Input] VP: 0x%04X, Value: %d (0x%04X)\n", vp, rawVal, rawVal);
            }
            
            if (vp == 0x3060) {
              uint16_t pageNum = 0;
              if (cmd == 0x83 && len >= 6) {
                pageNum = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                pageNum = (buffer[3] << 8) | buffer[4];
              }
              if (pageNum > 0 && pageNum != dwin_reason_page) {
                updateBreakdownPage(pageNum);
              }
            } else if (vp == 0x4010) {
              uint16_t selection = 0;
              if (cmd == 0x83 && len >= 6) {
                selection = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                selection = (buffer[3] << 8) | buffer[4];
              }
              if (selection <= 2) {
                dwin_selection = selection + 1;
              }
            } else if (vp == 0x4020) {
              if (cmd == 0x82 || cmd == 0x83) {
                submitBreakdownDWIN(dwin_selection);
                dwinWriteInt(0x4020, 0);
              }
            } else if (vp == 0x4040) {
              uint16_t pageNum = 0;
              if (cmd == 0x83 && len >= 6) {
                pageNum = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                pageNum = (buffer[3] << 8) | buffer[4];
              }
              if (pageNum > 0 && pageNum != dwin_shift_page) {
                updateShiftStartPage(pageNum);
              }
            } else if (vp == 0x4080) {
              uint16_t selection = 0;
              if (cmd == 0x83 && len >= 6) {
                selection = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                selection = (buffer[3] << 8) | buffer[4];
              }
              if (selection <= 2) {
                dwin_shift_selection = selection + 1;
              }
            } else if (vp == 0x5010) {
              if (cmd == 0x82 || cmd == 0x83) {
                showNotification("Start shift from\nMaster Dashboard");
                delay(3000);
                dwinSwitchPage(1);
                dwin_is_operator_screen = true;
                updateShiftStartPage(1);
                dwinWriteInt(0x4080, 1);
                dwin_shift_selection = 1;
                dwinWriteInt(0x5010, 0);
              }
            } else if (vp == 0x6060) {
              if (cmd == 0x82 || cmd == 0x83) {
                if (dwin_is_operator_screen) {
                  dwinSwitchPage(1);
                  dwin_is_operator_screen = true;
                  updateShiftStartPage(1);
                } else {
                  dwin_is_operator_screen = true;
                  updateShiftStartPage(1);
                }
                dwinWriteInt(0x6060, 0);
              }
            } else if (vp == 0x5020) {
              uint16_t btnVal = 0;
              if (cmd == 0x83 && len >= 6) {
                btnVal = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                btnVal = (buffer[3] << 8) | buffer[4];
              }
              dwin_wastage = btnVal;
            } else if (vp == 0x5030) {
              uint16_t val = 0;
              if (cmd == 0x83 && len >= 6) {
                val = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                val = (buffer[3] << 8) | buffer[4];
              }
              dwin_rejection_qty = val;
            } else if (vp == 0x5040) {
              uint16_t val = 0;
              if (cmd == 0x83 && len >= 6) {
                val = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                val = (buffer[3] << 8) | buffer[4];
              }
              dwin_manpower = val;
            } else if (vp == 0x5050) {
              if (cmd == 0x82 || cmd == 0x83) {
                showNotification("End shift from\nMaster Dashboard");
                delay(3000);
                dwinSwitchPage(1);
                dwinWriteInt(0x5020, 0);
                dwinWriteInt(0x5030, 0);
                dwinWriteInt(0x5040, 0);
                dwinWriteInt(0x5050, 0);
                
                dwin_wastage = 0;
                dwin_rejection_qty = 0;
                dwin_manpower = 0;
              }
            } else if (vp == 0x6000) {
              uint16_t pageNum = 0;
              if (cmd == 0x83 && len >= 6) {
                pageNum = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                pageNum = (buffer[3] << 8) | buffer[4];
              }
              if (pageNum > 0 && pageNum != dwin_unit_page) {
                updateUnitSettingPage(pageNum);
              }
            } else if (vp == 0x6040) {
              uint16_t selection = 0;
              if (cmd == 0x83 && len >= 6) {
                selection = (buffer[4] << 8) | buffer[5];
              } else if (cmd == 0x82 && len >= 5) {
                selection = (buffer[3] << 8) | buffer[4];
              }
              if (selection <= 2) {
                dwin_unit_selection = selection + 1;
              }
            } else if (vp == 0x6050) {
              if (cmd == 0x82 || cmd == 0x83) {
                submitUnitSettingDWIN(dwin_unit_selection);
                dwinWriteInt(0x6040, 0);
                dwinWriteInt(0x6050, 0);
                dwin_unit_selection = 1;
              }
            } else if (vp == 0x6250) {
              if (cmd == 0x82 || cmd == 0x83) {
                dwin_active_station_idx = (dwin_active_station_idx + 1) % NUM_ACTUAL_STATIONS;
                Serial.printf("🔄 DWIN Station switch clicked: New active station index = %d\n", dwin_active_station_idx);
                dwinWriteInt(0x6250, 0);
                last_dwin_update = 0; // Force immediate screen refresh
              }
            } else if (vp == 0x6270) {
              if (cmd == 0x82 || cmd == 0x83) {
                dwin_active_bd_station_idx = (dwin_active_bd_station_idx + 1) % NUM_ACTUAL_STATIONS;
                Serial.printf("🔄 DWIN BD Station switch clicked: New active station index = %d\n", dwin_active_bd_station_idx);
                dwinWriteInt(0x6270, 0);
                last_dwin_update = 0; // Force immediate screen refresh
              }
            }
          }
          state = 0;
        }
        break;
      default:
        state = 0;
        break;
    }
  }
}

/**
 * @brief Redraw units setting selection screen on DWIN.
 */
void updateUnitSettingPage(uint16_t pageNum) {
  const int totalUnits = sizeof(units) / sizeof(units[0]);
  int totalPages = (totalUnits + 2) / 3;
  
  if (pageNum < 1) pageNum = 1;
  if (pageNum > totalPages) pageNum = totalPages;
  
  dwin_unit_page = pageNum;
  dwinWriteInt(0x6000, pageNum);
  
  int idx1 = (pageNum - 1) * 3;
  int idx2 = idx1 + 1;
  int idx3 = idx1 + 2;
  
  String u1 = (idx1 < totalUnits) ? String(units[idx1]) : "";
  String u2 = (idx2 < totalUnits) ? String(units[idx2]) : "";
  String u3 = (idx3 < totalUnits) ? String(units[idx3]) : "";
  
  dwinWriteString(0x6010, u1, 32);
  dwinWriteString(0x6020, u2, 32);
  dwinWriteString(0x6030, u3, 32);
}

/**
 * @brief Submits unit selection from DWIN.
 */
void submitUnitSettingDWIN(uint16_t choice) {
  const int totalUnits = sizeof(units) / sizeof(units[0]);
  int idx = (dwin_unit_page - 1) * 3 + (choice - 1);
  if (idx >= 0 && idx < totalUnits) {
    unit_name = String(units[idx]);
    unit_name.replace(" ", "_");
    framWriteString(unit_name_add, unit_name);
    Serial.println("⚙ Saved unit_name via DWIN Settings: " + unit_name);
  }
}


/* ========================================================================== */
/* SECTION 9: CORE APPLICATION LOGIC & NOTIFICATION SERVICES                  */
/* ========================================================================== */

/**
 * @brief Sensor pulse interrupt handler. Triggered on sensor signal change.
 */
void IRAM_ATTR sensor_count() {
  bool sensorVal = digitalRead(SENSOR);
  if (!sensorVal && sense_flag) {
    sense_flag = 0;
    sense++;
    shift_count++;
    last_pulse_time_st[0] = millis();
  } else if (sensorVal && !sense_flag) {
    sense_flag = 1;
  }
}

void IRAM_ATTR sensor_count_2() {
#if NUM_INPUTS >= 2
  bool sensorVal = digitalRead(IN2_PIN);
  if (!sensorVal && sensor_flags[1]) {
    sensor_flags[1] = 0;
    station_counts[1]++;
    station_shift_counts[1]++;
    last_pulse_time_st[1] = millis();
  } else if (sensorVal && !sensor_flags[1]) {
    sensor_flags[1] = 1;
  }
#endif
}

void IRAM_ATTR sensor_count_3() {
#if NUM_INPUTS >= 3
  bool sensorVal = digitalRead(IN3_PIN);
  if (!sensorVal && sensor_flags[2]) {
    sensor_flags[2] = 0;
    station_counts[2]++;
    station_shift_counts[2]++;
    last_pulse_time_st[2] = millis();
  } else if (sensorVal && !sensor_flags[2]) {
    sensor_flags[2] = 1;
  }
#endif
}

/**
 * @brief Freeze shift metrics into the shiftSummary structure.
 */
void fetchShiftSummary() {
  shiftSummary.device_id = device_id;
  shiftSummary.device_name = device_name;
  shiftSummary.unit_name = unit_name;
  shiftSummary.part_name = part_name;
  shiftSummary.operator_name = operator_name;
  shiftSummary.shift = shift;
  shiftSummary.date = dateStr;
  shiftSummary.shift_end_time = Time;

  shiftSummary.shift_count = shift_count;
  shiftSummary.working_mins = total_working_shift_mins;
  shiftSummary.bd_mins = total_bd_shift_mins;
  shiftSummary.change_over_loss_mins = item_changeover_mins;

  float total_shift_time_mins = shiftSummary.working_mins + shiftSummary.bd_mins;
  if (total_shift_time_mins > 0) {
    shiftSummary.efficiency = (shiftSummary.working_mins * 100.0) / total_shift_time_mins;
  } else {
    shiftSummary.efficiency = 0.0f;
  }
  
  float shift_duration_mins = total_shift_time_mins;
  shiftSummary.target_count = 50000;
  shiftSummary.machine_speed = (uint16_t)part_speed;

  shiftSummary.production_efficiency = (shiftSummary.shift_count * 100.0) / shiftSummary.target_count;

  if (shiftSummary.working_mins > 0.1f) {
    shiftSummary.current_machine_speed = shiftSummary.shift_count / shiftSummary.working_mins;
  } else {
    shiftSummary.current_machine_speed = 0.0f;
  }

  String start_time_fram = framReadString(SHIFT_START_TIME_ADDR);
  shiftSummary.shift_start_time = start_time_fram;

  shiftSummary.wastage = wastage;
  shiftSummary.bd_reason = bd_reason2;
  shiftSummary.S_remarks = remarks;

  shiftSummary.S_good_qty = (shiftSummary.shift_count >= good_qty) ? good_qty : 0;
  shiftSummary.S_manpower_count = manpower_count;
  shiftSummary.rejection_qty = (shiftSummary.shift_count > shiftSummary.S_good_qty)
                               ? (shiftSummary.shift_count - shiftSummary.S_good_qty)
                               : 0;

  if (shiftSummary.shift_count > 0) {
    shiftSummary.rejection_percentage = (shiftSummary.rejection_qty * 100.0) / shiftSummary.shift_count;
  } else {
    shiftSummary.rejection_percentage = 0.0;
  }

  shiftSummary.valid = true;
  Serial.println("✅ Shift summary frozen");
}

/**
 * @brief Determines the shift name (Shift_A, Shift_B, Shift_C, or General_Shift) based on given time.
 * @param hour Hour of the day (0-23).
 * @param minute Minute of the hour (0-59).
 * @return String representing the shift label.
 */
String getShiftLabelFromTime(int hour, int minute) {
  if (is_general_shift) {
    return "General_Shift";
  }
  int totalMinutes = hour * 60 + minute;

  if (totalMinutes >= 6 * 60 && totalMinutes < 14 * 60) {
    return "Shift_A";
  } else if (totalMinutes >= 14 * 60 && totalMinutes < 22 * 60) {
    return "Shift_B";
  } else {
    return "Shift_C";
  }
}

/**
 * @brief Accumulates elapsed minutes into base shift timers.
 * @param current_state The current machine state (running or stopped).
 */
void updateShiftTime(bool current_state) {
  if (!is_shift_data_updated) {
    return;
  }
  uint32_t now = millis();
  float elapsed_mins = (now - state_start_millis) / 60000.0f;

  if (last_machine_state) {
    base_working_shift_mins += elapsed_mins;
  } else {
    base_bd_shift_mins += elapsed_mins;
  }

  state_start_millis = now;
  last_machine_state = current_state;

  total_working_shift_mins = base_working_shift_mins;
  total_bd_shift_mins = base_bd_shift_mins;
}

/**
 * @brief Calculate working and breakdown durations on the fly.
 */
void computeLiveShiftTime() {
  if (!is_shift_data_updated) {
    return;
  }
  float elapsed_mins = (millis() - state_start_millis) / 60000.0f;

  if (last_machine_state) {
    total_working_shift_mins = base_working_shift_mins + elapsed_mins;
    total_bd_shift_mins = base_bd_shift_mins;
  } else {
    total_bd_shift_mins = base_bd_shift_mins + elapsed_mins;
    total_working_shift_mins = base_working_shift_mins;
  }
}

/**
 * @brief Stores working/breakdown shift times to FRAM.
 */
void storeShiftTimeToFRAM() {
  uint16_t work_store = (uint16_t)(base_working_shift_mins * TIME_SCALE + 0.5f);
  uint16_t bd_store = (uint16_t)(base_bd_shift_mins * TIME_SCALE + 0.5f);

  framWrite8(TWS_MIN_L, work_store & 0xFF);
  framWrite8(TWS_MIN_H, work_store >> 8);
  framWrite8(TBS_MIN_L, bd_store & 0xFF);
  framWrite8(TBS_MIN_H, bd_store >> 8);
}

/**
 * @brief Restores working/breakdown shift times from FRAM.
 */
void restoreShiftTimeFromFRAM(bool current_machine_state) {
  uint16_t work_raw = framRead8(TWS_MIN_L) | (framRead8(TWS_MIN_H) << 8);
  uint16_t bd_raw = framRead8(TBS_MIN_L) | (framRead8(TBS_MIN_H) << 8);

  base_working_shift_mins = work_raw / TIME_SCALE;
  base_bd_shift_mins = bd_raw / TIME_SCALE;

  last_machine_state = current_machine_state;
  state_start_millis = millis();

  total_working_shift_mins = base_working_shift_mins;
  total_bd_shift_mins = base_bd_shift_mins;
}

/**
 * @brief Helper function to encode raw text string to URL format.
 * @param str Raw string.
 * @return URL encoded String.
 */
String urlEncode(const String &str) {
  String encoded = "";
  char c;
  char buf[4];

  for (int i = 0; i < str.length(); i++) {
    c = str.charAt(i);
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      encoded += c;
    } else {
      sprintf(buf, "%%%02X", (unsigned char)c);
      encoded += buf;
    }
  }
  return encoded;
}

/**
 * @brief Write shift summary parameters and details to Google Sheet.
 * @param s ShiftSummary struct.
 * @return True on success, false otherwise.
 */
bool write_shift_summary_to_google_sheet(const ShiftSummary &s) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected — Google Sheet skipped");
    return false;
  }

  const char *SCRIPT_ID = "AKfycbzl-NBCkye7XH4nJTsEYzHbgoOF6twPqCflSWW4L9YN7hKINZE4loHPdACSwghOsMH-9Q";

  String url = "https://script.google.com/macros/s/";
  url += SCRIPT_ID;
  url += "/exec";

  url += "?date=" + urlEncode(s.date);
  url += "&unit_name=" + urlEncode(s.unit_name);
  url += "&shift=" + urlEncode(s.shift);
  url += "&device_name=" + urlEncode(s.device_name);
  url += "&device_id=" + urlEncode(s.device_id);
  url += "&operator_name=" + urlEncode(s.operator_name);
  url += "&part_name=" + urlEncode(s.part_name);
  url += "&shift_count=" + String(s.shift_count);
  url += "&target_count=" + String(s.target_count);
  url += "&working_mins=" + String(s.working_mins, 1);
  url += "&good_qty=" + String(s.S_good_qty);
  url += "&rejection_qty=" + String(s.rejection_qty);
  url += "&rejection_percentage=" + String(s.rejection_percentage, 1);
  url += "&wastage=" + urlEncode(s.wastage);
  url += "&bd_mins=" + String(s.bd_mins, 1);
  url += "&efficiency=" + String(s.efficiency, 1);
  url += "&manpower=" + String(s.S_manpower_count, 1);
  url += "&target_speed=" + String(part_speed);
  url += "&actual_speed=" + String(s.current_machine_speed, 1);
  url += "&Prod_efficiency=" + String(s.production_efficiency, 1);
  url += "&change_over_loss=" + String(s.change_over_loss_mins, 1);
  url += "&shift_start_time=" + urlEncode(s.shift_start_time);
  url += "&shift_stop_time=" + urlEncode(shift_stop_time);
  url += "&remarks=" + urlEncode(s.S_remarks);

  const int maxRetries = 5;
  const int retryDelayMs = 2000;
  bool success = false;

  HTTPClient http;
  http.setTimeout(10000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    Serial.printf("🌐 [GoogleSheet] Shift upload attempt %d/%d\n", attempt, maxRetries);
    http.begin(url);
    int httpCode = http.GET();
    String response = http.getString();
    http.end();

    if (httpCode == HTTP_CODE_OK && response.indexOf("OK") >= 0) {
      Serial.println("✅ Shift data updated in Google Sheet");
      success = true;
      break;
    } else {
      Serial.printf("❌ Google Sheet failed (HTTP %d). Retrying...\n", httpCode);
      delay(retryDelayMs);
    }
  }

  if (!success) {
    Serial.println("🚨 Google Sheet update FAILED after retries");
  }
  return success;
}

/**
 * @brief Submits a completed shift summary. Triggers delayed WhatsApp/Telegram alert sends.
 */
void sendShiftSummary() {
  if (!shiftSummary.valid) {
    return;
  }
  bool gs_ok = write_shift_summary_to_google_sheet(shiftSummary);
  if (gs_ok) {
    wa_shift_pending = true;
    wa_trigger_time = millis();
  } else {
    Serial.println("⚠️ Shift data NOT sent to Google Sheet");
  }
  shiftSummary.valid = false;
}

#if ENABLE_WHATSAPP == 1
/**
 * @brief Sends a WhatsApp message using Twilio REST API.
 * @param message The body message to send.
 */
void sendWhatsAppMessage(String message) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected for WhatsApp. Skipping message.");
    return;
  }

  const int maxRetries = 2;
  const int retryDelayMs = 1000;

  for (int i = 0; i < numRecipients; i++) {
    bool sent = false;

    for (int attempt = 1; attempt <= maxRetries; attempt++) {
      HTTPClient http;
      http.setTimeout(3000);
      String url = "https://api.twilio.com/2010-04-01/Accounts/" + accountSID + "/Messages.json";
      http.begin(url);
      String auth = base64::encode(accountSID + ":" + authToken);
      http.addHeader("Authorization", "Basic " + auth);
      http.addHeader("Content-Type", "application/x-www-form-urlencoded");

      String toEnc = toNumbers[i];
      toEnc.replace("+", "%2B");
      String fromEnc = fromNumber;
      fromEnc.replace("+", "%2B");

      String payload = "From=" + fromEnc + "&To=" + toEnc + "&Body=" + message;

      Serial.printf("📲 [Twilio] Sending to %s (Attempt %d/%d)\n", toNumbers[i].c_str(), attempt, maxRetries);
      int httpCode = http.POST(payload);

      if (httpCode == HTTP_CODE_CREATED || httpCode == HTTP_CODE_OK) {
        Serial.printf("✅ WhatsApp sent successfully to %s\n", toNumbers[i].c_str());
        sent = true;
        http.end();
        break;
      } else {
        Serial.printf("❌ Send failed (HTTP %d). Retrying...\n", httpCode);
        http.end();
        if (attempt < maxRetries) {
          delay(retryDelayMs);
        }
      }
    }
    delay(100);
  }
}
#endif

#if ENABLE_TELEGRAM == 1
/**
 * @brief Sends a message to the Telegram bot channel/user.
 * @param message Message payload.
 */
void sendTelegramMessage(String message) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected for Telegram. Skipping message.");
    return;
  }

  const int maxRetries = 2;
  const int retryDelayMs = 1000;
  bool sent = false;

  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    HTTPClient http;
    http.setTimeout(3000);
    String url = "https://api.telegram.org/bot" + botToken + "/sendMessage";
    String payload = "chat_id=" + chatID + "&text=" + message;

    Serial.printf("📲 [Telegram] Sending Message (Attempt %d/%d)\n", attempt, maxRetries);
    http.begin(url);
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");

    int httpCode = http.POST(payload);

    if (httpCode > 0 && httpCode == HTTP_CODE_OK) {
      Serial.println("✅ Telegram message sent successfully");
      sent = true;
      http.end();
      break;
    } else {
      Serial.printf("❌ Telegram failed (HTTP %d). Retrying...\n", httpCode);
      http.end();
      if (attempt < maxRetries) {
        delay(retryDelayMs);
      }
    }
  }
}
#endif

#if ENABLE_WHATSAPP == 1 || ENABLE_TELEGRAM == 1
/**
 * @brief Formats shiftSummary data into a clean, human-readable notification text message.
 * @param s ShiftSummary struct.
 * @return Formatted string message.
 */
String buildWhatsAppMessage(const ShiftSummary &s) {
  String msg;
  msg = "📊 SHIFT SUMMARY \n\n";
  msg += "📅 Date : " + s.date + "\n";
  msg += "🏭 Unit : " + s.unit_name + "\n";
  msg += "🛠 Machine : " + s.device_name + "\n";
  msg += "🕒 Shift : " + s.shift + "\n";
  msg += "📦 Item : " + s.part_name + "\n";
  msg += "🎯 Target Speed : " + String(s.machine_speed) + " pcs/min\n";
  msg += "⚙ Machine Speed: " + String(s.current_machine_speed, 1) + " pcs/min\n\n";
  msg += "⏱ Working Time : " + String(s.working_mins, 1) + " min\n";
  msg += "⛔ BD Time  : " + String(s.bd_mins, 1) + " min\n";
  msg += "📈 Machine Efficiency : " + String(s.efficiency, 1) + " %\n\n";
  msg += "🎯 Target Production    : " + String(s.target_count) + "\n";
  msg += "📦 Actual Output    : " + String(s.shift_count) + "\n";
  msg += "📊 Production Efficiency : " + String(s.production_efficiency) + " %\n\n";
  msg += "✅ Good Qty    : " + String(s.S_good_qty) + "\n";
  msg += "❌ Rejected Qty  : " + String(s.rejection_qty) + "\n";
  msg += "📉 Rejection %   : " + String(s.rejection_percentage, 1) + " %\n\n";
  msg += "🔄 Item changeover loss : " + String(s.change_over_loss_mins, 1) + " min\n";
  msg += "🗑 Wastage   : " + s.wastage + "\n";
  msg += "💬 Remarks  : " + s.S_remarks + "\n";
  msg += "👥 Manpower : " + String(s.S_manpower_count, 1) + "\n";
  msg += "👷 Operator : " + s.operator_name + "\n\n";
  msg += "⏳ Start Time : " + s.shift_start_time + "\n";
  msg += "⌛ Stop Time  : " + shift_stop_time;

  if (shift_bd_log.length() > 0) {
    msg += "\n\n🛠 BREAKDOWN LOGS:\n" + shift_bd_log;
  } else {
    msg += "\n\n🛠 BREAKDOWN LOGS:\nNo breakdowns logged.";
  }

  return msg;
}
#endif

// --- Offline Storage / Queue helpers (Kept for compatibility) ---
void queueGoogleSheet(const String &url) {
  uint16_t next = (gsTail + 1) % GS_MAX_ITEMS;
  if (next == gsHead) {
    gsHead = (gsHead + 1) % GS_MAX_ITEMS;
  }
  framWriteString(GS_DATA_ADDR + gsTail * GS_ITEM_SIZE, url);
  gsTail = next;
  framWrite8(GS_HEAD_ADDR, gsHead & 0xFF);
  framWrite8(GS_HEAD_ADDR + 1, gsHead >> 8);
  framWrite8(GS_TAIL_ADDR, gsTail & 0xFF);
  framWrite8(GS_TAIL_ADDR + 1, gsTail >> 8);
  Serial.println("📥 Google Sheet queued");
}

void flushGoogleSheetQueue() {
  if (gsHead == gsTail) {
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  String url = framReadString(GS_DATA_ADDR + gsHead * GS_ITEM_SIZE);
  HTTPClient http;
  http.begin(url);
  int code = http.GET();
  http.end();
  if (code == HTTP_CODE_OK) {
    gsHead = (gsHead + 1) % GS_MAX_ITEMS;
    framWrite8(GS_HEAD_ADDR, gsHead & 0xFF);
    framWrite8(GS_HEAD_ADDR + 1, gsHead >> 8);
    Serial.println("✅ Google Sheet sent from queue");
  }
}

void queueWhatsApp(const String &msg) {
  uint16_t next = (waTail + 1) % WA_MAX_ITEMS;
  if (next == waHead) {
    waHead = (waHead + 1) % WA_MAX_ITEMS;
  }
  framWriteString(WA_DATA_ADDR + waTail * WA_ITEM_SIZE, msg);
  waTail = next;
  framWrite8(WA_HEAD_ADDR, waHead & 0xFF);
  framWrite8(WA_HEAD_ADDR + 1, waHead >> 8);
  framWrite8(WA_TAIL_ADDR, waTail & 0xFF);
  framWrite8(WA_TAIL_ADDR + 1, waTail >> 8);
  Serial.println("📥 WhatsApp queued");
}

void flushWhatsAppQueue() {
  if (waHead == waTail) {
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  String msg = framReadString(WA_DATA_ADDR + waHead * WA_ITEM_SIZE);
#if ENABLE_WHATSAPP == 1
  sendWhatsAppMessage(msg);
#endif
  waHead = (waHead + 1) % WA_MAX_ITEMS;
  framWrite8(WA_HEAD_ADDR, waHead & 0xFF);
  framWrite8(WA_HEAD_ADDR + 1, waHead >> 8);
}

/**
 * @brief Resets part-level counters and timers (run context).
 */
void run_reset() {
  for (int i = 0; i < MAX_STATIONS; i++) {
    station_counts[i] = 0;
    station_shift_counts[i] = 0;
    last_pulse_time_st[i] = millis() - (STATION_INACTIVITY_LIMIT + 1000);
    station_bd_reasons[i] = "";
    station_working_mins[i] = 0.0f;
    station_breakdown_mins[i] = 0.0f;
    last_seen_counts[i] = 0;
  }
  last_seen_sense = 0;
  last_pulse_time = millis() - (STATION_INACTIVITY_LIMIT + 1000);
  bd_count = 0;
  base_working_shift_mins = 0;
  base_bd_shift_mins = 0;
  total_working_shift_mins = 0;
  total_bd_shift_mins = 0;
  item_changeover_mins = 0.0f;
  is_min_bd = false;
  is_major_bd = false;
  is_bd_reason_updated = false;
  framWrite8(ITEM_CO_L_ADDR, 0);
  framWrite8(ITEM_CO_H_ADDR, 0);
  last_machine_state = motor1_status;
  state_start_millis = millis();
  storeShiftTimeToFRAM();
  dwin_active_bd_station_idx = 0;
  Serial.println("🔁 RUN reset (same shift, new part)");
}

/**
 * @brief Full shift metrics and changeover time resets.
 */
void shift_reset() {
  run_reset();
  shift_bd_log = "";
  framWrite8(shift_data_update, 0);
  part_run_count = 0;
  item_changeover_mins = 0.0f;
  item_change_active = false;
  item_change_start_time = 0;
  framWrite8(ITEM_CO_L_ADDR, 0);
  framWrite8(ITEM_CO_H_ADDR, 0);
  framWrite8(PART_RUN_CNT_ADDR, 0);
  Serial.println("🔁 SHIFT reset (A/B/C)");
}

/**
 * @brief Evaluates efficiency.
 */
void efficiency() {
  efficiency_percent = ((total_working_shift_hrs * 100) / 480.0);
}

/**
 * @brief Initialize sensor and control pins. Attach sensor ISR.
 */
void pin_mode_init() {
  pinMode(SENSOR, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(SENSOR), sensor_count, CHANGE);

#if NUM_INPUTS >= 2
  pinMode(IN2_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(IN2_PIN), sensor_count_2, CHANGE);
#endif

#if NUM_INPUTS >= 3
  pinMode(IN3_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(IN3_PIN), sensor_count_3, CHANGE);
#endif

  pinMode(DEVICE_STATE_OUT, OUTPUT);
}

/**
 * @brief EEPROM emulation write compatibility wrapper.
 */
void writeStringToEEPROM(int addrOffset, const String &strToWrite) {
  framWriteString((uint16_t)addrOffset, strToWrite);
}

/**
 * @brief EEPROM emulation read compatibility wrapper.
 */
String readStringFromEEPROM(int addrOffset) {
  return framReadString((uint16_t)addrOffset);
}

/**
 * @brief Gathers breakdown stats and triggers breakdown notifications.
 */
void data_fetch() {
  String param;
  param = "lat1=" + dateStr;
  param += "&lat2=" + unit_name;
  param += "&latitude=" + shift;
  param += "&longitude=" + device_name;
  param += "&speed=" + device_id;
  param += "&satellites=" + stop_time;
  param += "&altitude=" + bd_reason;
  param += "&gps_time=" + String(bd_reason2);
  param += "&gps_date=" + String(spare_detail);
  param += "&gps1_date=" + String(spare_qty);
  param += "&gps2_date=" + String(bd_remarks);
  Serial.println(param);
  write_to_google_sheet(param);

  if (is_bd_reason_updated == true) {
    if (motor1_status == 0) {
      bd_time = ((millis() - bd_millis) / 60000.00);
    }
    
    String wa_msg = "📊 BREAKDOWN UPDATE\n";
    wa_msg += "📅 Date: " + current_date + "\n";
    wa_msg += "🏭 Unit: " + unit_name + "\n";
    wa_msg += "🛠 Machine: " + device_name + "\n";
    wa_msg += "📌 Reason: " + bd_reason2 + "\n\n";
    wa_msg += "🕒 Stop Time: " + stop_time + "\n";
    wa_msg += "🕘 Start Time: " + Time + "\n";
    wa_msg += "BD Duration (min): " + String(bd_time) + "\n";
    
    String entry = "- Station: " + String(dwin_station_names[dwin_active_bd_station_idx]) + " | Reason: " + bd_reason2;
    entry += " | Time: " + stop_time + " to " + Time + " (" + String(bd_time, 1) + " min)\n";
    shift_bd_log += entry;

#if ENABLE_WHATSAPP == 1
    sendWhatsAppMessage(wa_msg);
#endif

#if ENABLE_TELEGRAM == 1
    sendTelegramMessage(wa_msg);
#endif
  }

  bd_millis = millis();
  bd_time = 0;
  is_major_bd = false;
  is_min_bd = false;
  is_bd_reason_updated = false;
}

/**
 * @brief Helper performing HTTP GET to Google Apps Script.
 * @param params Query parameters string.
 */
void write_to_google_sheet(String params) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected — skipping Google Sheet send");
    return;
  }

  String url = "https://script.google.com/macros/s/" + GOOGLE_SCRIPT_ID + "/exec?" + params;
  HTTPClient http;
  http.setTimeout(3000);
  const int maxRetries = 2;
  const int retryDelayMs = 1000;
  bool success = false;

  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    Serial.printf("🌐 [GoogleSheet] Attempt %d/%d -> %s\n", attempt, maxRetries, url.c_str());
    http.begin(url);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      Serial.println("✅ Data sent successfully!");
      Serial.println("Response: " + payload);
      success = true;
      http.end();
      break;
    } else {
      Serial.printf("❌ Failed (HTTP %d). Retrying...\n", httpCode);
      http.end();
      if (attempt < maxRetries) {
        delay(retryDelayMs);
      }
    }
  }

  if (!success) {
    Serial.println("🚫 All Google Sheet attempts failed.");
  }
}

/**
 * @brief Gathers statistics for manual triggers of shift summary alert sending.
 */
void data_fetch1() {
  String param;
  param = "lat1=" + dateStr;
  param += "&lat2=" + unit_name;
  param += "&latitude=" + device_id;
  param += "&longitude=" + device_name;
  param += "&speed=" + shift;
  param += "&satellites=" + String(total_working_shift_hrs);
  param += "&altitude=" + String(shift_count);
  param += "&gps_time=" + String(total_bd_shift_hrs);
  param += "&gps_date=" + String(efficiency_percent);
  param += "&gps1_date=" + operator_name;
  param += "&gps2_date=" + maintenance_name;
  Serial.println(param);

  String wa_msg = "📊 SHIFT SUMMARY\n";
  wa_msg += "Unit_name: " + unit_name + "\n";
  wa_msg += "Machine: " + device_name + "\n";
  wa_msg += "Shift: " + shift + "\n";
  wa_msg += "Item_name: " + part_name + "\n";
  wa_msg += "Total Working mins: " + String(total_working_shift_hrs) + "\n";
  wa_msg += "Total BD mins: " + String(total_bd_shift_hrs) + "\n";
  wa_msg += "Shift_output: " + String(shift_count) + "\n";
  wa_msg += "Efficiency: " + String(efficiency_percent) + "%\n";
  wa_msg += "Film Wastage / Remarks: " + String(wastage) + "\n";
  wa_msg += "Operator: " + operator_name + "\n";
  
#if ENABLE_WHATSAPP == 1
  sendWhatsAppMessage(wa_msg);
#endif

#if ENABLE_TELEGRAM == 1
  sendTelegramMessage(wa_msg);
#endif

  is_shift_data_updated = false;
  is_shift_completed = false;
  is_wastage_updated = false;
}

/**
 * @brief Helper performing HTTP POST to Google Apps Script.
 * @param jsonPayload JSON payload.
 * @return True on success, false otherwise.
 */
bool write_to_google_sheet_post(const String &jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected — skipping Google Sheet POST");
    return false;
  }

  const char *scriptUrl = "https://script.google.com/macros/s/AKfycby9v13iLxYlGoY-d9HaoiU-CgEBKNL4c6a2VukQTbJLtB5VBRjMxcBtDQdfs-YNEyWC/exec";
  const int maxRetries = 2;
  const int retryDelayMs = 1000;
  bool success = false;

  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    HTTPClient http;
    http.setTimeout(3000);
    Serial.printf("🌐 [GoogleSheet POST] Attempt %d/%d\n", attempt, maxRetries);
    http.begin(scriptUrl);
    http.addHeader("Content-Type", "application/json");
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

    int httpCode = http.POST(jsonPayload);
    String response = http.getString();

    if (httpCode == HTTP_CODE_OK) {
      Serial.println("✅ Data POSTED successfully!");
      success = true;
      http.end();
      break;
    } else {
      Serial.printf("❌ POST failed (HTTP %d). Retrying...\n", httpCode);
      http.end();
      if (attempt < maxRetries) {
        delay(retryDelayMs);
      }
    }
  }

  if (!success) {
    Serial.println("🚨 All retries failed — data NOT sent");
  }
  return success;
}

/**
 * @brief Persistent storage save (writes current counters to FRAM).
 */
void eeprom_store() {
  framWrite8(t_s_count_add1, (uint8_t)((station_shift_counts[0] >> 0) & 0xff));
  framWrite8(t_s_count_add2, (uint8_t)((station_shift_counts[0] >> 8) & 0xff));
  framWrite8(count_add1, (uint8_t)((station_counts[0] >> 0) & 0xff));
  framWrite8(count_add2, (uint8_t)((station_counts[0] >> 8) & 0xff));

#if NUM_INPUTS >= 2
  framWrite8(t_s_count2_add1, (uint8_t)((station_shift_counts[1] >> 0) & 0xff));
  framWrite8(t_s_count2_add2, (uint8_t)((station_shift_counts[1] >> 8) & 0xff));
  framWrite8(count2_add1, (uint8_t)((station_counts[1] >> 0) & 0xff));
  framWrite8(count2_add2, (uint8_t)((station_counts[1] >> 8) & 0xff));
#endif

#if NUM_INPUTS >= 3
  framWrite8(t_s_count3_add1, (uint8_t)((station_shift_counts[2] >> 0) & 0xff));
  framWrite8(t_s_count3_add2, (uint8_t)((station_shift_counts[2] >> 8) & 0xff));
  framWrite8(count3_add1, (uint8_t)((station_counts[2] >> 0) & 0xff));
  framWrite8(count3_add2, (uint8_t)((station_counts[2] >> 8) & 0xff));
#endif
  framWrite8(day_add, day_val);
  framWrite8(bd_count_add1, (uint8_t)((bd_count >> 0) & 0xff));
  framWrite8(bd_count_add2, (uint8_t)((bd_count >> 8) & 0xff));
  framWrite8(up_state_add, (uint8_t)upload_state);
  framWrite8(run_time_add1, (uint8_t)((running_time >> 0) & 0xff));
  framWrite8(run_time_add2, (uint8_t)((running_time >> 8) & 0xff));

  framWrite8(start_time_add1, tvals[4]);
  framWrite8(start_time_add2, tvals[5]);
  framWrite8(start_time_add3, tvals[6]);
  framWrite8(stop_time_add1, tvals[7]);
  framWrite8(stop_time_add2, tvals[8]);
  framWrite8(stop_time_add3, tvals[9]);

  framWriteString(date_add, dateStr);
  framWrite8(eff_add, (uint8_t)efficiency_percent);

  if (shift_update_received == 1) {
    if (is_shift_data_updated == false) {
      framWrite8(shift_data_update, 0);
    } else {
      framWrite8(shift_data_update, 1);
      framWriteString(unit_name_add, unit_name);
      framWriteString(operator_name_add, operator_name);
      framWriteString(maintenance_name_add, maintenance_name);
      framWriteString(shift_add, shift);
      framWrite8(IS_GENERAL_SHIFT_ADDR, (uint8_t)is_general_shift);
      shift_start_time = framReadString(SHIFT_START_TIME_ADDR);

      if (shift_start_time.length() > 0) {
        Serial.println("🔁 Restored shift start time: " + shift_start_time);
      }
    }
  }
  shift_update_received = 0;
  // Persist station operators to FRAM
  framWriteString(STATION1_OP_ADDR, station_operators[0]);
#if MAX_STATIONS >= 2
  framWriteString(STATION2_OP_ADDR, station_operators[1]);
#endif
#if MAX_STATIONS >= 3
  framWriteString(STATION3_OP_ADDR, station_operators[2]);
#endif
  storeShiftTimeToFRAM();
}

/**
 * @brief EEPROM read logic (compatibility stub).
 */
void eeprom_read1() {}

/**
 * @brief Read runtime variables from FRAM.
 */
void eeprom_read2() {
  running_time = (framRead8(run_time_add1) << 0) | (framRead8(run_time_add2) << 8);
  start_time = String(framRead8(start_time_add1)) + ":" +
               String(framRead8(start_time_add2)) + ":" +
               String(framRead8(start_time_add3));
  stop_time = String(framRead8(stop_time_add1)) + ":" +
              String(framRead8(stop_time_add2)) + ":" +
              String(framRead8(stop_time_add3));
  
  station_counts[0] = (framRead8(count_add1) << 0) | (framRead8(count_add2) << 8);
#if NUM_INPUTS >= 2
  station_counts[1] = (framRead8(count2_add1) << 0) | (framRead8(count2_add2) << 8);
#endif
#if NUM_INPUTS >= 3
  station_counts[2] = (framRead8(count3_add1) << 0) | (framRead8(count3_add2) << 8);
#endif

  bd_reason = "power_cut";
}

/**
 * @brief Read shift statistics and state flags from FRAM.
 */
void eeprom_read3() {
  station_counts[0] = (framRead8(count_add1) << 0) | (framRead8(count_add2) << 8);
#if NUM_INPUTS >= 2
  station_counts[1] = (framRead8(count2_add1) << 0) | (framRead8(count2_add2) << 8);
#endif
#if NUM_INPUTS >= 3
  station_counts[2] = (framRead8(count3_add1) << 0) | (framRead8(count3_add2) << 8);
#endif

  station_shift_counts[0] = (framRead8(t_s_count_add1) << 0) | (framRead8(t_s_count_add2) << 8);
#if NUM_INPUTS >= 2
  station_shift_counts[1] = (framRead8(t_s_count2_add1) << 0) | (framRead8(t_s_count2_add2) << 8);
#endif
#if NUM_INPUTS >= 3
  station_shift_counts[2] = (framRead8(t_s_count3_add1) << 0) | (framRead8(t_s_count3_add2) << 8);
#endif

  efficiency_percent = framRead8(eff_add);
  is_general_shift = framRead8(IS_GENERAL_SHIFT_ADDR) == 1;
  dateStr = framReadString(date_add);
  restoreShiftTimeFromFRAM(motor1_status);
}

/**
 * @brief Part speed lookup based on selection mapping name.
 * @param part Part Name string.
 * @return Target part speed value.
 */
uint16_t getPartSpeed(const String &part) {
  for (uint16_t i = 0; i < PART_SPEED_COUNT; i++) {
    if (part.equals(partSpeedMap[i].part)) {
      return partSpeedMap[i].speed;
    }
  }
  return 0;
}

// --- HTML Static Data Helpers ---
String generateOptions(const char *arr[], int count) {
  String html = "";
  for (int i = 0; i < count; i++) {
    html += "<option value='" + String(arr[i]) + "'>" + String(arr[i]) + "</option>";
  }
  return html;
}

const char html_part1[] PROGMEM = R"RAWHTML(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cycle Brand - Machine Control Panel</title>
  <script src="https://unpkg.com/lucide@latest"></script>

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: "Poppins", "Segoe UI", sans-serif;
      background-color: #fffaf5;
      color: #333;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px;
      min-height: 100vh;
      justify-content: space-between;
    }

    .panel {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      width: 100%;
      max-width: 500px;
      padding: 30px;
      text-align: center;
    }

    .brand-logo {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: 10px;
    }

    .brand-logo img { width: 140px; }

    .brand-logo span {
      font-size: 20px;
      font-weight: 600;
      color: #E89F33;
    }

    h2 {
      margin: 15px 0 20px;
      font-weight: 600;
    }

    .btn-group {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
    }

    .btn-group button {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background: #E89F33;
      color: #fff;
      cursor: pointer;
      font-weight: 500;
    }

    .btn-group button.active {
      background: #c47e1f;
    }

    .section {
      display: none;
      text-align: left;
      animation: fadeIn 0.3s ease;
    }

    .section.active { display: block; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    label {
      display: block;
      margin: 14px 0 6px;
      font-weight: 500;
    }

    input, select {
      width: 100%;
      padding: 10px;
      border-radius: 6px;
      border: 1px solid #ccc;
      font-size: 1em;
    }

    input:focus, select:focus {
      outline: none;
      border-color: #E89F33;
    }

    .submit-btn {
      margin-top: 18px;
      width: 100%;
      padding: 12px;
      background: #E89F33;
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 1em;
      cursor: pointer;
    }

    #message {
      margin-top: 15px;
      text-align: center;
      color: #E89F33;
      font-weight: 500;
      min-height: 1.2em;
    }

    footer {
      margin-top: 25px;
      text-align: center;
      font-size: 0.9em;
    }
  </style>
</head>

<body>

<div class="panel">

  <div class="brand-logo">
    <img src="https://www.nrrs.com/wp-content/uploads/2022/05/cycle-logo.png">
    <span>Cycle Pure Agarbathi</span>
  </div>

  <h2>Machine Control Panel</h2>

  <p style="color:#E89F33;font-weight:500;margin-bottom:16px;">
    Machine Name: <span id="machineValue"></span>
  </p>

  <div class="btn-group">
    <button id="btn-breakdown" class="active">Breakdown</button>
    <button id="btn-shift">Shift Change</button>
    <button id="btn-wastage">Shift End</button>
    <button id="btn-settings">Settings</button>
  </div>

  <!-- ================= Breakdown Section ================= -->
  <div id="section-breakdown" class="section active">
    <label>Select Breakdown Reason</label>
    <select id="reason"></select>
    <button class="submit-btn" onclick="submitBreakdown()">Submit</button>
  </div>

  <!-- ================= Shift Change Section ================= -->
  <div id="section-shift" class="section">
    <label>Item Name</label>
    <select id="part"></select>

    <label>Operator</label>
    <select id="operator"></select>

    <div style="margin: 20px 0; display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="document.getElementById('isGeneralShift').click()">
      <input type="checkbox" id="isGeneralShift" style="width: 20px; height: 20px; cursor: pointer;">
      <label style="margin: 0; cursor: pointer;">Is General Shift?</label>
    </div>

    <button class="submit-btn" onclick="submitShift()">Submit</button>
  </div>

  <!-- ================= Shift End Details ================= -->
  <div id="section-wastage" class="section">

    <h3 style="text-align:center;margin-bottom:16px;font-weight:600;">
      Shift End Details
    </h3>

    <label>Wastage (kg)</label>
    <input type="text" id="wastage" placeholder="Enter wastage in kg">

    <label>Rejection Quantity</label>
    <input type="number" id="goodqty" min="0" max="999" step="1" placeholder="Enter rejection qty">

    <label>Manpower Count</label>
    <input type="number" id="manpower" min="0" step="0.1" placeholder="Enter manpower count">

    <label>Remarks</label>
    <input type="text" id="remarks" placeholder="Enter remarks">

    <button class="submit-btn" onclick="submitWastage()">Submit</button>
  </div>

  <!-- ================= Settings Section ================= -->
  <div id="section-settings" class="section">
    <label>Unit Name</label>
    <select id="unitSelect"></select>

    <label>Device Name (Machine Name)</label>
    <input type="text" id="deviceInput" placeholder="Enter Device Name">

    <button class="submit-btn" onclick="submitSettings()">Submit</button>
    <button class="submit-btn" style="margin-top: 10px; background: #555;" onclick="triggerUpdate()">Check for Updates</button>
  </div>

  <div id="message"></div>
</div>

<footer>
  <span style="color:#E89F33;font-weight:600;">Cycle Pure Agarbathi</span>
  <p>2025 N. Ranga Rao & Sons Pvt. Ltd.</p>
</footer>

<script>
/* ================= DATA ================= */







/* ================= HELPERS ================= */



function populateSelectText(id, list) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";

  list.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
}

function populateSelectIndex(id, list) {
  const sel = document.getElementById(id);
  sel.innerHTML = "";

  list.forEach((v, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = v;
    sel.appendChild(o);
  });
}

function showMessage(msg) {
  const m = document.getElementById("message");
  m.innerText = msg;
  setTimeout(() => m.innerText = "", 3000);
}

/* ================= SUBMIT HANDLERS ================= */

function submitBreakdown() {
  const reason = document.getElementById("reason").value;
  fetch(`/submit_breakdown?reason=${encodeURIComponent(reason)}`)
    .then(() => {
      showMessage("✅ Breakdown Submitted");
      setTimeout(() => location.reload(), 1000);
    })
    .catch(() => showMessage("❌ Failed"));
}

function submitShift() {
  const operatorSel = document.getElementById("operator");
  const partSel = document.getElementById("part");
  const isGen = document.getElementById("isGeneralShift").checked ? 1 : 0;

  const operator = operatorSel.options[operatorSel.selectedIndex].text;
  const partIdx = partSel.value;

  fetch(`/submit_shift?part_idx=${partIdx}&operator=${encodeURIComponent(operator)}&is_gen=${isGen}`)
    .then(() => {
      showMessage("✅ Shift Submitted");
      setTimeout(() => {
        location.reload();
      }, 1000);
    })
    .catch(() => showMessage("❌ Failed"));
}

function submitSettings() {
  const unitSel = document.getElementById("unitSelect");
  const device = document.getElementById("deviceInput").value.trim();
  const unit = unitSel.options[unitSel.selectedIndex].text;

  if (!device) {
    showMessage("⚠️ Enter Device Name");
    return;
  }

  fetch(`/submit_settings?unit=${encodeURIComponent(unit)}&device=${encodeURIComponent(device)}`)
    .then(() => {
      showMessage("✅ Settings Updated");
      setTimeout(() => {
        location.reload();
      }, 1000);
    })
    .catch(() => showMessage("❌ Failed"));
}

function triggerUpdate() {
  showMessage("⏳ Checking for updates...");
  fetch("/check_update")
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => { throw new Error(text); });
      }
      return response.text();
    })
    .then(text => {
      showMessage("✅ " + text);
    })
    .catch(err => {
      showMessage("❌ " + (err.message || "Failed"));
    });
}

function submitWastage() {
  const w  = document.getElementById("wastage").value.trim();
  const r  = parseInt(document.getElementById("goodqty").value || "0", 10);
  const mp = parseFloat(document.getElementById("manpower").value || "0");
  const rm = document.getElementById("remarks").value.trim();

  if (!w) {
    showMessage("⚠️ Enter wastage");
    return;
  }

  if (isNaN(mp) || mp < 0) {
    showMessage("⚠️ Invalid manpower count");
    return;
  }

  if (r < 0 || r > 999) {
    showMessage("⚠️ Wrong rejection input values (must be 0 - 999)");
    return;
  }

  fetch(`/submit_wastage?wastage=${encodeURIComponent(w)}&goodqty=${r}&manpower=${mp}&remarks=${encodeURIComponent(rm)}`)
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => { throw new Error(text); });
      }
      showMessage("✅ Shift End Details Submitted");
      document.getElementById("wastage").value = "";
      document.getElementById("goodqty").value = "";
      document.getElementById("manpower").value = "";
      document.getElementById("remarks").value = "";
      setTimeout(() => location.reload(), 1000);
    })
    .catch((err) => showMessage("❌ " + (err.message || "Failed")));
}


/* ================= TAB CONTROL ================= */

const btnBreakdown = document.getElementById("btn-breakdown");
const btnShift     = document.getElementById("btn-shift");
const btnWastage   = document.getElementById("btn-wastage");
const btnSettings  = document.getElementById("btn-settings");

function setActive(sectionId, activeBtn) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".btn-group button").forEach(b => b.classList.remove("active"));

  document.getElementById(sectionId).classList.add("active");
  activeBtn.classList.add("active");
}

btnBreakdown.addEventListener("click", () =>
  setActive("section-breakdown", btnBreakdown)
);

btnShift.addEventListener("click", () =>
  setActive("section-shift", btnShift)
);

btnWastage.addEventListener("click", () =>
  setActive("section-wastage", btnWastage)
);

btnSettings.addEventListener("click", () =>
  setActive("section-settings", btnSettings)
);

/* ================= INIT ================= */

function initDropdowns() {
  if (
    typeof breakdownReasons === "undefined" ||
    typeof partNames === "undefined" ||
    typeof operators === "undefined" ||
    typeof units === "undefined"
  ) {
    console.log("⏳ Waiting for dropdown data...");
    setTimeout(initDropdowns, 100);
    return;
  }

  populateSelectText("reason", breakdownReasons);
  populateSelectIndex("part", partNames);
  populateSelectText("operator", operators);
  populateSelectText("unitSelect", units);

  document.getElementById("machineValue").innerText = "{{MACHINE_NAME}}";
  document.getElementById("unitSelect").value = "{{UNIT_NAME}}";
  document.getElementById("deviceInput").value = "{{MACHINE_NAME}}";
  lucide.createIcons();
  console.log("✅ All dropdowns loaded successfully");
}

window.onload = initDropdowns;
</script>
)RAWHTML";

const char html_part2[] PROGMEM = R"RAWHTML(
</body>
</html>
)RAWHTML";

/**
 * @brief Web Server route rendering the root control panel page.
 */
void handleRoot() {
  if (server.hasArg("unit")) {
    String detected = server.arg("unit");
    detected.trim();
    if (detected.length() > 0) {
      unit_name = detected;
      framWriteString(unit_name_add, unit_name);
      Serial.println("🌐 Auto-detected Unit from URL: " + unit_name);
    }
  }

  String html = FPSTR(html_part1);
  html.replace("{{MACHINE_NAME}}", device_name);
  html.replace("{{UNIT_NAME}}", unit_name);

  StaticJsonDocument<4096> doc;

  JsonArray br = doc.createNestedArray("breakdownReasons");
  for (int i = 0; i < sizeof(breakdownReasons) / sizeof(breakdownReasons[0]); i++) {
    br.add(String(breakdownReasons[i]));
  }

  JsonArray pn = doc.createNestedArray("partNames");
  for (int i = 0; i < sizeof(partNames) / sizeof(partNames[0]); i++) {
    pn.add(String(partNames[i]));
  }

  JsonArray op = doc.createNestedArray("operators");
  for (int i = 0; i < sizeof(operators) / sizeof(operators[0]); i++) {
    op.add(String(operators[i]));
  }

  JsonArray un = doc.createNestedArray("units");
  for (int i = 0; i < sizeof(units) / sizeof(units[0]); i++) {
    un.add(String(units[i]));
  }

  String json;
  serializeJson(doc, json);

  String script = "const data = " + json + ";";
  script += "const breakdownReasons = data.breakdownReasons;";
  script += "const partNames = data.partNames;";
  script += "const operators = data.operators;";
  script += "const units = data.units;";

  html.replace("/* ================= DATA ================= */", script);
  html += FPSTR(html_part2);

  server.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
  server.send(200, "text/html", html);
}

/**
 * @brief Web route executing breakdown entry submits.
 */
void handleBreakdown() {
  String reason = server.arg("reason");
  bd_reason2 = reason;
  is_bd_reason_updated = true;
  Serial.println("📉 Breakdown selected (web): " + bd_reason2);

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "Breakdown Received");
}

/**
 * @brief Web route executing shift change submits.
 */
void handleShift() {
  if ((is_shift_data_updated == false) && (is_wastage_updated == false)) {
    start_time_fetch_flag = 1;
    String op = server.arg("operator");
    is_general_shift = server.arg("is_gen").toInt() == 1;
    operator_name = op;

    framWriteString(unit_name_add, unit_name);
    framWriteString(operator_name_add, operator_name);
    framWrite8(IS_GENERAL_SHIFT_ADDR, (uint8_t)is_general_shift);

    for (int i = 0; i < MAX_STATIONS; i++) {
      station_operators[i] = operator_name;
    }

    struct tm nowTime;
    time_t now_t = time(nullptr);
    localtime_r(&now_t, &nowTime);
    bool ok = (nowTime.tm_year > 70);

    if (ok) {
      char buf[9];
      snprintf(buf, sizeof(buf), "%02d:%02d:%02d", nowTime.tm_hour, nowTime.tm_min, nowTime.tm_sec);
      shift_start_time = String(buf);
      framWriteString(SHIFT_START_TIME_ADDR, shift_start_time);
      Serial.println("🕒 Shift start time captured: " + shift_start_time);
    } else {
      Serial.println("⚠️ Failed to read time for shift start");
    }

    is_major_bd = false;
    is_min_bd = false;
    is_bd_reason_updated = false;
    bd_millis = millis();
    bd_shift_millis = millis();

    Serial.println("🔄 BD flags reset for new shift");

    uint16_t part_idx = server.arg("part_idx").toInt();
    if (part_idx >= PART_SPEED_COUNT) {
      Serial.println("❌ Invalid part index received");
      part_speed = 0;
      part_name = "UNKNOWN";
    } else {
      part_name = partSpeedMap[part_idx].part;
      part_speed = partSpeedMap[part_idx].speed;
      part_name.replace(" ", "_");
      framWriteString(PART_NAME_ADD_ADDR, part_name);
    }

    if (item_change_active && part_run_count >= 1 && item_change_start_time > 0) {
      time_t now_ts = time(NULL);
      float delta = difftime(now_ts, item_change_start_time) / 60.0f;
      if (delta > 0 && delta < 1440.0f) {
        item_changeover_mins = delta;
      } else {
        item_changeover_mins = 0.0f;
      }
      Serial.println("⏱ Item Changeover Loss: " + String(item_changeover_mins, 1) + " min");
    } else {
      item_changeover_mins = 0.0f;
    }

    part_run_count++;
    item_change_active = false;
    item_change_start_time = 0;

    framWrite8(ITEM_CHANGE_ACTIVE_ADDR, 0);
    framWriteArray(ITEM_CHANGE_START_ADDR, (uint8_t *)&item_change_start_time, sizeof(item_change_start_time));
    framWrite8(PART_RUN_CNT_ADDR, part_run_count);
    framWrite8(PART_SPEED_L_ADDR, part_speed & 0xFF);
    framWrite8(PART_SPEED_H_ADDR, part_speed >> 8);

    uint16_t item_store = (uint16_t)(item_changeover_mins * 10.0f + 0.5f);
    framWrite8(ITEM_CO_L_ADDR, item_store & 0xFF);
    framWrite8(ITEM_CO_H_ADDR, item_store >> 8);

    Serial.println("   ➤ Shift : " + shift);
    Serial.println("   ➤ Unit  : " + unit_name);
    Serial.println("   ➤ Part  : " + part_name);
    Serial.println("   ➤ Speed : " + String(part_speed) + " pcs/min");
    Serial.println("   ➤ Operator: " + operator_name);

    is_shift_data_updated = true;
    shift_data_requested_activated_flag = 1;
    shift_update_received = 1;
    framWrite8(shift_data_update, 1);

    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "text/plain", "Shift Received");
  }
}

/**
 * @brief Web route executing shift end wastage details submits.
 */
void handleWastage() {
  if ((is_shift_data_updated == true) && (is_wastage_updated == false)) {
    uint16_t rejection_input = server.arg("goodqty").toInt();
    if (rejection_input > 999) {
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.send(400, "text/plain", "Wrong rejection input values");
      return;
    }

    wastage = server.arg("wastage");
    if (shift_count >= rejection_input) {
      good_qty = shift_count - rejection_input;
    } else {
      good_qty = 0;
    }
    
    manpower_count = server.arg("manpower").toFloat();
    remarks = server.arg("remarks");

    item_change_active = true;
    item_change_start_time = time(NULL);

    framWrite8(ITEM_CHANGE_ACTIVE_ADDR, 1);
    framWriteArray(ITEM_CHANGE_START_ADDR, (uint8_t *)&item_change_start_time, sizeof(item_change_start_time));

    shift_stop_time = Time;
    is_wastage_updated = true;
    is_shift_completed = true;

    Serial.println("📦 PART END SUBMITTED (WEB)");
    Serial.println("   ➤ Wastage (kg)  : " + wastage);
    Serial.println("   ➤ Good Qty     : " + String(good_qty));
    Serial.println("   ➤ Manpower     : " + String(manpower_count, 2));
    Serial.println("   ➤ Remarks      : " + remarks);
    Serial.println("------------------------------------");

    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "text/plain", "Shift End Details Received");

    digitalWrite(DEVICE_STATE_OUT, LOW);
  }
}

void handleSettings() {
  if (server.hasArg("unit")) {
    unit_name = server.arg("unit");
    unit_name.replace(" ", "_");
    framWriteString(unit_name_add, unit_name);
  }
  if (server.hasArg("device")) {
    device_name = server.arg("device");
    device_name.replace(" ", "_");
    framWriteString(DEVICE_NAME_ADD, device_name);
  }
  
  Serial.println("⚙ Settings updated (web):");
  Serial.println("   ➤ Unit  : " + unit_name);
  Serial.println("   ➤ Device: " + device_name);
  
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "Settings Received");
}

void handleCheckUpdate() {
  if (WiFi.status() == WL_CONNECTED) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "text/plain", "Checking for updates...");
    checkForUpdate();
  } else {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(400, "text/plain", "Wi-Fi not connected");
  }
}

/**
 * @brief HTTP Web Server initialization routing definitions.
 */
void startWebServer() {
  server.on("/", handleRoot);
  server.on("/submit_breakdown", handleBreakdown);
  server.on("/submit_shift", handleShift);
  server.on("/submit_wastage", handleWastage);
  server.on("/submit_settings", handleSettings);
  server.on("/check_update", handleCheckUpdate);
  server.begin();
  Serial.println("🌐 Web Server started");
  mqtt.publish(topic_out, "Web Server started");
}

/**
 * @brief OTA flashing logic execution.
 * @param firmwareURL Download HTTP link.
 */
void performOTA(String firmwareURL) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.begin(client, firmwareURL);

  Serial.println("Downloading new firmware...");
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    all_led();
    int contentLength = http.getSize();
    if (Update.begin(contentLength)) {
      WiFiClient *stream = http.getStreamPtr();
      size_t written = Update.writeStream(*stream);

      if (written == contentLength) {
        Serial.println("✅ Firmware written successfully!");
      } else {
        Serial.printf("⚠️ Written only %d/%d bytes\n", written, contentLength);
      }

      if (Update.end()) {
        if (Update.isFinished()) {
          Serial.println("🎉 OTA complete! Rebooting...");
          ESP.restart();
        } else {
          Serial.println("⚠️ OTA failed: not finished.");
        }
      } else {
        Serial.printf("❌ OTA Error: %s\n", Update.errorString());
      }
    } else {
      Serial.println("❌ Not enough space for OTA update!");
    }
  } else {
    Serial.printf("❌ Failed to download firmware (HTTP %d)\n", httpCode);
  }
  http.end();
}

/**
 * @brief Checks online repository to fetch if firmware version updates exist.
 */
void checkForUpdate() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi not connected — skipping OTA update check");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  
  String url = String(version_url) + "?action=check_update&device_id=" + String(DEVICE_ID_DEFAULT);
  Serial.print("🌐 Checking update URL: ");
  Serial.println(url);

  http.begin(client, url);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    Serial.println("Received version info:");
    Serial.println(payload);

    DynamicJsonDocument doc(512);
    DeserializationError error = deserializeJson(doc, payload);
    if (error) {
      Serial.println("❌ Failed to parse JSON");
      return;
    }

    String newVersion = doc["version"];
    String firmwareURL = doc["firmware_url"];

    Serial.printf("Current version: %s | Available: %s\n", CURRENT_VERSION, newVersion.c_str());

    if (newVersion != CURRENT_VERSION) {
      Serial.println("⬆️ New version found! Starting OTA...");
      performOTA(firmwareURL);
    } else {
      Serial.println("✅ Already up to date.");
    }
  } else {
    Serial.printf("❌ Failed to fetch version info (HTTP %d)\n", httpCode);
  }
  http.end();
}


/* ========================================================================== */
/* SECTION 10: ARDUINO LIFECYCLE                                              */
/* ========================================================================== */

/**
 * @brief Arduino hardware and peripheral initialization setup block.
 */
void setup() {
  pinMode(PIN_POWER_SHUTDOWN, OUTPUT);
  digitalWrite(PIN_POWER_SHUTDOWN, HIGH);

  Serial.begin(115200);
  delay(200);
  Serial.println("DEBUG: ESP32 restarted / setup() started");

  Serial1.begin(115200, SERIAL_8N1, PIN_DWIN_RX, PIN_DWIN_TX);

  initFRAM();

  pin_mode_init();
  blue();

#if STORE == 1
  if (framReadString(DEVICE_ID_ADDR).length() == 0) framWriteString(DEVICE_ID_ADDR, DEVICE_ID_DEFAULT);
  if (framReadString(GOOGLE_SCRIPT_ID_ADDR).length() == 0) framWriteString(GOOGLE_SCRIPT_ID_ADDR, "AKfycbyzUMwCe_J7fs8P5F4ZLIReJeYMnY2enANEse9VsTQusTOzp6G2erAMw4gILTaSdx1NHg");
  if (framReadString(DEVICE_NAME_ADD).length() == 0) framWriteString(DEVICE_NAME_ADD, DEVICE_NAME_DEFAULT);
  if (framReadString(unit_name_add).length() == 0) framWriteString(unit_name_add, "RIPPLE");
  if (framReadString(operator_name_add).length() == 0) framWriteString(operator_name_add, "IFRAN");
  if (framReadString(PART_NAME_ADD_ADDR).length() == 0) framWriteString(PART_NAME_ADD_ADDR, "T-light candle");
#endif

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer1, ntpServer2, ntpServer3);

  upload_state = framRead8(up_state_add);
  part_run_count = framRead8(PART_RUN_CNT_ADDR);
  device_id = framReadString(DEVICE_ID_ADDR);
  device_name = framReadString(DEVICE_NAME_ADD);
  if (device_id != DEVICE_ID_DEFAULT || device_name != DEVICE_NAME_DEFAULT) {
    device_id = DEVICE_ID_DEFAULT;
    device_name = DEVICE_NAME_DEFAULT;
    framWriteString(DEVICE_ID_ADDR, device_id);
    framWriteString(DEVICE_NAME_ADD, device_name);
  }

  sprintf(client_name, "CB_%s", device_id.c_str());
  GOOGLE_SCRIPT_ID = framReadString(GOOGLE_SCRIPT_ID_ADDR);
  unit_name = framReadString(unit_name_add);
  if (unit_name.length() == 0 || unit_name == "") {
    unit_name = "RIPPLE";
  }

  qty_per_pouch = framRead8(POUCH_QTY_ADDR);
  if (qty_per_pouch == 0 || qty_per_pouch == 255) {
    qty_per_pouch = 10;
  }
  Serial.printf("⚙ Loaded qty_per_pouch from FRAM: %d\n", qty_per_pouch);

  box_pouch_qty = framRead8(POUCH_QTY_ADDR);
  if (box_pouch_qty == 0 || box_pouch_qty == 255) {
    box_pouch_qty = 10;
  }
  box_inner_qty = framRead8(INNER_QTY_ADDR);
  if (box_inner_qty == 0 || box_inner_qty == 255) {
    box_inner_qty = 1;
  }
  box_outer_qty = framRead8(OUTER_QTY_ADDR);
  if (box_outer_qty == 0 || box_outer_qty == 255) {
    box_outer_qty = 1;
  }
  Serial.printf("⚙ Loaded box config from FRAM: pouch=%d, inner=%d, outer=%d\n", box_pouch_qty, box_inner_qty, box_outer_qty);

  if (framRead8(shift_data_update) == 1) {
    is_shift_data_updated = true;
    unit_name = framReadString(unit_name_add);
    operator_name = framReadString(operator_name_add);
    maintenance_name = framReadString(maintenance_name_add);
    shift = framReadString(shift_add);
    part_name = framReadString(PART_NAME_ADD_ADDR);
    if (part_name.length() == 0 || part_name == "") {
      part_name = "T-light candle";
    }

    part_speed = framRead8(PART_SPEED_L_ADDR) | (framRead8(PART_SPEED_H_ADDR) << 8);
    Serial.println("⚙ Restored part speed: " + String(part_speed));

    uint16_t loss_raw = framRead8(SHIFT_LOSS_L_ADDR) | (framRead8(SHIFT_LOSS_H_ADDR) << 8);
    shift_change_loss_mins = loss_raw / 10.0f;

    uint16_t item_raw = framRead8(ITEM_CO_L_ADDR) | (framRead8(ITEM_CO_H_ADDR) << 8);
    item_changeover_mins = item_raw / 10.0f;

    Serial.println("🔁 Restored item changeover loss: " + String(item_changeover_mins, 1) + " mins");
    Serial.println("🔁 Restored shift change loss: " + String(shift_change_loss_mins, 2) + " mins");

    item_change_active = (framRead8(ITEM_CHANGE_ACTIVE_ADDR) == 1);
    framReadArray(ITEM_CHANGE_START_ADDR, (uint8_t *)&item_change_start_time, sizeof(item_change_start_time));

    if (item_change_active) {
      Serial.println("🔁 Restored active item changeover from FRAM");
    }

    bd_millis = millis();
    bd_shift_millis = millis();
    working_millis = millis();
    working_shift_millis = millis();
    state_start_millis = millis();

    eeprom_read3();
  } else {
    is_shift_data_updated = false;
  }

  // Restore station operators from FRAM if they exist, fallback to global operator_name
  {
    String op1 = framReadString(STATION1_OP_ADDR);
    if (op1.length() > 0) {
      station_operators[0] = op1;
    } else {
      station_operators[0] = operator_name;
    }
    station_working_mins[0] = 0.0f;
    station_breakdown_mins[0] = 0.0f;

#if MAX_STATIONS >= 2
    String op2 = framReadString(STATION2_OP_ADDR);
    if (op2.length() > 0) {
      station_operators[1] = op2;
    } else {
      station_operators[1] = operator_name;
    }
    station_working_mins[1] = 0.0f;
    station_breakdown_mins[1] = 0.0f;
#endif

#if MAX_STATIONS >= 3
    String op3 = framReadString(STATION3_OP_ADDR);
    if (op3.length() > 0) {
      station_operators[2] = op3;
    } else {
      station_operators[2] = operator_name;
    }
    station_working_mins[2] = 0.0f;
    station_breakdown_mins[2] = 0.0f;
#endif
  }

  wifi_connect();

  Serial.println(" Device ID Loaded: " + device_id);
  Serial.println(" scipt_id: " + GOOGLE_SCRIPT_ID);
  Serial.println(" device_name: " + device_name);
  Serial.println(" Part_name: " + part_name);

  if (WiFi.status() == WL_CONNECTED) {
    showNotification("Checking for Updates...");
    checkForUpdate();

    showNotification("Syncing NTP Time...");
    static uint8_t ntpFailCount = 0;
    while (!getLocalTime(&timeinfo)) {
      ntpFailCount++;
      Serial.printf("⚠️ NTP fail (%d)\n", ntpFailCount);

      if (ntpFailCount > 15) {
        showNotification("NTP Sync Failed\nRestarting Device...");
        Serial.println("❌ NTP timeout, restarting...");
        delay(2000);
        ESP.restart();
      }
      delay(1000);
    }

    ntpFailCount = 0;
    Serial.println("✅ Time synced successfully");
    mqtt.publish(topic_out, "Time synced successfully");
    showNotification("Time Synced\nSystem Ready");
    delay(1500);
    dwinSwitchPage(1); // Return to Menu
  } else {
    showNotification("Offline Mode\nSystem Ready");
    delay(2000);
    dwinSwitchPage(1); // Return to Menu
  }

  bool is_time_valid = (timeinfo.tm_year > 120);

  if (is_time_valid) {
    tvals[0] = timeinfo.tm_mday;
    day_val = framRead8(day_add);

    if (day_val == tvals[0]) {
      is_day_change = false;
    } else {
      is_day_change = true;
    }
  } else {
    is_day_change = false;
  }

  Serial.println(unit_name);
  Serial.println(operator_name);
  Serial.println(maintenance_name);
  Serial.println(shift);
  Serial.println(part_name);

  if (upload_state == 0) {
    eeprom_read2();
    data_fetch();
    sense = 0;
    last_seen_sense = 0;
    last_pulse_time = millis() - 6000;
  }

  if (is_time_valid) {
    char buf[10];
    int totalMinutes = timeinfo.tm_hour * 60 + timeinfo.tm_min;

    int A_start = 6 * 60 + 00;
    int A_end = 14 * 60 + 00;
    int B_start = 14 * 60 + 00;
    int B_end = 22 * 60 + 00;

    if (totalMinutes >= A_start && totalMinutes < A_end) {
      sprintf(buf, "Shift_A");
    } else if (totalMinutes >= B_start && totalMinutes < B_end) {
      sprintf(buf, "Shift_B");
    } else {
      sprintf(buf, "Shift_C");
    }

    String shift_temp = String(buf);
    if (is_general_shift) {
      shift_temp = "General_Shift";
    }

    if ((is_shift_data_updated == true) &&
        ((shift != shift_temp) ||
         ((shift == shift_temp) && (is_day_change == true)))) {
      Serial.println("Reboot shift reset triggered! Stored Shift: " + shift + ", Calculated: " + shift_temp + ", DayChange: " + String(is_day_change));
      is_shift_data_updated = false;
      shift_reset();
    }
  }
  mqtt.setServer(mqtt_broker, mqtt_port);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(2048);

  startWebServer();
  updateBreakdownPage(1);
  updateShiftStartPage(1);
  updateUnitSettingPage(1);

  // Initialize Telnet Server and ArduinoOTA
  telnetServer.begin();
  telnetServer.setNoDelay(true);
  ArduinoOTA.setHostname(device_name.c_str());
  ArduinoOTA.setPassword("admin");
  ArduinoOTA.begin();

  last_seen_sense = sense;
  for (int i = 0; i < MAX_STATIONS; i++) {
    last_seen_counts[i] = station_counts[i];
  }
  last_pulse_time = millis() - (STATION_INACTIVITY_LIMIT + 1000);
}

/**
 * @brief Arduino main loop execution context.
 */
void loop() {
  ArduinoOTA.handle();

  // Handle incoming Telnet logging client connections
  if (telnetServer.hasClient()) {
    if (!telnetClient || !telnetClient.connected()) {
      if (telnetClient) telnetClient.stop();
      telnetClient = telnetServer.available();
      telnetClient.println("Welcome to IOT Smart Counter Wireless Logs!");
    } else {
      telnetServer.available().stop(); // Reject additional clients
    }
  }

  trackNetworkStatus();
  parseDWIN();
  server.handleClient();

  computeLiveShiftTime();

  if (wa_shift_pending && WiFi.status() == WL_CONNECTED &&
      millis() - wa_trigger_time > 3000) {

#if ENABLE_WHATSAPP == 1
    Serial.println("📤 Sending delayed shift WhatsApp");
    String wa_msg = buildWhatsAppMessage(shiftSummary);
    sendWhatsAppMessage(wa_msg);
#endif

#if ENABLE_TELEGRAM == 1
    Serial.println("📤 Sending delayed shift Telegram");
    String tel_msg = buildWhatsAppMessage(shiftSummary);
    sendTelegramMessage(tel_msg);
#endif

    wa_shift_pending = false;
  }

  ensureWiFi();
  ensureMQTT();

  if (mqtt.connected()) {
    mqtt.loop();
  }

  if (reset_flag == 0) {
    time_t now_t = time(nullptr);
    localtime_r(&now_t, &timeinfo);

    day_val = timeinfo.tm_mday;
    char buf_date[11];

    snprintf(buf_date, sizeof(buf_date), "%04d-%02d-%02d",
             timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday);

    dateStr = String(buf_date);
    Time = String(timeinfo.tm_hour) + ":" + String(timeinfo.tm_min) + ":" + String(timeinfo.tm_sec);

    tvals[7] = timeinfo.tm_hour;
    tvals[8] = timeinfo.tm_min;
    tvals[9] = timeinfo.tm_sec;
    char t1_buf[6];
    snprintf(t1_buf, sizeof(t1_buf), "%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min);
    Time1 = String(t1_buf);
    current_date = dateStr;

    if (shift_data_requested_activated_flag == 1) {
      char buf2[50];
      if (is_general_shift) {
        sprintf(buf2, "General_Shift");
      } else {
        int totalMinutes = timeinfo.tm_hour * 60 + timeinfo.tm_min;
        int A_start = 6 * 60 + 00;
        int A_end = 14 * 60 + 00;
        int B_start = 14 * 60 + 00;
        int B_end = 22 * 60 + 00;

        if (totalMinutes >= A_start && totalMinutes < A_end) {
          sprintf(buf2, "Shift_A");
        } else if (totalMinutes >= B_start && totalMinutes < B_end) {
          sprintf(buf2, "Shift_B");
        } else {
          sprintf(buf2, "Shift_C");
        }
      }

      String new_shift_name = String(buf2);
      bool is_new_shift_started = (shift != new_shift_name);
      shift = new_shift_name;

      Serial.println(shift);
      shift_update_received = 1;
      current_log_sl_no = 0;
      main_start_time = Time + "_";
      tvals[1] = timeinfo.tm_hour;
      tvals[2] = timeinfo.tm_min;
      tvals[3] = timeinfo.tm_sec;
      framWrite8(main_start_time_add1, tvals[1]);
      framWrite8(main_start_time_add2, tvals[2]);
      framWrite8(main_start_time_add3, tvals[3]);
      framWriteString(PART_NAME_ADD_ADDR, part_name);

      total_working_hrs = 0;
      total_bd_hrs = 0;
      total_count = 0;
      bd_count = 0;
      sense = 0;
      last_seen_sense = 0;
      for (int i = 0; i < MAX_STATIONS; i++) {
        last_seen_counts[i] = 0;
      }
      last_pulse_time = millis() - (STATION_INACTIVITY_LIMIT + 1000);
      shift_count = 0;

      base_working_shift_mins = 0.0f;
      base_bd_shift_mins = 0.0f;
      total_working_shift_mins = 0.0f;
      total_bd_shift_mins = 0.0f;

      if (is_new_shift_started) {
        part_run_count = 0;
        item_changeover_mins = 0.0f;
        item_change_active = false;
        item_change_start_time = 0;

        framWrite8(PART_RUN_CNT_ADDR, 0);
        framWrite8(ITEM_CO_L_ADDR, 0);
        framWrite8(ITEM_CO_H_ADDR, 0);
      }

      bd_millis = millis();
      bd_shift_millis = millis();
      is_major_bd = false;
      is_min_bd = false;
      last_machine_state = motor1_status;
      state_start_millis = millis();
      storeShiftTimeToFRAM();

      if (shift_change_active) {
        shift_change_loss_mins += (millis() - shift_change_start_millis) / 60000.0f;
        shift_change_active = false;
        Serial.println("⏱ Shift Change Loss Captured: " + String(shift_change_loss_mins, 1) + " mins");
        uint16_t loss_store = (uint16_t)(shift_change_loss_mins * 10.0f + 0.5f);
        framWrite8(SHIFT_LOSS_L_ADDR, loss_store & 0xFF);
        framWrite8(SHIFT_LOSS_H_ADDR, loss_store >> 8);
      }

      is_shift_data_updated = true;
      shift_to_sheet = false;
      shift_data_requested_activated_flag = 0;
    }

    if (bd_reason_data_requested_activated_flag == 1) {
      is_bd_reason_updated = true;
      is_major_bd = false;
      is_min_bd = false;
      bd_millis = millis();
      bd_time = 0;
    }

    if (is_bd_reason_updated == true) {
      data_fetch();
    }

    bool start_flag = false;
    if ((is_shift_data_updated == true) &&
        ((is_major_bd == false) || (is_bd_reason_updated == true))) {
      digitalWrite(DEVICE_STATE_OUT, HIGH);
      start_flag = 1;
    } else if ((is_major_bd == true) || (is_shift_data_updated == false)) {
      digitalWrite(DEVICE_STATE_OUT, LOW);
      start_flag = 0;
    }

    if (is_shift_data_updated == false) {
      blue_blink();
      if (!shift_change_active) {
        shift_change_active = true;
        shift_change_start_millis = millis();
      }
      working_millis = millis();
      working_shift_millis = millis();
      bd_shift_millis = millis();
      start_millis1 = millis();
      stop_millis = millis();
    }

    bool is_shift_end_time = false;
    if (is_general_shift) {
      if (Time1 == "17:30") {
        is_shift_end_time = true;
      }
    } else {
      if ((Time1 == shift1) || (Time1 == shift2) || (Time1 == shift3)) {
        is_shift_end_time = true;
      }
    }

    if (is_shift_end_time && (shift_to_sheet == false) && (is_shift_data_updated == true)) {
      if (!is_shift_completed) {
        is_shift_completed = true;
        dwinSwitchPage(7);
      }
      digitalWrite(DEVICE_STATE_OUT, LOW);
    }

    if ((is_shift_completed == true) && (is_wastage_updated == true) && (shift_to_sheet == false)) {
      purple_led();
      if (is_major_bd == true) {
        data_fetch();
        is_major_bd = false;
        bd_reason2 = "";
        spare_detail = "";
        sense = 0;
        last_seen_sense = 0;
        for (int i = 0; i < MAX_STATIONS; i++) {
          last_seen_counts[i] = 0;
        }
        last_pulse_time = millis() - (STATION_INACTIVITY_LIMIT + 1000);
        spare_qty = "";
        bd_remarks = "";
        upload_state = 1;
      }

      fetchShiftSummary();
      sendShiftSummary();

      String current_shift_label = getShiftLabelFromTime(timeinfo.tm_hour, timeinfo.tm_min);
      bool is_real_shift_change = (shift != current_shift_label) || (is_day_change == true);

      if (is_real_shift_change) {
        shift_reset();
      } else {
        run_reset();
      }

      off_led();
      is_shift_data_updated = false;
      framWrite8(shift_data_update, 0);
      is_shift_completed = false;
      is_wastage_updated = false;

    } else if ((is_shift_completed == true) && (is_wastage_updated == false)) {
      digitalWrite(DEVICE_STATE_OUT, LOW);
      green_blink();
    }

    // Track sensor pulse inactivity across all active stations
    bool any_count_changed = false;
    for (int i = 0; i < NUM_ACTUAL_STATIONS; i++) {
      if (station_counts[i] != last_seen_counts[i]) {
        last_seen_counts[i] = station_counts[i];
        any_count_changed = true;
      }
    }
    if (any_count_changed) {
      last_pulse_time = millis();
    }

    if (start_flag && (millis() - last_pulse_time < STATION_INACTIVITY_LIMIT)) {
      motor1_status = 1;
    } else {
      motor1_status = 0;
      button_count = 0;
      set_time_flag = 0;
      bd_reason = "sensor_idle_alarm";
    }
    
    if (motor1_status != last_machine_state) {
      updateShiftTime(motor1_status);
      storeShiftTimeToFRAM();
    }

    if ((motor1_status == 1) && (is_shift_data_updated == true) && (is_shift_completed == false)) {
      mqtt_enable = 1;
      green();
      upload_state = 0;
      bd_reason2 = "";

      total_working_hrs = total_working_hrs1 + ((millis() - working_millis) / 60000.0);
      total_bd_hrs1 = total_bd_hrs;
      bd_millis = millis();

      total_working_shift_hrs = total_working_shift_hrs1 + ((millis() - working_shift_millis) / 60000.00);
      total_bd_shift_hrs1 = total_bd_shift_hrs;
      bd_shift_millis = millis();

      if (start_time_fetch_flag == 1) {
        start_time_fetch_flag = 0;
      }

      if (data_pick == false) {
        if (first_start == false) {
          if (is_min_bd == true) {
            purple_led();
            data_fetch();
            bd_reason2 = "";
            spare_detail = "";
            sense = 0;
            last_seen_sense = 0;
            last_pulse_time = millis() - 6000;
            spare_qty = "";
            bd_remarks = "";
            upload_state = 1;
            off_led();
          }
        }

        shift_to_sheet = false;
        start_millis1 = millis();
        current_log_sl_no++;
        start_time = Time;
        tvals[4] = timeinfo.tm_hour;
        tvals[5] = timeinfo.tm_min;
        tvals[6] = timeinfo.tm_sec;

        Serial.println("machine_running");
        data_pick = true;
      }
    }

    if ((motor1_status == 0) && (is_shift_data_updated == true) && (is_shift_completed == false)) {
      if ((is_major_bd == false) || (is_bd_reason_updated == true)) {
        red();
      }
      is_machine_running = false;

      total_working_hrs1 = total_working_hrs;
      working_millis = millis();
      total_bd_hrs = total_bd_hrs1 + ((millis() - bd_millis) / 60000.00);

      total_working_shift_hrs1 = total_working_shift_hrs;
      working_shift_millis = millis();
      total_bd_shift_hrs = total_bd_shift_hrs1 + ((millis() - bd_shift_millis) / 60000.0);

      bd_time = ((millis() - bd_millis) / 60000.00);
      if ((bd_time >= bd_min_set)) {
        is_min_bd = true;
      }
      if ((bd_time >= bd_major_set)) {
        if (is_major_bd == false) {
          is_major_bd = true;
          showNotification("MAJOR BD! PLEASE UPDATE REASON");
          delay(5000);
          dwinSwitchPage(3);
          updateBreakdownPage(1);
        }
      }

      if ((is_major_bd == true) && (is_bd_reason_updated == false)) {
        red_blink();
      }

      if (data_pick == true) {
        stop_time = Time;
        running_time = (millis() - start_millis1) / 60000;
        main_start_time_with_sl = main_start_time + String(bd_count);
        first_start = false;
        Serial.println("machine_off");
        data_pick = false;
      } else {
        if (stop_time == "" || stop_time == "0:0:0") {
          stop_time = Time;
        }
      }
    }
  }
  
  if (reset_flag == 1) {
    data_fetch1();
    Serial.println(shift);
    Serial.println(shift_temp);
    shift_to_sheet = true;
    shift_update_received = 1;
    is_shift_data_updated = false;
    shift_reset();
    eeprom_store();
    ESP.restart();
  }

  if (is_shift_data_updated == false) {
    machine_state = "WAIT";
  } else if (motor1_status == 1) {
    machine_state = "On";
  } else if ((motor1_status == 0) && (is_major_bd == true)) {
    machine_state = "major_BD";
  } else if ((motor1_status == 0) && (is_min_bd == true)) {
    machine_state = "minor_bd";
  } else if (motor1_status == 0) {
    machine_state = "Off";
  }

  static unsigned long last_sec_tick = 0;
  if (millis() - last_sec_tick >= 1000) {
    float elapsed_mins = (millis() - last_sec_tick) / 60000.0f;
    last_sec_tick = millis();
    if (is_shift_data_updated && !is_shift_completed) {
      for (int i = 0; i < MAX_STATIONS; i++) {
        bool is_st_running = (millis() - last_pulse_time_st[i] < STATION_INACTIVITY_LIMIT);
        if (is_st_running) {
          station_working_mins[i] += elapsed_mins;
        } else {
          station_breakdown_mins[i] += elapsed_mins;
        }
      }
    }
  }

  send_mqtt();
  updateDWINDisplay();
  delay(5);
}