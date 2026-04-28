/**
 * =============================================================================
 * SHOPIFY ORDERS → GOOGLE SHEETS  |  Google Apps Script
 * =============================================================================
 * 
 * This script provides a robust, automated way to sync Shopify order data into
 * Google Sheets for reporting, analysis, or backup.
 * 
 * KEY FEATURES:
 * - Real-time sync & historical backfill support.
 * - Marketing attribution (UTM parameters & customer journey).
 * - Self-healing automation (handles missing triggers).
 * - Resilience to API rate limits and script timeouts.
 * 
 * CORE FIXES INCLUDED:
 * 1. DRIFT PREVENTION: Sync bookmarks only update when data is found.
 * 2. RACE CONDITION FIX: Caps sync window at "now - 30m" to allow for Shopify lag.
 * 3. API COMPATIBILITY: Standardizes timestamps for Shopify's search filter.
 * 4. AUTO-RECOVERY: Recreates background triggers if they are accidentally deleted.
 * 
 * =============================================================================
 */


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global configuration object. 
 * Edit these values to connect your specific Shopify store and spreadsheet.
 */
var CONFIG = {
  // Your Shopify store subdomain (e.g., "my-store" for my-store.myshopify.com)
  SHOP:             "tear",
  
  // Your Shopify Admin API Access Token (requires read_orders, read_customers scopes)
  ACCESS_TOKEN:     "sh24",
  
  // Shopify API Version (recommended to use a stable version like 2024-04 or 2026-01)
  API_VERSION:      "2026-01",
  
  // The name of the tab where orders will be saved
  SHEET_NAME:       "Shopify Orders",
  
  // The name of the tab used for system logs
  LOG_SHEET_NAME:   "Orders_Log",
  
  // The earliest date to pull orders from on a fresh sync (ISO 8601 format)
  START_DATE:       "2022-01-01T00:00:00Z",
  
  // Timezone for formatting dates in the spreadsheet
  TIMEZONE:         "America/New_York",
  
  // Performance settings
  BATCH_SIZE:       10,    // Orders to pull per API request (max 250)
  FLUSH_EVERY:      500,   // Number of orders to buffer in memory before writing to sheet
  LINE_ITEMS_MAX:   50,    // Maximum number of line items to fetch per order
  DISCOUNT_APPS_MAX:5,     // Maximum number of discount codes to fetch per order
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: COLUMN HEADERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defines the order and naming of columns in the spreadsheet.
 * Note: If you change these, you must also update the buildRow() function.
 */
var HEADERS = [
  "order_id", "order_number",
  "created_at", "processed_at", "updated_at", "cancelled_at",
  "cancel_reason",
  "financial_status", "fulfillment_status",
  "payment_gateway", "currency",
  "tags", "order_note",
  "gross_price", "total_price", "subtotal_price",
  "current_total_price", "total_discounts", "total_tax",
  "shipping_price", "total_refunded",
  "customer_id", "email", "customer_full_name",
  "customer_orders_count", "customer_lifetime_spend",
  "customer_created_at", "shipping_city", "shipping_country",
  "total_items", "sku_list",
  "promo_code", "discount_type",
  "source_name",
  "last_click_landing_page", "referrer_url",
  "referring_platform", "traffic_type",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "first_click_landing_page", "first_click_referrer_url",
  "first_click_referring_platform", "first_click_traffic_type",
  "first_click_utm_source", "first_click_utm_medium",
  "first_click_utm_campaign", "first_click_utm_content", "first_click_utm_term",
  "days_to_conversion", "cart_attributes",
  "last_updated",
];


// =============================================================================
// SECTION 3: GRAPHQL QUERY
// =============================================================================

/**
 * Builds the GraphQL query used to fetch order data from Shopify.
 * 
 * @param {string} filterString - The search query for the orders connection.
 * @param {string|null} cursor - The pagination cursor for fetching subsequent pages.
 * @returns {string} The formatted GraphQL query string.
 */
function buildQuery(filterString, cursor) {
  var afterClause = cursor ? ', after: "' + cursor + '"' : "";
  
  // We use the GraphQL Admin API for more efficient data fetching and 
  // deep access to marketing attribution/customer journey data.
  return [
    "{",
    "  orders(first: " + CONFIG.BATCH_SIZE + ", sortKey: UPDATED_AT" + afterClause + ', query: "' + filterString + '") {',
    "    pageInfo { hasNextPage endCursor }",
    "    edges {",
    "      node {",
    "        id name createdAt processedAt updatedAt cancelledAt cancelReason",
    "        displayFinancialStatus displayFulfillmentStatus",
    "        tags note paymentGatewayNames",
    "        sourceName",
    "        subtotalPriceSet      { shopMoney { amount currencyCode } }",
    "        totalPriceSet         { shopMoney { amount } }",
    "        currentTotalPriceSet  { shopMoney { amount } }",
    "        totalTaxSet           { shopMoney { amount } }",
    "        totalDiscountsSet     { shopMoney { amount } }",
    "        totalShippingPriceSet { shopMoney { amount } }",
    "        totalRefundedSet      { shopMoney { amount } }",
    "        discountApplications(first: " + CONFIG.DISCOUNT_APPS_MAX + ") {",
    "          edges {",
    "            node {",
    "              ... on DiscountCodeApplication     { code allocationMethod }",
    "              ... on AutomaticDiscountApplication { title allocationMethod }",
    "              ... on ManualDiscountApplication    { title }",
    "            }",
    "          }",
    "        }",
    "        customer {",
    "          id email numberOfOrders createdAt firstName lastName",
    "          amountSpent { amount }",
    "          defaultAddress { city country }",
    "        }",
    "        customerJourneySummary {",
    "          daysToConversion",
    "          firstVisit {",
    "            sourceType source referrerUrl landingPage",
    "            utmParameters { source medium campaign term content }",
    "          }",
    "          lastVisit {",
    "            sourceType source referrerUrl landingPage",
    "            utmParameters { source medium campaign term content }",
    "          }",
    "        }",
    "        customAttributes { key value }",
    "        lineItems(first: " + CONFIG.LINE_ITEMS_MAX + ") {",
    "          edges { node { sku quantity } }",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
}


// =============================================================================
// SECTION 4: MAIN ENTRY POINT
// =============================================================================

/**
 * Primary function that orchestrates the sync process.
 * Usually triggered by a time-based trigger or manually from the menu.
 */
function syncShopifyOrders() {
  // Check for the trigger every time we run - self-healing automation.
  _ensureTriggerExists();

  // 1. Initial Validation
  try { _validateConfig(); } catch (e) {
    Logger.log("Config error: " + e.message);
    try { SpreadsheetApp.getUi().alert("⚠️ Configuration Error:\n\n" + e.message); } catch(ui) {}
    return;
  }

  // 2. Concurrency Lock
  // We use a script lock to prevent multiple instances from running at the same time,
  // which could lead to duplicate data or messy sheet writes.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("Sync aborted: another execution is already running.");
    return;
  }

  try {
    var executionStart = Date.now();
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var sheet    = _getOrCreateOrderSheet(ss);
    var logSheet = _getOrCreateLogSheet(ss);
    var props    = PropertiesService.getScriptProperties();
    var lastSync = props.getProperty("ORDER_LAST_SYNC");

    // Initialize headers if it's a fresh sheet
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length)
        .setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }

    // Load state from Properties Service (useful if the last run timed out)
    var cursor    = props.getProperty("ORDER_SYNC_CURSOR") || null;
    var filter    = props.getProperty("ORDER_SYNC_FILTER") || null;
    var syncStart = props.getProperty("ORDER_SYNC_START_TIME");

    if (!syncStart) {
      syncStart = new Date().toISOString();
      props.setProperty("ORDER_SYNC_START_TIME", syncStart);
    }

    // 3. Filter Construction
    if (!filter) {
      /**
       * FIX: We use a 45-minute overlap on the filter to account for orders
       * that might still be processing or "settling" in Shopify's backend.
       * We also strip milliseconds as the search API sometimes struggles with them.
       */
      var filterFrom = lastSync
        ? new Date(new Date(lastSync).getTime() - 45 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
        : CONFIG.START_DATE;
      
      filter = lastSync
        ? "status:any updated_at:>=" + filterFrom
        : "status:any created_at:>=" + filterFrom;
      
      props.setProperty("ORDER_SYNC_FILTER", filter);
    }

    _log(logSheet, "SYNC", "START", "filter=" + filter + (cursor ? " | RESUMED" : " | FRESH"));

    // 4. In-Memory Order Map
    // We map Order IDs to Row Numbers so we can update existing rows instead of creating duplicates.
    var existingOrders = _getExistingOrders(sheet);
    var newRows        = [];
    var updates        = [];
    var hasMore        = true;
    var totalProcessed = 0;
    var pageCount      = 0;
    var currentLastRow = sheet.getLastRow();
    var maxUpdatedAt   = lastSync || CONFIG.START_DATE;

    // 5. Main Fetch Loop
    while (hasMore) {

      // Check for impending timeout (Apps Script has a 6-minute limit)
      if (Date.now() - executionStart > 4.5 * 60 * 1000) {
        props.setProperty("ORDER_SYNC_CURSOR", cursor);
        _flushToSheet(sheet, newRows, updates);
        _log(logSheet, "SYNC", "PAUSED", "Processed: " + totalProcessed + " | cursor saved");
        try {
          SpreadsheetApp.getUi().alert("Paused to prevent timeout. Orders so far: " + totalProcessed);
        } catch(ui) {}
        return;
      }

      var query  = buildQuery(filter, cursor);
      var result = _gqlFetch(query, logSheet);
      var orders = result.orders;
      pageCount++;

      orders.edges.forEach(function(edge) {
        try {
          var row     = buildRow(edge.node);
          var orderId = row[0];

          // Keep track of the most recent "updated_at" timestamp for our next bookmark
          if (edge.node.updatedAt && edge.node.updatedAt > maxUpdatedAt) {
            maxUpdatedAt = edge.node.updatedAt;
          }

          if (existingOrders[orderId]) {
            updates.push({ rowNum: existingOrders[orderId], data: row });
          } else {
            newRows.push(row);
            existingOrders[orderId] = currentLastRow + newRows.length;
          }
          totalProcessed++;
        } catch (e) {
          _log(logSheet, "SYNC", "ROW_ERROR", "Skipped order: " + e.message);
        }
      });

      // Periodically flush data to the sheet to keep memory usage low
      if (newRows.length + updates.length >= CONFIG.FLUSH_EVERY) {
        _log(logSheet, "SYNC", "FLUSH", "Flushing at " + totalProcessed + " orders");
        _flushToSheet(sheet, newRows, updates);
        currentLastRow = sheet.getLastRow();
      }

      hasMore = orders.pageInfo.hasNextPage;
      cursor  = orders.pageInfo.endCursor;
      if (hasMore) Utilities.sleep(300); // Respect Shopify's API pace
    }

    // Final flush of remaining rows
    _flushToSheet(sheet, newRows, updates);

    // 6. Bookmarking Logic
    /**
     * FIX: We only update the bookmark if we actually processed data.
     * We also cap the bookmark at "now - 5 minutes" to ensure no orders
     * are skipped due to timestamp discrepancies between Google and Shopify servers.
     */
    if (totalProcessed > 0) {
      var candidateTime = new Date(maxUpdatedAt).getTime() - (2 * 60 * 1000);
      var cappedTime    = Date.now() - (5 * 60 * 1000);
      var finalTimeMs   = candidateTime < cappedTime ? candidateTime : cappedTime;
      var safeSync      = new Date(finalTimeMs).toISOString().replace(/\.\d{3}Z$/, "Z");
      
      props.setProperty("ORDER_LAST_SYNC", safeSync);
      _log(logSheet, "SYNC", "BOOKMARK", "ORDER_LAST_SYNC set to " + safeSync);
    } else {
      _log(logSheet, "SYNC", "BOOKMARK", "No orders found — bookmark unchanged.");
    }

    // Cleanup session properties
    props.deleteProperty("ORDER_SYNC_CURSOR");
    props.deleteProperty("ORDER_SYNC_FILTER");
    props.deleteProperty("ORDER_SYNC_START_TIME");

    _log(logSheet, "SYNC", "COMPLETE", "Total orders: " + totalProcessed);

    try {
      SpreadsheetApp.getUi().alert("✅ Order Sync Complete! Total: " + totalProcessed);
    } catch(ui) {}

  } finally {
    lock.releaseLock();
  }
}


