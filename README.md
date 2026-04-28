Shopify Orders to Google Sheets Sync

Automated Shopify Orders sync into Google Sheets using Google Apps Script and the Shopify GraphQL API.

Designed for reliable reporting, dashboards, and attribution workflows — with proper handling of retries, rate limits, partial runs, and missed data.

Overview

This project pulls Shopify order data into Google Sheets and keeps it updated on a fixed schedule. It is built to solve real operational issues:

Missing late-night orders

Duplicate rows during re-syncs

API throttling failures

Script timeouts

Broken triggers

Inconsistent timestamps

The script handles all of this internally and keeps the sheet consistent over time.

What You Get

The script automatically generates and manages two sheets within your Google Spreadsheet:

1. Shopify Orders

A structured dataset at the order level, including:

Order Details: ID, number, and timestamps.

Financials: Gross, subtotal, discounts, tax, shipping, and refunds.

Customer Data: Email, lifetime spend, and order count.

Item Aggregation: SKU and quantity lists.

Discounts: Discount codes and allocation types.

Source Tracking: Shopify source and UTM parameters.

Journey Data: First-click and last-click journey attribution.

Conversion Metrics: Days to conversion.

Cart Attributes: Raw JSON cart attributes.

This dataset is structured to be immediately ready to plug into dashboards or analysis tools without additional data cleaning.

2. Orders_Log

An internal auditing sheet that tracks every execution run:

Sync start and completion times

Progress checkpoints

Flush events (database writes)

API throttling warnings

Errors and skipped rows

Backfill run details

This makes debugging and data validation straightforward.

Core Design

The script is built around three fundamental principles:

1. Safe Incremental Sync

The first execution pulls historical data starting from your defined START_DATE.

Subsequent runs only query updated orders.

Existing rows are updated in place; they are not duplicated.

2. No Data Loss

Fixes included to ensure absolute data integrity:

Smart Bookmarking: The sync bookmark only updates when new data is successfully found.

Overlap Windows: The sync window always overlaps slightly to catch edge cases.

Delayed Capture: Late or delayed unfulfilled orders are still captured.

Recovery Tools: Dedicated backfill function for manual recovery.

3. Resilient Execution

The system gracefully handles:

Shopify rate limits (HTTP 429 and GraphQL cost throttling).

Network transmission failures.

Partial executions due to Google Apps Script runtime limits.

Unexplained time-driven trigger disappearances.

How It Works

Builds the GraphQL query using strict timestamp filters.

Fetches orders iteratively, page-by-page.

Converts the nested JSON of each order into a flattened row format.

Matches existing rows in the sheet using the unique order_id.

Inserts new rows or applies batch updates to existing rows.

Periodically flushes memory to the Google Sheet to prevent data loss on crash.

Saves a pagination cursor if the execution approaches the Google Apps Script timeout limit.

Resumes seamlessly from the saved cursor on the subsequent run.

Setup Instructions

Step 1: Create a Google Sheet

Create a blank Google Sheet. This will serve as your database.

Step 2: Open Apps Script

In your Google Sheet, navigate to the top menu: Extensions > Apps Script. Paste the entire script provided into the editor.

Step 3: Configure Variables

Edit only the CONFIG block at the top of the script:

var CONFIG = {
  SHOP:             "your-store-name",
  ACCESS_TOKEN:     "your-token",
  API_VERSION:      "2026-01",
  SHEET_NAME:       "Shopify Orders",
  LOG_SHEET_NAME:   "Orders_Log",
  START_DATE:       "2022-01-01T00:00:00Z",
  TIMEZONE:         "America/New_York",
  BATCH_SIZE:       10,
  FLUSH_EVERY:      500,
  LINE_ITEMS_MAX:   50,
  DISCOUNT_APPS_MAX:5,
};


Important:

SHOP must only be the subdomain (e.g., use my-store, not my-store.myshopify.com).

ACCESS_TOKEN requires a Shopify Custom App Admin API token with the read_orders scope.

Step 4: Run Once Manually

From the Apps Script editor, run the function: syncShopifyOrders.
This will:

Create the required sheets.

Start the historical sync.

Initialize internal state properties.

Step 5: Authorize Application

Grant the required Google permissions when prompted by the authorization modal.

Step 6: Enable Auto Sync

Reload your Google Sheet.

Navigate to the newly created custom menu: Shopify Orders > Create 30-min Trigger.

The sync will now run automatically in the background.

Menu Functions

Accessible via the Shopify Orders menu in your Google Sheet:

Run Order Sync: Triggers a manual execution immediately.

Backfill Missed Orders: Used to recover orders in a specific historical window. To use this, edit BACKFILL_FROM and BACKFILL_TO directly in the code. It is safe to run multiple times as duplicates are handled.

Create 30-min Trigger: Installs the background automation.

Reset Sync Memory: Clears the saved state. The next run will start entirely fresh from your START_DATE.

View Configuration & Status: Displays the last sync time, current operational state, and your active configuration values.

Important Safeguards

Bookmark Protection

ORDER_LAST_SYNC is updated only if orders are successfully found. This prevents empty execution runs from artificially shifting the sync window forward and missing data.

Time Buffer

The sync never runs up to the exact "current time". It intentionally stays slightly behind to catch delayed server updates and processing lags on Shopify's end.

Timeout Handling

If the execution time approaches Google's 6-minute limit, the cursor is saved, data is flushed to the sheet, and the script terminates cleanly. The next scheduled run will resume automatically.

Trigger Recovery

If the automated Google trigger disappears (a known infrastructure issue), the script checks for its existence and recreates it automatically during the next manual run.

Technical Notes

Performance

BATCH_SIZE: Keep between 5 and 20 for optimal stability.

FLUSH_EVERY: Controls the sheet write frequency.

Note: Larger stores with heavy order volumes may need to lower batch sizes to prevent payload timeouts.

Data Structure Details

gross_price is calculated as subtotal + discounts.

Refunds are captured as a total refunded integer.

Shipping and tax are separated into their own columns.

The SKU list is aggregated into a single comma-separated string.

UTM fields are derived natively from Shopify's customerJourneySummary data.

When to Use This

This solution is highly recommended for:

Revenue dashboards and BI tools.

Marketing attribution tracking.

Customer lifetime value (LTV) analysis.

Discount and promotion tracking.

Automated order-level data exports.

Monthly accounting reporting.

Limitations

Standard Google Apps Script runtime and memory limits apply.

Extremely high-volume enterprise stores (10,000+ orders/day) should utilize a dedicated database (e.g., BigQuery) instead of Google Sheets.

Line items and discount applications are capped (configurable in CONFIG).

Execution depends on the uptime and availability of the Shopify API.

Security Protocol

NEVER COMMIT REAL CREDENTIALS TO VERSION CONTROL.

Before pushing this code to a public or shared GitHub repository, ensure you sanitize the CONFIG block:

  ACCESS_TOKEN: "YOUR_TOKEN",
  SHOP: "YOUR_STORE",


Never expose your API tokens, customer email lists, or internal business data.

Suggested Repository Structure

shopify-orders-google-sheets-sync/
│
├── README.md
├── Code.gs
├── LICENSE
└── screenshots/


Final Note

This is not a demonstration script. It is an enterprise-grade utility designed to run continuously without manual intervention, specifically built to handle real-world Shopify data anomalies over time. If configured correctly, it will operate silently and reliably in the background.

License

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
