// Database Management System using localStorage
class InvoiceDB {
    constructor() {
        this.init();
    }

    init() {
        // Initialize database collections if they don't exist
        const collections = ['customers', 'products', 'invoices', 'quotations', 'credits'];
        collections.forEach(collection => {
            if (!localStorage.getItem(collection)) {
                localStorage.setItem(collection, JSON.stringify([]));
            }
        });

        // Initialize settings
        if (!localStorage.getItem('business-settings')) {
            this.saveSettings({
                businessName: 'Your Business Name',
                businessPhone: '',
                businessEmail: '',
                businessAddress: '',
                businessGst: '',
                invoicePrefix: 'INV',
                quotationPrefix: 'QUO',
                defaultTax: 18,
                paymentTerms: 30,
                lowStockThreshold: 10,
                autoBackup: 'weekly'
            });
        }

        // Initialize counters
        if (!localStorage.getItem('counters')) {
            localStorage.setItem('counters', JSON.stringify({
                invoice: 1000,
                quotation: 2000
            }));
        }
    }

    // Generic CRUD operations
    getAll(collection) {
        return JSON.parse(localStorage.getItem(collection) || '[]');
    }

    getById(collection, id) {
        const items = this.getAll(collection);
        return items.find(item => item.id === id);
    }

    save(collection, item) {
        const items = this.getAll(collection);
        if (item.id) {
            const index = items.findIndex(i => i.id === item.id);
            if (index >= 0) {
                items[index] = { ...item, updatedAt: new Date().toISOString() };
            }
        } else {
            item.id = this.generateId();
            item.createdAt = new Date().toISOString();
            items.push(item);
        }
        localStorage.setItem(collection, JSON.stringify(items));
        return item;
    }

    delete(collection, id) {
        const items = this.getAll(collection);
        const filteredItems = items.filter(item => item.id !== id);
        localStorage.setItem(collection, JSON.stringify(filteredItems));
    }

    generateId() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    getNextNumber(type) {
        const counters = JSON.parse(localStorage.getItem('counters'));
        const nextNumber = counters[type];
        counters[type] = nextNumber + 1;
        localStorage.setItem('counters', JSON.stringify(counters));
        return nextNumber;
    }

    saveSettings(settings) {
        localStorage.setItem('business-settings', JSON.stringify(settings));
    }

    getSettings() {
        return JSON.parse(localStorage.getItem('business-settings'));
    }

    exportData() {
        const data = {
            customers: this.getAll('customers'),
            products: this.getAll('products'),
            invoices: this.getAll('invoices'),
            quotations: this.getAll('quotations'),
            credits: this.getAll('credits'),
            settings: this.getSettings(),
            counters: JSON.parse(localStorage.getItem('counters')),
            exportDate: new Date().toISOString()
        };
        return data;
    }

    importData(data) {
        try {
            Object.keys(data).forEach(key => {
                if (key !== 'exportDate' && localStorage.hasOwnProperty(key === 'settings' ? 'business-settings' : key)) {
                    localStorage.setItem(
                        key === 'settings' ? 'business-settings' : key,
                        JSON.stringify(data[key])
                    );
                }
            });
            return true;
        } catch (error) {
            console.error('Import failed:', error);
            return false;
        }
    }

    clearAllData() {
        const collections = ['customers', 'products', 'invoices', 'quotations', 'credits'];

        collections.forEach(collection => {
            localStorage.setItem(collection, JSON.stringify([]));
        });
        localStorage.setItem('counters', JSON.stringify({
            invoice: 1000,
            quotation: 2000
        }));
    }
}