// =============================================================================
// SECTION 4B: BACKFILL
// =============================================================================

/**
 * A manual recovery function for pulling orders in a specific date range.
 * Useful if you identify a gap in data or need to re-sync a specific day.
 */
function backfillMissedOrders() {
  try { _validateConfig(); } catch (e) {
    SpreadsheetApp.getUi().alert("⚠️ Config Error: " + e.message);
    return;
  }

  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var sheet    = _getOrCreateOrderSheet(ss);
  var logSheet = _getOrCreateLogSheet(ss);

  // MANUALLY EDIT THESE DATES AS NEEDED
  var BACKFILL_FROM = "2026-04-22T22:30:00Z";
  var BACKFILL_TO   = "2026-04-23T01:00:00Z";

  var filter = 'status:any created_at:>=' + BACKFILL_FROM + ' created_at:<=' + BACKFILL_TO;

  _log(logSheet, "BACKFILL", "START", "filter=" + filter);
  SpreadsheetApp.getUi().alert("⏳ Backfill started! Check the log for progress.");

  var existingOrders = _getExistingOrders(sheet);
  var newRows        = [];
  var updates        = [];
  var cursor         = null;
  var hasMore        = true;
  var totalProcessed = 0;
  var currentLastRow = sheet.getLastRow();
  var executionStart = Date.now();

  while (hasMore) {
    if (Date.now() - executionStart > 4.5 * 60 * 1000) {
      _flushToSheet(sheet, newRows, updates);
      _log(logSheet, "BACKFILL", "TIMEOUT", "Hit limit. Run again to continue.");
      return;
    }

    var query  = buildQuery(filter, cursor);
    var result = _gqlFetch(query, logSheet);
    var orders = result.orders;

    orders.edges.forEach(function(edge) {
      try {
        var row     = buildRow(edge.node);
        var orderId = row[0];
        if (existingOrders[orderId]) {
          updates.push({ rowNum: existingOrders[orderId], data: row });
        } else {
          newRows.push(row);
          existingOrders[orderId] = currentLastRow + newRows.length;
        }
        totalProcessed++;
      } catch (e) {
        _log(logSheet, "BACKFILL", "ROW_ERROR", "Skipped: " + e.message);
      }
    });

    hasMore = orders.pageInfo.hasNextPage;
    cursor  = orders.pageInfo.endCursor;
    if (hasMore) Utilities.sleep(300);
  }

  _flushToSheet(sheet, newRows, updates);
  _log(logSheet, "BACKFILL", "COMPLETE", "Recovered orders: " + totalProcessed);
}


