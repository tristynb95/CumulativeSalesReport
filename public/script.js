document.addEventListener('DOMContentLoaded', () => {

    // --- STATE MANAGEMENT --- //
    const state = {
        salesChart: null,
        historicalData: [],
        currentChartType: 'line',
        timeSlots: Array.from({ length: 28 }, (_, i) => {
            const hour = Math.floor(i / 2) + 5;
            const minute = i % 2 === 0 ? '00' : '30';
            return `${String(hour).padStart(2, '0')}:${minute}`;
        }),
        lineColors: ['#0078D4', '#F5A623', '#4CAF50', '#E91E63', '#9C27B0', '#FF5722'],
        comparisonModes: {
            average: 'Average Weekday',
            top_weekday: 'Record By Weekday',
            worst_days: 'Lowest Sales',
            specific: 'Specific Days',
            same_day_last_week: 'Last Week',
            same_date_last_year: 'Last Year (Date)',
            same_day_last_year: 'Last Year (Day)',
        }
    };

    // --- DOM ELEMENTS --- //
    const ui = {
        excelFileInput: document.getElementById('excel-file-input'),
        uploadBtn: document.getElementById('upload-btn'),
        dropZone: document.getElementById('drop-zone'),
        fileStatus: document.getElementById('file-status'),
        updateChartBtn: document.getElementById('update-chart-btn'),
        chartError: document.getElementById('chart-error'),
        comparisonModesContainer: document.getElementById('comparison-modes'),
        additionalControlsContainer: document.getElementById('additional-controls'),
        todaysSalesInput: document.getElementById('todays-sales'),
        salesDateInput: document.getElementById('sales-date'),
        analysisPanel: document.getElementById('analysis-panel'),
        generatePanel: document.getElementById('generate-panel'),
        chartPlaceholder: document.getElementById('chart-placeholder'),
        chartPanel: document.getElementById('chart-panel'),
        fullscreenBtn: document.getElementById('fullscreen-btn'),
        fileInfoContainer: document.getElementById('file-info-container'),
        fileNameEl: document.getElementById('file-name'),
        deleteFileBtn: document.getElementById('delete-file-btn'),
        kpiContainer: document.getElementById('kpi-container'),
        chartTypeSwitcher: document.querySelector('.chart-type-switcher'),
        insightsContent: document.getElementById('insights-content'),
        panelToggleBtn: document.getElementById('panel-toggle-btn'),
        controlPanel: document.getElementById('control-panel'),
    };

    // --- APP INITIALIZATION --- //
    const init = () => {
        ui.salesDateInput.valueAsDate = new Date();
        populateComparisonModes();
        setupEventListeners();
        setupChartDefaults();
    };

    const setupChartDefaults = () => {
        Chart.defaults.color = '#777777';
        Chart.defaults.font.family = "'Space Grotesk', sans-serif";
        Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.05)';
    };

    const populateComparisonModes = () => {
        Object.entries(state.comparisonModes).forEach(([value, label]) => {
            const button = document.createElement('button');
            button.dataset.mode = value;
            button.textContent = label;
            ui.comparisonModesContainer.appendChild(button);
        });
        ui.comparisonModesContainer.querySelector('button')?.classList.add('selected');
    };

    // --- EVENT HANDLERS & UI --- //
    const setupEventListeners = () => {
        ui.uploadBtn.addEventListener('click', () => ui.excelFileInput.click());
        ui.excelFileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
        ui.deleteFileBtn.addEventListener('click', handleDeleteFile);
        ui.updateChartBtn.addEventListener('click', handleUpdateChart);
        ui.comparisonModesContainer.addEventListener('click', handleModeSelection);
        ui.fullscreenBtn.addEventListener('click', () => ui.chartPanel.requestFullscreen().catch(err => console.error(err)));
        ui.chartTypeSwitcher.addEventListener('click', handleChartTypeSwitch);
        ui.panelToggleBtn.addEventListener('click', toggleControlPanel);
        setupDragAndDrop();
    };

    const setupDragAndDrop = () => {
        ['dragover', 'drop'].forEach(eventName => ui.dropZone.addEventListener(eventName, e => e.preventDefault()));
        ui.dropZone.addEventListener('dragover', () => ui.dropZone.classList.add('dragover'));
        ui.dropZone.addEventListener('dragleave', () => ui.dropZone.classList.remove('dragover'));
        ui.dropZone.addEventListener('drop', e => {
            ui.dropZone.classList.remove('dragover');
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
        state.historicalData = [];
        ui.excelFileInput.value = '';
        ui.fileInfoContainer.classList.add('hidden');
        ui.dropZone.style.display = 'block';
        ui.analysisPanel.classList.add('disabled');
        ui.generatePanel.classList.add('disabled');
        updateFileStatus('', false);
        if (state.salesChart) {
            state.salesChart.destroy();
            state.salesChart = null;
            ui.chartPlaceholder.style.display = 'flex';
        }
        ui.kpiContainer.innerHTML = '';
        ui.insightsContent.innerHTML = '<p class="no-data-text">Generate a chart to see automated insights here.</p>';
    };

    const toggleControlPanel = () => {
        ui.controlPanel.classList.toggle('collapsed');
        ui.panelToggleBtn.querySelector('i').classList.toggle('fa-chevron-left');
        ui.panelToggleBtn.querySelector('i').classList.toggle('fa-chevron-right');
    };

    const handleChartTypeSwitch = (e) => {
        const btn = e.target.closest('.chart-type-btn');
        if (!btn || btn.classList.contains('active')) return;

        state.currentChartType = btn.dataset.chartType;
        document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (state.salesChart || state.historicalData.length > 0) {
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
        ui.chartError.textContent = '';
        let todayDataset = null;

        if (ui.todaysSalesInput.value.trim() !== '') {
            const parsedResult = parseComplexSalesData(ui.todaysSalesInput.value);
            if (!parsedResult) {
                ui.chartError.textContent = "Could not parse today's sales data.";
                return;
            }
            const alignedSales = alignSalesData(parsedResult);
            todayDataset = {
                label: `Today's Sales`,
                data: calculateCumulative(alignedSales),
                raw: alignedSales,
                borderColor: '#E91E63',
                borderWidth: 3,
                pointRadius: 0,
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(233, 30, 99, 0.1)',
            };
        }

        let datasets = todayDataset ? [todayDataset] : [];
        const selectedMode = document.querySelector('#comparison-modes button.selected')?.dataset.mode;
        let comparisonData = null;
        if (selectedMode && state.historicalData.length > 0) {
            comparisonData = getComparisonData(selectedMode);
            if (comparisonData) datasets.push(...comparisonData);
        }

        if (datasets.length === 0 && state.currentChartType !== 'heatmap') {
            ui.chartError.textContent = "No data available to generate chart.";
            return;
        }

        renderChart(datasets);
        updateKpis(todayDataset, comparisonData);
        generateInsights(todayDataset, comparisonData);
    };

    const updateFileStatus = (message, isError = false) => {
        ui.fileStatus.textContent = message;
        ui.fileStatus.style.color = isError ? '#D32F2F' : '#0078D4';
    };

    // --- DATA PROCESSING & ANALYSIS --- //
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

                const alignedSales = Array(state.timeSlots.length).fill(0);
                fileTimeSlots.forEach((slot, index) => {
                    const mainIndex = state.timeSlots.indexOf(slot);
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

            state.historicalData = processedData;
            updateFileStatus(`${state.historicalData.length} records loaded successfully.`);
            ui.analysisPanel.classList.remove('disabled');
            ui.generatePanel.classList.remove('disabled');
            ui.fileNameEl.textContent = fileName;
            ui.fileInfoContainer.classList.remove('hidden');
            ui.dropZone.style.display = 'none';

            const selectedMode = document.querySelector('#comparison-modes button.selected')?.dataset.mode;
            if (selectedMode) renderAdditionalControls(selectedMode);

        } catch (error) {
            updateFileStatus(error.message, true);
            handleDeleteFile();
        }
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

    const renderAdditionalControls = (mode) => {
        ui.additionalControlsContainer.innerHTML = '';
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
            ui.additionalControlsContainer.appendChild(div);
        }
    };

    const createCheckboxes = (mode) => {
        const div = document.createElement('div');
        let data, label;

        const sortAndSlice = (sortFn, slice) => [...state.historicalData].sort(sortFn).slice(0, slice);

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
        const salesDate = ui.salesDateInput.valueAsDate || new Date();
        const utcDate = new Date(Date.UTC(salesDate.getFullYear(), salesDate.getMonth(), salesDate.getDate()));

        const createDataset = (dayData, index, options = {}) => ({
            label: options.label || new Date(dayData.date).toLocaleDateString('en-GB', { timeZone: 'UTC' }),
            data: calculateCumulative(dayData.sales),
            raw: dayData.sales,
            borderColor: state.lineColors[index % state.lineColors.length],
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
            ...options
        });

        const findAndFormat = (targetDate, label) => {
            const day = state.historicalData.find(d => d.id === targetDate.toISOString().split('T')[0]);
            if (day) return [createDataset(day, 0, { label })];
            ui.chartError.textContent = `No data for ${targetDate.toLocaleDateString('en-GB', { timeZone: 'UTC' })}`;
            return null;
        };

        switch (mode) {
            case 'average': {
                const dayOfWeek = document.getElementById('day-of-week').value;
                const relevant = state.historicalData.filter(d => d.dayOfWeek === dayOfWeek);
                if (!relevant.length) { ui.chartError.textContent = `No data for ${dayOfWeek}.`; return null; }
                const avgSales = state.timeSlots.map((_, i) => relevant.reduce((sum, d) => sum + d.sales[i], 0) / relevant.length);
                return [createDataset({ sales: avgSales, date: new Date() }, 0, { label: `Average ${dayOfWeek}`, borderDash: [5, 5] })];
            }
            case 'top_weekday': {
                const dayOfWeek = utcDate.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
                const relevant = state.historicalData.filter(d => d.dayOfWeek === dayOfWeek);
                if (!relevant.length) { ui.chartError.textContent = `No data for ${dayOfWeek}.`; return null; }
                return relevant.sort((a, b) => b.totalSales - a.totalSales).slice(0, 5).map((d, i) => createDataset(d, i));
            }
            case 'specific':
            case 'record_days':
            case 'worst_days': {
                const checked = Array.from(document.querySelectorAll('#additional-controls input:checked'));
                if (!checked.length) { ui.chartError.textContent = 'Please select at least one day.'; return null; }
                return checked.slice(0, 6).map((box, i) => {
                    const dayData = state.historicalData.find(d => d.id === box.value);
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

    // --- CHART RENDERING --- //
    const renderChart = (datasets) => {
        if (state.salesChart) state.salesChart.destroy();
        ui.chartPlaceholder.style.display = 'none';
        const ctx = document.getElementById('salesChart').getContext('2d');
        let chartConfig;

        if (state.currentChartType === 'heatmap') {
            const heatmapData = state.historicalData.flatMap(day => {
                const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day.dayOfWeek);
                return day.sales.map((value, timeIndex) => ({ x: timeIndex, y: dayIndex, v: value }));
            });
            chartConfig = {
                type: 'matrix',
                data: {
                    datasets: [{
                        label: 'Sales Heatmap (£)',
                        data: heatmapData,
                        backgroundColor: (c) => `rgba(0, 120, 212, ${Math.min(0.1 + ((c.dataset.data[c.dataIndex]?.v || 0) / 150), 1)})`,
                        borderColor: 'rgba(255, 255, 255, 0.5)',
                        borderWidth: 1,
                        width: ({ chart }) => (chart.chartArea || {}).width / state.timeSlots.length - 1,
                        height: ({ chart }) => (chart.chartArea || {}).height / 7 - 1,
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { type: 'category', labels: state.timeSlots, ticks: { autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
                        y: { type: 'category', labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], offset: true, grid: { display: false } }
                    },
                    plugins: { legend: { display: false }, tooltip: { callbacks: { title: () => '', label: c => `£${c.raw.v.toFixed(2)}` } } }
                }
            };
        } else {
            let finalDatasets, yAxisTitle;
            if (state.currentChartType === 'bar') {
                finalDatasets = datasets.map(ds => ({ ...ds, data: ds.raw, type: 'bar', backgroundColor: ds.borderColor + '80' }));
                yAxisTitle = 'Sales per Interval (£)';
            } else {
                finalDatasets = datasets.map(ds => ({ ...ds, type: 'line', backgroundColor: ds.backgroundColor || (ds.borderColor + '1A') }));
                yAxisTitle = 'Cumulative Sales (£)';
            }
            chartConfig = {
                type: 'line', data: { labels: state.timeSlots, datasets: finalDatasets },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    scales: { y: { title: { display: true, text: yAxisTitle } } },
                    plugins: { legend: { position: 'bottom' } }
                }
            };
        }
        state.salesChart = new Chart(ctx, chartConfig);
    };

    // --- KPI & INSIGHTS --- //
    const generateInsights = (todayData, comparisonData) => {
        ui.insightsContent.innerHTML = '';
        let insights = [];

        if (todayData) {
            const peakHour = getPeakHour(todayData.raw);
            insights.push(`Today's sales peaked around <strong>${peakHour}</strong>.`);

            if (comparisonData && comparisonData.length > 0) {
                const todayTotal = todayData.data.at(-1);
                const compTotal = comparisonData[0].data.at(-1);
                if (compTotal > 0) {
                    const percentChange = (todayTotal / compTotal - 1) * 100;
                    const verb = percentChange >= 0 ? 'up' : 'down';
                    insights.push(`Performance is <strong>${verb} ${Math.abs(percentChange).toFixed(1)}%</strong> vs '${comparisonData[0].label}'.`);
                }
            }

            const morningSales = todayData.raw.slice(0, 14).reduce((a, b) => a + b, 0);
            const afternoonSales = todayData.raw.slice(14).reduce((a, b) => a + b, 0);
            if (morningSales + afternoonSales > 0) {
                const split = (morningSales / (morningSales + afternoonSales) * 100).toFixed(0);
                insights.push(`The morning session drove <strong>${split}%</strong> of today's revenue.`);
            }
        } else {
            insights.push(`Load today's data to generate live insights.`);
        }

        if (state.historicalData.length > 0) {
            const historicalAvg = state.historicalData.reduce((sum, day) => sum + day.totalSales, 0) / state.historicalData.length;
            insights.push(`The average daily total from your dataset is <strong>£${historicalAvg.toFixed(2)}</strong>.`);
        }

        if (insights.length > 0) {
            insights.forEach(insight => {
                const p = document.createElement('p');
                p.className = 'insight-item';
                p.innerHTML = `<i class="fas fa-check-circle"></i> ${insight}`;
                ui.insightsContent.appendChild(p);
            });
        } else {
            ui.insightsContent.innerHTML = '<p class="no-data-text">Not enough data for insights.</p>';
        }
    };

    const updateKpis = (todayData, comparisonData) => {
        ui.kpiContainer.innerHTML = '';
        if (!todayData || !todayData.data.length) {
            ui.kpiContainer.innerHTML = '<p class="no-data-text">No data for KPIs.</p>';
            return;
        }

        const todayTotal = todayData.data.at(-1);
        let comparisonTotal = null;
        let change = null;
        let comparisonLabel = 'vs. N/A';

        if (comparisonData && comparisonData.length > 0) {
            const firstComparison = comparisonData[0];
            comparisonTotal = firstComparison.data.at(-1);
            if (comparisonTotal > 0) change = ((todayTotal - comparisonTotal) / comparisonTotal) * 100;
            comparisonLabel = `vs. ${firstComparison.label}`;
        }

        const kpis = [
            { title: "Today's Total Sales", value: `£${todayTotal.toFixed(2)}`, change: change, label: comparisonLabel },
            { title: "Avg. Transaction Value", value: `£${(todayTotal / (todayData.raw.filter(v => v > 0).length || 1)).toFixed(2)}`, label: 'per active half-hour' },
            { title: "Peak Hour", value: getPeakHour(todayData.raw), label: 'Highest sales interval' }
        ];

        kpis.forEach(kpi => {
            const card = document.createElement('div');
            card.className = 'kpi-card';
            let changeHtml = '';
            if (kpi.change !== null && isFinite(kpi.change)) {
                const changeClass = kpi.change >= 0 ? 'positive' : 'negative';
                const sign = kpi.change >= 0 ? '+' : '';
                changeHtml = `<p class="kpi-change ${changeClass}">${sign}${kpi.change.toFixed(1)}%</p>`;
            }
            card.innerHTML = `<h4>${kpi.title}</h4><p class="kpi-value">${kpi.value}</p><div class="kpi-footer">${changeHtml}<p class="kpi-label">${kpi.label}</p></div>`;
            ui.kpiContainer.appendChild(card);
        });
    };

    // --- UTILITY FUNCTIONS --- //
    const getPeakHour = (salesArray) => {
        if (!salesArray || salesArray.length === 0) return 'N/A';
        const maxSales = Math.max(...salesArray);
        if (maxSales === 0) return 'N/A';
        return state.timeSlots[salesArray.indexOf(maxSales)];
    };

    const parseComplexSalesData = (pastedString) => {
        if (!pastedString || typeof pastedString !== 'string') return null;
        const items = pastedString.split(/[\s,£\t\n\r]+/).filter(Boolean);
        if (items.length === 0) return null;

        const salesFigures = [];
        let startTime = '05:00';
        const timeRegex = /^\d{2}:\d{2}$/;

        for (let i = 0; i < items.length; i++) {
            if (timeRegex.test(items[i]) && items[i + 1] === "-") {
                if (salesFigures.length === 0) startTime = items[i];
                const value = parseFloat(items[i + 7]);
                if (!isNaN(value)) salesFigures.push(value);
                i += 7;
            }
        }
        if (salesFigures.length > 0) return { sales: salesFigures, startTime };
        const potentialSales = items.map(parseFloat).filter(v => !isNaN(v));
        return potentialSales.length > 0 ? { sales: potentialSales, startTime } : null;
    };

    const alignSalesData = (parsedResult) => {
        const alignedSales = Array(state.timeSlots.length).fill(0);
        const startIndex = state.timeSlots.indexOf(parsedResult.startTime);
        if (startIndex !== -1) {
            parsedResult.sales.forEach((value, index) => {
                if (startIndex + index < alignedSales.length) alignedSales[startIndex + index] = value;
            });
        }
        return alignedSales;
    };

    const calculateCumulative = data => data.reduce((acc, val) => [...acc, (acc.at(-1) || 0) + val], []);

    // --- START THE APP --- //
    init();
});