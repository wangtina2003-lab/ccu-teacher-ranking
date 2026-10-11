let teacherBarChart = null;
let dailyAvgBarChart = null;
let categoryPieChart = null;
let categoryDailyHorizontalChart = null; // 新增：橫向長條圖實例

const API_URL = "http://127.0.0.1:5000/api/teachers";

// 專屬學程主題色碼
const TRACK_COLORS = {
    '財務學程': '#1F2A44',  // Navy
    '運籌學程': '#8C7355',  // 深金棕
    '人力資源學程': '#C6A75E', // Soft Gold
    '行銷學程': '#D8C8B0',  // Warm Beige
    '策略學程': '#4A5568'   // 藍灰
};

let allTeachers = [];
let totalViews = 0;
let refreshTimer = null;
let currentSortMode = "total"; // "total": 依累積總數排序 | "daily": 依日均數排序

async function fetchData(forceRefresh = false) {
    try {
        const response = await fetch(forceRefresh ? `${API_URL}?refresh=1` : API_URL);
        const data = await response.json();
        
        if (data.status === "success") {
            allTeachers = data.teachers;
            totalViews = data.total_views;
            updateCategoryFilter(data.teachers);
            updateSearchDatalist(data.teachers);
            updateDashboard(data);
            const updatedAt = new Date(data.updated_at).toLocaleTimeString();
            const refreshStatus = data.refreshing ? "（背景更新中）" : "";
            document.getElementById("last-updated").innerText =
                `最後更新時間：${updatedAt}${refreshStatus}`;
            scheduleFetch(data.refreshing ? 2000 : 30000);
        } else if (data.status === "loading") {
            document.getElementById("last-updated").innerText =
                "首次擷取教師瀏覽數中，完成後會自動顯示";
            scheduleFetch(2000);
        }
    } catch (error) {
        console.error("無法取得數據:", error);
        scheduleFetch(5000);
    }
}

function scheduleFetch(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => fetchData(), delay);
}

function updateCategoryFilter(teachers) {
    const filter = document.getElementById("category-filter");
    const selectedCategory = filter.value;
    const categories = [...new Set(teachers.map(teacher => teacher.category))]
        .sort((a, b) => a.localeCompare(b, "zh-TW"));

    filter.innerHTML = '<option value="">全部教師</option>';
    categories.forEach(category => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = `${category}排行`;
        filter.appendChild(option);
    });
    filter.value = categories.includes(selectedCategory) ? selectedCategory : "";
}

function updateSearchDatalist(teachers) {
    const datalist = document.getElementById("teacher-search-list");
    if (!datalist) return;
    
    datalist.innerHTML = "";
    teachers.forEach(teacher => {
        const option = document.createElement("option");
        option.value = teacher.name;
        option.textContent = `${teacher.name} (${teacher.category})`;
        datalist.appendChild(option);
    });
}

function performTeacherSearch() {
    const input = document.getElementById("teacher-search-input");
    if (!input) return;

    const query = input.value.trim();
    if (!query) return;

    const target = allTeachers.find(t => t.name === query) || 
                   allTeachers.find(t => t.name.includes(query));

    if (target) {
        openTeacherStats(target);
        input.value = "";
    } else {
        alert(`找不到名稱包含「${query}」的教師，請重新輸入！`);
    }
}