// =============================================================================
// SECTION 5: API HANDLER (FETCH + RETRY + THROTTLE)
// =============================================================================

/**
 * Handles API communication with Shopify, including intelligent retries and
 * throttle management for both HTTP 429 and GraphQL 'THROTTLED' errors.
 * 
 * @param {string} query - The GraphQL query to execute.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} logSheet - Reference for logging.
 * @returns {object} The parsed data object from the API response.
 */
function _gqlFetch(query, logSheet) {
  var endpoint      = "https://" + CONFIG.SHOP + ".myshopify.com/admin/api/" + CONFIG.API_VERSION + "/graphql.json";
  var payload       = JSON.stringify({ query: query });
  var maxRetries    = 8;
  var lastError;
  var throttleCount = 0;

  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    var response;
    try {
      response = UrlFetchApp.fetch(endpoint, {
        method:             "post",
        contentType:        "application/json",
        headers:            { "X-Shopify-Access-Token": CONFIG.ACCESS_TOKEN },
        payload:            payload,
        muteHttpExceptions: true,
      });
    } catch (netErr) {
      lastError = netErr;
      if (attempt < maxRetries) Utilities.sleep(2000 * attempt);
      continue;
    }

    var status = response.getResponseCode();
    var body   = response.getContentText();

    // Handle standard Rate Limiting
    if (status === 429) {
      var hdrs       = response.getHeaders() || {};
      var retryAfter = parseInt(hdrs["Retry-After"] || hdrs["retry-after"] || "10", 10);
      _log(logSheet, "API", "429", "Rate limited — waiting " + retryAfter + "s");
      Utilities.sleep(retryAfter * 1000);
      continue;
    }

    if (status >= 500) {
      Utilities.sleep(2000 * attempt);
      continue;
    }

    if (status !== 200) {
      throw new Error("HTTP " + status + ": " + body.substring(0, 300));
    }

    var json;
    try { json = JSON.parse(body); }
    catch (e) { throw new Error("JSON parse failed"); }

    // Handle GraphQL-specific Throttling
    if (json.errors && json.errors.length > 0) {
      var throttled = null;
      for (var ei = 0; ei < json.errors.length; ei++) {
        var ext = json.errors[ei].extensions;
        if (ext && ext.code === "THROTTLED") { throttled = json.errors[ei]; break; }
      }

      if (throttled) {
        throttleCount++;
        if (throttleCount > 20) throw new Error("Too many throttle retries.");
        var resetAt = throttled.extensions && throttled.extensions.cost && throttled.extensions.cost.windowResetAt;
        var waitMs  = resetAt ? Math.max(new Date(resetAt).getTime() - Date.now() + 2000, 5000) : 20000;
        _log(logSheet, "API", "THROTTLED", "Sleeping " + Math.ceil(waitMs / 1000) + "s");
        Utilities.sleep(waitMs);
        attempt--; // Don't count throttling against our hard retry limit
        continue;
      }
      throw new Error("GraphQL error: " + JSON.stringify(json.errors));
    }

    // Proactive throttling check (based on remaining cost)
    var cost = json.extensions && json.extensions.cost;
    if (cost && cost.throttleStatus) {
      var available = cost.throttleStatus.currentlyAvailable || 0;
      var restoreRate = cost.throttleStatus.restoreRate || 50;
      var needed = cost.requestedQueryCost || 100;
      if (available < needed * 2) {
        var proactiveWait = Math.ceil((needed * 2 - available) / restoreRate) * 1000;
        Utilities.sleep(proactiveWait);
      }
    }

    return json.data;
  }

  throw lastError || new Error("API call failed after retries.");
}


