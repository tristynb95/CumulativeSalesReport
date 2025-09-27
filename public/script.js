document.addEventListener('DOMContentLoaded', () => {
    // --- STATE & CONFIG --- //
    let salesChart = null;
    let historicalData = [];
    let currentChartType = 'line';
    const timeSlots = Array.from({ length: 28 }, (_, i) => {
        const hour = Math.floor(i / 2) + 5;
        const minute = i % 2 === 0 ? '00' : '30';
        return `${String(hour).padStart(2, '0')}:${minute}`;
    });
    const lineColors = ['#8A2BE2', '#00BFFF', '#32CD32', '#FF69B4', '#FFD700', '#1E90FF'];
    const comparisonModes = {
        average: 'Average Weekday',
        top_weekday: 'Record By Weekday',
        worst_days: 'Lowest Sales',
        specific: 'Specific Days',
        same_day_last_week: 'Last Week',
        same_date_last_year: 'Last Year (Date)',
        same_day_last_year: 'Last Year (Day)',
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
    const chartPanel = document.getElementById('chart-panel');
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


    // --- INITIALIZATION --- //
    const init = () => {
        salesDateInput.valueAsDate = new Date();
        populateComparisonModes();
        setupEventListeners();
        setupChartDefaults();
        loadFromLocalStorage();
    };

    const loadFromLocalStorage = () => {
        const savedData = localStorage.getItem('historicalData');
        const savedFileName = localStorage.getItem('savedFileName');
        const savedTodaysSales = localStorage.getItem('todaysSalesData');

        if (savedData && savedFileName) {
            try {
                historicalData = JSON.parse(savedData);
                if (historicalData.length > 0) {
                    updateUIWithLoadedData(savedFileName);
                }
            } catch (error) {
                console.error("Failed to parse historical data from localStorage:", error);
                localStorage.removeItem('historicalData');
                localStorage.removeItem('savedFileName');
            }
        }

        if (savedTodaysSales) {
            todaysSalesInput.value = savedTodaysSales;
        }
    };

    const saveHistoricalData = (fileName) => {
        localStorage.setItem('historicalData', JSON.stringify(historicalData));
        localStorage.setItem('savedFileName', fileName);
    };

    const saveTodaysSales = () => {
        localStorage.setItem('todaysSalesData', todaysSalesInput.value);
    };

    const clearLocalStorage = () => {
        localStorage.removeItem('historicalData');
        localStorage.removeItem('savedFileName');
        localStorage.removeItem('todaysSalesData');
    };
    
    const updateUIWithLoadedData = (fileName) => {
        fileNameEl.textContent = fileName;
        fileInfoContainer.classList.remove('hidden');
        dropZone.style.display = 'none';
        
        analysisPanel.classList.remove('disabled');
        generatePanel.classList.remove('disabled');

        updateFileStatus(`${historicalData.length} records loaded from memory.`);
        
        const selectedMode = document.querySelector('#comparison-modes button.selected')?.dataset.mode;
        if (selectedMode) {
            renderAdditionalControls(selectedMode);
        }
    };

    const setupChartDefaults = () => {
        Chart.defaults.color = '#A9A9A9';
        Chart.defaults.font.family = "'Inter', sans-serif";
        Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';
    };

    const populateComparisonModes = () => {
        Object.entries(comparisonModes).forEach(([value, label]) => {
            const button = document.createElement('button');
            button.dataset.mode = value;
            button.textContent = label;
            comparisonModesContainer.appendChild(button);
        });
        comparisonModesContainer.querySelector('button')?.classList.add('selected');
    };

    const setupEventListeners = () => {
        uploadBtn.addEventListener('click', () => excelFileInput.click());
        excelFileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
        deleteFileBtn.addEventListener('click', handleDeleteFile);
        updateChartBtn.addEventListener('click', handleUpdateChart);
        comparisonModesContainer.addEventListener('click', handleModeSelection);
        fullscreenBtn.addEventListener('click', () => document.querySelector('.chart-and-insights-container').requestFullscreen());
        chartTypeSwitcher.addEventListener('click', handleChartTypeSwitch);
        panelToggleBtn.addEventListener('click', toggleControlPanel);
        todaysSalesInput.addEventListener('input', saveTodaysSales);
        setupDragAndDrop();

        // --- MODIFICATION START: Add listener for exiting fullscreen --- //
        document.addEventListener('fullscreenchange', () => {
            // When we exit fullscreen, document.fullscreenElement becomes null
            if (!document.fullscreenElement) {
                // If the chart exists, tell it to resize to its container
                if (salesChart) {
                    // A tiny delay ensures the browser has finished its layout changes first
                    setTimeout(() => {
                        salesChart.resize();
                    }, 50);
                }
            }
        });
        // --- MODIFICATION END --- //
    };
    
    const setupDragAndDrop = () => {
        dropZone.addEventListener('dragover', e => { 
            e.preventDefault(); 
            dropZone.classList.add('dragover'); 
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            handleFile(e.dataTransfer.files[0]);
        });
    };

    const handleFile = (file) => {
        if (!file) return;
        updateFileStatus(`Loading ${file.name}...`, false);
        const reader = new FileReader();
        reader.onload = (e) => processFile(e.target.result, file.name);
        reader.onerror = () => updateFileStatus("Failed to read file.", true);
        reader.readAsBinaryString(file);
    };

    const handleDeleteFile = () => {
        historicalData = [];
        excelFileInput.value = '';
        todaysSalesInput.value = '';
        fileInfoContainer.classList.add('hidden');
        dropZone.style.display = 'block';
        analysisPanel.classList.add('disabled');
        generatePanel.classList.add('disabled');
        updateFileStatus('', false);
        if (salesChart) {
            salesChart.destroy();
            salesChart = null;
            chartPlaceholder.style.display = 'flex';
        }
        kpiContainer.innerHTML = '';
        insightsContent.innerHTML = '<p class="no-data-text">Generate a chart to see automated insights here.</p>';
        dashboardTitleText.textContent = 'Sales Dashboard';
        clearLocalStorage();
    };

    const toggleControlPanel = () => {
        const isCollapsed = controlPanel.classList.toggle('collapsed');
        const icon = panelToggleBtn.querySelector('i');
        
        if (isCollapsed) {
            icon.classList.remove('fa-chevron-left');
            icon.classList.add('fa-chevron-right');
        } else {
            icon.classList.remove('fa-chevron-right');
            icon.classList.add('fa-chevron-left');
        }
    };

    const handleChartTypeSwitch = (e) => {
        const btn = e.target.closest('.chart-type-btn');
        if (!btn || btn.classList.contains('active')) return;

        currentChartType = btn.dataset.chartType;
        document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (salesChart || historicalData.length > 0) {
           handleUpdateChart();
        }
    };

    const handleModeSelection = (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        const selectedMode = e.target.dataset.mode;
        document.querySelectorAll('#comparison-modes button').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.mode === selectedMode);
        });
        renderAdditionalControls(selectedMode);
    };

    const handleUpdateChart = () => {
        chartError.textContent = '';
        let todayDataset = null;

        if (todaysSalesInput.value.trim() !== '') {
            const parsedResult = parseComplexSalesData(todaysSalesInput.value);
            if (!parsedResult) {
                chartError.textContent = "Could not parse today's sales data.";
                return;
            }
            const alignedSales = alignSalesData(parsedResult);
            const lastSaleIndex = findLastSaleIndex(alignedSales);

            todayDataset = {
                label: `Today's Sales`,
                data: calculateCumulative(alignedSales, lastSaleIndex),
                raw: alignedSales,
                borderColor: '#FF69B4',
                borderWidth: 3,
                pointRadius: 0,
                tension: 0.4,
                fill: true,
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
            chartError.textContent = "No data available to generate chart.";
            return;
        }

        renderChart(datasets);
        updateKpis(todayDataset, comparisonData);
        generateInsights(todayDataset, comparisonData);
    };

    const updateFileStatus = (message, isError = false) => {
        fileStatus.textContent = message;
        fileStatus.style.color = isError ? '#FF69B4' : '#00BFFF';
    };

    const parseDDMMYYYY = (dateString) => {
        const parts = String(dateString).split(/[/.-]/);
        if (parts.length === 3) {
            const [day, month, year] = parts.map(Number);
            const fullYear = year < 100 ? (year > 50 ? 1900 + year : 2000 + year) : year;
            return new Date(Date.UTC(fullYear, month - 1, day));
        }
        return new Date(dateString);
    };
    
    const processFile = (fileContent, fileName) => {
        try {
            const workbook = XLSX.read(fileContent, { type: 'binary' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

            if (json.length < 2) throw new Error("Spreadsheet is empty or invalid.");

            const header = json[0].map(h => String(h).trim());
            const fileTimeSlots = header.slice(1);

            const processedData = json.slice(1).map(row => {
                if (!row[0]) return null;
                const date = parseDDMMYYYY(row[0]);
                if (isNaN(date.getTime())) return null;

                const alignedSales = Array(timeSlots.length).fill(0);
                fileTimeSlots.forEach((slot, index) => {
                    const mainIndex = timeSlots.indexOf(slot);
                    if (mainIndex !== -1) {
                        alignedSales[mainIndex] = parseFloat(row.slice(1)[index]) || 0;
                    }
                });

                const totalSales = alignedSales.reduce((a, b) => a + b, 0);
                if (totalSales === 0) return null;

                return {
                    id: date.toISOString().split('T')[0],
                    date: date.toISOString(),
                    dayOfWeek: date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }),
                    sales: alignedSales,
                    totalSales
                };
            }).filter(Boolean);

            if (processedData.length === 0) throw new Error("No valid data rows found.");
            
            historicalData = processedData;
            updateUIWithLoadedData(fileName);
            saveHistoricalData(fileName);

        } catch (error) {
            updateFileStatus(error.message, true);
            handleDeleteFile();
        }
    };
    
    const renderAdditionalControls = (mode) => {
        additionalControlsContainer.innerHTML = '';
        if (['average', 'record_days', 'worst_days', 'specific'].includes(mode)) {
            const div = document.createElement('div');
            div.className = 'control-group';
            if (mode === 'average') {
                div.innerHTML = `
                    <label for="day-of-week">Day of the Week</label>
                    <select id="day-of-week" class="form-input">
                        ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(o => `<option>${o}</option>`).join('')}
                    </select>`;
            } else {
                div.appendChild(createCheckboxes(mode));
            }
            additionalControlsContainer.appendChild(div);
        }
    };
    
    const createCheckboxes = (mode) => {
        const div = document.createElement('div');
        let data, label;

        const sortAndSlice = (sortFn, slice) => [...historicalData].sort(sortFn).slice(0, slice);

        switch (mode) {
            case 'record_days':
                data = sortAndSlice((a, b) => b.totalSales - a.totalSales, 10);
                label = 'Top 10 Record Days';
                break;
            case 'worst_days':
                data = sortAndSlice((a, b) => a.totalSales - b.totalSales, 10);
                label = '10 Lowest Sales Days';
                break;
            case 'specific':
                data = sortAndSlice((a, b) => new Date(b.date) - new Date(a.date), 100);
                label = 'Select up to 6 days';
                break;
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
            container.innerHTML = `<p class="no-data-text">No historical data loaded.</p>`;
        }
        div.appendChild(container);
        return div;
    };
    
    const getComparisonData = (mode) => {
        const salesDate = salesDateInput.valueAsDate || new Date();
        const utcDate = new Date(Date.UTC(salesDate.getFullYear(), salesDate.getMonth(), salesDate.getDate()));

        const createDataset = (dayData, index, options = {}) => ({
            label: options.label || new Date(dayData.date).toLocaleDateString('en-GB', { timeZone: 'UTC' }),
            data: calculateCumulative(dayData.sales),
            raw: dayData.sales,
            borderColor: lineColors[index % lineColors.length],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
            ...options
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
                const relevant = historicalData.filter(d => d.dayOfWeek === dayOfWeek);
                if (!relevant.length) { chartError.textContent = `No data for ${dayOfWeek}.`; return null; }
                const avgSales = timeSlots.map((_, i) => relevant.reduce((sum, d) => sum + d.sales[i], 0) / relevant.length);
                return [createDataset({ sales: avgSales, date: new Date() }, 0, { label: `Average ${dayOfWeek}`, borderDash: [5, 5] })];
            }
            case 'top_weekday': {
                const dayOfWeek = utcDate.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
                const relevant = historicalData.filter(d => d.dayOfWeek === dayOfWeek);
                if (!relevant.length) { chartError.textContent = `No data for ${dayOfWeek}.`; return null; }
                return relevant.sort((a, b) => b.totalSales - a.totalSales).slice(0, 5).map((d,i)=>createDataset(d,i));
            }
            case 'specific':
            case 'record_days':
            case 'worst_days': {
                const checked = Array.from(document.querySelectorAll('#additional-controls input:checked'));
                if (!checked.length) { chartError.textContent = 'Please select at least one day.'; return null; }
                return checked.slice(0, 6).map((box, i) => {
                    const dayData = historicalData.find(d => d.id === box.value);
                    return dayData ? createDataset(dayData, i) : null;
                }).filter(Boolean);
            }
            case 'same_day_last_week': {
                const d = new Date(utcDate); d.setUTCDate(d.getUTCDate() - 7); return findAndFormat(d, 'Last Week');
            }
            case 'same_date_last_year': {
                const d = new Date(utcDate); d.setUTCFullYear(d.getUTCFullYear() - 1); return findAndFormat(d, 'Same Date Last Year');
            }
            case 'same_day_last_year': {
                const d = new Date(utcDate);
                d.setUTCFullYear(d.getUTCFullYear() - 1);
                const dayDiff = utcDate.getUTCDay() - d.getUTCDay();
                d.setUTCDate(d.getUTCDate() + dayDiff);
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
                data: {
                    datasets: [{
                        label: 'Sales Heatmap (£)',
                        data: heatmapData,
                        backgroundColor: (c) => `rgba(0, 191, 255, ${Math.min(0.1 + ((c.dataset.data[c.dataIndex]?.v || 0) / 150), 1)})`,
                        borderColor: 'rgba(26, 26, 46, 0.5)',
                        borderWidth: 1,
                        width: ({chart}) => (chart.chartArea || {}).width / timeSlots.length - 1,
                        height: ({chart}) => (chart.chartArea || {}).height / 7 - 1,
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { type: 'category', labels: timeSlots, ticks: { autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
                        y: { type: 'category', labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], offset: true, grid: { display: false } }
                    },
                    plugins: { legend: { display: false }, tooltip: { callbacks: { title:()=>'', label: c => `£${c.raw.v.toFixed(2)}` } } }
                }
            };
        } else {
            let finalDatasets, yAxisTitle;
            if (currentChartType === 'bar') {
                finalDatasets = datasets.map(ds => ({ ...ds, data: ds.raw, type: 'bar', backgroundColor: ds.borderColor + '80' }));
                yAxisTitle = 'Sales per Interval (£)';
            } else {
                finalDatasets = datasets.map(ds => ({ ...ds, type: 'line', backgroundColor: ds.backgroundColor || (ds.borderColor + '1A') }));
                yAxisTitle = 'Cumulative Sales (£)';
            }
            chartConfig = {
                type: 'line', data: { labels: timeSlots, datasets: finalDatasets },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    scales: { y: { title: { display: true, text: yAxisTitle } } },
                    plugins: { legend: { position: 'bottom' } }
                }
            };
        }
        salesChart = new Chart(ctx, chartConfig);
    };

    const generateInsights = (todayData, comparisonData) => {
        insightsContent.innerHTML = '';
        let insights = [];
    
        if (todayData) {
            const todayTotal = todayData.data[findLastSaleIndex(todayData.raw)] || 0;
            const peakHour = getPeakHour(todayData.raw);
            insights.push(`Today's sales peaked around <strong>${peakHour}</strong>.`);
            
            if (comparisonData && comparisonData.length > 0) {
                const compTotal = comparisonData[0].data.at(-1);
                if(compTotal > 0){
                    const percentChange = (todayTotal / compTotal - 1) * 100;
                    const verb = percentChange >= 0 ? 'up' : 'down';
                    insights.push(`Performance is <strong>${verb} ${Math.abs(percentChange).toFixed(1)}%</strong> vs '${comparisonData[0].label}'.`);
                }
            }
    
            const morningSales = todayData.raw.slice(0, 14).reduce((a, b) => a + b, 0);
            const afternoonSales = todayData.raw.slice(14).reduce((a, b) => a + b, 0);
            if(morningSales + afternoonSales > 0){
                const split = (morningSales / (morningSales + afternoonSales) * 100).toFixed(0);
                insights.push(`The morning session drove <strong>${split}%</strong> of today's revenue.`);
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
            kpiContainer.innerHTML = '<p class="no-data-text">No data for KPIs.</p>';
            return;
        }

        const lastSaleIndex = findLastSaleIndex(todayData.raw);
        const todayTotal = todayData.data[lastSaleIndex] || 0;
        let comparisonTotal = null;
        let change = null;
        let comparisonLabel = 'vs. N/A';

        if (comparisonData && comparisonData.length > 0) {
            const firstComparison = comparisonData[0];
            comparisonTotal = firstComparison.data[lastSaleIndex] || 0;
            if (comparisonTotal > 0) change = ((todayTotal - comparisonTotal) / comparisonTotal) * 100;
            comparisonLabel = `vs. ${firstComparison.label}`;
        }

        const projectedSales = calculateProjectedSales(todayData.raw);

        const kpis = [
            { hero: true, title: "Today's Total Sales", value: `£${todayTotal.toFixed(2)}`, change: change, label: comparisonLabel },
            { title: "Projected Sales", value: `~ £${projectedSales.toFixed(2)}`, label: 'based on current run-rate' },
            { title: "Avg. Transaction", value: `£${(todayTotal / (todayData.raw.filter(v => v > 0).length || 1)).toFixed(2)}`, label: 'per active half-hour' },
            { title: "Peak Hour", value: getPeakHour(todayData.raw), label: 'highest sales interval' }
        ];

        kpis.forEach(kpi => {
            const card = document.createElement('div');
            card.className = 'kpi-card';
            if (kpi.hero) card.classList.add('hero');
            
            let changeHtml = '';
            if (kpi.change !== null && isFinite(kpi.change)) {
                const changeClass = kpi.change >= 0 ? 'positive' : 'negative';
                const sign = kpi.change >= 0 ? '+' : '';
                changeHtml = `<p class="kpi-change ${changeClass}">${sign}${kpi.change.toFixed(1)}%</p>`;
            }
             card.innerHTML = `
                <h4>${kpi.title}</h4>
                <p class="kpi-value">${kpi.value}</p>
                <div class="kpi-footer">
                    ${changeHtml}
                    <p class="kpi-label">${kpi.label}</p>
                </div>`;
            kpiContainer.appendChild(card);
        });
    };

    const calculateProjectedSales = (rawSales) => {
        const lastSaleIndex = findLastSaleIndex(rawSales);
        if (lastSaleIndex === -1) return 0;
        
        const intervalsPassed = lastSaleIndex + 1;
        const totalSoFar = rawSales.slice(0, intervalsPassed).reduce((a, b) => a + b, 0);
        const rate = totalSoFar / intervalsPassed;
        
        return rate * timeSlots.length;
    };


    const getPeakHour = (salesArray) => {
        if (!salesArray || salesArray.length === 0) return 'N/A';
        const maxSales = Math.max(...salesArray);
        if (maxSales === 0) return 'N/A';
        return timeSlots[salesArray.indexOf(maxSales)];
    };
    
    const parseComplexSalesData = (pastedString) => {
        if (!pastedString || typeof pastedString !== 'string') return null;
        const items = pastedString.split(/[\s,£\t\n\r]+/).filter(Boolean);
        if (items.length === 0) return null;

        const salesFigures = [];
        let startTime = '05:00';
        const timeRegex = /^\d{2}:\d{2}$/;

        for (let i = 0; i < items.length; i++) {
            if (timeRegex.test(items[i]) && items[i+1] === "-") {
                if (salesFigures.length === 0) startTime = items[i];
                const value = parseFloat(items[i+7]);
                if (!isNaN(value)) salesFigures.push(value);
                i += 7;
            }
        }
        if (salesFigures.length > 0) return { sales: salesFigures, startTime };
        const potentialSales = items.map(parseFloat).filter(v => !isNaN(v));
        return potentialSales.length > 0 ? { sales: potentialSales, startTime } : null;
    };
    
    const alignSalesData = (parsedResult) => {
        const alignedSales = Array(timeSlots.length).fill(0);
        const startIndex = timeSlots.indexOf(parsedResult.startTime);
        if (startIndex !== -1) {
            parsedResult.sales.forEach((value, index) => {
                if (startIndex + index < alignedSales.length) alignedSales[startIndex + index] = value;
            });
        }
        return alignedSales;
    };

    const findLastSaleIndex = (salesArray) => {
        for (let i = salesArray.length - 1; i >= 0; i--) {
            if (salesArray[i] > 0) {
                return i;
            }
        }
        return -1;
    };

    const calculateCumulative = (data, limitIndex = -1) => {
        const cumulativeData = [];
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i];
            if (limitIndex !== -1 && i > limitIndex) {
                cumulativeData.push(null);
            } else {
                cumulativeData.push(sum);
            }
        }
        return cumulativeData;
    };

    init();
});

