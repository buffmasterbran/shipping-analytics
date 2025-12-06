# Quick Start Guide

## Prerequisites

- Node.js 18+ installed
- ShipStation API credentials (already configured in `.env.local`)

## Installation & Running

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm run dev
   ```

3. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Using the Dashboard

1. **Select a date range**:
   - Click "Today" or "Yesterday" for quick selection
   - Or use the date pickers to select a custom range and click "Apply"

2. **View the chart**:
   - The line chart shows shipments per hour for each user
   - Hover over data points to see detailed information
   - Each user has a different colored line

3. **Review summaries**:
   - Total shipments card shows the overall count
   - Active users card shows how many users have shipments
   - The table below shows breakdown by user with percentages

## Troubleshooting

### API Errors

If you see API errors:
- Verify your `SHIPSTATION_API_KEY` and `SHIPSTATION_API_SECRET` in `.env.local`
- Check that your ShipStation account has API access enabled
- Ensure the date range doesn't exceed your account's data retention period

### No Data Showing

- Try selecting a different date range
- Check the browser console for any errors
- Verify your ShipStation account has shipments in the selected date range

### Chart Not Rendering

- Ensure you have shipments data for the selected date range
- Check that users exist in your ShipStation account
- Verify the API is returning data correctly (check Network tab in browser dev tools)