// =============================================================================
// SECTION 6: DATA MAPPING
// =============================================================================

/**
 * Maps the raw GraphQL node into a flat array of values matching the HEADERS.
 * 
 * @param {object} node - The Shopify Order node.
 * @returns {Array} A flat array of data.
 */
function buildRow(node) {
  // --- Helper Helpers ---
  function getMoney(moneySet) {
    return (moneySet && moneySet.shopMoney) ? parseFloat(moneySet.shopMoney.amount) || 0 : 0;
  }
  function safeStr(v) { return (v === null || v === undefined) ? "" : String(v); }
  function safeVal(v) { return (v === null || v === undefined) ? "" : v; }
  function fmtDate(iso) {
    if (!iso) return "";
    try { return Utilities.formatDate(new Date(iso), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss"); }
    catch(e) { return ""; }
  }

  // --- De-nesting GraphQL Object ---
  var customer   = node.customer               || {};
  var address    = customer.defaultAddress     || {};
  var journey    = node.customerJourneySummary || {};
  var firstVisit = journey.firstVisit          || {};
  var lastVisit  = journey.lastVisit           || {};
  var firstUtm   = firstVisit.utmParameters    || {};
  var lastUtm    = lastVisit.utmParameters     || {};

  // --- Line Item Processing ---
  var lineItems = (node.lineItems && node.lineItems.edges) ? node.lineItems.edges.map(function(e) { return e.node; }) : [];
  var totalQuantity = lineItems.reduce(function(s, i) { return s + (i.quantity || 0); }, 0);
  var skuList = lineItems.map(function(i) { return safeStr(i.sku) || "No-SKU"; }).join(", ");

  // --- Discount Application Logic ---
  var discountNodes = (node.discountApplications && node.discountApplications.edges) ? node.discountApplications.edges.map(function(e) { return e.node; }) : [];
  var promoCodes = discountNodes.map(function(d) { return d.code || d.title || ""; }).filter(Boolean).join(", ");
  var discountTypes = discountNodes.map(function(d) { return d.allocationMethod || "MANUAL"; }).filter(Boolean).join(", ");

  // --- Metadata & Pricing ---
  var attrs = {};
  (node.customAttributes || []).forEach(function(a) { attrs[a.key] = a.value; });
  var cartAttrs = Object.keys(attrs).length ? JSON.stringify(attrs) : "";

  var subtotal   = getMoney(node.subtotalPriceSet);
  var discounts  = getMoney(node.totalDiscountsSet);
  var grossPrice = subtotal + discounts;
  var currency   = (node.subtotalPriceSet && node.subtotalPriceSet.shopMoney) ? safeStr(node.subtotalPriceSet.shopMoney.currencyCode) : "";

  var lifetimeSpend = customer.amountSpent ? parseFloat(customer.amountSpent.amount) || 0 : 0;
  var sourceName = safeStr(node.sourceName) || "web";
  var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");

  // MUST match the order of HEADERS
  return [
    safeStr(node.id).split("/").pop(), // Extract ID from GID
    safeStr(node.name),
    fmtDate(node.createdAt),
    fmtDate(node.processedAt),
    fmtDate(node.updatedAt),
    fmtDate(node.cancelledAt),
    safeStr(node.cancelReason),
    safeStr(node.displayFinancialStatus),
    safeStr(node.displayFulfillmentStatus),
    (node.paymentGatewayNames || []).join(", "),
    currency,
    Array.isArray(node.tags) ? node.tags.join(", ") : safeStr(node.tags),
    safeStr(node.note),
    grossPrice,
    getMoney(node.totalPriceSet),
    subtotal,
    getMoney(node.currentTotalPriceSet),
    discounts,
    getMoney(node.totalTaxSet),
    getMoney(node.totalShippingPriceSet),
    getMoney(node.totalRefundedSet),
    safeStr(customer.id).split("/").pop(),
    safeStr(customer.email),
    (safeStr(customer.firstName) + " " + safeStr(customer.lastName)).trim(),
    safeVal(customer.numberOfOrders),
    lifetimeSpend,
    fmtDate(customer.createdAt),
    safeStr(address.city),
    safeStr(address.country),
    totalQuantity,
    skuList,
    promoCodes,
    discountTypes,
    sourceName,
    safeStr(lastVisit.landingPage),
    safeStr(lastVisit.referrerUrl),
    safeStr(lastVisit.source),
    safeStr(lastVisit.sourceType),
    safeStr(lastUtm.source),
    safeStr(lastUtm.medium),
    safeStr(lastUtm.campaign),
    safeStr(lastUtm.content),
    safeStr(lastUtm.term),
    safeStr(firstVisit.landingPage),
    safeStr(firstVisit.referrerUrl),
    safeStr(firstVisit.source),
    safeStr(firstVisit.sourceType),
    safeStr(firstUtm.source),
    safeStr(firstUtm.medium),
    safeStr(firstUtm.campaign),
    safeStr(firstUtm.content),
    safeStr(firstUtm.term),
    safeVal(journey.daysToConversion),
    cartAttrs,
    now,
  ];
}


// =============================================================================
// SECTION 7: SHEET HELPERS
// =============================================================================

/**
 * Writes buffered rows to the sheet.
 */
function _flushToSheet(sheet, newRows, updates) {
  if (newRows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
    newRows.length = 0;
  }
  if (updates.length > 0) {
    _batchUpdate(sheet, updates);
    updates.length = 0;
  }
}

/**
 * Updates existing order rows efficiently.
 */
function _batchUpdate(sheet, updates) {
  if (updates.length === 0) return;
  updates.sort(function(a, b) { return a.rowNum - b.rowNum; });

  var gStart = updates[0].rowNum;
  var gRows  = [updates[0].data];

  for (var i = 1; i < updates.length; i++) {
    if (updates[i].rowNum === updates[i - 1].rowNum + 1) {
      gRows.push(updates[i].data);
    } else {
      sheet.getRange(gStart, 1, gRows.length, gRows[0].length).setValues(gRows);
      gStart = updates[i].rowNum;
      gRows  = [updates[i].data];
    }
  }
  sheet.getRange(gStart, 1, gRows.length, gRows[0].length).setValues(gRows);
}

/**
 * Scans the sheet for existing Order IDs to prevent duplicates.
 */
function _getExistingOrders(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var map = {};
  ids.forEach(function(row, i) {
    if (row[0]) map[String(row[0])] = i + 2;
  });
  return map;
}


// =============================================================================
// SECTION 8: INITIALIZATION
// =============================================================================

function _getOrCreateOrderSheet(ss) {
  var s = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!s) {
    s = ss.insertSheet(CONFIG.SHEET_NAME);
    s.getRange("A2:A").setNumberFormat("@");
  }
  return s;
}

function _getOrCreateLogSheet(ss) {
  var s = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!s) {
    s = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    var LOG_COLS = ["timestamp", "mode", "level", "message"];
    var r = s.getRange(1, 1, 1, LOG_COLS.length);
    r.setValues([LOG_COLS]);
    r.setBackground("#2d2d2d").setFontColor("#ffffff").setFontWeight("bold");
    s.setFrozenRows(1);
    s.setColumnWidth(1, 165);
    s.setColumnWidth(LOG_COLS.length, 520);
  }
  return s;
}


