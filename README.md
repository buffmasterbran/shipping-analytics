# PAWS Analytics - ShipStation Dashboard

A production-quality Next.js analytics dashboard for visualizing ShipStation shipments per hour by user.

## Features

- **Date Range Selection**: Choose today, yesterday, or custom date ranges
- **Hourly Shipment Visualization**: Interactive line chart showing shipments per hour broken down by user
- **User Comparison**: Compare shipments across different users
- **Numeric Summaries**: Total shipments, shipments per user, and percentage breakdowns
- **Modern UI**: Clean, responsive design with hover tooltips and smooth interactions

## Tech Stack

- **Next.js 14+** with App Router
- **TypeScript**
- **Tailwind CSS** for styling
- **Recharts** for data visualization
- **date-fns** and **date-fns-tz** for timezone handling

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   
   Copy `.env.example` to `.env.local` and update with your credentials:
   ```bash
   cp .env.example .env.local
   ```
   
   Then update `.env.local` with your actual values:
   ```
   SHIPSTATION_API_KEY=your_api_key_here
   SHIPSTATION_API_SECRET=your_api_secret_here
   SHIPSTATION_BASE_URL=https://ssapi.shipstation.com
   OPENAI_API_KEY=your_openai_api_key_here
   ```

   - ShipStation API credentials can be found in your ShipStation account under **Settings → API Settings**
   - OpenAI API key is optional but required for the Smart Analysis feature. Get one at [platform.openai.com](https://platform.openai.com/api-keys)

3. **Run the development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser**:
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── shipments/
│   │   │   └── hourly/route.ts    # API route for hourly shipment data
│   │   └── users/route.ts          # API route for user mappings
│   ├── globals.css                 # Global styles
│   ├── layout.tsx                  # Root layout
│   └── page.tsx                    # Main dashboard page
├── lib/
│   ├── aggregation.ts             # Data aggregation logic
│   └── shipstation.ts              # ShipStation API client
├── types/
│   └── shipstation.ts              # TypeScript type definitions
└── .env.local                      # Environment variables (not in git)
```

## API Endpoints

### `GET /api/shipments/hourly`

Fetches and aggregates shipments by hour and user.

**Query Parameters**:
- `startDate` (optional): Start date in `YYYY-MM-DD` format (defaults to today)
- `endDate` (optional): End date in `YYYY-MM-DD` format (defaults to today)

**Response**:
```json
{
  "startDate": "2025-12-06",
  "endDate": "2025-12-06",
  "timezone": "America/New_York",
  "series": [
    {
      "hour": "2025-12-06T14:00:00-05:00",
      "John Doe": 5,
      "Jane Smith": 3
    }
  ],
  "users": [
    {
      "userId": "123",
      "userName": "John Doe",
      "totalShipments": 45
    }
  ],
  "totals": {
    "totalShipments": 100
  }
}
```

### `GET /api/users`

Fetches all ShipStation users for name mapping.

**Response**:
```json
{
  "users": [
    {
      "userId": 123,
      "userName": "John Doe"
    }
  ],
  "userMap": {
    "123": "John Doe"
  }
}
```

## Data Processing

- All timestamps are converted to **America/New_York** timezone
- Shipments are grouped into hourly buckets
- User IDs are mapped to human-readable names via the ShipStation Users API
- The dashboard handles pagination automatically to fetch all shipments

## Development

- **Build for production**: `npm run build`
- **Start production server**: `npm start`
- **Run linter**: `npm run lint`

## Notes

- The dashboard is designed as an internal tool with a simple but clean UX
- All API calls use Basic Authentication with your ShipStation API credentials
- The ShipStation API is paginated; the app automatically fetches all pages
- Maximum page size is set to 500 records per request for optimal performance