function updateDashboard(data) {
    const { total_views, teachers, categories } = data;

    // 1. KPI 卡片數值填入
    document.getElementById("total-views").innerText = total_views.toLocaleString();
    
    // 計算全系每日平均瀏覽數總和
    const totalDailyViews = teachers.reduce((acc, curr) => {
        return acc + (Number.isFinite(curr.average_daily_views) ? curr.average_daily_views : 0);
    }, 0);
    
    document.getElementById("total-daily-views").innerText = totalDailyViews > 0 
        ? totalDailyViews.toFixed(1) 
        : "---";

    const topTeacher = teachers.find(teacher => Number.isFinite(teacher.views));
    document.getElementById("top-teacher").innerText = topTeacher
        ? `${topTeacher.name} (${topTeacher.views.toLocaleString()} 次)`
        : "暫無資料";

    // 計算最高熱度學程
    let topCat = "無";
    let maxCatViews = -1;
    for (const [cat, views] of Object.entries(categories)) {
        if (cat !== "其他" && cat !== "待分類/其他" && views > maxCatViews) {
            maxCatViews = views;
            topCat = cat;
        }
    }

    const topCategoryElem = document.getElementById("top-category");
    topCategoryElem.innerText = `${topCat} (${maxCatViews.toLocaleString()} 次)`;

    // 2. 渲染表格與四張圖表
    renderTeacherTable();
    renderTeacherBarChart(teachers);
    renderDailyAvgBarChart(teachers);
    renderCategoryPieChart(categories, total_views);
    renderCategoryDailyHorizontalChart(teachers); // 渲染橫向長條圖

    // 3. 動態更新問號圖示 Tooltip
    const sampleBaseline = teachers?.find(t => t.baseline_date)?.baseline_date;
    const tooltipIcons = document.querySelectorAll(".daily-avg-tooltip-icon");
    
    if (tooltipIcons.length > 0) {
        const dateText = sampleBaseline ? `<span class="text-warning fw-bold">${sampleBaseline}</span>` : "系統紀錄日";
        const tooltipContent = `
            <div class="text-start p-1" style="max-width: 220px; font-size: 0.8rem; line-height: 1.4;">
                <div class="fw-bold text-white mb-1">系統監測期間之每日平均增量</div>
                <div class="text-white-50 mb-1">公式：(當前總瀏覽數 - 基準日瀏覽數) ÷ 經過天數</div>
                <div class="text-light">起算基準日：${dateText}</div>
            </div>
        `;
        
        tooltipIcons.forEach(icon => {
            icon.setAttribute("data-bs-original-title", tooltipContent);
            icon.setAttribute("title", tooltipContent);

            if (window.bootstrap && bootstrap.Tooltip) {
                const existingTooltip = bootstrap.Tooltip.getInstance(icon);
                if (existingTooltip) {
                    existingTooltip.dispose();
                }
                new bootstrap.Tooltip(icon);
            }
        });
    }
}

