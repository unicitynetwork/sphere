// Debug Report Viewer Application
let currentReports = [];
let currentReportId = null;
let currentReportData = null;

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    loadReports();
    setupEventListeners();
    
    // Auto-refresh every 30 seconds
    setInterval(loadReports, 30000);
});

// Setup event listeners
function setupEventListeners() {
    document.getElementById('refresh-btn').addEventListener('click', loadReports);
    document.getElementById('search-box').addEventListener('input', filterReports);
    document.getElementById('export-json-btn').addEventListener('click', exportJSON);
    document.getElementById('export-transactions-btn').addEventListener('click', exportTransactions);
    document.getElementById('copy-report-id-btn').addEventListener('click', copyReportId);
    document.getElementById('copy-hex-btn').addEventListener('click', copyTransactionHex);
    document.getElementById('save-tx-btn').addEventListener('click', saveTransaction);
}

// Load reports from server
async function loadReports() {
    try {
        const response = await fetch('/api/reports');
        if (!response.ok) throw new Error('Failed to load reports');
        
        currentReports = await response.json();
        displayReports(currentReports);
        updateReportCount();
    } catch (error) {
        console.error('Error loading reports:', error);
        showError('Failed to load reports');
    }
}

// Display reports in list
function displayReports(reports) {
    const reportList = document.getElementById('report-list');
    
    if (reports.length === 0) {
        reportList.innerHTML = '<div class="empty-state">No reports available</div>';
        return;
    }
    
    reportList.innerHTML = reports.map(report => {
        const hasFailedTx = report.hasFailedTransactions;
        const timestamp = new Date(report.timestamp).toLocaleString();
        
        return `
            <div class="report-item ${report.id === currentReportId ? 'selected' : ''}" 
                 data-report-id="${report.id}" onclick="selectReport('${report.id}')">
                <div class="report-item-header">
                    <span class="report-id">${report.id.substring(0, 8)}...</span>
                    <span class="report-time">${timestamp}</span>
                </div>
                <div class="report-stats">
                    <span>📊 ${report.sessionCount} sessions</span>
                    <span>💳 ${report.transactionCount} transactions</span>
                    ${hasFailedTx ? '<span class="status-badge failed">Failed TX</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Filter reports based on search
function filterReports() {
    const searchTerm = document.getElementById('search-box').value.toLowerCase();
    
    if (!searchTerm) {
        displayReports(currentReports);
        return;
    }
    
    const filtered = currentReports.filter(report => {
        return report.id.toLowerCase().includes(searchTerm) ||
               report.timestamp.toLowerCase().includes(searchTerm) ||
               (report.folder && report.folder.includes(searchTerm));
    });
    
    displayReports(filtered);
}

// Update report count
function updateReportCount() {
    const countElement = document.getElementById('report-count');
    const failedCount = currentReports.filter(r => r.hasFailedTransactions).length;
    countElement.textContent = `${currentReports.length} reports (${failedCount} with failed transactions)`;
}

// Select and load a specific report
async function selectReport(reportId) {
    try {
        // Update UI selection
        document.querySelectorAll('.report-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.reportId === reportId);
        });
        
        // Load report data
        const response = await fetch(`/api/report/${reportId}`);
        if (!response.ok) throw new Error('Failed to load report');
        
        currentReportId = reportId;
        currentReportData = await response.json();
        
        displayReportDetails(currentReportData);
        
        // Show actions
        document.getElementById('report-actions').style.display = 'flex';
    } catch (error) {
        console.error('Error loading report:', error);
        showError('Failed to load report details');
    }
}

// Display report details
function displayReportDetails(report) {
    const contentDiv = document.getElementById('report-content');
    
    let html = `
        <div class="report-section">
            <h3>Report Information</h3>
            <div class="report-info">
                <div class="tx-detail-row">
                    <span class="tx-detail-label">Report ID:</span>
                    <span class="tx-detail-value">${report.id}</span>
                </div>
                <div class="tx-detail-row">
                    <span class="tx-detail-label">Received At:</span>
                    <span class="tx-detail-value">${new Date(report.receivedAt).toLocaleString()}</span>
                </div>
                <div class="tx-detail-row">
                    <span class="tx-detail-label">Client IP:</span>
                    <span class="tx-detail-value">${report.clientIp || 'Unknown'}</span>
                </div>
                <div class="tx-detail-row">
                    <span class="tx-detail-label">User Agent:</span>
                    <span class="tx-detail-value">${report.userAgent || 'Unknown'}</span>
                </div>
            </div>
        </div>
    `;
    
    // Display metadata if available
    if (report.metadata) {
        html += `
            <div class="report-section">
                <h3>Metadata</h3>
                <div class="report-info">
                    ${Object.entries(report.metadata).map(([key, value]) => `
                        <div class="tx-detail-row">
                            <span class="tx-detail-label">${key}:</span>
                            <span class="tx-detail-value">${typeof value === 'object' ? JSON.stringify(value) : value}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // Display transactions ready to import
    if (report.readyToImport && report.readyToImport.length > 0) {
        html += `
            <div class="report-section">
                <h3>Failed Transactions (${report.readyToImport.length})</h3>
                ${report.readyToImport.map((tx, index) => `
                    <div class="transaction-item" onclick="showTransactionDetails(${index})">
                        <div class="transaction-header">
                            <span class="txid">${tx.txid}</span>
                        </div>
                        <div class="transaction-stats">
                            <div class="stat-item">
                                <span class="stat-label">Amount</span>
                                <span class="stat-value">${tx.details ? tx.details.totalAmount || '0' : '0'} ALPHA</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Inputs</span>
                                <span class="stat-value">${tx.details ? tx.details.inputCount || '0' : '0'}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Outputs</span>
                                <span class="stat-value">${tx.details ? tx.details.outputCount || '0' : '0'}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    // Display debug sessions
    if (report.sessions && report.sessions.length > 0) {
        html += `
            <div class="report-section">
                <h3>Debug Sessions (${report.sessions.length})</h3>
                ${report.sessions.map(session => {
                    const statusClass = session.status || 'active';
                    const logCount = session.logs ? session.logs.length : 0;
                    
                    return `
                        <div class="session-item">
                            <div class="session-header">
                                <span class="session-id">Session: ${session.id}</span>
                                <span class="session-status ${statusClass}">${session.status || 'unknown'}</span>
                            </div>
                            <div>
                                <strong>Operation:</strong> ${session.operation}<br>
                                <strong>Started:</strong> ${new Date(session.startTime).toLocaleString()}<br>
                                <strong>Log Entries:</strong> ${logCount}
                            </div>
                            ${logCount > 0 ? `
                                <div class="log-entries">
                                    ${session.logs.slice(0, 20).map(log => `
                                        <div class="log-entry ${log.level}">
                                            <strong>[${log.level.toUpperCase()}]</strong> ${log.message}
                                            ${log.data && Object.keys(log.data).length > 0 ? 
                                                `<br><small>${JSON.stringify(log.data).substring(0, 200)}...</small>` : ''}
                                        </div>
                                    `).join('')}
                                    ${logCount > 20 ? `<div class="log-entry">... and ${logCount - 20} more entries</div>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
    
    contentDiv.innerHTML = html;
}

// Show transaction details in modal
function showTransactionDetails(txIndex) {
    if (!currentReportData || !currentReportData.readyToImport) return;
    
    const tx = currentReportData.readyToImport[txIndex];
    const modal = document.getElementById('transaction-modal');
    const detailsDiv = document.getElementById('transaction-details');
    
    // Store current transaction for copy/save operations
    window.currentTransaction = tx;
    
    let html = `
        <div class="tx-detail-row">
            <span class="tx-detail-label">Transaction ID:</span>
            <span class="tx-detail-value">${tx.txid}</span>
        </div>
    `;
    
    if (tx.details) {
        html += `
            <div class="tx-detail-row">
                <span class="tx-detail-label">Total Amount:</span>
                <span class="tx-detail-value">${tx.details.totalAmount || '0'} ALPHA</span>
            </div>
            <div class="tx-detail-row">
                <span class="tx-detail-label">Fee:</span>
                <span class="tx-detail-value">${tx.details.fee || '0'} ALPHA</span>
            </div>
            <div class="tx-detail-row">
                <span class="tx-detail-label">Inputs:</span>
                <span class="tx-detail-value">${tx.details.inputCount || '0'}</span>
            </div>
            <div class="tx-detail-row">
                <span class="tx-detail-label">Outputs:</span>
                <span class="tx-detail-value">${tx.details.outputCount || '0'}</span>
            </div>
        `;
    }
    
    if (tx.hex) {
        html += `
            <div class="tx-detail-row">
                <span class="tx-detail-label">Transaction Hex:</span>
            </div>
            <div class="tx-hex-display">${tx.hex}</div>
        `;
    }
    
    detailsDiv.innerHTML = html;
    modal.style.display = 'flex';
}

// Close transaction modal
function closeTransactionModal() {
    document.getElementById('transaction-modal').style.display = 'none';
    window.currentTransaction = null;
}

// Export full report as JSON
async function exportJSON() {
    if (!currentReportData) return;
    
    const blob = new Blob([JSON.stringify(currentReportData, null, 2)], 
                          { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-report-${currentReportId}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// Export transactions for wallet import
async function exportTransactions() {
    if (!currentReportId) return;
    
    try {
        const response = await fetch(`/api/report/${currentReportId}/export-transactions`);
        if (!response.ok) throw new Error('Failed to export transactions');
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `transactions-${currentReportId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error exporting transactions:', error);
        showError('Failed to export transactions');
    }
}

// Copy report ID to clipboard
function copyReportId() {
    if (!currentReportId) return;
    
    navigator.clipboard.writeText(currentReportId).then(() => {
        showSuccess('Report ID copied to clipboard');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showError('Failed to copy report ID');
    });
}

// Copy transaction hex to clipboard
function copyTransactionHex() {
    if (!window.currentTransaction || !window.currentTransaction.hex) return;
    
    navigator.clipboard.writeText(window.currentTransaction.hex).then(() => {
        showSuccess('Transaction hex copied to clipboard');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showError('Failed to copy transaction hex');
    });
}

// Save single transaction
function saveTransaction() {
    if (!window.currentTransaction) return;
    
    const exportData = {
        network: 'alpha',
        transactions: [{
            raw: window.currentTransaction.hex,
            txid: window.currentTransaction.txid,
            details: window.currentTransaction.details || null
        }],
        timestamp: new Date().toISOString(),
        type: 'debug_export',
        description: `Transaction ${window.currentTransaction.txid} from debug report`
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], 
                          { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transaction-${window.currentTransaction.txid.substring(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// Show success message
function showSuccess(message) {
    // Simple implementation - could be enhanced with toast notifications
    console.log('Success:', message);
}

// Show error message
function showError(message) {
    console.error('Error:', message);
    // Could be enhanced with toast notifications
}