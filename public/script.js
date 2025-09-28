document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & CONFIG --- //
    let salesChart = null;
    let historicalData = [];
    let currentChartType = 'line';
    let currentUser = null; // To hold the logged-in user object
    let peakHourData = null; // To store peak hour info
    let isPeakHighlightVisible = false; // To toggle highlight

    // --- FIREBASE INITIALIZATION ---
    // Firebase is now initialized automatically by the /__/firebase/init.js script
    const auth = firebase.auth();
    const db = firebase.firestore();

    const timeSlots = Array.from({ length: 28 }, (_, i) => {
        const hour = Math.floor(i / 2) + 5;
        const minute = i % 2 === 0 ? '00' : '30';
        return `${String(hour).padStart(2, '0')}:${minute}`;
    });
    const lineColors = ['#8A2BE2', '#00BFFF', '#32CD32', '#FF69B4', '#FFD700', '#1E90FF', '#FF4500', '#DA70D6', '#00CED1', '#ADFF2F', '#FF6347', '#4682B4'];
    const comparisonModes = {
        average: 'Day of Week (Average)',
        top_weekday: 'Day of Week (Record High)',
        lowest_by_weekday: 'Day of Week (Record Low)',
        record_highs: 'Record Sales (Highest)',
        worst_days: 'Record Sales (Lowest)',
        specific: 'Specific Day(s)',
        same_day_last_week: 'Same Day Last Week',
        same_date_last_year: 'Same Date Last Year',
        same_day_last_year: 'Same Day Last Year',
    };

    // --- DOM ELEMENTS --- //
    const excelFileInput = document.getElementById('excel-file-input');
    const uploadBtn = document.getElementById('upload-btn');
    const dropZone = document.getElementById('drop-zone');
    const fileStatus = document.getElementById('file-status');
    const updateChartBtn = document.getElementById('update-chart-btn');
    const chartError = document.getElementById('chart-error');
    const comparisonModesContainer = document.getElementById('comparison-modes');
    const additionalControlsContainer = document.getElementById('additional-controls');
    const todaysSalesInput = document.getElementById('todays-sales');
    const salesDateInput = document.getElementById('sales-date');
    const analysisPanel = document.getElementById('analysis-panel');
    const generatePanel = document.getElementById('generate-panel');
    const chartPlaceholder = document.getElementById('chart-placeholder');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const fileInfoContainer = document.getElementById('file-info-container');
    const fileNameEl = document.getElementById('file-name');
    const deleteFileBtn = document.getElementById('delete-file-btn');
    const kpiContainer = document.getElementById('kpi-container');
    const chartTypeSwitcher = document.querySelector('.chart-type-switcher');
    const insightsContent = document.getElementById('insights-content');
    const panelToggleBtn = document.getElementById('panel-toggle-btn');
    const controlPanel = document.getElementById('control-panel');
    const dashboardTitleText = document.getElementById('dashboard-title-text');
    const userInfo = document.getElementById('user-info');
    const userEmailEl = document.getElementById('user-email');
    const logoutBtn = document.getElementById('logout-btn');
    const insightsToggleBtn = document.getElementById('insights-toggle-btn');
    const insightsPanel = document.getElementById('insights-panel');
    const insightsCloseBtn = document.getElementById('insights-close-btn');
    const insightsOverlay = document.getElementById('insights-overlay');
    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmClearBtn = document.getElementById('confirm-clear-btn');
    const cancelClearBtn = document.getElementById('cancel-clear-btn');
    const selectedDatesDisplay = document.getElementById('selected-dates-display');
    const selectedDatesList = document.getElementById('selected-dates-list');


    // --- AUTHENTICATION LISTENER --- //
    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            userEmailEl.textContent = user.email;
            userInfo.classList.remove('hidden');
            init();
        } else {
            window.location.href = '/login.html';
        }
    });

    // --- INITIALIZATION & DATA HANDLING --- //
    const init = () => {
        salesDateInput.valueAsDate = new Date();
        populateComparisonModes();
        setupEventListeners();
        setupChartDefaults();
        loadFromFirestore();
    };

    const loadFromFirestore = () => {
        if (!currentUser) return;
        updateFileStatus("Loading historical data from database...", false);
        
        db.collection("users").doc(currentUser.uid).collection("dailySales").orderBy("date", "desc").get()
          .then((querySnapshot) => {
              historicalData = [];
              querySnapshot.forEach((doc) => historicalData.push(doc.data()));
              if (historicalData.length > 0) {
                  const savedFileName = localStorage.getItem('savedFileName');
                  updateUIWithLoadedData(savedFileName || 'Database');
                  updateFileStatus(`${historicalData.length} records loaded from database.`);
                  handleUpdateChart(); 
              } else {
                  updateFileStatus("No historical data found. Upload a file to start.", false);
              }
          })
          .catch((error) => {
              console.error("Error loading data from Firestore:", error);
              updateFileStatus("Error loading from database.", true);
          });
    };
    
    const handleFile = async (file) => {
        if (!file || !currentUser) return;
        updateFileStatus(`Uploading and processing ${file.name}...`, false);
        
        const token = await currentUser.getIdToken();

        const reader = new FileReader();
        reader.onload = (e) => {
            const fileContents = e.target.result.split(',')[1];
            const functionUrl = 'https://us-central1-cumulativesalesreport.cloudfunctions.net/processSalesData';
            
            fetch(functionUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ fileContents, fileName: file.name }),
            })
            .then(response => {
                if (!response.ok) return response.json().then(err => { throw new Error(err.error || 'Processing failed') });
                return response.json();
            })
            .then(data => {
                updateFileStatus(data.message, false);
                localStorage.setItem('savedFileName', file.name);
                loadFromFirestore();
            })
            .catch(error => {
                console.error('Upload Error:', error);
                updateFileStatus(`Error: ${error.message}`, true);
            });
        };
        reader.onerror = () => updateFileStatus("Failed to read file.", true);
        reader.readAsDataURL(file);
    };

    // --- UI & EVENT LISTENERS --- //
    const updateFileStatus = (message, isError = false) => {
        fileStatus.textContent = message;
        fileStatus.style.color = isError ? 'var(--error-color)' : 'var(--success-color)';
    };

    const saveTodaysSales = () => localStorage.setItem('todaysSalesData', todaysSalesInput.value);
    
    const handlePastedDataUpdate = () => {
        saveTodaysSales(); // Keep saving to localStorage

        const pastedText = todaysSalesInput.value;
        const { date } = parseTimeZoneReport(pastedText);

        if (date) {
            salesDateInput.valueAsDate = date;
            const dayOfWeek = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
            
            const wrapper = document.querySelector('.custom-select-wrapper');
            if (wrapper) {
                const trigger = wrapper.querySelector('.custom-select-trigger span');
                const nativeSelect = wrapper.querySelector('select');
                const options = wrapper.querySelectorAll('.custom-option');

                nativeSelect.value = dayOfWeek;
                if (trigger) trigger.textContent = dayOfWeek;
                options.forEach(opt => {
                    opt.classList.toggle('selected', opt.dataset.value === dayOfWeek);
                });
            }
        }
    };
    
    const updateUIWithLoadedData = (fileName) => {
        fileNameEl.textContent = fileName;
        fileInfoContainer.classList.remove('hidden');
        dropZone.style.display = 'none';
        analysisPanel.classList.remove('disabled');
        generatePanel.classList.remove('disabled');
        updateFileStatus(`${historicalData.length} records loaded.`);
        
        const selectedMode = document.querySelector('#comparison-modes button.selected')?.dataset.mode;
        renderAdditionalControls(selectedMode);
        
        const savedTodaysSales = localStorage.getItem('todaysSalesData');
        if (savedTodaysSales) {
            todaysSalesInput.value = savedTodaysSales;
            handlePastedDataUpdate(); 
        }
    };

    const peakHighlightPlugin = {
        id: 'peakHighlight',
        afterDraw: (chart) => {
            if (isPeakHighlightVisible && peakHourData) {
                const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
                const start = x.getPixelForValue(peakHourData.startIndex);
                const end = x.getPixelForValue(peakHourData.endIndex + 1); 

                ctx.save();
                ctx.fillStyle = 'rgba(138, 43, 226, 0.2)';
                ctx.fillRect(start, top, end - start, bottom - top);
                ctx.restore();
            }
        }
    };

    const setupChartDefaults = () => {
        Chart.defaults.color = '#A9A9A9';
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
        Chart.register(peakHighlightPlugin);
    };
    
    const populateComparisonModes = () => {
        comparisonModesContainer.innerHTML = '';
        Object.entries(comparisonModes).forEach(([value, label]) => {
            const button = document.createElement('button');
            button.dataset.mode = value;
            button.textContent = label;
            comparisonModesContainer.appendChild(button);
        });
        comparisonModesContainer.querySelector('button')?.classList.add('selected');
    };

    const toggleInsightsPanel = () => {
        insightsPanel.classList.toggle('is-visible');
        insightsOverlay.classList.toggle('is-visible');
    };
    
    const setupEventListeners = () => {
        uploadBtn.addEventListener('click', () => excelFileInput.click());
        excelFileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
        deleteFileBtn.addEventListener('click', handleDeleteFile);
        updateChartBtn.addEventListener('click', handleUpdateChart);
        comparisonModesContainer.addEventListener('click', handleModeSelection);
        fullscreenBtn.addEventListener('click', () => document.querySelector('.main-chart-container').requestFullscreen());
        chartTypeSwitcher.addEventListener('click', handleChartTypeSwitch);
        panelToggleBtn.addEventListener('click', toggleControlPanel);
        todaysSalesInput.addEventListener('input', handlePastedDataUpdate);
        
        insightsToggleBtn.addEventListener('click', toggleInsightsPanel);
        insightsCloseBtn.addEventListener('click', toggleInsightsPanel);
        insightsOverlay.addEventListener('click', toggleInsightsPanel);

        logoutBtn.addEventListener('click', () => auth.signOut());

        kpiContainer.addEventListener('click', (e) => {
            const peakKpiCard = e.target.closest('#peak-2-hours-kpi');
            if (peakKpiCard) togglePeakHourHighlight();
        });

        additionalControlsContainer.addEventListener('click', handleCustomSelect);
        
        confirmClearBtn.addEventListener('click', () => {
            const checkboxes = additionalControlsContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => checkbox.checked = false);
            confirmationModal.classList.add('hidden');
            updateSelectedDatesDisplay();
        });

        cancelClearBtn.addEventListener('click', () => {
            confirmationModal.classList.add('hidden');
        });

        window.addEventListener('click', (e) => {
            const select = document.querySelector('.custom-select');
            if (select && !select.contains(e.target)) {
                select.classList.remove('open');
            }
        });

        setupDragAndDrop();
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        });
    };

    const togglePeakHourHighlight = () => {
        if (!salesChart || !peakHourData) return;
        isPeakHighlightVisible = !isPeakHighlightVisible;

        const peakKpiCard = document.getElementById('peak-2-hours-kpi');
        if (peakKpiCard) {
            peakKpiCard.classList.toggle('active-highlight', isPeakHighlightVisible);
        }

        salesChart.update();
    };
    
    const setupDragAndDrop = () => {
        ['dragover', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, e => e.preventDefault()));
        dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', e => {
            dropZone.classList.remove('dragover');
            handleFile(e.dataTransfer.files[0]);
        });
    };

    const handleDeleteFile = () => {
        historicalData = [];
        excelFileInput.value = '';
        todaysSalesInput.value = '';
        fileInfoContainer.classList.add('hidden');
        dropZone.style.display = 'block';
        analysisPanel.classList.add('disabled');
        generatePanel.classList.add('disabled');
        updateFileStatus('File removed. Upload a new dataset.', false);
        if (salesChart) {
            salesChart.destroy();
            salesChart = null;
            chartPlaceholder.style.display = 'flex';
        }
        kpiContainer.innerHTML = '';
        insightsContent.innerHTML = '<p class="no-data-text">Generate a chart to see automated insights here.</p>';
        dashboardTitleText.textContent = 'Sales Dashboard';
        localStorage.removeItem('savedFileName');
        localStorage.removeItem('todaysSalesData');
    };

    const toggleControlPanel = () => {
        const isCollapsed = controlPanel.classList.toggle('collapsed');
        const icon = panelToggleBtn.querySelector('i');
        icon.className = isCollapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
    };

    const handleChartTypeSwitch = (e) => {
        const btn = e.target.closest('.chart-type-btn');
        if (!btn || btn.classList.contains('active')) return;
        currentChartType = btn.dataset.chartType;
        document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (salesChart || historicalData.length > 0) handleUpdateChart();
    };

    const handleModeSelection = (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        const selectedMode = e.target.dataset.mode;
        document.querySelectorAll('#comparison-modes button').forEach(btn => btn.classList.toggle('selected', btn.dataset.mode === selectedMode));
        renderAdditionalControls(selectedMode);
    };

    const handleCustomSelect = (e) => {
        const trigger = e.target.closest('.custom-select-trigger');
        if (trigger) {
            trigger.closest('.custom-select').classList.toggle('open');
            return;
        }

        const option = e.target.closest('.custom-option');
        if (option) {
            const select = option.closest('.custom-select');
            const nativeSelect = select.previousElementSibling;
            
            nativeSelect.value = option.dataset.value;
            select.querySelector('.custom-select-trigger span').textContent = option.textContent;
            select.querySelector('.custom-option.selected').classList.remove('selected');
            option.classList.add('selected');
            select.classList.remove('open');
        }
        const clearButton = e.target.closest('.clear-selection-btn');
        if (clearButton) {
            confirmationModal.classList.remove('hidden');
        }
        if (e.target.matches('input[type="checkbox"]')) {
            updateSelectedDatesDisplay();
        }
    };
    
    // --- DATA PARSING & PROCESSING --- //
    const parseTimeZoneReport = (pastedString) => {
        if (!pastedString || typeof pastedString !== "string") return { sales: null, date: null };

        const lines = pastedString.split('\n');
        let parsedDate = null;
        const remainingLines = [];

        const dateRegex = /(?:Date:)?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/;

        for (const line of lines) {
            const dateMatch = line.match(dateRegex);
            if (dateMatch && !parsedDate) {
                const day = parseInt(dateMatch[1], 10);
                const month = parseInt(dateMatch[2], 10) - 1;
                const year = parseInt(dateMatch[3], 10);
                
                const tempDate = new Date(Date.UTC(year, month, day));
                
                if (tempDate.getUTCFullYear() === year && tempDate.getUTCMonth() === month && tempDate.getUTCDate() === day) {
                    parsedDate = tempDate;
                }
            } else {
                remainingLines.push(line);
            }
        }

        const aggregatedSales = Array(timeSlots.length).fill(0);
        const lineRegex = /^(\d{2}:\d{2})\s*-\s*\d{2}:\d{2}.*?\s([\d,]+\.\d{2})\s*$/;

        for (const line of remainingLines) {
            const match = line.trim().match(lineRegex);
            if (match) {
                const startTime = match[1];
                const netSales = parseFloat(match[2].replace(/,/g, ''));
                
                const slotIndex = timeSlots.indexOf(startTime);
                if (slotIndex !== -1) aggregatedSales[slotIndex] = netSales;
            }
        }
        
        const totalParsedSales = aggregatedSales.reduce((a, b) => a + b, 0);
        
        return { 
            sales: totalParsedSales > 0 ? aggregatedSales : null, 
            date: parsedDate 
        };
    };

    const findLastSaleIndex = (salesArray) => {
        for (let i = salesArray.length - 1; i >= 0; i--) if (salesArray[i] > 0) return i;
        return -1;
    };

    const calculateCumulative = (data, limitIndex = -1) => {
        let sum = 0;
        return data.map((value, i) => {
            sum += value;
            return (limitIndex !== -1 && i > limitIndex) ? null : sum;
        });
    };

    // --- CHARTING & INSIGHTS --- //
    const handleUpdateChart = () => {
        chartError.textContent = '';
        let todayDataset = null;
        isPeakHighlightVisible = false;

        if (todaysSalesInput.value.trim() !== '') {
            const parsedResult = parseTimeZoneReport(todaysSalesInput.value);
            if (!parsedResult.sales) {
                chartError.textContent = "Could not parse today's sales data. Check the format."; return;
            }
            const lastSaleIndex = findLastSaleIndex(parsedResult.sales);
            todayDataset = {
                label: `Today's Sales`, data: calculateCumulative(parsedResult.sales, lastSaleIndex), raw: parsedResult.sales,
                borderColor: '#FF69B4', borderWidth: 3, pointRadius: 0, tension: 0.4, fill: true,
                backgroundColor: 'rgba(255, 105, 180, 0.1)'
            };
        }
        
        let datasets = todayDataset ? [todayDataset] : [];
        const selectedMode = document.querySelector('#comparison-modes button.selected')?.dataset.mode;
        let comparisonData = null;
        if (selectedMode && historicalData.length > 0) {
            comparisonData = getComparisonData(selectedMode);
            if (comparisonData) datasets.push(...comparisonData);
        }

        if (datasets.length === 0 && currentChartType !== 'heatmap') {
            chartError.textContent = "No data available to generate chart. Please upload a file."; 
            return;
        }

        renderChart(datasets);
        updateKpis(todayDataset, comparisonData);
        generateInsights(todayDataset, comparisonData);
    };
    
    const renderAdditionalControls = (mode) => {
        additionalControlsContainer.innerHTML = '';
        selectedDatesDisplay.classList.add('hidden'); 

        if (mode === 'average') {
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            const dateRanges = {
                'all': 'All',
                'this-month': 'This Month',
                'last-month': 'Last Month',
                'last-3-months': 'Last 3 Months',
                'last-6-months': 'Last 6 Months',
                'last-12-months': 'Last 12 Months',
                'this-year': 'This Year',
                'last-year': 'Last Year'
            };
            const currentDate = salesDateInput.valueAsDate || new Date();
            const currentDay = currentDate.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

            const dayOfWeekSelect = `<select id="day-of-week" class="form-input-hidden">${days.map(d => `<option value="${d}" ${d === currentDay ? 'selected' : ''}>${d}</option>`).join('')}</select>`;
            const dayOfWeekOptions = days.map(d => `<span class="custom-option ${d === currentDay ? 'selected' : ''}" data-value="${d}">${d}</span>`).join('');
            
            const dateRangeSelect = `<select id="date-range" class="form-input-hidden">${Object.entries(dateRanges).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
            const dateRangeOptions = Object.entries(dateRanges).map(([value, label], index) => `<span class="custom-option ${index === 0 ? 'selected' : ''}" data-value="${value}">${label}</span>`).join('');

            const controlHTML = `
                <div class="control-group">
                    <label>Day of the Week</label>
                    <div class="custom-select-wrapper">
                        ${dayOfWeekSelect}
                        <div class="custom-select">
                            <div class="custom-select-trigger">
                                <span>${currentDay}</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">${dayOfWeekOptions}</div>
                        </div>
                    </div>
                </div>
                <div class="control-group">
                    <label>Date Range</label>
                    <div class="custom-select-wrapper">
                        ${dateRangeSelect}
                        <div class="custom-select">
                            <div class="custom-select-trigger">
                                <span>All</span>
                                <div class="arrow"></div>
                            </div>
                            <div class="custom-options">${dateRangeOptions}</div>
                        </div>
                    </div>
                </div>
            `;
            additionalControlsContainer.innerHTML = controlHTML;
        } else if (['worst_days', 'specific', 'record_highs'].includes(mode)) {
            const div = document.createElement('div');
            div.className = 'control-group';
            div.appendChild(createCheckboxes(mode));
            additionalControlsContainer.appendChild(div);
            updateSelectedDatesDisplay();
        }
    };
    
    const createCheckboxes = (mode) => {
        const div = document.createElement('div');
        let data, label;
        const sortAndSlice = (sortFn, slice) => [...historicalData].sort(sortFn).slice(0, slice);
        
        switch (mode) {
            case 'record_highs':
                data = sortAndSlice((a, b) => b.totalSales - a.totalSales, 10);
                label = '10 Highest Sales Days'; break;
            case 'worst_days':
                data = sortAndSlice((a, b) => a.totalSales - b.totalSales, 10);
                label = '10 Lowest Sales Days'; break;
            case 'specific':
                data = sortAndSlice((a, b) => new Date(b.date) - new Date(a.date), 100);
                label = 'Select up to 10 days'; break;
        }

        div.innerHTML = `<label>${label}</label>`;
        const container = document.createElement('div');
        container.className = 'checkbox-container';
        if (data?.length) {
            data.forEach(day => {
                const formattedDate = new Date(day.date).toLocaleDateString('en-GB', { timeZone: 'UTC' });
                const checkboxLabel = `<span>${formattedDate} (£${day.totalSales.toFixed(2)})</span>`;
                container.innerHTML += `<label class="checkbox-label"><input type="checkbox" value="${day.id}" class="form-checkbox">${checkboxLabel}</label>`;
            });
        } else {
            container.innerHTML = `<p class="no-data-text">No historical data for this day.</p>`;
        }
        div.appendChild(container);
        return div;
    };
    
    const updateSelectedDatesDisplay = () => {
        const checked = Array.from(document.querySelectorAll('#additional-controls input:checked'));
        const clearButton = document.getElementById('clear-selection-btn');
        if (checked.length > 0) {
            selectedDatesList.innerHTML = checked.map(checkbox => {
                const dayData = historicalData.find(d => d.id === checkbox.value);
                const date = new Date(dayData.date);
                const formattedDate = date.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: '2-digit', year: '2-digit' });
                return `<span class="selected-date-item">${formattedDate}</span>`;
            }).join('');
            selectedDatesDisplay.classList.remove('hidden');
            clearButton.classList.remove('hidden');
        } else {
            selectedDatesDisplay.classList.add('hidden');
            clearButton.classList.add('hidden');
        }
    };

    const getComparisonData = (mode) => {
        const salesDate = salesDateInput.valueAsDate || new Date();
        const utcDate = new Date(Date.UTC(salesDate.getFullYear(), salesDate.getMonth(), salesDate.getDate()));

        const createDataset = (dayData, index, options = {}) => ({
            label: options.label || new Date(dayData.date).toLocaleDateString('en-GB', { timeZone: 'UTC' }),
            data: calculateCumulative(dayData.sales), raw: dayData.sales, borderColor: lineColors[index % lineColors.length],
            borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false, ...options
        });

        const findAndFormat = (targetDate, label) => {
            const day = historicalData.find(d => d.id === targetDate.toISOString().split('T')[0]);
            if (day) return [createDataset(day, 0, { label })];
            chartError.textContent = `No data for ${targetDate.toLocaleDateString('en-GB', { timeZone: 'UTC' })}`;
            return null;
        };

        switch (mode) {
            case 'average': {
                const dayOfWeek = document.getElementById('day-of-week').value;
                const dateRange = document.getElementById('date-range').value;
                const now = new Date();
                const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

                const filteredData = historicalData.filter(d => {
                    const recordDate = new Date(d.date);
                    switch (dateRange) {
                        case 'this-month':
                            return recordDate.getUTCMonth() === today.getUTCMonth() && recordDate.getUTCFullYear() === today.getUTCFullYear();
                        case 'last-month':
                            const lastMonth = new Date(today);
                            lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
                            return recordDate.getUTCMonth() === lastMonth.getUTCMonth() && recordDate.getUTCFullYear() === lastMonth.getUTCFullYear();
                        case 'last-3-months':
                            const threeMonthsAgo = new Date(today);
                            threeMonthsAgo.setUTCMonth(threeMonthsAgo.getUTCMonth() - 3);
                            return recordDate >= threeMonthsAgo;
                        case 'last-6-months':
                            const sixMonthsAgo = new Date(today);
                            sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
                            return recordDate >= sixMonthsAgo;
                        case 'last-12-months':
                             const twelveMonthsAgo = new Date(today);
                            twelveMonthsAgo.setUTCFullYear(twelveMonthsAgo.getUTCFullYear() - 1);
                            return recordDate >= twelveMonthsAgo;
                        case 'this-year':
                            return recordDate.getUTCFullYear() === today.getUTCFullYear();
                        case 'last-year':
                            return recordDate.getUTCFullYear() === today.getUTCFullYear() - 1;
                        case 'all':
                        default:
                            return true;
                    }
                });

                const relevant = filteredData.filter(d => d.dayOfWeek === dayOfWeek);
                if (!relevant.length) { chartError.textContent = `No data for ${dayOfWeek}.`; return null; }
                const avgSales = timeSlots.map((_, i) => relevant.reduce((sum, d) => sum + d.sales[i], 0) / relevant.length);
                return [createDataset({ sales: avgSales, date: new Date() }, 0, { label: `Average ${dayOfWeek}`, borderDash: [5, 5] })];
            }
            case 'top_weekday': {
                const dayOfWeek = salesDate.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
                const top5Days = historicalData
                    .filter(d => d.dayOfWeek === dayOfWeek)
                    .sort((a, b) => b.totalSales - a.totalSales)
                    .slice(0, 5);
                
                if (!top5Days.length) {
                    chartError.textContent = `Not enough historical data for ${dayOfWeek}s.`;
                    return null;
                }
                
                return top5Days.map((day, i) => createDataset(day, i));
            }
            case 'lowest_by_weekday': {
                const dayOfWeek = salesDate.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
                const lowest5Days = historicalData
                    .filter(d => d.dayOfWeek === dayOfWeek)
                    .sort((a, b) => a.totalSales - b.totalSales)
                    .slice(0, 5);
                
                if (!lowest5Days.length) {
                    chartError.textContent = `Not enough historical data for ${dayOfWeek}s.`;
                    return null;
                }
                
                return lowest5Days.map((day, i) => createDataset(day, i));
            }
            case 'specific': case 'worst_days': case 'record_highs': {
                const checked = Array.from(document.querySelectorAll('#additional-controls input:checked'));
                if (!checked.length) { chartError.textContent = 'Please select at least one day.'; return null; }
                return checked.slice(0, 10).map((box, i) => {
                    const dayData = historicalData.find(d => d.id === box.value);
                    return dayData ? createDataset(dayData, i) : null;
                }).filter(Boolean);
            }
            case 'same_day_last_week': { const d = new Date(utcDate); d.setUTCDate(d.getUTCDate() - 7); return findAndFormat(d, 'Last Week'); }
            case 'same_date_last_year': { const d = new Date(utcDate); d.setUTCFullYear(d.getUTCFullYear() - 1); return findAndFormat(d, 'Same Date Last Year'); }
            case 'same_day_last_year': {
                const d = new Date(utcDate); d.setUTCFullYear(d.getUTCFullYear() - 1);
                d.setUTCDate(d.getUTCDate() + (utcDate.getUTCDay() - d.getUTCDay()));
                return findAndFormat(d, 'Same Day Last Year');
            }
        }
        return null;
    };
    
    const renderChart = (datasets) => {
        if (salesChart) salesChart.destroy();
        chartPlaceholder.style.display = 'none';
        const ctx = document.getElementById('salesChart').getContext('2d');
        let chartConfig;

        if (currentChartType === 'heatmap') {
             const heatmapData = historicalData.flatMap(day => {
                const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day.dayOfWeek);
                return day.sales.map((value, timeIndex) => ({ x: timeIndex, y: dayIndex, v: value }));
            });
            chartConfig = {
                type: 'matrix',
                data: { datasets: [{
                    label: 'Sales Heatmap (£)', data: heatmapData,
                    backgroundColor: c => `rgba(0, 191, 255, ${Math.min(0.1 + ((c.dataset.data[c.dataIndex]?.v || 0) / 150), 1)})`,
                    borderColor: 'rgba(26, 26, 46, 0.5)', borderWidth: 1,
                    width: ({chart}) => (chart.chartArea || {}).width / timeSlots.length - 1,
                    height: ({chart}) => (chart.chartArea || {}).height / 7 - 1,
                }] },
                options: { responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { type: 'category', labels: timeSlots, ticks: { autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
                        y: { type: 'category', labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], offset: true, grid: { display: false } }
                    },
                    plugins: { legend: { display: false }, tooltip: { callbacks: { title:()=>'', label: c => `£${c.raw.v.toFixed(2)}` } } }
                }
            };
        } else {
            const yAxisTitle = currentChartType === 'bar' ? 'Sales per Interval (£)' : 'Cumulative Sales (£)';
            const finalDatasets = datasets.map(ds => ({
                ...ds,
                data: currentChartType === 'bar' ? ds.raw : ds.data,
                type: currentChartType,
                backgroundColor: ds.backgroundColor || (ds.borderColor + '1A')
            }));
            chartConfig = {
                type: 'line', data: { labels: timeSlots, datasets: finalDatasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: { y: { title: { display: true, text: yAxisTitle } } },
                    plugins: { legend: { position: 'bottom' } },
                    layout: {
                        padding: {
                            top: 10,
                            right: 20,
                            bottom: 10,
                            left: 10
                        }
                    }
                }
            };
        }
        salesChart = new Chart(ctx, chartConfig);
    };

    const generateInsights = (todayData, comparisonData) => {
        insightsContent.innerHTML = '';
        const insights = [];
        if (todayData) {
            const todayTotal = todayData.data[findLastSaleIndex(todayData.raw)] || 0;
            insights.push(`Today's sales peaked around <strong>${getPeakHour(todayData.raw)}</strong>.`);
            if (comparisonData?.[0]) {
                const compTotal = comparisonData[0].data.at(-1);
                if (compTotal > 0) {
                    const percentChange = (todayTotal / compTotal - 1) * 100;
                    insights.push(`Performance is <strong>${percentChange >= 0 ? 'up' : 'down'} ${Math.abs(percentChange).toFixed(1)}%</strong> vs '${comparisonData[0].label}'.`);
                }
            }
            const morningSales = todayData.raw.slice(0, 14).reduce((a, b) => a + b, 0);
            const afternoonSales = todayData.raw.slice(14).reduce((a, b) => a + b, 0);
            if (morningSales + afternoonSales > 0) {
                insights.push(`The morning session drove <strong>${(morningSales / (morningSales + afternoonSales) * 100).toFixed(0)}%</strong> of today's revenue.`);
            }
        } else {
            insights.push(`Load today's data to generate live insights.`);
        }
        if (historicalData.length > 0) {
            const historicalAvg = historicalData.reduce((sum, day) => sum + day.totalSales, 0) / historicalData.length;
            insights.push(`The average daily total from your dataset is <strong>£${historicalAvg.toFixed(2)}</strong>.`);
        }
        if (insights.length > 0) {
            insights.forEach(insight => {
                const p = document.createElement('p');
                p.className = 'insight-item';
                p.innerHTML = `<i class="fas fa-check-circle"></i> ${insight}`;
                insightsContent.appendChild(p);
            });
        } else {
            insightsContent.innerHTML = '<p class="no-data-text">Not enough data for insights.</p>';
        }
    };
    
    const updateKpis = (todayData, comparisonData) => {
        kpiContainer.innerHTML = ''; 
        const selectedDate = salesDateInput.valueAsDate || new Date();
        dashboardTitleText.textContent = `Live Sales Performance for ${selectedDate.toLocaleDateString('en-GB')}`;

        if (!todayData || !todayData.data.length) {
            kpiContainer.innerHTML = '<p class="no-data-text">No data for KPIs.</p>'; return;
        }

        const lastSaleIndex = findLastSaleIndex(todayData.raw);
        const todayTotal = todayData.data[lastSaleIndex] || 0;
        let change = null;
        let comparisonLabel = 'vs. N/A';

        if (comparisonData?.[0]) {
            const comp = comparisonData[0];
            const comparisonTotal = comp.data[lastSaleIndex] || 0;
            if (comparisonTotal > 0) change = ((todayTotal - comparisonTotal) / comparisonTotal) * 100;
            comparisonLabel = `vs. ${comp.label}`;
        }

        const projectedSales = calculateProjectedSales(todayData.raw, historicalData, selectedDate);
        const peak2HoursResult = getPeak2Hours(todayData.raw);
        peakHourData = peak2HoursResult;
        const kpis = [
            { hero: true, title: "Today's Total Sales", value: `£${todayTotal.toFixed(2)}`, change: change, label: comparisonLabel },
            { title: "Projected Sales", value: `~ £${projectedSales.toFixed(2)}`, label: 'based on current run-rate' },
            { title: "Avg. Transaction", value: `£${(todayTotal / (todayData.raw.filter(v => v > 0).length || 1)).toFixed(2)}`, label: 'per active half-hour' },
            { title: "Peak 2 Hours", value: peak2HoursResult.label, label: 'highest sales interval' }
        ];

        kpis.forEach(kpi => {
            const card = document.createElement('div');
            card.className = 'kpi-card';
            if (kpi.hero) card.classList.add('hero');
            if (kpi.title === 'Peak 2 Hours') {
                card.id = 'peak-2-hours-kpi';
            }
            let changeHtml = '';
            if (kpi.change !== null && isFinite(kpi.change)) {
                const changeClass = kpi.change >= 0 ? 'positive' : 'negative';
                changeHtml = `<p class="kpi-change ${changeClass}">${kpi.change >= 0 ? '+' : ''}${kpi.change.toFixed(1)}%</p>`;
            }
             card.innerHTML = `<h4>${kpi.title}</h4><p class="kpi-value">${kpi.value}</p><div class="kpi-footer">${changeHtml}<p class="kpi-label">${kpi.label}</p></div>`;
            kpiContainer.appendChild(card);
        });
    };

    const calculateProjectedSales = (rawSales, historicalData, salesDate) => {
        const lastSaleIndex = findLastSaleIndex(rawSales);
        if (lastSaleIndex === -1) return 0;

        const dayOfWeek = salesDate.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
        const relevantHistoricalDays = historicalData.filter(d => d.dayOfWeek === dayOfWeek);

        if (relevantHistoricalDays.length < 3) { // Fallback to simple run-rate if not enough data
            const intervalsPassed = lastSaleIndex + 1;
            const totalSoFar = rawSales.slice(0, intervalsPassed).reduce((a, b) => a + b, 0);
            return (totalSoFar / intervalsPassed) * timeSlots.length;
        }

        const historicalAverageSales = timeSlots.map((_, i) =>
            relevantHistoricalDays.reduce((sum, d) => sum + d.sales[i], 0) / relevantHistoricalDays.length
        );

        const intervalsPassed = lastSaleIndex + 1;
        const totalSoFar = rawSales.slice(0, intervalsPassed).reduce((a, b) => a + b, 0);
        const historicalTotalForIntervalsPassed = historicalAverageSales.slice(0, intervalsPassed).reduce((a, b) => a + b, 0);

        const performanceFactor = historicalTotalForIntervalsPassed > 0 ? totalSoFar / historicalTotalForIntervalsPassed : 1;
        const projectedRemainingSales = historicalAverageSales.slice(intervalsPassed).reduce((sum, avg) => sum + (avg * performanceFactor), 0);

        return totalSoFar + projectedRemainingSales;
    };

    const getPeak2Hours = (salesArray) => {
        if (!salesArray || salesArray.length < 4) return { label: 'N/A' };
    
        let maxSum = 0;
        let peakStartIndex = -1;
    
        for (let i = 0; i <= salesArray.length - 4; i++) {
            const currentSum = salesArray.slice(i, i + 4).reduce((a, b) => a + b, 0);
            if (currentSum > maxSum) {
                maxSum = currentSum;
                peakStartIndex = i;
            }
        }
    
        if (peakStartIndex === -1 || maxSum === 0) return { label: 'N/A' };
    
        const startTime = timeSlots[peakStartIndex];
        const endTimeSlotIndex = peakStartIndex + 3;
        const endTime = timeSlots[endTimeSlotIndex];
    
        const [endHour, endMinute] = endTime.split(':').map(Number);
        const endDate = new Date();
        endDate.setHours(endHour, endMinute + 30, 0, 0);
    
        const finalEndHour = String(endDate.getHours()).padStart(2, '0');
        const finalEndMinute = String(endDate.getMinutes()).padStart(2, '0');
    
        return {
            label: `${startTime} - ${finalEndHour}:${finalEndMinute}`,
            startIndex: peakStartIndex,
            endIndex: endTimeSlotIndex,
        };
    };

    const getPeakHour = (salesArray) => {
        if (!salesArray || salesArray.length === 0) return 'N/A';
        const maxSales = Math.max(...salesArray);
        return maxSales === 0 ? 'N/A' : timeSlots[salesArray.indexOf(maxSales)];
    };
});