function renderTeacherTable() {
    const tbody = document.getElementById("teacher-table-body");
    
    tbody.classList.add("fade-out");

    setTimeout(() => {
        tbody.innerHTML = "";
        const selectedCategory = document.getElementById("category-filter").value;
        
        let filtered = selectedCategory
            ? allTeachers.filter(teacher => teacher.category === selectedCategory)
            : allTeachers.slice();

        if (currentSortMode === "daily") {
            filtered.sort((a, b) => (b.average_daily_views ?? -1) - (a.average_daily_views ?? -1));
        } else {
            filtered.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
        }

        const thViews = document.getElementById("th-views");
        const thDaily = document.getElementById("th-daily");
        if (currentSortMode === "daily") {
            thDaily.classList.add("col-active");
            thViews.classList.remove("col-active");
        } else {
            thViews.classList.add("col-active");
            thDaily.classList.remove("col-active");
        }

        filtered.forEach((t, index) => {
            const rank = (currentSortMode === "daily" ? Number.isFinite(t.average_daily_views) : Number.isFinite(t.views))
                ? index + 1
                : null;
            
            const percentage = Number.isFinite(t.views) && totalViews > 0
                ? `${((t.views / totalViews) * 100).toFixed(1)}%`
                : "--";
            
            const averageDailyViews = Number.isFinite(t.average_daily_views)
                ? t.average_daily_views.toLocaleString("zh-TW", { maximumFractionDigits: 1 })
                : "--";
            
            const baselineTitle = t.baseline_date
                ? `系統監測期間之每日平均增量（自 ${t.baseline_date} 起算）`
                : "系統監測期間之每日平均增量（尚無基準日）";
            
            let rankClass = "rank-normal";
            if (rank === 1) rankClass = "rank-top-1";
            if (rank === 2) rankClass = "rank-top-2";
            if (rank === 3) rankClass = "rank-top-3";

            const trackClass = `track-${t.category.replace('/', '')}`;
            const isDailyActive = currentSortMode === "daily" ? "cell-highlight" : "";
            const isViewsActive = currentSortMode === "total" ? "cell-highlight" : "";

            const row = `
                <tr>
                    <td><span class="rank-badge ${rankClass}">${rank ?? "—"}</span></td>
                    <td class="fw-semibold text-dark">
                        <button type="button" class="teacher-name-button" data-teacher-name="${escapeHTML(t.name)}">${escapeHTML(t.name)}</button>
                    </td>
                    <td><span class="track-badge ${trackClass}">${t.category}</span></td>
                    <td class="text-end fw-bold font-monospace text-slate-800 ${isViewsActive}">${Number.isFinite(t.views) ? t.views.toLocaleString() : "暫無資料"}</td>
                    <td class="text-end fw-bold font-monospace text-indigo">${percentage}</td>
                    <td class="text-end fw-bold font-monospace ${isDailyActive}" title="${escapeHTML(baselineTitle)}">${averageDailyViews}</td>
                    <td class="text-center">
                        <a href="${escapeHTML(t.url)}" target="_blank" rel="noopener noreferrer" class="btn-table-link">開啟官網</a>
                    </td>
                </tr>
            `;
            tbody.innerHTML += row;
        });

        tbody.classList.remove("fade-out");
    }, 150);
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function openTeacherStats(teacher) {
    const sortedTotal = allTeachers
        .filter(item => Number.isFinite(item.views))
        .slice()
        .sort((a, b) => b.views - a.views);
    const categoryTotal = sortedTotal.filter(item => item.category === teacher.category);

    const totalRank = Number.isFinite(teacher.views)
        ? sortedTotal.findIndex(item => item.name === teacher.name) + 1
        : null;
    const totalCatRank = Number.isFinite(teacher.views)
        ? categoryTotal.findIndex(item => item.name === teacher.name) + 1
        : null;

    const sortedDaily = allTeachers
        .filter(item => Number.isFinite(item.average_daily_views))
        .slice()
        .sort((a, b) => b.average_daily_views - a.average_daily_views);
    const categoryDaily = sortedDaily.filter(item => item.category === teacher.category);

    const dailyRank = Number.isFinite(teacher.average_daily_views)
        ? sortedDaily.findIndex(item => item.name === teacher.name) + 1
        : null;
    const dailyCatRank = Number.isFinite(teacher.average_daily_views)
        ? categoryDaily.findIndex(item => item.name === teacher.name) + 1
        : null;

    const modal = document.getElementById("teacher-stat-modal");
    const keywordContainer = document.getElementById("teacher-modal-keywords");
    const keywords = Array.isArray(teacher.keywords) ? teacher.keywords.slice(0, 5) : [];

    document.getElementById("teacher-modal-name").textContent = teacher.name;
    document.getElementById("teacher-modal-category").textContent = teacher.category;

    document.getElementById("modal-total-views").textContent = Number.isFinite(teacher.views)
        ? `${teacher.views.toLocaleString()} 次`
        : "暫無資料";
    document.getElementById("modal-total-rank").textContent = totalRank ? `第 ${totalRank} 名` : "暫無資料";
    document.getElementById("modal-total-cat-rank").textContent = totalCatRank ? `第 ${totalCatRank} 名 (${teacher.category})` : "暫無資料";

    document.getElementById("modal-daily-views").textContent = Number.isFinite(teacher.average_daily_views)
        ? `${teacher.average_daily_views.toFixed(1)} 次/天`
        : "暫無資料";
    document.getElementById("modal-daily-rank").textContent = dailyRank ? `第 ${dailyRank} 名` : "暫無資料";
    document.getElementById("modal-daily-cat-rank").textContent = dailyCatRank ? `第 ${dailyCatRank} 名 (${teacher.category})` : "暫無資料";

    document.getElementById("teacher-modal-profile-link").href = teacher.url;

    keywordContainer.replaceChildren();
    if (keywords.length === 0) {
        const message = document.createElement("span");
        message.className = "teacher-keyword-empty";
        message.textContent = "官網尚未提供研究領域資料";
        keywordContainer.appendChild(message);
    } else {
        keywords.forEach(keyword => {
            const tag = document.createElement("span");
            tag.className = "teacher-keyword";
            tag.textContent = keyword;
            keywordContainer.appendChild(tag);
        });
    }

    modal.showModal();
}

// 圖表 1 (左上)：熱門教師 Top 5 直方圖 (Navy)
function renderTeacherBarChart(teachers) {
    const ctx = document.getElementById('teacherBarChart').getContext('2d');
    
    const top5 = teachers.slice(0, 5);
    const labels = top5.map(t => t.name);
    const dataViews = top5.map(t => t.views);

    if (teacherBarChart) teacherBarChart.destroy();

    teacherBarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '網頁瀏覽數',
                data: dataViews,
                backgroundColor: '#1F2A44',
                borderRadius: 6,
                barThickness: 28
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Inter', size: 11, weight: '600' }, color: '#1F2A44' }
                },
                y: {
                    border: { dash: [4, 4] },
                    grid: { color: '#E2DDD5' },
                    ticks: { font: { family: 'Inter', size: 11 }, color: '#656E7B' }
                }
            }
        }
    });
}

