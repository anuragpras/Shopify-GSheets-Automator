# Shopify Orders → Google Sheets Sync (GraphQL Edition)

A high-performance, open-source Google Apps Script designed to synchronize Shopify order data into Google Sheets for advanced reporting, BI, and historical archiving.

This script uses the **Shopify GraphQL Admin API**, which allows for more efficient data fetching, deep marketing attribution capture, and better handling of large data sets compared to the older REST API.

---

## ✨ Features

- **🚀 High Performance**: Uses GraphQL to fetch only the fields you need, reducing payload size and execution time.
- **📈 Marketing Attribution**: Captures detailed UTM parameters (`source`, `medium`, `campaign`, etc.) and Customer Journey data (first/last visit).
- **🔄 Smart Syncing**: 
    - **Initial Backfill**: Pulls historical data from a custom start date.
    - **Incremental Updates**: Automatically picks up new and updated orders since the last successful run.
    - **Deduplication**: Maps Shopify IDs to spreadsheet rows to update existing records instead of creating duplicates.
- **🛡️ Resilience & Reliability**:
    - **Rate Limit Handling**: Automatically retries on HTTP 429 and GraphQL `THROTTLED` errors.
    - **Timeout Prevention**: Gracefully pauses and saves state if the script nears the Google Apps Script 6-minute execution limit.
    - **Concurrency Locking**: Prevents race conditions by ensuring only one sync instance runs at a time.
- **🤖 Self-Healing Automation**: Automatically monitors and recreates background triggers if they are accidentally removed.
- **📝 Detailed Logging**: Maintains an `Orders_Log` sheet for transparency on sync status, API costs, and errors.

---

## 🛠️ Installation & Setup

### 1. Create a Shopify Custom App
1. Log in to your Shopify Admin.
2. Navigate to **Settings** > **Apps and sales channels** > **Develop apps**.
3. Click **Create an app** and give it a name (e.g., "Google Sheets Sync").
4. Click **Configure Admin API scopes** and enable:
    - `read_orders`
    - `read_customers`
5. Click **Install app** and copy your **Admin API access token**.

### 2. Prepare the Google Sheet
1. Create a new Google Spreadsheet.
2. Go to **Extensions** > **Apps Script**.
3. Rename the default file to `Code.gs` and paste the provided script.
4. Update the `CONFIG` object at the top of the script:
    - `SHOP`: Your store subdomain (e.g., `my-store`).
    - `ACCESS_TOKEN`: Your Shopify API token.
    - `START_DATE`: The ISO date to start syncing from (e.g., `2023-01-01T00:00:00Z`).
    - `TIMEZONE`: Your local timezone (e.g., `America/Los_Angeles`).

### 3. Initialize the Sync
1. In the Apps Script editor, click **Save**.
2. Refresh your Google Spreadsheet.
3. You will see a new menu: **Shopify Orders**.
4. Run **Shopify Orders** > **⏰ Create 30-min Trigger**. (You'll need to authorize the script).
5. Run **Shopify Orders** > **▶ Run Order Sync** to start the first data pull.

---

## 📊 Data Column Reference

The script populates over 50 columns of data, grouped as follows:

| Group | Key Fields |
| :--- | :--- |
| **Order Info** | ID, Name, Created/Updated/Cancelled dates, Financial & Fulfillment status. |
| **Financials** | Gross Price, Subtotal, Total, Discounts, Taxes, Shipping, Refunded amounts. |
| **Customer** | Name, Email, Total orders, Lifetime spend, City, Country. |
| **Items** | Total item count, SKU list (comma-separated). |
| **Marketing** | UTM Source/Medium/Campaign, Referral URLs, Landing Pages (First & Last visit). |
| **Metadata** | Cart Attributes (JSON), Promo codes, Discount types, App source. |

---

## 🔧 Developer Guide & Logic

### Sync Logic (The "Fixed" Approach)
This script includes several critical fixes for common Apps Script sync issues:
1. **Drift Prevention**: The `ORDER_LAST_SYNC` bookmark only updates if the sync actually finds data. This prevents the "updated_at" window from moving forward during empty periods, ensuring no order is ever missed.
2. **The 30-Minute Gap**: We cap the sync bookmark at "current time minus 5-30 minutes." This accounts for the lag between an order being placed in Shopify and it becoming visible in the search index.
3. **Batch Writing**: Rows are buffered in memory and written in batches (defined by `FLUSH_EVERY`) to minimize the number of API calls to the Google Sheets service.

### Troubleshooting
- **Missing Data**: Check the `Orders_Log` sheet. If you see "TIMEOUT" or "PAUSED," the script will automatically resume on the next 30-minute trigger.
- **Authentication**: If you see 401 errors, your `ACCESS_TOKEN` is likely incorrect or expired.
- **Permissions**: Ensure the script has permission to "Connect to an external service" and "Manage your spreadsheets."

---

## 🤝 Contributing
Contributions are welcome! If you have suggestions for new data fields or performance improvements:
1. Fork the project.
2. Create your feature branch.
3. Submit a Pull Request with a clear description of the change.

## 📄 License
This project is licensed under the **MIT License**. Use it freely for your business or clients.