// =============================================================================
// SECTION 9: UTILS
// =============================================================================

function _validateConfig() {
  if (!CONFIG.SHOP || CONFIG.SHOP.trim() === "") throw new Error("SHOP subdomain missing");
  if (!CONFIG.ACCESS_TOKEN || CONFIG.ACCESS_TOKEN.length < 20) throw new Error("Invalid ACCESS_TOKEN");
  if (CONFIG.BATCH_SIZE < 1 || CONFIG.BATCH_SIZE > 250) throw new Error("Invalid BATCH_SIZE");
}

function _log(logSheet, mode, level, msg) {
  try {
    if (logSheet && typeof logSheet.appendRow === "function") {
      var ts = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
      logSheet.appendRow([ts, mode, level, msg]);
    }
    Logger.log("[" + mode + "][" + level + "] " + msg);
  } catch (e) {}
}

/**
 * Checks if the time-based trigger exists. Recreates it if not found.
 */
function _ensureTriggerExists() {
  var triggers = ScriptApp.getProjectTriggers();
  var found = triggers.some(function(t) { return t.getHandlerFunction() === "syncShopifyOrders"; });
  if (!found) {
    ScriptApp.newTrigger("syncShopifyOrders").timeBased().everyMinutes(30).create();
    Logger.log("Trigger restored.");
  }
}