// 圖表 2 (右上)：五大學程流量占比圓餅圖 (Doughnut)
function renderCategoryPieChart(categories, totalViews) {
    const ctx = document.getElementById('categoryPieChart').getContext('2d');
    
    const trackEntries = Object.entries(categories)
        .filter(([cat]) => cat !== "其他" && cat !== "待分類/其他")
        .sort((a, b) => b[1] - a[1]);

    const labels = trackEntries.map(([cat]) => cat);
    const dataViews = trackEntries.map(([, views]) => views);
    const bgColors = labels.map(cat => TRACK_COLORS[cat] || '#656E7B');

    const tracksTotal = dataViews.reduce((a, b) => a + b, 0);

    if (categoryPieChart) categoryPieChart.destroy();

    categoryPieChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataViews,
                backgroundColor: bgColors,
                borderWidth: 2,
                borderColor: '#FFFFFF'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        font: { family: 'Inter', size: 11, weight: '600' },
                        color: '#1F2A44',
                        boxWidth: 10,
                        usePointStyle: true,
                        generateLabels: (chart) => {
                            const data = chart.data;
                            return data.labels.map((label, i) => {
                                const val = data.datasets[0].data[i];
                                const pct = tracksTotal > 0 ? ((val / tracksTotal) * 100).toFixed(1) : 0;
                                return {
                                    text: `${label} (${pct}%)`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    hidden: false,
                                    index: i
                                };
                            });
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const pct = tracksTotal > 0 ? ((val / tracksTotal) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${val.toLocaleString()} 次 (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// 圖表 3 (左下)：平均每日瀏覽數 Top 5 直方圖 (Soft Gold)
function renderDailyAvgBarChart(teachers) {
    const ctx = document.getElementById('dailyAvgBarChart').getContext('2d');
    
    const top5Daily = teachers
        .slice()
        .filter(t => Number.isFinite(t.average_daily_views))
        .sort((a, b) => b.average_daily_views - a.average_daily_views)
        .slice(0, 5);

    const labels = top5Daily.map(t => t.name);
    const dataViews = top5Daily.map(t => t.average_daily_views);

    if (dailyAvgBarChart) dailyAvgBarChart.destroy();

    dailyAvgBarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '平均每日瀏覽數',
                data: dataViews,
                backgroundColor: '#C6A75E',
                borderRadius: 6,
                barThickness: 28
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` 平均每日: ${context.raw.toFixed(1)} 次/天`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Inter', size: 11, weight: '600' }, color: '#1F2A44' }
                },
                y: {
                    border: { dash: [4, 4] },
                    grid: { color: '#E2DDD5' },
                    ticks: { font: { family: 'Inter', size: 11 }, color: '#656E7B' }
                }
            }
        }
    });
}

