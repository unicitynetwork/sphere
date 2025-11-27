const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3487;
const REPORTS_DIR = path.join(__dirname, 'reports');
const SSL_DIR = path.join(__dirname, 'ssl');
const MAX_REPORT_SIZE = 10 * 1024 * 1024; // 10MB max

// Ensure reports directory exists
async function ensureReportsDir() {
    try {
        await fs.access(REPORTS_DIR);
    } catch {
        await fs.mkdir(REPORTS_DIR, { recursive: true });
    }
}

// Middleware with different CSP for wallet vs debug interface
app.use((req, res, next) => {
    // Use relaxed CSP for wallet to allow external connections
    if (req.path === '/wallet' || req.path === '/index.html') {
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    connectSrc: ["'self'", "wss:", "https:", "ws:", "http:"], // Allow all connections for wallet
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Wallet needs eval for crypto
                    scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
                    imgSrc: ["'self'", "data:", "https:"],
                    fontSrc: ["'self'", "data:"],
                    workerSrc: ["'self'", "blob:"],
                }
            }
        })(req, res, next);
    } else {
        // Strict CSP for debug interface
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    connectSrc: ["'self'"], // Only allow same-origin for debug interface
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers for debug UI
                    imgSrc: ["'self'", "data:"],
                }
            }
        })(req, res, next);
    }
});
app.use(compression());
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests from file:// protocol (offline wallet) and any https origin
        if (!origin || origin.startsWith('file://') || origin.startsWith('https://')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', apiLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Serve the wallet HTML for testing
app.get('/wallet', (req, res) => {
    const walletPath = path.join(__dirname, '..', 'index.html');
    if (fsSync.existsSync(walletPath)) {
        res.sendFile(walletPath);
    } else {
        res.status(404).send('Wallet file not found');
    }
});

// Serve wallet at root as well if explicitly requested
app.get('/index.html', (req, res) => {
    const walletPath = path.join(__dirname, '..', 'index.html');
    if (fsSync.existsSync(walletPath)) {
        res.sendFile(walletPath);
    } else {
        res.status(404).send('Wallet file not found');
    }
});

// Serve a simple favicon to avoid 404 errors
app.get('/favicon.ico', (req, res) => {
    // Create a simple 1x1 transparent favicon
    const favicon = Buffer.from(
        'AAABAAEAAQEAAAEAIAAwAAAAFgAAACgAAAABAAAAAgAAAAEAIAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAA////AA==',
        'base64'
    );
    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=604800'); // Cache for 1 week
    res.send(favicon);
});

// API endpoint to receive debug reports
app.post('/api/submit-report', async (req, res) => {
    try {
        const report = req.body;
        
        // Validate report structure
        if (!report || !report.sessions) {
            return res.status(400).json({ error: 'Invalid report format' });
        }
        
        // Generate unique ID for this report
        const reportId = uuidv4();
        const timestamp = new Date().toISOString();
        
        // Add metadata
        const enrichedReport = {
            id: reportId,
            receivedAt: timestamp,
            clientIp: req.ip,
            userAgent: req.headers['user-agent'],
            ...report,
            metadata: {
                ...report.metadata,
                serverReceivedAt: timestamp,
                reportId: reportId
            }
        };
        
        // Save to file system
        const dateFolder = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const reportDir = path.join(REPORTS_DIR, dateFolder);
        await fs.mkdir(reportDir, { recursive: true });
        
        const filename = `${timestamp.replace(/[:.]/g, '-')}_${reportId}.json`;
        const filepath = path.join(reportDir, filename);
        
        await fs.writeFile(filepath, JSON.stringify(enrichedReport, null, 2));
        
        // Create index entry
        await updateReportIndex(reportId, {
            id: reportId,
            timestamp: timestamp,
            filename: filename,
            folder: dateFolder,
            hasFailedTransactions: report.readyToImport && report.readyToImport.length > 0,
            transactionCount: report.readyToImport ? report.readyToImport.length : 0,
            sessionCount: report.sessions ? report.sessions.length : 0
        });
        
        console.log(`Report ${reportId} saved to ${filepath}`);
        
        res.json({
            success: true,
            reportId: reportId,
            message: 'Debug report received successfully',
            viewUrl: `/view/${reportId}`
        });
        
    } catch (error) {
        console.error('Error processing report:', error);
        res.status(500).json({ error: 'Failed to process report' });
    }
});

// Update report index for quick lookups
async function updateReportIndex(reportId, metadata) {
    const indexPath = path.join(REPORTS_DIR, 'index.json');
    let index = {};
    
    try {
        const indexData = await fs.readFile(indexPath, 'utf8');
        index = JSON.parse(indexData);
    } catch {
        // Index doesn't exist yet
    }
    
    index[reportId] = metadata;
    
    // Keep only last 1000 reports in index
    const entries = Object.entries(index);
    if (entries.length > 1000) {
        entries.sort((a, b) => b[1].timestamp.localeCompare(a[1].timestamp));
        index = Object.fromEntries(entries.slice(0, 1000));
    }
    
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

// API to get list of reports
app.get('/api/reports', async (req, res) => {
    try {
        const indexPath = path.join(REPORTS_DIR, 'index.json');
        let index = {};
        
        try {
            const indexData = await fs.readFile(indexPath, 'utf8');
            index = JSON.parse(indexData);
        } catch {
            // No reports yet
        }
        
        // Convert to array and sort by timestamp
        const reports = Object.values(index).sort((a, b) => 
            b.timestamp.localeCompare(a.timestamp)
        );
        
        res.json(reports);
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// API to get specific report
app.get('/api/report/:id', async (req, res) => {
    try {
        const reportId = req.params.id;
        
        // Get report metadata from index
        const indexPath = path.join(REPORTS_DIR, 'index.json');
        const indexData = await fs.readFile(indexPath, 'utf8');
        const index = JSON.parse(indexData);
        
        if (!index[reportId]) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const metadata = index[reportId];
        const filepath = path.join(REPORTS_DIR, metadata.folder, metadata.filename);
        
        const reportData = await fs.readFile(filepath, 'utf8');
        const report = JSON.parse(reportData);
        
        res.json(report);
    } catch (error) {
        console.error('Error fetching report:', error);
        res.status(500).json({ error: 'Failed to fetch report' });
    }
});

// API to extract all transactions from a report
app.get('/api/report/:id/transactions', async (req, res) => {
    try {
        const reportId = req.params.id;
        
        // Get report
        const indexPath = path.join(REPORTS_DIR, 'index.json');
        const indexData = await fs.readFile(indexPath, 'utf8');
        const index = JSON.parse(indexData);
        
        if (!index[reportId]) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const metadata = index[reportId];
        const filepath = path.join(REPORTS_DIR, metadata.folder, metadata.filename);
        const reportData = await fs.readFile(filepath, 'utf8');
        const report = JSON.parse(reportData);
        
        // Extract all transactions
        const transactions = [];
        
        // From readyToImport
        if (report.readyToImport) {
            report.readyToImport.forEach(tx => {
                transactions.push({
                    source: 'readyToImport',
                    ...tx
                });
            });
        }
        
        // From sessions
        if (report.sessions) {
            report.sessions.forEach(session => {
                if (session.extractedTransactions) {
                    session.extractedTransactions.forEach(tx => {
                        // Avoid duplicates
                        if (!transactions.find(t => t.txid === tx.txid)) {
                            transactions.push({
                                source: 'session',
                                sessionId: session.id,
                                ...tx
                            });
                        }
                    });
                }
            });
        }
        
        res.json({
            reportId: reportId,
            transactionCount: transactions.length,
            transactions: transactions
        });
        
    } catch (error) {
        console.error('Error extracting transactions:', error);
        res.status(500).json({ error: 'Failed to extract transactions' });
    }
});

// API to export transactions in wallet format
app.get('/api/report/:id/export-transactions', async (req, res) => {
    try {
        const reportId = req.params.id;
        
        // Get transactions
        const indexPath = path.join(REPORTS_DIR, 'index.json');
        const indexData = await fs.readFile(indexPath, 'utf8');
        const index = JSON.parse(indexData);
        
        if (!index[reportId]) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const metadata = index[reportId];
        const filepath = path.join(REPORTS_DIR, metadata.folder, metadata.filename);
        const reportData = await fs.readFile(filepath, 'utf8');
        const report = JSON.parse(reportData);
        
        // Extract unique transactions
        const transactionMap = new Map();
        
        if (report.readyToImport) {
            report.readyToImport.forEach(tx => {
                if (tx.hex && !transactionMap.has(tx.txid)) {
                    transactionMap.set(tx.txid, {
                        raw: tx.hex,
                        txid: tx.txid,
                        details: tx.details || null
                    });
                }
            });
        }
        
        // Format for wallet import
        const exportData = {
            network: 'alpha',
            transactions: Array.from(transactionMap.values()),
            timestamp: new Date().toISOString(),
            type: 'debug_export',
            description: `Transactions from debug report ${reportId}`,
            reportId: reportId
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="transactions-${reportId}.json"`);
        res.json(exportData);
        
    } catch (error) {
        console.error('Error exporting transactions:', error);
        res.status(500).json({ error: 'Failed to export transactions' });
    }
});

// Check for SSL certificates
function checkSSLCertificates() {
    // Check for common certificate file names
    const certNames = ['cert.pem', 'certificate.pem', 'fullchain.pem'];
    const keyNames = ['key.pem', 'privkey.pem', 'private.pem', 'privatekey.pem'];
    const caNames = ['ca.pem', 'chain.pem', 'intermediate.pem'];
    
    let certPath = null;
    let keyPath = null;
    let caPath = null;
    
    // Find certificate file
    for (const name of certNames) {
        const path_ = path.join(SSL_DIR, name);
        if (fsSync.existsSync(path_)) {
            certPath = path_;
            console.log(`Found certificate: ${name}`);
            break;
        }
    }
    
    // Find private key file
    for (const name of keyNames) {
        const path_ = path.join(SSL_DIR, name);
        if (fsSync.existsSync(path_)) {
            keyPath = path_;
            console.log(`Found private key: ${name}`);
            break;
        }
    }
    
    // Find CA/chain file (optional)
    for (const name of caNames) {
        const path_ = path.join(SSL_DIR, name);
        if (fsSync.existsSync(path_)) {
            caPath = path_;
            console.log(`Found CA/chain: ${name}`);
            break;
        }
    }
    
    try {
        if (certPath && keyPath) {
            const sslOptions = {
                cert: fsSync.readFileSync(certPath),
                key: fsSync.readFileSync(keyPath)
            };
            
            // Include CA certificate if it exists
            if (caPath) {
                sslOptions.ca = fsSync.readFileSync(caPath);
            }
            
            console.log('SSL certificates loaded successfully');
            return sslOptions;
        }
    } catch (error) {
        console.log('Error loading SSL certificates:', error.message);
    }
    
    return null;
}

// Start server
async function startServer() {
    await ensureReportsDir();
    
    const sslOptions = checkSSLCertificates();
    
    if (sslOptions) {
        // Start HTTPS server
        https.createServer(sslOptions, app).listen(PORT, () => {
            console.log('========================================');
            console.log(`Debug Report Service (HTTPS) running on port ${PORT}`);
            console.log('========================================');
            console.log(`Reports will be saved to: ${REPORTS_DIR}`);
            console.log('');
            console.log('Available endpoints:');
            console.log(`  Debug Interface: https://localhost:${PORT}`);
            console.log(`  Wallet (Dev):    https://localhost:${PORT}/wallet`);
            console.log(`  API Endpoint:    https://unicity-debug-report.dyndns.org:${PORT}/api/submit-report`);
            console.log('========================================');
        });
        
        // Optionally also start HTTP server on different port for local access
        const HTTP_PORT = PORT + 1000; // 4487
        http.createServer(app).listen(HTTP_PORT, () => {
            console.log(`HTTP server also available on port ${HTTP_PORT}`);
            console.log(`  Debug Interface: http://localhost:${HTTP_PORT}`);
            console.log(`  Wallet (Dev):    http://localhost:${HTTP_PORT}/wallet`);
            console.log('========================================');
        });
    } else {
        // Fallback to HTTP only
        console.log('No SSL certificates found in ./ssl folder');
        console.log('Starting HTTP-only server...');
        
        http.createServer(app).listen(PORT, () => {
            console.log('========================================');
            console.log(`Debug Report Service (HTTP) running on port ${PORT}`);
            console.log('========================================');
            console.log(`Reports will be saved to: ${REPORTS_DIR}`);
            console.log('');
            console.log('Available endpoints:');
            console.log(`  Debug Interface: http://localhost:${PORT}`);
            console.log(`  Wallet (Dev):    http://localhost:${PORT}/wallet`);
            console.log('');
            console.log('To enable HTTPS, add certificate files to ./ssl folder:');
            console.log('  - cert.pem or fullchain.pem (Certificate)');
            console.log('  - key.pem or privkey.pem (Private key)');
            console.log('  - chain.pem or ca.pem (Optional: CA certificate)');
            console.log('========================================');
        });
    }
}

startServer().catch(console.error);