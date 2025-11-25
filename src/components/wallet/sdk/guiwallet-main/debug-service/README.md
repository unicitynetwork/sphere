# Unicity Debug Report Service

A microservice for collecting and analyzing debug reports from the Unicity Web GUI Wallet.

## Features

- **Automatic Report Collection**: Receives debug reports from wallets via HTTPS
- **Transaction Extraction**: Automatically extracts failed transactions from reports
- **Web Interface**: Browse and analyze debug reports through a web UI
- **Export Functionality**: Export transactions in wallet-compatible format
- **File System Storage**: Organized storage by date for easy management

## Installation

```bash
cd debug-service
npm install
```

## Running the Service

### Production Mode
```bash
npm start
# or
node server.js
```

### Development Mode (with auto-restart)
```bash
npm run dev
```

The service will start on port 3487 and be accessible at:
- API: `http://localhost:3487/api/`
- Web Interface: `http://localhost:3487/`

## Configuration

The service is configured to accept connections from:
- `file://` protocol (offline wallet)
- Any HTTPS origin
- The configured domain: `https://unicity-debug-report.dyndns.org:3487`

## API Endpoints

### Submit Report
`POST /api/submit-report`
- Receives debug reports from wallets
- Returns a unique report ID

### List Reports
`GET /api/reports`
- Returns list of all reports with metadata
- Sorted by timestamp (newest first)

### Get Report
`GET /api/report/:id`
- Returns full report data for a specific ID

### Extract Transactions
`GET /api/report/:id/transactions`
- Extracts all transactions from a report
- Returns transaction count and details

### Export Transactions
`GET /api/report/:id/export-transactions`
- Downloads transactions in wallet-compatible format
- Ready for import and broadcast

## Web Interface

The web interface provides:
- **Report List**: Browse all submitted reports
- **Search**: Filter reports by ID or date
- **Report Details**: View full debug sessions and logs
- **Transaction Viewer**: Inspect failed transactions
- **Export Options**: Download reports or transactions

## Storage Structure

Reports are stored in the file system:
```
reports/
├── index.json          # Report index for quick lookups
├── 2025-09-06/        # Date-based folders
│   ├── report1.json
│   └── report2.json
└── 2025-09-07/
    └── report3.json
```

## Security Features

- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS Protection**: Only allows specific origins
- **Content Security Policy**: Prevents XSS attacks
- **Compression**: Reduces bandwidth usage
- **Size Limits**: 10MB max report size

## Troubleshooting

### Port Already in Use
If port 3487 is already in use:
```bash
# Find process using port
lsof -i :3487
# Kill the process if needed
kill -9 <PID>
```

### Permission Issues
Ensure the service has write permissions:
```bash
mkdir -p reports
chmod 755 reports
```

### CORS Issues
The service is configured to accept requests from:
- Local file:// protocol (for offline wallet)
- HTTPS origins
- The specific debug report domain

## Integration with Wallet

The wallet integrates with this service through:
1. **Submit Button**: In the debug modal, users can click "Submit Report"
2. **Automatic Submission**: Sends report to the configured endpoint
3. **Fallback**: If submission fails, downloads report locally

## Viewing Reports

1. Open browser to `http://localhost:3487`
2. Click on any report to view details
3. Failed transactions can be:
   - Viewed with full hex data
   - Exported for manual broadcast
   - Copied to clipboard for testing

## Development

### Adding New Features
1. API endpoints go in `server.js`
2. Frontend code in `public/app.js`
3. Styles in `public/style.css`

### Testing
```bash
# Test submission endpoint
curl -X POST http://localhost:3487/api/submit-report \
  -H "Content-Type: application/json" \
  -d '{"sessions": [], "metadata": {"test": true}}'

# Get reports
curl http://localhost:3487/api/reports
```