// 圖表 4 (右下)：新增 - 五大學程日均瀏覽數比較 (橫向長條圖)
function renderCategoryDailyHorizontalChart(teachers) {
    const ctx = document.getElementById('categoryDailyHorizontalChart').getContext('2d');

    // 計算各學程內教師的平均日均瀏覽數
    const categoryStats = {};
    
    teachers.forEach(teacher => {
        const cat = teacher.category;
        if (cat === "其他" || cat === "待分類/其他") return;

        if (!categoryStats[cat]) {
            categoryStats[cat] = { totalDaily: 0, count: 0 };
        }

        if (Number.isFinite(teacher.average_daily_views)) {
            categoryStats[cat].totalDaily += teacher.average_daily_views;
            categoryStats[cat].count += 1;
        }
    });

    const categoryAverages = Object.entries(categoryStats)
        .map(([cat, stats]) => ({
            category: cat,
            avgDaily: stats.count > 0 ? stats.totalDaily / stats.count : 0
        }))
        .sort((a, b) => b.avgDaily - a.avgDaily);

    const labels = categoryAverages.map(item => item.category);
    const dataViews = categoryAverages.map(item => item.avgDaily);
    const bgColors = labels.map(cat => TRACK_COLORS[cat] || '#656E7B');

    if (categoryDailyHorizontalChart) categoryDailyHorizontalChart.destroy();

    categoryDailyHorizontalChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '學程教師平均日均點閱',
                data: dataViews,
                backgroundColor: bgColors,
                borderRadius: 6,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y', // 設定為橫向長條圖
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` 學程內教師平均: ${context.raw.toFixed(1)} 次/天`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    border: { dash: [4, 4] },
                    grid: { color: '#E2DDD5' },
                    ticks: { font: { family: 'Inter', size: 11 }, color: '#656E7B' }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { family: 'Inter', size: 11, weight: '600' }, color: '#1F2A44' }
                }
            }
        }
    });
}

// 初始化頁面事件監聽
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".rank-tabs button").forEach(btn => {
        btn.addEventListener("click", event => {
            document.querySelectorAll(".rank-tabs button").forEach(b => b.classList.remove("active"));
            event.currentTarget.classList.add("active");
            
            currentSortMode = event.currentTarget.dataset.sort;
            
            const titleElem = document.getElementById("table-title");
            const subtitleElem = document.getElementById("table-subtitle");

            if (currentSortMode === "daily") {
                titleElem.textContent = "專任教師日均點閱飆升排行榜";
                subtitleElem.textContent = "Daily Average Growth Traffic Ranking";
            } else {
                titleElem.textContent = "專任教師個人網頁熱度即時排行榜";
                subtitleElem.textContent = "Real-time Faculty Webpage Ranking";
            }

            renderTeacherTable();
        });
    });

    document.getElementById("category-filter").addEventListener("change", renderTeacherTable);
    document.getElementById("refresh-btn").addEventListener("click", () => fetchData(true));

    document.getElementById("teacher-table-body").addEventListener("click", event => {
        const button = event.target.closest(".teacher-name-button");
        if (!button) return;

        const teacher = allTeachers.find(item => item.name === button.dataset.teacherName);
        if (teacher) openTeacherStats(teacher);
    });

    document.querySelector(".teacher-modal-close").addEventListener("click", () => {
        document.getElementById("teacher-stat-modal").close();
    });

    document.getElementById("teacher-stat-modal").addEventListener("click", event => {
        if (event.target === event.currentTarget) event.currentTarget.close();
    });

    const searchBtn = document.getElementById("teacher-search-btn");
    const searchInput = document.getElementById("teacher-search-input");

    if (searchBtn) {
        searchBtn.addEventListener("click", performTeacherSearch);
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                performTeacherSearch();
            }
        });

        searchInput.addEventListener("input", (e) => {
            const query = e.target.value.trim();
            const exactMatch = allTeachers.find(t => t.name === query);
            if (exactMatch) {
                performTeacherSearch();
            }
        });
    }

    fetchData();
});