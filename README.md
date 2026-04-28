# Shopify Orders to Google Sheets Sync

A robust Google Apps Script for automated, hourly synchronization of Shopify orders into a Google Spreadsheet. This script uses the Shopify GraphQL Admin API for high performance and includes features like historical backfill, marketing attribution (UTM) tracking, and self-healing automation.

## 🚀 Key Features

- **Automated Hourly Sync**: Automatically fetches new and updated orders every 30 minutes.
- **Full Historical Backfill**: Ability to pull historical data starting from a custom date.
- **Marketing Attribution**: Captures UTM parameters (`source`, `medium`, `campaign`, etc.) and customer journey data (first/last visit).
- **Customer Insights**: Syncs customer lifetime spend, order counts, and geographic data.
- **Self-Healing Triggers**: Automatically recreates the background trigger if it's ever deleted.
- **Reliability & Performance**:
  - Handles Shopify API rate limiting (429 errors) and throttling.
  - Implements script locking to prevent concurrent execution conflicts.
  - Automatic pagination for large data sets.
  - Intelligent bookmarking to prevent data gaps or overlaps.
- **Detailed Logging**: Dedicated `Orders_Log` sheet to monitor sync status and debug errors.

## 🛠️ Setup Instructions

### 1. Shopify API Configuration
1. Go to your Shopify Admin -> **Settings** -> **Apps and sales channels**.
2. Click **Develop apps** -> **Create an app**.
3. Under **Configuration**, select **Admin API integration**.
4. Enable the following **Admin API scopes**:
   - `read_orders`
   - `read_customers` (optional, for enriched customer data)
5. Install the app and copy the **Admin API access token**.

### 2. Google Sheets Setup
1. Create a new Google Spreadsheet.
2. Go to **Extensions** -> **Apps Script**.
3. Delete any code in `Code.gs` and paste the provided script.
4. Update the `CONFIG` block at the top of the script:
   ```javascript
   var CONFIG = {
     SHOP:             "your-shop-subdomain", // e.g., "my-store" (not my-store.myshopify.com)
     ACCESS_TOKEN:     "shpat_xxxxxxxxxxxx", // Your Shopify Admin API Token
     API_VERSION:      "2026-01",            // Keep as is or update to latest
     SHEET_NAME:       "Shopify Orders",     // Destination sheet name
     LOG_SHEET_NAME:   "Orders_Log",         // Log sheet name
     START_DATE:       "2022-01-01T00:00:00Z", // Data start date
     TIMEZONE:         "America/New_York",   // Your timezone
     // ... other settings
   };
   ```
5. Click **Save** and then **Run** -> `onOpen` to initialize the menu.

### 3. Initialize the Sync
1. Refresh your Google Sheet. You should see a new **Shopify Orders** menu.
2. Select **Shopify Orders** -> **⏰ Create 30-min Trigger** to start automation.
3. Select **Shopify Orders** -> **▶ Run Order Sync** to perform the initial sync.

## 📋 Data Captured

The script populates columns including:
- **Order Details**: ID, Number, Dates (Created, Updated, Cancelled), Statuses.
- **Financials**: Gross Price, Total Price, Subtotal, Taxes, Discounts, Shipping, Refunds.
- **Customer**: ID, Email, Name, Order Count, Lifetime Spend, City, Country.
- **Items**: Total items, SKU list.
- **Marketing (UTM)**: Source, Medium, Campaign, Content, Term for both First and Last visits.
- **Journey**: Days to conversion, Landing page, Referrer URL, Cart attributes.

## 🔧 Maintenance & Utilities

The **Shopify Orders** menu provides several tools:
- **Run Order Sync**: Manually triggers a sync of the latest updates.
- **Backfill Missed Orders**: A special function to recover orders in a specific historical window (useful for fixing gaps).
- **Reset Sync Memory**: Clears the "last sync" bookmark so the next run starts fresh from your `START_DATE`.
- **View Configuration & Status**: Shows current settings and the timestamp of the last successful sync.

## 🛡️ Applied Fixes (Change Log)

1. **Stop Backwards Drift**: The sync bookmark only updates when orders are actually found, preventing the pointer from moving forward during empty intervals.
2. **Stop Leapfrogging**: Caps the sync bookmark at "now - 30 minutes" to ensure late-processing Shopify orders are never skipped.
3. **Millisecond Hygiene**: Strips milliseconds from Shopify filter strings to comply with API search requirements.
4. **Self-Healing Trigger**: The script checks for the existence of its own automation trigger every time it runs manually, recreating it if missing.

## ⚖️ License
MIT License. Use this script freely for your own Shopify store or for clients.