// =============================================================================
// SECTION 10: USER INTERFACE
// =============================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Shopify Orders")
    .addItem("▶ Run Order Sync",                          "syncShopifyOrders")
    .addItem("🔁 Backfill Missed Orders",                 "backfillMissedOrders")
    .addItem("✖ Reset Sync Memory",                       "resetSync")
    .addSeparator()
    .addItem("⏰ Create 30-min Trigger",                  "createHourlyTrigger")
    .addSeparator()
    .addItem("ℹ View Config & Status",                    "showConfig")
    .addToUi();
}

function createHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "syncShopifyOrders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncShopifyOrders").timeBased().everyMinutes(30).create();
  SpreadsheetApp.getUi().alert("✅ 30-minute automation active.");
}

function resetSync() {
  var props = PropertiesService.getScriptProperties();
  ["ORDER_LAST_SYNC", "ORDER_SYNC_CURSOR", "ORDER_SYNC_FILTER", "ORDER_SYNC_START_TIME"].forEach(function(p) { props.deleteProperty(p); });
  SpreadsheetApp.getUi().alert("Sync state cleared. Next run will be a full backfill.");
}

function showConfig() {
  var props = PropertiesService.getScriptProperties();
  var lastSync = props.getProperty("ORDER_LAST_SYNC") || "Never run";
  var syncStatus = props.getProperty("ORDER_SYNC_CURSOR") ? "In-Progress (Paused)" : "Idle";

  var info = [
    "SHOP: " + CONFIG.SHOP,
    "API VERSION: " + CONFIG.API_VERSION,
    "START DATE: " + CONFIG.START_DATE,
    "LAST SYNC: " + lastSync,
    "STATUS: " + syncStatus,
    "TIMEZONE: " + CONFIG.TIMEZONE
  ];
  SpreadsheetApp.getUi().alert("Configuration Status\n\n" + info.join("\n"));
}