// Application Manager
class InvoiceApp {
    constructor() {
        this.db = new InvoiceDB();
        this.currentPage = 'dashboard';
        this.currentInvoiceItems = [];
        this.currentQuotationItems = [];
        this.productModalSourceIndex = null;
        this.stashedInvoiceState = null;
        this.stashedQuotationState = null; // For quotations
        this.metalRatesCache = null;
        this.metalRatesApiKey = '1f50e17b354d0937c2a01856c445d82b'; // replace with your actual API key
        this.isOnline = navigator.onLine;
        this.autoUpdateTimer = null;

        // Scheduled update times (24-hour format)
        this.updateSchedule = [
            { hour: 9, minute: 0 },   // 9:00 AM
            { hour: 14, minute: 0 },  // 2:00 PM
            { hour: 17, minute: 0 }   // 5:00 PM
        ];

        // Flags to initialize network and auto-update only once
        this.networkDetectionInitialized = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadSettings();
        this.refreshDashboard();
        this.setupAutoSave();
        // Call initializations here or in init method
        this.initNetworkDetection();
        this.initAutoUpdateSystem();
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = e.currentTarget.dataset.page;
                this.showPage(page);
            });
        });

        const exportBtn = document.getElementById('export-data');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportData());
        }

        const importInput = document.getElementById('import-data');
        if (importInput) {
            importInput.addEventListener('change', (e) => this.importData(e.target.files[0]));
        }

        const resetBtn = document.getElementById('reset-data');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.promptForReset());
        }

        this.setupSearchFilters();

        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'modal-overlay') {
                this.closeModal();
            }
        });

        document.addEventListener('DOMContentLoaded', () => {
            const settingsForm = document.getElementById('settings-form');
            if (settingsForm) {
                settingsForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.saveSettingsForm();
                });
            }
        });

        document.body.addEventListener('click', (e) => {
            if (!e.target.closest('.searchable-select')) {
                document.querySelectorAll('.searchable-select-dropdown').forEach(d => d.classList.remove('active'));
            }
        });
    }

    filterSearchableOptions(inputElement) {
        const filter = inputElement.value.toUpperCase();
        const dropdown = inputElement.nextElementSibling;
        const options = dropdown.getElementsByClassName('searchable-select-option');
        for (let i = 0; i < options.length; i++) {
            const txtValue = options[i].textContent || options[i].innerText;
            if (txtValue.toUpperCase().indexOf(filter) > -1) {
                options[i].classList.remove('hidden');
            } else {
                options[i].classList.add('hidden');
            }
        }
    }

    selectSearchableOption(optionElement, isCustomer = false) {
        const wrapper = optionElement.closest('.searchable-select');
        const input = wrapper.querySelector('.searchable-select-input');
        const hiddenInput = wrapper.querySelector('input[type="hidden"]');
        const dropdown = wrapper.querySelector('.searchable-select-dropdown');

        input.value = optionElement.textContent;
        hiddenInput.value = optionElement.dataset.value;
        dropdown.classList.remove('active');

        if (!isCustomer) {
            const row = optionElement.closest('[data-index]');
            const index = parseInt(row.dataset.index);
            const productId = optionElement.dataset.value;
            const rate = parseFloat(optionElement.dataset.rate) || 0;

            // This is the new logic to call the correct updater
            const formId = wrapper.closest('form').id;
            if (formId === 'invoice-form') {
                this.updateInvoiceItem(index, productId, rate);
            } else if (formId === 'quotation-form') {
                this.updateQuotationItem(index, productId, rate);
            }
        }
    }

    setupSearchFilters() {
        const filters = [
            { id: 'invoice-search', action: () => this.filterInvoices() },
            { id: 'invoice-status-filter', action: () => this.filterInvoices() },
            { id: 'customer-search', action: () => this.filterCustomers() },
            { id: 'product-search', action: () => this.filterProducts() },
            { id: 'product-category-filter', action: () => this.filterProducts() }
        ];

        filters.forEach(({ id, action }) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', action);
                element.addEventListener('change', action);
            }
        });
    }

    showPage(pageName) {
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        const activeLink = document.querySelector(`[data-page="${pageName}"]`);
        if (activeLink) activeLink.classList.add('active');

        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        const activePage = document.getElementById(pageName);
        if (activePage) activePage.classList.add('active');

        const titles = {
            dashboard: 'Dashboard',
            invoices: 'Invoice Management',
            quotations: 'Quotation Management',
            customers: 'Customer Management',
            stock: 'Stock Management',
            reports: 'Business Reports',
            settings: 'Settings'
        };
        const titleElement = document.getElementById('page-title');
        if (titleElement) titleElement.textContent = titles[pageName] || pageName;

        this.currentPage = pageName;
        this.loadPageData(pageName);
    }

    loadPageData(pageName) {
        switch (pageName) {
            case 'dashboard': this.refreshDashboard(); break;
            case 'invoices': this.loadInvoices(); break;
            case 'quotations': this.loadQuotations(); break;
            case 'customers': this.loadCustomers(); break;
            case 'stock': this.loadProducts(); break;
            case 'reports':
                this.generateReports();
                this.generateStatementSummaryReport();
                break;
            case 'settings': this.loadSettingsForm(); break;
            case 'gold-silver':
                this.loadMetalRatesPage();
                break;

        }
    }

    setupAutoSave() {
        setInterval(() => {
            if (this.hasUnsavedChanges) {
                this.saveCurrentForm();
                this.hasUnsavedChanges = false;
            }
        }, 30000);
    }

    refreshDashboard() {
        const invoices = this.db.getAll('invoices');
        const customers = this.db.getAll('customers');
        const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((sum, inv) => sum + (inv.total || 0), 0);
        // MODIFIED LOGIC
        const pendingAmount = invoices
            .filter(i => i.status === 'pending')
            .reduce((sum, inv) => sum + (inv.remainingAmount !== undefined ? inv.remainingAmount : (inv.total || 0)), 0);

        document.getElementById('total-revenue').textContent = `₹${totalRevenue.toLocaleString('en-IN')}`;
        document.getElementById('total-invoices').textContent = invoices.length;
        document.getElementById('total-customers').textContent = customers.length;
        document.getElementById('pending-amount').textContent = `₹${pendingAmount.toLocaleString('en-IN')}`;
        this.loadRecentInvoices();
        this.loadLowStockAlerts();
    }

    loadRecentInvoices() {
        const invoices = this.db.getAll('invoices').slice(-5).reverse();
        const customers = this.db.getAll('customers');
        const tbody = document.querySelector('#recent-invoices-table tbody');
        if (invoices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="no-data">No invoices found</td></tr>';
            return;
        }
        tbody.innerHTML = invoices.map(invoice => {
            const customer = customers.find(c => c.id === invoice.customerId);
            return `
                <tr>
                    <td>${invoice.invoiceNumber || 'N/A'}</td>
                    <td>${customer ? customer.name : 'Unknown'}</td>
                    <td>₹${(invoice.total || 0).toLocaleString('en-IN')}</td>
                    <td>${invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('en-IN') : 'N/A'}</td>
                    <td><span class="status-badge status-${invoice.status || 'pending'}">${invoice.status || 'pending'}</span></td>
                    <td><button class="action-btn" onclick="app.printInvoice('${invoice.id}')" title="Print Invoice"><i class="fas fa-print"></i></button></td>
                </tr>`;
        }).join('');
    }

    loadLowStockAlerts() {
        const products = this.db.getAll('products');
        const settings = this.db.getSettings();
        const threshold = settings.lowStockThreshold || 10;
        const lowStockProducts = products.filter(p => (p.currentStock || 0) <= threshold);
        const tbody = document.querySelector('#low-stock-table tbody');
        if (lowStockProducts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">All products are in stock</td></tr>';
            return;
        }
        tbody.innerHTML = lowStockProducts.map(product => `
            <tr>
                <td>${product.name}</td>
                <td>${product.currentStock || 0}</td>
                <td>${product.minStock || threshold}</td>
                <td><button class="btn btn-sm btn-warning" onclick="app.editProduct('${product.id}')"><i class="fas fa-edit"></i> Restock</button></td>
            </tr>`).join('');
    }

    // Initialize network online/offline detection
    initNetworkDetection() {
        this.updateConnectionStatus();

        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus();
            this.showOnlineNotification();

            // Auto-refresh rates if on gold-silver page
            if (this.currentPage === 'gold-silver') {
                this.performAutoUpdate();
            }
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateConnectionStatus();
            this.showOfflineNotification();
        });
    }

    updateConnectionStatus() {
        const statusBadge = document.getElementById('connection-status');
        const statusText = document.getElementById('status-text');

        if (!statusBadge || !statusText) return;

        if (this.isOnline) {
            statusBadge.className = 'status-badge online';
            statusText.textContent = 'Online';
            statusBadge.querySelector('i').className = 'fas fa-wifi';
        } else {
            statusBadge.className = 'status-badge offline';
            statusText.textContent = 'Offline';
            statusBadge.querySelector('i').className = 'fas fa-wifi-slash';
        }
    }

    showOnlineNotification() {
        // Hide offline notice
        const offlineNotice = document.getElementById('offline-notice');
        if (offlineNotice) {
            offlineNotice.style.display = 'none';
        }
        // Optional: show toast or console
        console.log('Connection restored: fetching latest rates soon.');
    }

    showOfflineNotification() {
        const offlineNotice = document.getElementById('offline-notice');
        if (offlineNotice) {
            const cached = this.getMetalRatesFromStorage();
            if (cached) {
                const cacheDate = new Date(cached.timestamp);
                document.getElementById('cache-date').textContent = cacheDate.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                offlineNotice.style.display = 'flex';
            }
        }
        console.log('Offline mode: showing cached rates.');
    }

    // Initialize automatic updates
    initAutoUpdateSystem() {
        console.log('Auto-update system initialized');

        // Run once immediately on load to check current time and update if needed
        this.checkAndUpdateIfNeeded();

        // Check every minute if it matches scheduled update times
        this.autoUpdateTimer = setInterval(() => {
            this.checkAndUpdateIfNeeded();
        }, 60000);

        // Update "next update" display every 30 seconds
        this.updateNextUpdateDisplay();
        setInterval(() => {
            this.updateNextUpdateDisplay();
        }, 30000);
    }

    // Check if current time matches update schedule
    checkAndUpdateIfNeeded() {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        const isUpdateTime = this.updateSchedule.some(schedule =>
            schedule.hour === currentHour && schedule.minute === currentMinute
        );

        if (isUpdateTime) {
            // Prevent multiple runs this exact minute using localStorage key
            const lastUpdate = localStorage.getItem('last-auto-update');
            const currentTimeStr = `${now.toDateString()}-${currentHour}:${currentMinute}`;

            if (lastUpdate !== currentTimeStr) {
                console.log(`Scheduled update triggered at ${currentHour}:${currentMinute}`);
                this.performAutoUpdate();
                localStorage.setItem('last-auto-update', currentTimeStr);
            } else {
                console.log('Already updated at this time.');
            }
        }
    }

    // Perform the automatic fetch and UI update
    async performAutoUpdate() {
        if (!this.isOnline) {
            console.log('Offline, skipping update.');
            return;
        }

        try {
            this.showUpdatingIndicator();

            const rates = await this.fetchMetalRates();

            if (!rates.error) {
                this.displayMetalRates(rates);
                this.showUpdateSuccessMessage();
            } else {
                console.error('Failed to fetch latest rates.');
            }
        } catch (err) {
            console.error('Error during auto update:', err);
        } finally {
            this.hideUpdatingIndicator();
        }
    }

    // Show updating animation/indicator
    showUpdatingIndicator() {
        const indicator = document.getElementById('auto-update-indicator');
        if (indicator) {
            indicator.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i><span>Updating rates<span class="updating-animation"></span></span>';
            indicator.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
        }
    }

    // Hide updating animation and restore next update text
    hideUpdatingIndicator() {
        const indicator = document.getElementById('auto-update-indicator');
        if (indicator) {
            this.updateNextUpdateDisplay();
            indicator.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
    }

    // Show success message for update
    showUpdateSuccessMessage() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        console.log(`Rates updated successfully at ${timeStr}`);
    }

    // Update display text for next scheduled update
    updateNextUpdateDisplay() {
        const indicator = document.getElementById('next-update-text');
        if (!indicator) return;

        const nextUpdate = this.getNextUpdateTime();

        if (nextUpdate) {
            const timeStr = nextUpdate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
            const minutesUntil = Math.round((nextUpdate - new Date()) / 60000);

            if (minutesUntil > 60) {
                const hours = Math.floor(minutesUntil / 60);
                indicator.textContent = `Next update at ${timeStr} (in ${hours}h)`;
            } else if (minutesUntil > 0) {
                indicator.textContent = `Next update at ${timeStr} (in ${minutesUntil}m)`;
            } else {
                indicator.textContent = `Updating now...`;
            }
        }
    }

    // Determine the next scheduled update Date object
    getNextUpdateTime() {
        const now = new Date();
        const today = new Date(now);

        for (let schedule of this.updateSchedule) {
            const updateTime = new Date(today);
            updateTime.setHours(schedule.hour, schedule.minute, 0, 0);
            if (updateTime > now) return updateTime;
        }

        // If no updates left today, next update is tomorrow's first schedule
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(this.updateSchedule[0].hour, this.updateSchedule[0].minute, 0, 0);
        return tomorrow;
    }

    // Fetch metal rates from the API or cache if offline
    async fetchMetalRates() {
        if (!this.isOnline) {
            console.log('Offline: loading cached metal rates...');
            const cached = this.getMetalRatesFromStorage();
            return cached || { gold24k: 0, gold22k: 0, silver: 0, timestamp: new Date().toISOString(), error: true, offline: true };
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(
                `https://api.metalpriceapi.com/v1/latest?api_key=1f50e17b354d0937c2a01856c445d82b&base=INR&currencies=EUR,XAU,XAG`,
                { signal: controller.signal }
            );

            clearTimeout(timeoutId);

            if (!response.ok) throw new Error('Failed to fetch metal rates');

            const data = await response.json();
            const usdToInr = 83; // Use dynamic conversion in production

            const gold24kPer10g = (1 / data.rates.XAU) * usdToInr * (10 / 31.1035);
            const gold22kPer10g = gold24kPer10g * (22 / 24);
            const silverPerKg = (1 / data.rates.XAG) * usdToInr * (1000 / 31.1035);

            const rates = {
                gold24k: Math.round(gold24kPer10g),
                gold22k: Math.round(gold22kPer10g),
                silver: Math.round(silverPerKg),
                timestamp: new Date().toISOString(),
                source: 'MetalPriceAPI',
                offline: false,
            };

            this.metalRatesCache = rates;
            this.saveMetalRatesToStorage(rates);

            return rates;
        } catch (error) {
            console.error('Error fetching metal rates:', error);
            const cached = this.getMetalRatesFromStorage();
            return cached ? { ...cached, offline: true } : {
                gold24k: 0, gold22k: 0, silver: 0,
                timestamp: new Date().toISOString(),
                error: true,
                offline: true,
            };
        }
    }

    // Store rates and history in localStorage
    saveMetalRatesToStorage(rates) {
        localStorage.setItem('metal-rates-current', JSON.stringify(rates));

        const history = JSON.parse(localStorage.getItem('metal-rates-history') || '[]');
        const today = new Date().toISOString().split('T')[0];
        const todayIndex = history.findIndex(item => item.date === today);

        if (todayIndex >= 0) {
            history[todayIndex] = { date: today, ...rates };
        } else {
            history.unshift({ date: today, ...rates });
        }

        if (history.length > 30) history.splice(30);
        localStorage.setItem('metal-rates-history', JSON.stringify(history));
    }

    // Retrieve cached rates from storage
    getMetalRatesFromStorage() {
        const cached = localStorage.getItem('metal-rates-current');
        return cached ? JSON.parse(cached) : null;
    }

    // Display rates with cached indicator if offline
    displayMetalRates(rates) {
        const isCached = rates.offline || false;
        const cachedLabel = isCached ? '<span class="cached-indicator">CACHED</span>' : '';

        document.getElementById('gold-24k-rate').innerHTML = `₹${rates.gold24k.toLocaleString('en-IN')}${cachedLabel}`;
        document.getElementById('gold-22k-rate').innerHTML = `₹${rates.gold22k.toLocaleString('en-IN')}${cachedLabel}`;
        document.getElementById('silver-rate').innerHTML = `₹${rates.silver.toLocaleString('en-IN')}${cachedLabel}`;

        const lastUpdated = new Date(rates.timestamp);
        document.getElementById('last-updated').textContent =
            lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        if (isCached && !this.isOnline) {
            this.showOfflineNotification();
        } else {
            const offlineNotice = document.getElementById('offline-notice');
            if (offlineNotice) offlineNotice.style.display = 'none';
        }

        this.displayMetalRatesHistory();
    }

    // Display last 7 days rate history table
    displayMetalRatesHistory() {
        const history = JSON.parse(localStorage.getItem('metal-rates-history') || '[]');
        const tbody = document.querySelector('#metal-rates-table tbody');
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-data">No history available</td></tr>';
            return;
        }

        const last7Days = history.slice(0, 7);

        tbody.innerHTML = last7Days.map((rate, index) => {
            let changePercent = 0;
            let changeClass = '';

            if (index < last7Days.length - 1) {
                const prevRate = last7Days[index + 1];
                changePercent = ((rate.gold24k - prevRate.gold24k) / prevRate.gold24k * 100).toFixed(2);
                changeClass = changePercent >= 0 ? 'rate-change-positive' : 'rate-change-negative';
            }

            return `
            <tr>
                <td>${new Date(rate.date).toLocaleDateString('en-IN')}</td>
                <td>₹${rate.gold24k.toLocaleString('en-IN')}</td>
                <td>₹${rate.gold22k.toLocaleString('en-IN')}</td>
                <td>₹${rate.silver.toLocaleString('en-IN')}</td>
                <td class="${changeClass}">${changePercent > 0 ? '+' : ''}${changePercent}%</td>
            </tr>
        `;
        }).join('');
    }

    // Load metal rates page data and setup network & auto-update
    async loadMetalRatesPage() {
        if (!this.networkDetectionInitialized) {
            this.initNetworkDetection();
            this.networkDetectionInitialized = true;
        }
        if (!this.autoUpdateTimer) {
            this.initAutoUpdateSystem();
        }

        this.updateConnectionStatus();

        const cached = this.getMetalRatesFromStorage();
        if (cached) {
            this.displayMetalRates({ ...cached, offline: !this.isOnline });
        } else {
            await this.performAutoUpdate();
        }
    }

    // Invoice Management
    loadInvoices() {
        const invoices = this.db.getAll('invoices');
        this.renderInvoices(invoices);
    }

    renderInvoices(invoices) {
        const customers = this.db.getAll('customers');
        const tbody = document.querySelector('#invoices-table tbody');

        if (invoices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">No invoices found</td></tr>';
            return;
        }

        tbody.innerHTML = invoices.map(invoice => {
            const customer = customers.find(c => c.id === invoice.customerId);
            const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
            const isOverdue = dueDate && dueDate < new Date() && invoice.status === 'pending';

            return `
                <tr>
                    <td>${invoice.invoiceNumber || 'N/A'}</td>
                    <td>${customer ? customer.name : 'Unknown'}</td>
                    <td>${invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('en-IN') : 'N/A'}</td>
                    <td>${dueDate ? dueDate.toLocaleDateString('en-IN') : 'N/A'}</td>
                    <td>₹${((invoice.remainingAmount !== undefined) ? invoice.remainingAmount : (invoice.total || 0)).toLocaleString('en-IN')}</td>
                    <td><span class="status-badge status-${isOverdue ? 'overdue' : (invoice.status || 'pending')}">${isOverdue ? 'overdue' : (invoice.status || 'pending')}</span></td>
                    <td>
                        <button class="action-btn edit" onclick="app.editInvoice('${invoice.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="action-btn" onclick="app.printInvoice('${invoice.id}')" title="Print" style="background-color: #28a745;"><i class="fas fa-print"></i></button>
                        <button class="action-btn delete" onclick="app.deleteInvoice('${invoice.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
        }).join('');
    }

    showInvoiceModal(invoiceId = null, initialState = null) {
        const isEdit = !!invoiceId;
        const invoice = isEdit ? this.db.getById('invoices', invoiceId) : null;
        const customers = this.db.getAll('customers');
        const data = initialState || invoice || {};
        this.currentInvoiceItems = data.items || [];
        const customerName = data.customerId ? this.db.getById('customers', data.customerId)?.name : '';

        // Check if there is a pending credit entry for this invoice
        const creditEntry = this.db.getAll('credits').find(c => c.invoiceId === invoiceId);
        let amountReceived = 0;
        if (creditEntry) {
            amountReceived = creditEntry.payments.reduce((sum, p) => sum + p.amount, 0);
        }

        const content = `
    <form id="invoice-form" style="display: grid; gap: 15px;">
         <input type="hidden" name="invoiceId" value="${invoiceId || ''}">
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px;">
            <div class="form-group">
                <label>Customer *</label>
                <div style="display: flex; gap: 10px;">
                    <div class="searchable-select" style="flex: 1;">
                        <input type="text" class="searchable-select-input" placeholder="Search and select a customer..."
                            onkeyup="app.filterSearchableOptions(this)"
                            onclick="this.nextElementSibling.classList.toggle('active')"
                            value="${customerName}" autocomplete="off">
                        <div class="searchable-select-dropdown">
                            ${customers.map(c => `<div class="searchable-select-option" data-value="${c.id}" onclick="app.selectSearchableOption(this, true)">${c.name} - ${c.phone}</div>`).join('')}
                        </div>
                        <input type="hidden" name="customerId" value="${data.customerId || ''}" required>
                    </div>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="app.showCustomerModalInline()"><i class="fas fa-plus"></i></button>
                </div>                     
            </div>
         </div>
        <div class="form-group">
            <label>Status</label>
            <select id="invoice-status" name="status" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <option value="pending" ${!data || data.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="paid" ${data && data.status === 'paid' ? 'selected' : ''}>Paid</option>
            </select>
        </div>
        
        <div class="form-group" id="partial-payment-container" style="display: ${!data || data.status === 'pending' ? 'block' : 'none'};">
            <label>Total Amount Received</label>
            <input type="number" id="partial-payment-amount" name="partialPayment" value="${amountReceived.toFixed(2)}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;" min="0" readonly>
            <label style="margin-top: 10px;">Add New Payment</label>
            <input type="number" id="new-payment-amount" name="newPayment" placeholder="Enter new amount to add" value="" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;" min="0">
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 15px;">
            <div class="form-group">
                <label>Invoice Date</label>
                <input type="datetime-local" id="invoice-date" name="invoiceDate" value="${(data?.invoiceDate ? new Date(data.invoiceDate).toISOString() : new Date().toISOString()).slice(0, 16)}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;" />
            </div>
            <div class="form-group">
                <label>Due Date</label>
                <input type="date" id="invoice-due-date" name="dueDate" value="${data?.dueDate ? data.dueDate.split('T')[0] : ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;" />
            </div>
            <div class="form-group">
                <label>Payment Date</label>
                <input type="datetime-local" id="payment-date" name="paymentDate" value="${data?.paymentDate ? new Date(data.paymentDate).toISOString().slice(0, 16) : ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;" ${!data || data.status !== 'paid' ? 'disabled' : ''}>
            </div>
            <div class="form-group">
                <label>Payment Method</label>
                <select id="payment-method" name="paymentMethod" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;" ${!data || data.status !== 'paid' ? 'disabled' : ''}>
                    <option value="cash" ${data?.paymentMethod === 'cash' ? 'selected' : ''}>Cash</option>
                    <option value="upi" ${data?.paymentMethod === 'upi' ? 'selected' : ''}>UPI</option>
                    <option value="cheque" ${data?.paymentMethod === 'cheque' ? 'selected' : ''}>Cheque</option>
                    <option value="card" ${data?.paymentMethod === 'card' ? 'selected' : ''}>Credit/Debit Card</option>
                </select>
            </div>
        </div>
        <div class="form-group">
            <label>Items</label>
            <div id="invoice-items">
                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 10px; font-weight: bold;">
                    <div>Product</div><div>Quantity</div><div>Rate</div><div>Amount</div><div>Action</div>
                </div>
                <div id="items-container">${this.renderInvoiceItems()}</div>
                <button type="button" class="btn btn-sm btn-primary" onclick="app.addInvoiceItem()"><i class="fas fa-plus"></i> Add Item</button>
            </div>
        </div>
        <div class="form-group">
            <div style="text-align: right; font-size: 18px; font-weight: bold;">
                <p>Total: ₹<span id="invoice-total">0</span></p>
                <p id="remaining-amount-display" style="color: red;"></p>
            </div>
        </div>
        <div class="form-group">
            <label>Notes</label>
            <textarea id="invoice-notes" name="notes" rows="3" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">${data ? (data.notes || '') : ''}</textarea>
        </div>
    </form>`;
        const actions = [
            { text: 'Cancel', class: 'btn-secondary', action: 'closeModal' },
            { text: isEdit ? 'Update Invoice' : 'Create Invoice', class: 'btn-primary', icon: 'fas fa-save', action: `saveInvoice('${invoiceId || ''}')` }
        ];
        this.showModal(isEdit ? 'Edit Invoice' : 'New Invoice', content, actions);

        const statusDropdown = document.getElementById('invoice-status');
        const paymentContainer = document.getElementById('partial-payment-container');
        const paymentInput = document.getElementById('partial-payment-amount');
        const paymentDateInput = document.getElementById('payment-date');
        const paymentMethodInput = document.getElementById('payment-method');

        statusDropdown.addEventListener('change', (e) => {
            const isPaid = e.target.value === 'paid';
            paymentDateInput.disabled = !isPaid;
            paymentMethodInput.disabled = !isPaid;
            paymentContainer.style.display = isPaid ? 'none' : 'block';
            if (isPaid) {
                paymentInput.value = '';
                if (!paymentDateInput.value) {
                    paymentDateInput.value = new Date().toISOString().slice(0, 16);
                }
            }
        });
        this.calculateInvoiceTotal();
    }

    renderInvoiceItems() {
        const products = this.db.getAll('products');
        return this.currentInvoiceItems.map((item, index) => {
            const productName = item.productId ? this.db.getById('products', item.productId)?.name : '';
            return `
              <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 10px; align-items: center;" data-index="${index}">
                <div style="display: flex; gap: 5px;">
                    <div class="searchable-select" style="flex: 1;">
                        <input type="text" class="searchable-select-input" placeholder="Search product..."
                               onkeyup="app.filterSearchableOptions(this)"
                               onclick="this.nextElementSibling.classList.toggle('active')"
                               value="${productName}" autocomplete="off">
                        <div class="searchable-select-dropdown">
                            ${products.map(p => `<div class="searchable-select-option" data-value="${p.id}" data-rate="${p.sellingPrice || 0}" onclick="app.selectSearchableOption(this)">${p.name} - ₹${(p.sellingPrice || 0).toLocaleString('en-IN')}</div>`).join('')}
                        </div>
                        <input type="hidden" class="item-product-id" value="${item.productId || ''}">
                    </div>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="app.showProductModalInline(${index})" title="Add New Product"><i class="fas fa-plus"></i></button>
                </div>
                <input type="number" class="item-quantity" value="${item.quantity || 1}" min="1" onchange="app.calculateInvoiceTotal()" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                <input type="number" class="item-rate" value="${item.productId ? this.db.getById('products', item.productId).sellingPrice : 0}" step="0.01" min="0" onchange="app.calculateInvoiceTotal()" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                <div class="item-amount">₹${((item.quantity || 1) * (item.rate || 0)).toLocaleString('en-IN')}</div>
                <button type="button" class="action-btn delete" onclick="app.removeInvoiceItem(${index})"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
    }

    addInvoiceItem() {
        this.currentInvoiceItems.push({ productId: '', quantity: 1, rate: 0, amount: 0 });
        document.getElementById('items-container').innerHTML = this.renderInvoiceItems();
        this.calculateInvoiceTotal();
    }

    removeInvoiceItem(index) {
        this.currentInvoiceItems.splice(index, 1);
        document.getElementById('items-container').innerHTML = this.renderInvoiceItems();
        this.calculateInvoiceTotal();
    }

    calculateInvoiceTotal() {
        let total = 0;
        const itemContainers = document.querySelectorAll('#items-container > div[data-index]');
        this.currentInvoiceItems = [];
        itemContainers.forEach(container => {
            const productId = container.querySelector('.item-product-id').value;
            const quantity = parseFloat(container.querySelector('.item-quantity').value) || 0;
            const rate = parseFloat(container.querySelector('.item-rate').value) || 0;
            const amount = quantity * rate;
            container.querySelector('.item-amount').textContent = `₹${amount.toLocaleString('en-IN')}`;
            total += amount;
            this.currentInvoiceItems.push({ productId, quantity, rate, amount });
        });

        document.getElementById('invoice-total').textContent = total.toLocaleString('en-IN');

        // NEW LOGIC FOR PENDING AMOUNT
        const status = document.getElementById('invoice-status').value;
        const partialPaymentInput = document.getElementById('partial-payment-amount');
        const remainingAmountDisplay = document.getElementById('remaining-amount-display');

        if (status === 'pending' && partialPaymentInput) {
            const amountReceived = parseFloat(partialPaymentInput.value) || 0;
            const remainingAmount = total - amountReceived;
            remainingAmountDisplay.textContent = `Remaining: ₹${remainingAmount.toLocaleString('en-IN')}`;
        } else {
            remainingAmountDisplay.textContent = ''; // Clear the display if not a pending invoice
        }

        return total;
    }

    saveInvoice(invoiceId = '') {
        const form = document.getElementById('invoice-form');
        if (!form) return;

        const formData = new FormData(form);
        const customerId = formData.get('customerId');
        const status = formData.get('status');

        const partialPayment = parseFloat(formData.get('partialPayment')) || 0;
        const newPayment = parseFloat(formData.get('newPayment')) || 0;


        if (!customerId) {
            this.showNotification('Please select a customer!', 'error');
            return;
        }

        if (this.currentInvoiceItems.length === 0 || !this.currentInvoiceItems.some(item => item.productId)) {
            this.showNotification('Please add at least one item!', 'error');
            return;
        }

        const total = this.calculateInvoiceTotal();

        if (status === 'pending' && (partialPayment + newPayment) >= total) {
            this.showNotification('For Pending status, Amount Received must be less than the total amount.', 'error');
            return;
        }

        const settings = this.db.getSettings();

        const invoice = {
            id: invoiceId || undefined,
            invoiceNumber: invoiceId ?
                this.db.getById('invoices', invoiceId).invoiceNumber :
                `${settings.invoicePrefix}-${this.db.getNextNumber('invoice')}`,
            customerId: customerId,
            invoiceDate: formData.get('invoiceDate') || new Date().toISOString(),
            dueDate: formData.get('dueDate') || null,
            paymentDate: status === 'paid' ? (formData.get('paymentDate') || new Date().toISOString()) : null,
            paymentMethod: status === 'paid' ? formData.get('paymentMethod') : null,
            items: [...this.currentInvoiceItems],
            subtotal: total,
            tax: 0,
            total: total,
            status: status,
            notes: formData.get('notes')
        };
        // Update remainingAmount on the invoice object
        const totalReceived = partialPayment + newPayment;
        if (status === 'pending') {
            invoice.remainingAmount = total - totalReceived;
        } else {
            invoice.remainingAmount = 0;
        }

        // Stock management logic (no changes here)
        if (invoiceId) {
            const existingInvoice = this.db.getById('invoices', invoiceId);
            if (existingInvoice) {
                existingInvoice.items.forEach(item => {
                    if (item.productId) {
                        const product = this.db.getById('products', item.productId);
                        if (product) {
                            product.currentStock += item.quantity;
                            this.db.save('products', product);
                        }
                    }
                });
            }
        }
        this.currentInvoiceItems.forEach(item => {
            if (item.productId) {
                const product = this.db.getById('products', item.productId);
                if (product) {
                    product.currentStock -= item.quantity;
                    this.db.save('products', product);
                }
            }
        });

        const savedInvoice = this.db.save('invoices', invoice);

        const allCredits = this.db.getAll('credits');
        let linkedCredit = allCredits.find(c => c.invoiceId === savedInvoice.id);

        if (savedInvoice.status === 'pending') {
            if (linkedCredit) {
                // Add new payment to existing credit entry
                if (newPayment > 0) {
                    linkedCredit.payments.push({
                        amount: newPayment,
                        date: new Date().toISOString(),
                        method: 'partial'
                    });
                }
                linkedCredit.remainingAmount = savedInvoice.total - (partialPayment + newPayment);

                if (linkedCredit.remainingAmount <= 0) {
                    linkedCredit.status = 'paid';
                    savedInvoice.status = 'paid';
                    this.showNotification(`Invoice #${savedInvoice.invoiceNumber} has been marked as Paid.`, 'info');
                }
                this.db.save('credits', linkedCredit);
            } else {
                // Create a new credit entry for the new invoice
                const creditData = {
                    id: undefined,
                    customerId: savedInvoice.customerId,
                    invoiceId: savedInvoice.id,
                    amount: savedInvoice.total,
                    remainingAmount: savedInvoice.total,
                    dueDate: savedInvoice.dueDate,
                    status: 'pending',
                    notes: `From invoice #${savedInvoice.invoiceNumber}`,
                    payments: []
                };
                if (partialPayment > 0) {
                    creditData.remainingAmount -= partialPayment;
                    creditData.payments.push({
                        amount: partialPayment,
                        date: savedInvoice.invoiceDate,
                        method: 'advance'
                    });
                }
                this.db.save('credits', creditData);
            }
        } else if (savedInvoice.status === 'paid') {
            if (linkedCredit) {
                linkedCredit.remainingAmount = 0;
                linkedCredit.status = 'paid';
                linkedCredit.payments = [{
                    amount: linkedCredit.amount,
                    date: savedInvoice.paymentDate,
                    method: savedInvoice.paymentMethod || 'invoice_payment'
                }];
                this.db.save('credits', linkedCredit);
            } else {
                const creditData = {
                    id: undefined,
                    customerId: savedInvoice.customerId,
                    invoiceId: savedInvoice.id,
                    amount: savedInvoice.total,
                    remainingAmount: 0,
                    dueDate: savedInvoice.dueDate,
                    status: 'paid',
                    notes: `From paid invoice #${savedInvoice.invoiceNumber}`,
                    payments: [{
                        amount: savedInvoice.total,
                        date: savedInvoice.paymentDate,
                        method: savedInvoice.paymentMethod || 'invoice_payment'
                    }]
                };
                this.db.save('credits', creditData);
            }
        }

        this.closeModal();
        this.loadInvoices();
        if (this.currentPage === 'customers') this.loadCustomers();
        this.refreshDashboard();
        this.showNotification(`Invoice ${invoiceId ? 'updated' : 'created'} successfully!`, 'success');
        this.currentInvoiceItems = [];
    }

    editInvoice(invoiceId) {
        this.showInvoiceModal(invoiceId);
    }

    deleteInvoice(invoiceId) {
        if (confirm('Are you sure you want to delete this invoice? This will also remove any associated credit entry.')) {
            // --- NEW --- Delete associated credit
            const credit = this.db.getAll('credits').find(c => c.invoiceId === invoiceId);
            if (credit) {
                this.db.delete('credits', credit.id);
            }
            // --- END NEW ---

            this.db.delete('invoices', invoiceId);
            this.loadInvoices();
            if (this.currentPage === 'customers') this.loadCustomers();
            this.refreshDashboard();
            this.showNotification('Invoice and associated credit deleted successfully!', 'success');
        }
    }

    async printInvoice(invoiceId) {
        // Inside your printInvoice function, find where it gets the invoice and customer.
        // It will look like this:
        const invoice = this.db.getById('invoices', invoiceId);
        const customer = this.db.getById('customers', invoice.customerId);
        const settings = this.db.getSettings();

        if (!invoice || !customer) {
            this.showNotification('Invoice or customer data not found!', 'error');
            return;
        }
        // --- NEW: CALCULATE PREVIOUS DUE AND GRAND TOTAL ---
        let previousDue = 0;
        const customerCredits = this.db.getAll('credits').filter(c => c.customerId === customer.id);

        customerCredits.forEach(cred => {
            // IMPORTANT: Exclude the credit amount from the CURRENT invoice being printed
            if (cred.invoiceId !== invoiceId) {
                previousDue += (cred.remainingAmount || 0);
            }
        });
        // Check if an advance payment was made for this invoice (using the credit entry)
        const creditEntry = this.db.getAll('credits').find(c => c.invoiceId === invoiceId);
        const advancePayment = creditEntry ? creditEntry.payments.reduce((sum, p) => sum + p.amount, 0) : 0;

        // Calculate the remaining amount for the current invoice
        const currentRemaining = invoice.total - advancePayment;

        // The grand total is the remaining amount of the current invoice plus any previous dues
        const grandTotal = currentRemaining + previousDue;
        // --- END NEW ---

        function numberToWords(num) {
            if (num === 0) return 'Zero';
            const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
            const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
            function convertHundreds(n) {
                let result = '';
                if (n > 99) {
                    result += ones[Math.floor(n / 100)] + ' Hundred ';
                    n %= 100;
                }
                if (n > 19) {
                    result += tens[Math.floor(n / 10)] + ' ';
                    n %= 10;
                }
                if (n > 0) {
                    result += ones[n] + ' ';
                }
                return result;
            }
            let result = '';
            let crores = Math.floor(num / 10000000);
            num %= 10000000;
            let lakhs = Math.floor(num / 100000);
            num %= 100000;
            let thousands = Math.floor(num / 1000);
            num %= 1000;
            let hundreds = num;
            if (crores > 0) result += convertHundreds(crores) + 'Crore ';
            if (lakhs > 0) result += convertHundreds(lakhs) + 'Lakh ';
            if (thousands > 0) result += convertHundreds(thousands) + 'Thousand ';
            if (hundreds > 0) result += convertHundreds(hundreds);
            return result.trim();
        }

        // --- UPDATED PRINT TEMPLATE ---
        const printContentHTML = `
            <div style="width: 210mm; padding: 15mm; background: white; color: black; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.3;">
                <div class="invoice-header" style="text-align: center; margin-bottom: 20px;"><h1 class="invoice-title" style="font-size: 22px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px;">INVOICE</h1></div>
                <div class="invoice-info" style="display: flex; justify-content: space-between; margin-bottom: 20px; gap: 20px;">
                    <div class="consignee-section" style="flex: 1; max-width: 45%;">
                        <h3 class="section-title" style="font-size: 12px; font-weight: bold; margin-bottom: 8px; text-decoration: underline;">Consignee (Ship to)</h3>
                        <div class="address-info" style="font-size: 10px;">
                            <p style="margin-bottom: 2px;"><strong>${customer.name}</strong></p>
                            <p style="margin-bottom: 2px;">Buyer (Bill to)</p>
                            <p style="margin-bottom: 2px;">${customer.address || ''}</p>
                            <p style="margin-bottom: 2px;">Phone: ${customer.phone}</p>
                        </div>
                    </div>
                    <div class="details-section" style="flex: 1; max-width: 50%;">
                        <table class="details-table" style="width: 100%; border-collapse: collapse; border: 2px solid #000;">
                            <tr><td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Invoice No.</td><td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%;">${invoice.invoiceNumber}</td></tr>
                            <tr><td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Dated</td><td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%;">${new Date(invoice.invoiceDate).toLocaleDateString('en-IN')}</td></tr>
                            ${invoice.status === 'paid' && invoice.paymentDate ? `
                                <tr>
                                    <td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Payment Date</td>
                                    <td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%;">${new Date(invoice.paymentDate).toLocaleDateString('en-IN')}</td>
                                </tr>
                            ` : ''}
                            ${invoice.status === 'paid' && invoice.paymentMethod ? `
                                <tr>
                                    <td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Payment Method</td>
                                    <td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%; text-transform: capitalize;">${invoice.paymentMethod}</td>
                                </tr>
                            ` : `
                                <tr>
                                    <td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Due Date</td>
                                    <td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%;">${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-IN') : 'N/A'}</td>
                                </tr>
                            `}
                        </table>
                    </div>
                </div>
                <table class="items-table" style="width: 100%; border-collapse: collapse; border: 2px solid #000; margin: 15px 0;">
                    <thead>
                        <tr>
                            <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 5%;">S.L</th>
                            <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 45%;">Description of Goods</th>
                            <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 15%;">Quantity</th>
                            <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 12%;">Rate</th>
                            <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 8%;">per</th>
                            <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 15%;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${invoice.items.map((item, index) => {
            const product = this.db.getById('products', item.productId);
            const unit = product?.unit || 'PCS';
            return `
                        <tr>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: center;">${index + 1}</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: left;">${product ? product.name : 'Unknown Product'}</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: center;">${item.quantity} ${unit.toUpperCase()}</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: right;">${item.rate.toFixed(2)}</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: center;">${unit.toUpperCase()}</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: right;">${item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>`;
        }).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" style="border: 1px solid #000; text-align: right; padding-right: 10px; font-weight: bold;">Total</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: right; font-weight: bold;">₹ ${invoice.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                        ${advancePayment > 0 ? `
                        <tr>
                            <td colspan="5" style="border: 1px solid #000; text-align: right; padding-right: 10px; font-weight: bold;">Less: Advance Received</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: right; font-weight: bold;">₹ ${advancePayment.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>` : ''}
                        ${previousDue > 0 ? `
                        <tr>
                            <td colspan="5" style="border: 1px solid #000; text-align: right; padding-right: 10px; font-weight: bold;">Previous Due</td>
                            <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: right; font-weight: bold;">₹ ${previousDue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>` : ''}
                        <tr style="background-color: #f0f0f0; font-weight: bold;">
                             <td colspan="5" style="border: 1px solid #000; text-align: right; padding-right: 10px; font-size: 11px; font-weight: bold;">GRAND TOTAL</td>
                             <td style="border: 1px solid #000; padding: 4px 3px; font-size: 11px; text-align: right; font-weight: bold;">₹ ${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                    </tfoot>
                </table>
                <div class="invoice-footer" style="display: flex; justify-content: space-between; margin-top: 25px; margin-bottom: 15px;">
                    <div class="footer-left" style="flex: 1; max-width: 60%;">
                        <div class="amount-words">
                            <h4 style="font-size: 11px; margin-bottom: 4px; text-decoration: underline;">Amount Chargeable (in words)</h4>
                            <p style="font-size: 10px; margin-bottom: 12px;">Rs ${numberToWords(Math.floor(grandTotal))} Only</p>
                        </div>
                        <div class="declaration" style="font-size: 8px; line-height: 1.2; margin-top: 15px;"><p>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</p></div>
                    </div>
                    <div class="footer-right" style="flex: 1; max-width: 35%; text-align: right;">
                        <div class="signature-section" style="text-align: center; margin-top: 30px;">
                            <p style="font-size: 9px; margin-bottom: 4px;">for ${settings.businessName || 'Your Business'}</p>
                            <div class="signature-line" style="border-top: 1px solid #000; margin: 25px 0 4px 0; width: 120px; margin-left: auto; margin-right: auto;"></div>
                            <p style="font-size: 9px; margin-bottom: 4px;">Authorised Signatory</p>
                        </div>
                    </div>
                </div>
            </div>`;
        // --- END UPDATED TEMPLATE ---

        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.innerHTML = printContentHTML;
        document.body.appendChild(tempContainer);

        this.showNotification('Creating PDF, please wait...', 'info');

        try {
            const canvas = await html2canvas(tempContainer.firstElementChild, { scale: 2 });
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`Invoice-${invoice.invoiceNumber}.pdf`);
            this.showNotification('Invoice saved to PDF successfully!', 'success');
        } catch (error) {
            console.error('Error creating PDF:', error);
            this.showNotification('Failed to create PDF.', 'error');
        } finally {
            document.body.removeChild(tempContainer);
        }
    }

    filterInvoices() {
        const searchTerm = document.getElementById('invoice-search')?.value.toLowerCase() || '';
        const statusFilter = document.getElementById('invoice-status-filter')?.value || '';

        let invoices = this.db.getAll('invoices');
        const customers = this.db.getAll('customers');

        if (searchTerm) {
            invoices = invoices.filter(invoice => {
                const customer = customers.find(c => c.id === invoice.customerId);
                return (
                    (invoice.invoiceNumber || '').toLowerCase().includes(searchTerm) ||
                    (customer ? customer.name.toLowerCase().includes(searchTerm) : false)
                );
            });
        }

        if (statusFilter) {
            invoices = invoices.filter(invoice => {
                if (statusFilter === 'overdue') {
                    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
                    return dueDate && dueDate < new Date() && invoice.status === 'pending';
                }
                return invoice.status === statusFilter;
            });
        }
        this.renderInvoices(invoices);
    }

    updateInvoiceItem(index, productId, rate) {
        if (this.currentInvoiceItems[index]) {
            this.currentInvoiceItems[index].productId = productId;
            this.currentInvoiceItems[index].rate = rate;
        }
        document.getElementById('items-container').innerHTML = this.renderInvoiceItems();
        this.calculateInvoiceTotal();
    }

    // Quotation Management
    loadQuotations() {
        const quotations = this.db.getAll('quotations');
        this.renderQuotations(quotations);
    }

    renderQuotations(quotations) {
        const customers = this.db.getAll('customers');
        const tbody = document.querySelector('#quotations-table tbody');
        if (quotations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">No quotations found</td></tr>';
            return;
        }
        tbody.innerHTML = quotations.map(quotation => {
            const customer = customers.find(c => c.id === quotation.customerId);
            return `
                <tr>
                    <td>${quotation.quotationNumber || 'N/A'}</td>
                    <td>${customer ? customer.name : 'Unknown'}</td>
                    <td>${quotation.createdAt ? new Date(quotation.createdAt).toLocaleDateString('en-IN') : 'N/A'}</td>
                    <td>${quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString('en-IN') : 'N/A'}</td>
                    <td>₹${(quotation.total || 0).toLocaleString('en-IN')}</td>
                    <td><span class="status-badge status-${quotation.status || 'pending'}">${quotation.status || 'pending'}</span></td>
                    <td>
                        <button class="action-btn edit" onclick="app.editQuotation('${quotation.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="action-btn" onclick="app.printQuotation('${quotation.id}')" title="Print" style="background-color: #28a745;"><i class="fas fa-print"></i></button>
                        <button class="action-btn" onclick="app.convertToInvoice('${quotation.id}')" title="Convert to Invoice" style="background-color: #17a2b8;"><i class="fas fa-exchange-alt"></i></button>
                        <button class="action-btn delete" onclick="app.deleteQuotation('${quotation.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
        }).join('');
    }

    showQuotationModal(quotationId = null, initialState = null) {
        const isEdit = !!quotationId;
        const quotation = isEdit ? this.db.getById('quotations', quotationId) : null;
        const customers = this.db.getAll('customers');

        const data = initialState || quotation || {};
        this.currentQuotationItems = data.items || [];
        const customerName = data.customerId ? this.db.getById('customers', data.customerId)?.name : '';

        const content = `
            <form id="quotation-form" style="display: grid; gap: 15px;">
                <input type="hidden" name="quotationId" value="${quotationId || ''}">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="form-group">
                        <label>Customer *</label>
                        <div style="display: flex; gap: 10px;">
                            <div class="searchable-select" style="flex: 1;">
                                <input type="text" class="searchable-select-input" placeholder="Search and select a customer..."
                                    onkeyup="app.filterSearchableOptions(this)"
                                    onclick="this.nextElementSibling.classList.toggle('active')"
                                    value="${customerName}" autocomplete="off">
                                <div class="searchable-select-dropdown">
                                    ${customers.map(c => `<div class="searchable-select-option" data-value="${c.id}" onclick="app.selectSearchableOption(this, true)">${c.name} - ${c.phone}</div>`).join('')}
                                </div>
                                <input type="hidden" name="customerId" value="${data.customerId || ''}" required>
                            </div>
                            <button type="button" class="btn btn-sm btn-secondary" onclick="app.showCustomerModalInlineForQuotation()"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Valid Until</label>
                        <input type="date" name="validUntil" value="${data.validUntil ? data.validUntil.split('T')[0] : ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>
                <div class="form-group">
                    <label>Items</label>
                    <div id="quotation-items">
                        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 10px; font-weight: bold;">
                            <div>Product</div><div>Quantity</div><div>Rate</div><div>Amount</div><div>Action</div>
                        </div>
                        <div id="quotation-items-container">${this.renderQuotationItems()}</div>
                        <button type="button" class="btn btn-sm btn-primary" onclick="app.addQuotationItem()"><i class="fas fa-plus"></i> Add Item</button>
                    </div>
                </div>
                <div class="form-group"><div style="text-align: right; font-size: 18px; font-weight: bold;">Total: ₹<span id="quotation-total">0</span></div></div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea name="notes" rows="3" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">${data.notes || ''}</textarea>
                </div>
            </form>`;

        const actions = [
            { text: 'Cancel', class: 'btn-secondary', action: 'closeModal' },
            { text: isEdit ? 'Update Quotation' : 'Create Quotation', class: 'btn-primary', icon: 'fas fa-save', action: `saveQuotation('${quotationId || ''}')` }
        ];

        this.showModal(isEdit ? 'Edit Quotation' : 'New Quotation', content, actions);
        this.calculateQuotationTotal();
    }

    renderQuotationItems() {
        const products = this.db.getAll('products');
        return this.currentQuotationItems.map((item, index) => {
            const productName = item.productId ? this.db.getById('products', item.productId)?.name : '';
            return `
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 10px; margin-bottom: 10px; align-items: center;" data-index="${index}">
                <div style="display: flex; gap: 5px;">
                    <div class="searchable-select" style="flex: 1;">
                        <input type="text" class="searchable-select-input" placeholder="Search product..."
                               onkeyup="app.filterSearchableOptions(this)"
                               onclick="this.nextElementSibling.classList.toggle('active')"
                               value="${productName}" autocomplete="off">
                        <div class="searchable-select-dropdown">
                            ${products.map(p => `<div class="searchable-select-option" data-value="${p.id}" data-rate="${p.sellingPrice || 0}" onclick="app.selectSearchableOption(this)">${p.name} - ₹${(p.sellingPrice || 0).toLocaleString('en-IN')}</div>`).join('')}
                        </div>
                        <input type="hidden" class="item-product-id" value="${item.productId || ''}">
                    </div>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="app.showProductModalInlineForQuotation(${index})" title="Add New Product"><i class="fas fa-plus"></i></button>
                </div>
                <input type="number" class="item-quantity" value="${item.quantity || 1}" min="1" onchange="app.calculateQuotationTotal()" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                <input type="number" class="item-rate" value="${item.rate || 0}" step="0.01" min="0" onchange="app.calculateQuotationTotal()" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                <div class="item-amount">₹${((item.quantity || 1) * (item.rate || 0)).toLocaleString('en-IN')}</div>
                <button type="button" class="action-btn delete" onclick="app.removeQuotationItem(${index})"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
    }

    addQuotationItem() {
        this.currentQuotationItems.push({ productId: '', quantity: 1, rate: 0, amount: 0 });
        document.getElementById('quotation-items-container').innerHTML = this.renderQuotationItems();
        this.calculateQuotationTotal();
    }

    removeQuotationItem(index) {
        this.currentQuotationItems.splice(index, 1);
        document.getElementById('quotation-items-container').innerHTML = this.renderQuotationItems();
        this.calculateQuotationTotal();
    }

    calculateQuotationTotal() {
        let total = 0;
        const itemContainers = document.querySelectorAll('#quotation-items-container > div[data-index]');
        this.currentQuotationItems = [];
        itemContainers.forEach(container => {
            const productId = container.querySelector('.item-product-id').value;
            const quantity = parseFloat(container.querySelector('.item-quantity').value) || 0;
            const rate = parseFloat(container.querySelector('.item-rate').value) || 0;
            const amount = quantity * rate;
            container.querySelector('.item-amount').textContent = `₹${amount.toLocaleString('en-IN')}`;
            total += amount;
            this.currentQuotationItems.push({ productId, quantity, rate, amount });
        });
        const totalElement = document.getElementById('quotation-total');
        if (totalElement) {
            totalElement.textContent = total.toLocaleString('en-IN');
        }
        return total;
    }

    saveQuotation(quotationId = '') {
        const form = document.getElementById('quotation-form');
        if (!form) return;
        const formData = new FormData(form);
        const customerId = formData.get('customerId');
        if (!customerId) {
            this.showNotification('Please select a customer!', 'error');
            return;
        }
        if (this.currentQuotationItems.length === 0 || !this.currentQuotationItems.some(item => item.productId)) {
            this.showNotification('Please add at least one item!', 'error');
            return;
        }
        const total = this.calculateQuotationTotal();
        const settings = this.db.getSettings();
        const quotation = {
            id: quotationId || undefined,
            quotationNumber: quotationId ? this.db.getById('quotations', quotationId).quotationNumber : `${settings.quotationPrefix}-${this.db.getNextNumber('quotation')}`,
            customerId: customerId,
            validUntil: formData.get('validUntil') || null,
            items: [...this.currentQuotationItems],
            total: total,
            status: 'pending',
            notes: formData.get('notes')
        };
        this.db.save('quotations', quotation);
        this.closeModal();
        this.loadQuotations();
        this.showNotification(`Quotation ${quotationId ? 'updated' : 'created'} successfully!`, 'success');
    }

    editQuotation(quotationId) {
        this.showQuotationModal(quotationId);
    }

    deleteQuotation(quotationId) {
        if (confirm('Are you sure you want to delete this quotation?')) {
            this.db.delete('quotations', quotationId);
            this.loadQuotations();
            this.showNotification('Quotation deleted successfully!', 'success');
        }
    }

    convertToInvoice(quotationId) {
        const quotation = this.db.getById('quotations', quotationId);
        if (!quotation) {
            this.showNotification('Quotation not found!', 'error');
            return;
        }
        if (confirm('Convert this quotation to an invoice?')) {
            const settings = this.db.getSettings();
            const invoice = {
                invoiceNumber: `${settings.invoicePrefix}-${this.db.getNextNumber('invoice')}`,
                customerId: quotation.customerId,
                items: quotation.items,
                total: quotation.total,
                status: 'pending',
                notes: `Converted from Quotation #${quotation.quotationNumber}\n${quotation.notes || ''}`,
                convertedFrom: quotationId
            };
            this.db.save('invoices', invoice);
            quotation.status = 'converted';
            this.db.save('quotations', quotation);
            this.loadQuotations();
            this.showNotification('Quotation converted to invoice successfully!', 'success');
        }
    }


    async printQuotation(quotationId) {
        const quotation = this.db.getById('quotations', quotationId);
        const customer = this.db.getById('customers', quotation.customerId);
        const settings = this.db.getSettings();

        if (!quotation || !customer) {
            this.showNotification('Quotation or customer data not found!', 'error');
            return;
        }

        // Number to words conversion function
        function numberToWords(num) {
            if (num === 0) return 'Zero';
            const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
            const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
            function convertHundreds(n) {
                let result = '';
                if (n > 99) {
                    result += ones[Math.floor(n / 100)] + ' Hundred ';
                    n %= 100;
                }
                if (n > 19) {
                    result += tens[Math.floor(n / 10)] + ' ';
                    n %= 10;
                }
                if (n > 0) {
                    result += ones[n] + ' ';
                }
                return result;
            }
            let result = '';
            let crores = Math.floor(num / 10000000);
            num %= 10000000;
            let lakhs = Math.floor(num / 100000);
            num %= 100000;
            let thousands = Math.floor(num / 1000);
            num %= 1000;
            let hundreds = num;
            if (crores > 0) result += convertHundreds(crores) + 'Crore ';
            if (lakhs > 0) result += convertHundreds(lakhs) + 'Lakh ';
            if (thousands > 0) result += convertHundreds(thousands) + 'Thousand ';
            if (hundreds > 0) result += convertHundreds(hundreds);
            return result.trim();
        }

        const printContentHTML = `
        <div style="width: 210mm; padding: 15mm; background: white; color: black; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.3;">
            <div class="quotation-header" style="text-align: center; margin-bottom: 20px;"><h1 class="quotation-title" style="font-size: 22px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 15px;">QUOTATION</h1></div>
            <div class="quotation-info" style="display: flex; justify-content: space-between; margin-bottom: 20px; gap: 20px;">
                <div class="consignee-section" style="flex: 1; max-width: 45%;">
                    <h3 class="section-title" style="font-size: 12px; font-weight: bold; margin-bottom: 8px; text-decoration: underline;">Consignee (Ship to)</h3>
                    <div class="address-info" style="font-size: 10px;">
                        <p style="margin-bottom: 2px;"><strong>${customer.name}</strong></p>
                        <p style="margin-bottom: 2px;">Buyer (Bill to)</p>
                        <p style="margin-bottom: 2px;">${customer.address || ''}</p>
                        <p style="margin-bottom: 2px;">Phone: ${customer.phone}</p>
                    </div>
                </div>
                <div class="details-section" style="flex: 1; max-width: 50%;">
                    <table class="details-table" style="width: 100%; border-collapse: collapse; border: 2px solid #000;">
                        <tr><td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Quotation No.</td><td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%;">${quotation.quotationNumber}</td></tr>
                        <tr><td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Dated</td><td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%;">${new Date(quotation.createdAt).toLocaleDateString('en-IN')}</td></tr>
                        <tr><td class="label" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; background-color: #f8f8f8; font-weight: bold; width: 60%;">Valid Until</td><td class="value" style="padding: 3px 6px; border: 1px solid #000; font-size: 9px; width: 40%;">${quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString('en-IN') : 'N/A'}</td></tr>
                    </table>
                </div>
            </div>
            <table class="items-table" style="width: 100%; border-collapse: collapse; border: 2px solid #000; margin: 15px 0;">
                <thead>
                    <tr>
                        <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 5%;">S.L</th>
                        <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 45%;">Description of Goods</th>
                        <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 15%;">Quantity</th>
                        <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 12%;">Rate</th>
                        <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 8%;">per</th>
                        <th style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; background-color: #f8f8f8; font-weight: bold; text-align: center; width: 15%;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${quotation.items.map((item, index) => {
            const product = this.db.getById('products', item.productId);
            const unit = product?.unit || 'PCS';
            return `
                                <tr>
                                    <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: center;">${index + 1}</td>
                                    <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: left;">${product ? product.name : 'Unknown Product'}</td>
                                    <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: center;">${item.quantity} ${unit.toUpperCase()}</td>
                                    <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: right;">${item.rate.toFixed(2)}</td>
                                    <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: center;">${unit.toUpperCase()}</td>
                                    <td style="border: 1px solid #000; padding: 4px 3px; font-size: 9px; text-align: right;">${item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                </tr>`;
        }).join('')}
                </tbody>
                <tfoot>
                    <tr style="background-color: #f0f0f0; font-weight: bold;">
                         <td colspan="5" style="border: 1px solid #000; text-align: right; padding-right: 10px; font-size: 11px; font-weight: bold;">GRAND TOTAL</td>
                         <td style="border: 1px solid #000; padding: 4px 3px; font-size: 11px; text-align: right; font-weight: bold;">₹ ${quotation.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                </tfoot>
            </table>
            <div class="quotation-footer" style="display: flex; justify-content: space-between; margin-top: 25px; margin-bottom: 15px;">
                <div class="footer-left" style="flex: 1; max-width: 60%;">
                    <div class="amount-words">
                        <h4 style="font-size: 11px; margin-bottom: 4px; text-decoration: underline;">Amount Chargeable (in words)</h4>
                        <p style="font-size: 10px; margin-bottom: 12px;">Rs ${numberToWords(Math.floor(quotation.total))} Only</p>
                    </div>
                    <div class="notes" style="font-size: 10px; line-height: 1.2; margin-top: 15px;">
                        <h4 style="font-size: 11px; margin-bottom: 4px; text-decoration: underline;">Notes:</h4>
                        <p>${quotation.notes || 'N/A'}</p>
                    </div>
                </div>
                <div class="footer-right" style="flex: 1; max-width: 35%; text-align: right;">
                    <div class="signature-section" style="text-align: center; margin-top: 30px;">
                        <p style="font-size: 9px; margin-bottom: 4px;">for ${settings.businessName || 'Your Business'}</p>
                        <div class="signature-line" style="border-top: 1px solid #000; margin: 25px 0 4px 0; width: 120px; margin-left: auto; margin-right: auto;"></div>
                        <p style="font-size: 9px; margin-bottom: 4px;">Authorised Signatory</p>
                    </div>
                </div>
            </div>
        </div>`;

        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.innerHTML = printContentHTML;
        document.body.appendChild(tempContainer);

        this.showNotification('Creating PDF, please wait...', 'info');

        try {
            const canvas = await html2canvas(tempContainer.firstElementChild, { scale: 2 });
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`Quotation-${quotation.quotationNumber}.pdf`);
            this.showNotification('Quotation saved to PDF successfully!', 'success');
        } catch (error) {
            console.error('Error creating PDF:', error);
            this.showNotification('Failed to create PDF.', 'error');
        } finally {
            document.body.removeChild(tempContainer);
        }
    }

    updateQuotationItem(index, productId, rate) {
        if (this.currentQuotationItems[index]) {
            this.currentQuotationItems[index].productId = productId;
            this.currentQuotationItems[index].rate = rate;
        }
        document.getElementById('quotation-items-container').innerHTML = this.renderQuotationItems();
        this.calculateQuotationTotal();
    }

    // Customer Management
    loadCustomers() {
        const customers = this.db.getAll('customers');
        this.renderCustomers(customers);
    }

    showCustomerModal(customerId = null) {
        const isEdit = !!customerId;
        const customer = isEdit ? this.db.getById('customers', customerId) : null;
        const content = `
            <form id="customer-form" style="display: grid; gap: 15px;">
                <input type="hidden" name="customerId" value="${customerId || ''}">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="form-group">
                        <label>Customer Name *</label>
                        <input type="text" name="name" value="${customer ? customer.name : ''}" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    <div class="form-group">
                        <label>Phone Number *</label>
                        <input type="tel" name="phone" value="${customer ? customer.phone : ''}" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" name="email" value="${customer ? (customer.email || '') : ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    <div class="form-group">
                        <label>GST Number</label>
                        <input type="text" name="gstNumber" value="${customer ? (customer.gstNumber || '') : ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>
                <div class="form-group">
                    <label>Address</label>
                    <textarea name="address" rows="3" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">${customer ? (customer.address || '') : ''}</textarea>
                </div>
            </form>
        `;

        const actions = [
            { text: 'Cancel', class: 'btn-secondary', action: 'closeModal' },
            { text: isEdit ? 'Update Customer' : 'Add Customer', class: 'btn-primary', icon: 'fas fa-save', action: `saveCustomer('${customerId || ''}')` }
        ];

        this.showModal(isEdit ? 'Edit Customer' : 'Add Customer', content, actions);
    }


    renderCustomers(customers) {
        const invoices = this.db.getAll('invoices');
        const credits = this.db.getAll('credits');
        const tbody = document.querySelector('#customers-table tbody');

        if (customers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="no-data">No customers found</td></tr>';
            return;
        }

        tbody.innerHTML = customers.map(customer => {
            const customerInvoices = invoices.filter(inv => inv.customerId === customer.id);
            const totalOrders = customerInvoices.length;
            const totalAmount = customerInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
            const customerCredits = credits.filter(cred => cred.customerId === customer.id && cred.status === 'pending');
            const pendingCredit = customerCredits.reduce((sum, cred) => sum + (cred.remainingAmount || 0), 0);

            return `
        <tr>
            <td>${customer.name}</td>
             <td>${customer.phone}</td>
            <td>${customer.email || 'N/A'}</td>
            <td>${totalOrders}</td>
            <td>₹${totalAmount.toLocaleString('en-IN')}</td>
            <td style="color: ${pendingCredit > 0 ? 'red' : 'green'}; font-weight: bold;">
                ₹${pendingCredit.toLocaleString('en-IN')}
            </td>
            <td>
                <button class="action-btn" onclick="app.showPaymentModal('${customer.id}')" title="Record Payment" style="background-color: #ffc107;">
                    <i class="fas fa-hand-holding-usd"></i>
                </button>
                <button class="action-btn statement" onclick="app.showPartyStatement('${customer.id}')" title="View Statement"><i class="fas fa-list-alt"></i></button>
                <button class="action-btn edit" onclick="app.editCustomer('${customer.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete" onclick="app.deleteCustomer('${customer.id}')" title="Delete"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
        }).join('');
    }

    showCustomerModalInline() {
        this.calculateInvoiceTotal();
        const form = document.getElementById('invoice-form');
        this.stashedInvoiceState = {
            invoiceId: form.querySelector('input[name="invoiceId"]').value,
            customerId: form.querySelector('input[name="customerId"]').value,
            status: form.querySelector('#invoice-status').value,
            invoiceDate: form.querySelector('#invoice-date').value,
            dueDate: form.querySelector('#invoice-due-date').value,
            paymentDate: form.querySelector('#payment-date').value,
            paymentMethod: form.querySelector('#payment-method').value,
            notes: form.querySelector('#invoice-notes').value,
            items: [...this.currentInvoiceItems]
        };
        this.showCustomerModal();
    }

    showCustomerModalInlineForQuotation() {
        this.calculateQuotationTotal();
        const form = document.getElementById('quotation-form');
        this.stashedQuotationState = {
            quotationId: form.querySelector('input[name="quotationId"]').value,
            customerId: form.querySelector('input[name="customerId"]').value,
            validUntil: form.querySelector('input[name="validUntil"]').value,
            notes: form.querySelector('textarea[name="notes"]').value,
            items: [...this.currentQuotationItems]
        };
        this.showCustomerModal();
    }

    saveCustomer(customerId = '') {
        const form = document.getElementById('customer-form');
        if (!form) return;
        const formData = new FormData(form);
        const customerData = {
            id: customerId || undefined,
            name: formData.get('name'),
            phone: formData.get('phone'),
            email: formData.get('email'),
            gstNumber: formData.get('gstNumber'),
            address: formData.get('address')
        };
        if (!customerData.name || !customerData.phone) {
            this.showNotification('Please fill all required fields!', 'error');
            return;
        }

        const savedCustomer = this.db.save('customers', customerData);

        if (this.stashedInvoiceState) {
            const state = this.stashedInvoiceState;
            this.stashedInvoiceState = null;
            state.customerId = savedCustomer.id;
            this.showInvoiceModal(state.invoiceId, state);
        } else if (this.stashedQuotationState) {
            const state = this.stashedQuotationState;
            this.stashedQuotationState = null;
            state.customerId = savedCustomer.id;
            this.showQuotationModal(state.quotationId, state);
        } else {
            this.closeModal();
            this.loadCustomers();
        }
        this.showNotification(`Customer ${customerId ? 'updated' : 'added'} successfully!`, 'success');
    }

    editCustomer(customerId) {
        this.showCustomerModal(customerId);
    }

    deleteCustomer(customerId) {
        const invoices = this.db.getAll('invoices').filter(inv => inv.customerId === customerId);
        const quotations = this.db.getAll('quotations').filter(quo => quo.customerId === customerId);
        if (invoices.length > 0 || quotations.length > 0) {
            this.showNotification('Cannot delete customer with existing invoices or quotations!', 'error');
            return;
        }
        if (confirm('Are you sure you want to delete this customer?')) {
            this.db.delete('customers', customerId);
            this.loadCustomers();
            this.showNotification('Customer deleted successfully!', 'success');
        }
    }

    // Add this function to the InvoiceApp class
    showCustomerSelectionForStatement() {
        const customers = this.db.getAll('customers');
        const content = `
        <div class="form-group">
            <label for="statement-customer-select">Select Customer</label>
            <select id="statement-customer-select" class="form-control" required>
                <option value="">-- Select a Customer --</option>
                ${customers.map(c => `<option value="${c.id}">${c.name} (${c.phone})</option>`).join('')}
            </select>
        </div>
        `;

        const actions = [
            { text: 'Cancel', class: 'btn-secondary', action: 'closeModal' },
            { text: 'View Statement', class: 'btn-primary', action: 'viewSelectedStatement()' }
        ];

        this.showModal('View Customer Statement', content, actions);

        // Attach event listener for the "View Statement" button inside the modal
        const viewButton = document.querySelector('.modal-footer .btn-primary');
        if (viewButton) {
            viewButton.onclick = () => {
                const customerId = document.getElementById('statement-customer-select').value;
                if (customerId) {
                    this.closeModal();
                    this.showPartyStatement(customerId);
                } else {
                    this.showNotification('Please select a customer.', 'error');
                }
            };
        }
    }

    /**
 * Displays a modal with a party statement and date range selection.
 * @param {string} customerId The ID of the customer to generate the statement for.
 */
    showPartyStatement(customerId) {
        const customer = this.db.getById('customers', customerId);
        if (!customer) {
            this.showNotification('Customer not found', 'error');
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const content = `
        <div id="statement-controls" style="display: flex; gap: 10px; margin-bottom: 20px; align-items: flex-end;">
            <div class="form-group" style="flex: 1;">
                <label for="statement-start-date">Start Date</label>
                <input type="date" id="statement-start-date" value="${thirtyDaysAgo}" class="form-control" style="width: 100%;">
            </div>
            <div class="form-group" style="flex: 1;">
                <label for="statement-end-date">End Date</label>
                <input type="date" id="statement-end-date" value="${today}" class="form-control" style="width: 100%;">
            </div>
            <button class="btn btn-primary" onclick="app.refreshStatementView('${customerId}')">View</button>
        </div>
        <div id="statement-content-area" class="table-container">
            <p class="no-data" style="text-align: center; margin-top: 20px;">Select a date range and click 'View' to generate the statement.</p>
        </div>
        `;

        const actions = [
            { text: 'Cancel', class: 'btn-secondary', action: 'closeModal' },
            { text: 'Print Statement', class: 'btn-success', icon: 'fas fa-print', action: `printStatement('${customerId}')` }
        ];

        this.showModal(`Statement for ${customer.name}`, content, actions, 'large');
    }

    /**
     * Refreshes the statement view inside the modal based on the selected dates.
     * This is the function that actually generates the on-screen table.
     */
    refreshStatementView(customerId) {
        const startDate = document.getElementById('statement-start-date').value;
        const endDate = document.getElementById('statement-end-date').value;
        const contentArea = document.getElementById('statement-content-area');

        if (!startDate || !endDate) {
            contentArea.innerHTML = '<p class="no-data" style="text-align: center;">Please select a valid date range.</p>';
            return;
        }

        const statementData = this.generateImprovedStatement(customerId, startDate, endDate);
        const { summary, transactions } = statementData;
        let runningBalance = summary.openingBalance;

        const statementRows = transactions.map(t => {
            runningBalance += (t.debit || 0) - (t.credit || 0);
            return `
            <tr>
                <td style="text-align: center;">${t.date ? new Date(t.date).toLocaleDateString('en-IN') : '—'}</td>
                <td>${t.particulars || '—'}</td>
                <td style="text-align: right;">${t.debit > 0 ? `₹${t.debit.toLocaleString('en-IN')}` : '-'}</td>
                <td style="text-align: right;">${t.credit > 0 ? `₹${t.credit.toLocaleString('en-IN')}` : '-'}</td>
                <td style="text-align: right;">₹${runningBalance.toLocaleString('en-IN')}</td>
            </tr>
        `;
        }).join('');

        const tableHTML = `
        <table id="statement-table" class="table table-bordered">
            <thead>
                <tr>
                    <th style="text-align: center;">Date</th>
                    <th>Particulars</th>
                    <th style="text-align: right;">Debit (₹)</th>
                    <th style="text-align: right;">Credit (₹)</th>
                    <th style="text-align: right;">Balance (₹)</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td colspan="4" style="text-align: right; font-weight: bold;">Opening Balance:</td>
                    <td style="text-align: right; font-weight: bold;">₹${summary.openingBalance.toLocaleString('en-IN')}</td>
                </tr>
                ${statementRows || '<tr><td colspan="5" class="no-data">No transactions found for this period.</td></tr>'}
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="4" style="text-align: right; font-weight: bold;">Closing Balance:</td>
                    <td style="text-align: right; font-weight: bold;">₹${summary.closingBalance.toLocaleString('en-IN')}</td>
                </tr>
            </tfoot>
        </table>
    `;

        contentArea.innerHTML = tableHTML;
    }

    /**
     * Helper function to generate structured statement data for a given period.
     * This function will be called by both refreshStatementView and printStatement.
     * @param {string} customerId
     * @param {string} startDate
     * @param {string} endDate
     * @returns {{summary: object, transactions: array}}
     */
    generateImprovedStatement(customerId, startDate, endDate) {
        const invoices = this.db.getAll('invoices').filter(inv => inv.customerId === customerId);
        const credits = this.db.getAll('credits').filter(c => c.customerId === customerId);

        const startPeriod = new Date(startDate);
        startPeriod.setHours(0, 0, 0, 0);
        const endPeriod = new Date(endDate);
        endPeriod.setHours(23, 59, 59, 999);

        let allTransactions = [];

        // Process all invoices to build transaction list
        invoices.forEach(inv => {
            allTransactions.push({
                date: new Date(inv.invoiceDate || inv.createdAt),
                type: 'invoice',
                id: inv.id,
                particulars: `Invoice #${inv.invoiceNumber}`,
                debit: inv.total,
                credit: 0
            });
        });

        // Process all credit/payment entries to build transaction list
        credits.forEach(cred => {
            (cred.payments || []).forEach(p => {
                allTransactions.push({
                    date: new Date(p.date),
                    type: 'payment',
                    id: cred.id,
                    particulars: `Payment Received (${p.method})`,
                    debit: 0,
                    credit: p.amount
                });
            });
        });

        allTransactions.sort((a, b) => a.date - b.date);

        let openingBalance = 0;
        const transactionsInPeriod = [];

        allTransactions.forEach(tx => {
            if (tx.date < startPeriod) {
                openingBalance += (tx.debit || 0) - (tx.credit || 0);
            } else if (tx.date >= startPeriod && tx.date <= endPeriod) {
                transactionsInPeriod.push(tx);
            }
        });

        const totalDebits = transactionsInPeriod.reduce((sum, tx) => sum + (tx.debit || 0), 0);
        const totalCredits = transactionsInPeriod.reduce((sum, tx) => sum + (tx.credit || 0), 0);
        const closingBalance = openingBalance + totalDebits - totalCredits;

        return {
            summary: {
                openingBalance,
                totalDebits,
                totalCredits,
                closingBalance
            },
            transactions: transactionsInPeriod
        };
    }
    // In swapnil.js

    /**
     * Prints a party statement for a given customer and date range.
     */
    async printStatement(customerId) {
        // 1. Get the necessary data and generate the statement.
        // This part is crucial to ensure the data is prepared before printing.
        const startDate = document.getElementById('statement-start-date').value;
        const endDate = document.getElementById('statement-end-date').value;

        if (!customerId || !startDate || !endDate) {
            this.showNotification('Please select a customer and a valid date range first.', 'error');
            return;
        }

        const customer = this.db.getById('customers', customerId);
        const settings = this.db.getSettings();
        const statementData = this.generateImprovedStatement(customerId, startDate, endDate);
        const { summary, transactions } = statementData;

        let runningBalance = summary.openingBalance;

        // 2. Construct the HTML content for the print window.
        const transactionRows = transactions.map(tx => {
            runningBalance += (tx.debit || 0) - (tx.credit || 0);
            return `
            <tr>
                <td style="text-align: center;">${tx.date ? new Date(tx.date).toLocaleDateString('en-IN') : '—'}</td>
                <td>${tx.particulars || '—'}</td>
                <td style="text-align: right;">${tx.debit > 0 ? `₹${tx.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td>
                <td style="text-align: right;">${tx.credit > 0 ? `₹${tx.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td>
                <td style="text-align: right;">₹${runningBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
        `;
        }).join('');

        const printContentHTML = `
        <!DOCTYPE in HTML>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Party Statement - ${customer.name}</title>
            <style>
                body {
                    font-family: 'Arial', sans-serif;
                    margin: 0;
                    padding: 20px;
                    color: #333;
                    font-size: 12px;
                }
                .statement-container {
                    max-width: 800px;
                    margin: 0 auto;
                    border: 1px solid #ddd;
                    padding: 20px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    border-bottom: 2px solid #333;
                    padding-bottom: 15px;
                    margin-bottom: 20px;
                }
                .header h1 {
                    font-size: 24px;
                    margin: 0;
                }
                .header p {
                    margin: 0;
                    font-size: 14px;
                }
                .party-info, .period-info {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 20px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                th {
                    background-color: #f5f5f5;
                    font-weight: bold;
                }
                tfoot tr.summary-row td {
                    font-weight: bold;
                    border-top: 2px solid #333;
                }
                tfoot td:last-child {
                    text-align: right;
                }
                .text-right {
                    text-align: right;
                }
                .text-center {
                    text-align: center;
                }
                .no-data {
                    text-align: center;
                    font-style: italic;
                    color: #777;
                }
            </style>
        </head>
        <body>
            <div class="statement-container">
                <div class="header">
                    <h1>${settings.businessName || 'Party Statement'}</h1>
                    <p>${settings.businessAddress || ''}</p>
                    <p>Phone: ${settings.businessPhone || ''} | Email: ${settings.businessEmail || ''}</p>
                </div>

                <div class="party-info">
                    <strong>Party Name: ${customer.name}</strong>
                    <span>Statement Date: ${new Date().toLocaleDateString('en-IN')}</span>
                </div>
                <div class="period-info">
                    <p><strong>Statement Period:</strong> ${new Date(startDate).toLocaleDateString('en-IN')} to ${new Date(endDate).toLocaleDateString('en-IN')}</p>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th class="text-center">Date</th>
                            <th>Particulars</th>
                            <th class="text-right">Debit (₹)</th>
                            <th class="text-right">Credit (₹)</th>
                            <th class="text-right">Balance (₹)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td colspan="4" style="text-align: right; font-weight: bold;">Opening Balance:</td>
                            <td class="text-right"><strong>₹${summary.openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                        </tr>
                        ${transactionRows || `<tr><td colspan="5" class="no-data">No transactions found in this period.</td></tr>`}
                    </tbody>
                    <tfoot>
                        <tr class="summary-row">
                            <td colspan="2" class="text-right"><strong>Total for Period:</strong></td>
                            <td class="text-right"><strong>₹${summary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                            <td class="text-right"><strong>₹${summary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                            <td></td>
                        </tr>
                        <tr class="summary-row">
                            <td colspan="4" class="text-right"><strong>Closing Balance:</strong></td>
                            <td class="text-right"><strong>₹${summary.closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
                        </tr>
                    </tfoot>
                </table>

            </div>
        </body>
        </html>
    `;
        // 3. Open a new window and write the content.
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(printContentHTML);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
                printWindow.print();
                printWindow.close();
            }, 500); // Delay printing to allow content to render
        } else {
            this.showNotification('Popup blocked. Please allow popups for this site to print.', 'error');
        }
    }

    showPaymentModal(customerId) {
        const customer = this.db.getById('customers', customerId);
        const customerCredits = this.db.getAll('credits').filter(c => c.customerId === customerId && c.status === 'pending');
        const totalPending = customerCredits.reduce((sum, c) => sum + c.remainingAmount, 0);

        if (totalPending <= 0) {
            this.showNotification('No pending amount for this customer.', 'info');
            return;
        }

        const content = `
            <form id="payment-form">
                <p>Total Outstanding: <strong>₹${totalPending.toLocaleString('en-IN')}</strong></p>
                <div class="form-group">
                    <label>Amount Received *</label>
                    <input type="number" name="amount" class="form-control" value="${totalPending}" required min="1" max="${totalPending}">
                </div>
                <div class="form-group">
                    <label>Payment Date</label>
                    <input type="datetime-local" name="date" class="form-control" value="${new Date().toISOString().slice(0, 16)}">
                </div>
                <div class="form-group">
                    <label>Payment Method</label>
                     <select name="method" class="form-control">
                        <option value="cash">Cash</option>
                        <option value="upi">UPI</option>
                        <option value="cheque">Cheque</option>
                        <option value="card">Credit/Debit Card</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea name="notes" class="form-control" rows="2"></textarea>
                </div>
            </form>
        `;

        const actions = [
            { text: 'Cancel', class: 'btn-secondary', action: 'closeModal' },
            { text: 'Save Payment', class: 'btn-primary', action: `savePayment('${customerId}')` }
        ];

        this.showModal(`Record Payment for ${customer.name}`, content, actions);
    }



    savePayment(customerId) {
        const form = document.getElementById('payment-form');
        const amountReceived = parseFloat(form.querySelector('[name="amount"]').value);
        if (!amountReceived || amountReceived <= 0) {
            this.showNotification('Please enter a valid amount.', 'error');
            return;
        }

        let amountToSettle = amountReceived;
        const paymentDate = form.querySelector('[name="date"]').value;
        const paymentMethod = form.querySelector('[name="method"]').value;

        const pendingCredits = this.db.getAll('credits')
            .filter(c => c.customerId === customerId && c.status === 'pending')
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        for (const credit of pendingCredits) {
            if (amountToSettle <= 0) break;

            const paymentForThisCredit = Math.min(amountToSettle, credit.remainingAmount);
            credit.remainingAmount -= paymentForThisCredit;
            amountToSettle -= paymentForThisCredit;

            if (!credit.payments) credit.payments = [];
            credit.payments.push({
                amount: paymentForThisCredit,
                date: paymentDate,
                method: paymentMethod
            });

            if (credit.remainingAmount <= 0) {
                credit.status = 'paid';
                // --- NEW: UPDATE THE LINKED INVOICE STATUS ---
                if (credit.invoiceId) {
                    const linkedInvoice = this.db.getById('invoices', credit.invoiceId);
                    if (linkedInvoice && linkedInvoice.status === 'pending') {
                        linkedInvoice.status = 'paid';
                        linkedInvoice.paymentDate = paymentDate;
                        linkedInvoice.paymentMethod = paymentMethod;
                        this.db.save('invoices', linkedInvoice);
                        this.showNotification(`Invoice #${linkedInvoice.invoiceNumber} has been marked as Paid.`, 'info');
                    }
                }
                // --- END NEW ---
            }
            this.db.save('credits', credit);
        }

        this.showNotification(`₹${amountReceived.toLocaleString('en-IN')} payment recorded successfully.`, 'success');
        this.closeModal();
        this.loadCustomers();
    }
    // --- END OF NEWLY ADDED FUNCTIONS ---

    filterCustomers() {
        const searchTerm = document.getElementById('customer-search')?.value.toLowerCase() || '';
        let customers = this.db.getAll('customers');
        if (searchTerm) {
            customers = customers.filter(c => c.name.toLowerCase().includes(searchTerm) || c.phone.includes(searchTerm) || (c.email && c.email.toLowerCase().includes(searchTerm)));
        }
        this.renderCustomers(customers);
    }

    // Product Management
    loadProducts() {
        const products = this.db.getAll('products');
        this.renderProducts(products);
        this.loadProductCategories();
    }

    renderProducts(products) {
        const tbody = document.querySelector('#products-table tbody');
        if (products.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="no-data">No products found</td></tr>';
            return;
        }
        tbody.innerHTML = products.map(product => {
            const settings = this.db.getSettings();
            const threshold = product.minStock || settings.lowStockThreshold || 10;
            const isLowStock = (product.currentStock || 0) <= threshold;
            return `
                <tr>
                    <td>${product.name}</td>
                    <td>${product.category || 'Uncategorized'}</td>
                    <td>${product.sku || 'N/A'}</td>
                    <td>${product.currentStock || 0}</td>
                    <td>${threshold}</td>
                    <td>₹${(product.sellingPrice || 0).toLocaleString('en-IN')}</td>
                    <td><span class="status-badge ${isLowStock ? 'status-low' : 'status-good'}">${isLowStock ? 'Low Stock' : 'In Stock'}</span></td>
                    <td>
                        <button class="action-btn edit" onclick="app.editProduct('${product.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="action-btn delete" onclick="app.deleteProduct('${product.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
        }).join('');
    }

    showProductModal(productId = null) {
        const isEdit = !!productId;
        const product = isEdit ? this.db.getById('products', productId) : null;
        const content = `
            <form id="product-form" style="display: grid; gap: 15px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;"><div class="form-group"><label>Product Name *</label><input type="text" name="name" value="${product ? product.name : ''}" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div><div class="form-group"><label>Category</label><input type="text" name="category" value="${product ? (product.category || '') : ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div></div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;"><div class="form-group"><label>SKU</label><input type="text" name="sku" value="${product ? (product.sku || '') : ''}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div><div class="form-group"><label>Current Stock *</label><input type="number" name="currentStock" value="${product ? (product.currentStock || 0) : 1}" min="0" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div></div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;"><div class="form-group"><label>Min Stock Level</label><input type="number" name="minStock" value="${product ? (product.minStock || 10) : 10}" min="0" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div><div class="form-group"><label>Purchase Price</label><input type="number" name="purchasePrice" value="${product ? (product.purchasePrice || 0) : 0}" step="0.01" min="0" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div></div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;"><div class="form-group"><label>Selling Price *</label><input type="number" name="sellingPrice" value="${product ? (product.sellingPrice || 0) : 0}" step="0.01" min="0" required style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"></div><div class="form-group"><label>Unit</label><select name="unit" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;"><option value="pcs" ${product && product.unit === 'pcs' ? 'selected' : ''}>Pieces</option><option value="kg" ${product && product.unit === 'kg' ? 'selected' : ''}>Kilogram</option><option value="ltr" ${product && product.unit === 'ltr' ? 'selected' : ''}>Liter</option><option value="mtr" ${product && product.unit === 'mtr' ? 'selected' : ''}>Meter</option><option value="box" ${product && product.unit === 'box' ? 'selected' : ''}>Box</option></select></div></div>
                <div class="form-group"><label>Description</label><textarea name="description" rows="3" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">${product ? (product.description || '') : ''}</textarea></div>
            </form>`;
        const actions = [
            { text: 'Cancel', class: 'btn-secondary', action: 'closeModal' },
            { text: isEdit ? 'Update Product' : 'Add Product', class: 'btn-primary', icon: 'fas fa-save', action: `saveProduct('${productId || ''}')` }
        ];
        this.showModal(isEdit ? 'Edit Product' : 'Add Product', content, actions);
    }

    saveProduct(productId = '') {
        const form = document.getElementById('product-form');
        if (!form) return;
        const formData = new FormData(form);
        const productData = {
            id: productId || undefined,
            name: formData.get('name'),
            category: formData.get('category'),
            sku: formData.get('sku'),
            currentStock: parseInt(formData.get('currentStock')),
            minStock: parseInt(formData.get('minStock')),
            purchasePrice: parseFloat(formData.get('purchasePrice')),
            sellingPrice: parseFloat(formData.get('sellingPrice')),
            unit: formData.get('unit'),
            description: formData.get('description')
        };
        if (!productData.name || productData.sellingPrice === null || isNaN(productData.sellingPrice)) {
            this.showNotification('Please fill all required fields!', 'error');
            return;
        }
        const savedProduct = this.db.save('products', productData);

        if (this.stashedInvoiceState) {
            const state = this.stashedInvoiceState;
            this.stashedInvoiceState = null;
            if (this.productModalSourceIndex !== null && state.items[this.productModalSourceIndex]) {
                state.items[this.productModalSourceIndex].productId = savedProduct.id;
            }
            this.productModalSourceIndex = null;
            this.showInvoiceModal(state.invoiceId, state);
        } else if (this.stashedQuotationState) {
            const state = this.stashedQuotationState;
            this.stashedQuotationState = null;
            if (this.productModalSourceIndex !== null && state.items[this.productModalSourceIndex]) {
                state.items[this.productModalSourceIndex].productId = savedProduct.id;
                state.items[this.productModalSourceIndex].rate = savedProduct.sellingPrice;
            }
            this.productModalSourceIndex = null;
            this.showQuotationModal(state.quotationId, state);
        } else {
            this.closeModal();
            this.loadProducts();
        }

        this.refreshDashboard();
        this.showNotification(`Product ${productId ? 'updated' : 'added'} successfully!`, 'success');
    }

    showProductModalInline(index) {
        this.productModalSourceIndex = index;
        this.calculateInvoiceTotal();
        const form = document.getElementById('invoice-form');
        this.stashedInvoiceState = {
            invoiceId: form.querySelector('input[name="invoiceId"]').value,
            customerId: form.querySelector('input[name="customerId"]').value, // ADD THIS LINE
            status: form.querySelector('#invoice-status').value,
            invoiceDate: form.querySelector('#invoice-date').value,
            dueDate: form.querySelector('#invoice-due-date').value,
            paymentDate: form.querySelector('#payment-date').value,
            paymentMethod: form.querySelector('#payment-method').value,
            notes: form.querySelector('#invoice-notes').value,
            items: [...this.currentInvoiceItems]
        };
        this.showProductModal();
    }

    showProductModalInlineForQuotation(index) {
        this.productModalSourceIndex = index;
        this.calculateQuotationTotal();
        const form = document.getElementById('quotation-form');
        this.stashedQuotationState = {
            quotationId: form.querySelector('input[name="quotationId"]').value,
            customerId: form.querySelector('input[name="customerId"]').value,
            validUntil: form.querySelector('input[name="validUntil"]').value,
            notes: form.querySelector('textarea[name="notes"]').value,
            items: [...this.currentQuotationItems]
        };
        this.showProductModal();
    }

    editProduct(productId) {
        this.showProductModal(productId);
    }

    deleteProduct(productId) {
        if (confirm('Are you sure you want to delete this product?')) {
            this.db.delete('products', productId);
            this.loadProducts();
            this.refreshDashboard();
            this.showNotification('Product deleted successfully!', 'success');
        }
    }

    loadProductCategories() {
        const products = this.db.getAll('products');
        const categories = [...new Set(products.map(p => p.category).filter(c => c))];
        const filterSelect = document.getElementById('product-category-filter');
        if (filterSelect) {
            filterSelect.innerHTML = `<option value="">All Categories</option>${categories.map(c => `<option value="${c}">${c}</option>`).join('')}`;
        }
    }

    filterProducts() {
        const searchTerm = document.getElementById('product-search')?.value.toLowerCase() || '';
        const categoryFilter = document.getElementById('product-category-filter')?.value || '';
        let products = this.db.getAll('products');
        if (searchTerm) {
            products = products.filter(p => p.name.toLowerCase().includes(searchTerm) || (p.sku && p.sku.toLowerCase().includes(searchTerm)) || (p.category && p.category.toLowerCase().includes(searchTerm)));
        }
        if (categoryFilter) {
            products = products.filter(p => p.category === categoryFilter);
        }
        this.renderProducts(products);
    }

    // Reports
    generateReports() {
        const invoices = this.db.getAll('invoices');
        const customers = this.db.getAll('customers');
        const totalSales = invoices.filter(i => i.status === 'paid').reduce((sum, inv) => sum + (inv.total || 0), 0);
        const totalInvoices = invoices.length;
        const averageOrder = totalInvoices > 0 ? totalSales / totalInvoices : 0;
        const paidInvoices = invoices.filter(i => i.status === 'paid').length;
        const pendingInvoices = invoices.filter(i => i.status === 'pending').length;
        const totalCustomers = customers.length;
        const activeCustomers = customers.filter(c => invoices.some(inv => inv.customerId === c.id)).length;

        const reportElements = {
            'report-total-sales': `₹${totalSales.toLocaleString('en-IN')}`,
            'report-total-invoices': totalInvoices,
            'report-average-order': `₹${averageOrder.toLocaleString('en-IN')}`,
            'report-paid-invoices': paidInvoices,
            'report-pending-invoices': pendingInvoices,
            'report-total-customers': totalCustomers,
            'report-active-customers': activeCustomers,
        };
        Object.entries(reportElements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        });
    }

    // Replace the placeholder function with this
    generateStatementSummaryReport() {
        const customers = this.db.getAll('customers');
        const invoices = this.db.getAll('invoices');
        const credits = this.db.getAll('credits');
        const tbody = document.querySelector('#statement-summary-table tbody');
        tbody.innerHTML = '';

        const summaryData = customers.map(customer => {
            const customerInvoices = invoices.filter(inv => inv.customerId === customer.id);
            const customerCredits = credits.filter(cred => cred.customerId === customer.id);

            const totalSales = customerInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);
            const totalReceived = customerCredits.reduce((sum, cred) => sum + (cred.payments.reduce((pSum, p) => pSum + p.amount, 0)), 0);
            const outstandingBalance = totalSales - totalReceived;

            return {
                customerName: customer.name,
                totalSales: totalSales,
                totalReceived: totalReceived,
                outstandingBalance: outstandingBalance
            };
        });

        if (summaryData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">No customer data found</td></tr>';
            return;
        }

        tbody.innerHTML = summaryData.map(data => `
        <tr>
            <td>${data.customerName}</td>
            <td>₹${data.totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td>₹${data.totalReceived.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="color: ${data.outstandingBalance > 0 ? 'red' : 'green'}; font-weight: bold;">
                ₹${data.outstandingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </td>
        </tr>
    `).join('');
    }

    // Add this function to the InvoiceApp class
    async printStatementSummary() {
        this.showNotification('Preparing statement summary for print...', 'info');

        // Generate the report data first
        this.generateStatementSummaryReport();

        // Find the report container to be printed
        const reportContainer = document.getElementById('statement-summary-container');
        if (!reportContainer) {
            this.showNotification('Statement summary report not found.', 'error');
            return;
        }

        try {
            // --- MODIFIED CODE START ---
            // Temporarily adjust styles to ensure full table is visible for printing
            const originalWidth = reportContainer.style.width;
            const originalOverflow = reportContainer.style.overflowX;
            reportContainer.style.width = 'fit-content';
            reportContainer.style.overflowX = 'visible';

            const canvas = await html2canvas(reportContainer, { scale: 2, useCORS: true });

            // Restore original styles
            reportContainer.style.width = originalWidth;
            reportContainer.style.overflowX = originalOverflow;
            // --- MODIFIED CODE END ---
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`Statement-Summary-${new Date().toISOString().split('T')[0]}.pdf`);
            this.showNotification('Statement summary saved to PDF successfully!', 'success');
        } catch (error) {
            console.error('Error creating PDF:', error);
            this.showNotification('Failed to create PDF. Please try again.', 'error');
        }
    }

    // Settings
    loadSettingsForm() {
        const settings = this.db.getSettings();
        Object.keys(settings).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                element.value = settings[key] || '';
            }
        });
        const passwordStatusEl = document.getElementById('password-status');
        if (passwordStatusEl) {
            if (settings.resetPasswordHash) {
                passwordStatusEl.textContent = 'Status: Password Protection is ON';
                passwordStatusEl.style.color = '#27ae60';
            } else {
                passwordStatusEl.textContent = 'Status: Password Protection is OFF';
                passwordStatusEl.style.color = '#c0392b';
            }
        }
    }

    saveSettingsForm() {
        const form = document.getElementById('settings-form');
        if (!form) return;
        const formData = new FormData(form);
        const settings = {};
        for (let [key, value] of formData.entries()) {
            settings[key] = value;
        }
        this.db.saveSettings(settings);
        this.showNotification('Settings saved successfully!', 'success');
    }

    async simpleHash(str) {
        const buffer = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async saveResetPassword() {
        const passwordInput = document.getElementById('reset-password');
        const newPassword = passwordInput.value;

        if (newPassword.length < 4) {
            this.showNotification('New password must be at least 4 characters long.', 'error');
            return;
        }

        const settings = this.db.getSettings();

        // --- MODIFIED LOGIC ---
        // Check if a password already exists
        if (settings.resetPasswordHash) {
            // UPDATE FLOW: Requires current password
            const currentPassword = prompt('To update, please enter your CURRENT password:');
            if (currentPassword === null) return; // User cancelled prompt

            const currentPasswordHash = await this.simpleHash(currentPassword);

            if (currentPasswordHash === settings.resetPasswordHash) {
                // Correct current password, proceed to update
                if (confirm('Password correct. Are you sure you want to update the password?')) {
                    settings.resetPasswordHash = await this.simpleHash(newPassword);
                    this.db.saveSettings(settings);
                    passwordInput.value = '';
                    this.loadSettingsForm();
                    this.showNotification('Reset password has been updated successfully!', 'success');
                }
            } else {
                this.showNotification('Incorrect current password!', 'error');
            }
        } else {
            // SET FLOW: No existing password, so set it directly
            if (confirm('Are you sure you want to set the reset password?')) {
                settings.resetPasswordHash = await this.simpleHash(newPassword);
                this.db.saveSettings(settings);
                passwordInput.value = '';
                this.loadSettingsForm();
                this.showNotification('Reset password has been set successfully!', 'success');
            }
        }
        // --- END OF MODIFIED LOGIC ---
    }

    async removeResetPassword() {
        const settings = this.db.getSettings();
        if (!settings.resetPasswordHash) {
            this.showNotification('No password is set.', 'info');
            return;
        }

        // --- MODIFIED LOGIC ---
        // Ask for the current password to confirm removal
        const enteredPassword = prompt('To remove password protection, please enter your current password:');
        if (enteredPassword === null) return; // User cancelled prompt

        const enteredPasswordHash = await this.simpleHash(enteredPassword);

        if (enteredPasswordHash === settings.resetPasswordHash) {
            // Correct password, proceed with removal
            if (confirm('Password correct. Are you sure you want to remove the password protection?')) {
                delete settings.resetPasswordHash;
                this.db.saveSettings(settings);
                this.loadSettingsForm();
                this.showNotification('Password protection has been removed.', 'success');
            }
        } else {
            // Incorrect password
            this.showNotification('Incorrect password!', 'error');
        }
        // --- END OF MODIFIED LOGIC ---
    }

    async promptForReset() {
        const settings = this.db.getSettings();
        if (settings.resetPasswordHash) {
            const enteredPassword = prompt('To reset all data, please enter your password:');
            if (enteredPassword === null) {
                return;
            }

            const enteredPasswordHash = await this.simpleHash(enteredPassword);
            if (enteredPasswordHash === settings.resetPasswordHash) {
                if (confirm('Password correct. Are you absolutely sure you want to delete all data? This cannot be undone.')) {
                    this.db.clearAllData();
                    location.reload();
                }
            } else {
                this.showNotification('Incorrect password!', 'error');
            }
        } else {
            if (confirm('Are you sure you want to delete all data? This cannot be undone.')) {
                this.db.clearAllData();
                location.reload();
            }
        }
    }

    // Utility functions
    showModal(title, content, actions = [], size = 'default') {
        const modalOverlay = document.getElementById('modal-overlay');
        const modal = modalOverlay.querySelector('.modal');
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;

        modal.classList.remove('modal-large');
        if (size === 'large') {
            modal.classList.add('modal-large');
        }

        const footer = document.getElementById('modal-footer');
        if (footer) {
            footer.innerHTML = actions.map(action => {
                const iconHtml = action.icon ? `<i class="${action.icon}"></i> ` : '';
                const onclick = action.action === 'closeModal' ? 'app.closeModal()' : `app.${action.action}`;
                return `<button class="btn ${action.class}" onclick="${onclick}">${iconHtml}${action.text}</button>`;
            }).join('');
        }
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        const modalOverlay = document.getElementById('modal-overlay');
        if (modalOverlay) modalOverlay.classList.remove('active');
        document.body.style.overflow = 'auto';
        this.currentInvoiceItems = [];
        this.currentQuotationItems = [];
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
        notification.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span><button class="notification-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
        if (container) container.appendChild(notification);
        setTimeout(() => { notification.remove(); }, 5000);
    }

    exportData() {
        const data = this.db.exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-pro-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showNotification('Data exported successfully!', 'success');
    }

    importData(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (this.db.importData(data)) {
                    this.showNotification('Data imported successfully!', 'success');
                    setTimeout(() => location.reload(), 1000);
                } else {
                    this.showNotification('Import failed! Please check the file format.', 'error');
                }
            } catch (error) {
                this.showNotification('Invalid file format!', 'error');
            }
        };
        reader.readAsText(file);
    }

    loadSettings() {
        const settings = this.db.getSettings();
    }
}

window.addEventListener('load', () => {
    app.initNetworkDetection();
    app.initAutoUpdateSystem();
});

window.addEventListener('beforeunload', () => {
    if (app.autoUpdateTimer) clearInterval(app.autoUpdateTimer);
});

document.addEventListener('DOMContentLoaded', function () {
    window.app = new InvoiceApp();
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }
});