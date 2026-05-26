// ==========================================
// 1. 全域變數與設定
// ==========================================
const API_URL = 'https://data.ntpc.gov.tw/api/datasets/71cd1490-a2df-4198-bef1-318479775e8a/json?page=0&size=2000';

let stations = [];
let filteredStations = [];
let districts = ['全部'];
let selectedDistrict = '全部';

let lastFetchTime = 0;
let updateInterval = 60000; // 60秒更新一次
let isLoading = true;
let hasError = false;
let loadingProgress = 0; // 載入進度百分比
let loadingState = "建立連線中..."; // 載入狀態文字
let dataModeStr = "初始化"; // 當前資料來源模式
let officialDataTime = "載入中"; // 官方資料發布時間

// 滾動與 UI 排版變數
let scrollY = 0;
let targetScrollY = 0;
let maxScrollY = 0;
let filterChips = [];

const TOP_PANEL_H = 80;
let filterPanelH = 60; // 將根據標籤數量自動計算
const CARD_W = 340;
const CARD_H = 130;
const CARD_MARGIN = 20;

// 調色盤物件
let colors;

// ==========================================
// 2. p5.js 生命週期函數
// ==========================================
function setup() {
  createCanvas(windowWidth, windowHeight);
  
  // 初始化 Cyberpunk 調色盤
  colors = {
    bg: color(11, 14, 23),
    card: color(25, 32, 51),
    sbi: color(0, 230, 118),
    bemp: color(0, 180, 255),
    warning: color(255, 46, 99),
    disabled: color(70, 78, 95)
  };

  // 啟動資料拉取
  fetchData();
}

function draw() {
  background(colors.bg);

  if (isLoading || hasError) {
    drawLoading();

    // 即使連線失敗，也允許每隔 60 秒嘗試重新拉取資料
    if (millis() - lastFetchTime > updateInterval) {
      isLoading = true;
      hasError = false;
      fetchData();
    }

    return;
  }

  // 定期資料刷新機制
  if (millis() - lastFetchTime > updateInterval) {
    fetchData();
  }

  // 計算卡片佈局
  let cols = max(1, floor(width / (CARD_W + CARD_MARGIN)));
  let startX = (width - (cols * CARD_W + (cols - 1) * CARD_MARGIN)) / 2;
  let startY = TOP_PANEL_H + filterPanelH + CARD_MARGIN;
  let rows = Math.ceil(filteredStations.length / cols);
  
  // 計算最大可滾動高度
  let totalContentHeight = startY + rows * (CARD_H + CARD_MARGIN);
  maxScrollY = max(0, totalContentHeight - height + CARD_MARGIN);

  // 平滑計算當前滾動位置
  scrollY = lerp(scrollY, targetScrollY, 0.15);

  // ==========================================
  // 繪製下方站點卡片層 (帶平滑滾動)
  // ==========================================
  let clipY = TOP_PANEL_H + filterPanelH;
  
  push();
  for (let i = 0; i < filteredStations.length; i++) {
    let st = filteredStations[i];
    let c = i % cols;
    let r = Math.floor(i / cols);
    
    let x = startX + c * (CARD_W + CARD_MARGIN);
    let y = startY + r * (CARD_H + CARD_MARGIN) - scrollY;

    // 視窗外剔除 (Culling): 如果卡片不在可視範圍內，則跳過渲染以優化效能
    if (y + CARD_H < clipY || y > height) continue;

    drawCard(st, x, y, CARD_W, CARD_H, clipY);
  }
  pop();

  // ==========================================
  // 繪製置頂的 UI 面板層
  // ==========================================
  drawTopPanel();
  drawFilterPanel();
}

function windowResized() {
  // 確保 p5.js 畫布引擎已建立，避免過早觸發造成白畫面
  if (typeof drawingContext !== 'undefined') {
    resizeCanvas(windowWidth, windowHeight);
    updateFilterLayout();
  }
}

// ==========================================
// 3. 資料獲取與解析
// ==========================================
async function fetchData() {
  // 每次進入 Fetch 都先更新計時器，避免失敗後引發無限迴圈或當機
  lastFetchTime = millis();
  
  loadingProgress = 0;
  loadingState = "建立連線中...";

  try {
    // 1. 在原 API 網址加上時間戳，確保抓到最新狀態而不被代理伺服器快取
    let timeConnector = API_URL.includes('?') ? '&' : '?';
    let targetUrl = API_URL + timeConnector + 't=' + Date.now();
    
    // 2. 依照需求，直接使用代理伺服器發送 GET 請求，繞過 127.0.0.1 的 CORS 限制
    let proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl);
    let response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`Proxy fetch failed: ${response.status}`);
    
    // 建立 clone 以安全地解析 JSON，避免我們手動分塊導致中文字元截斷報錯
    let responseClone = response.clone();
    
    loadingState = "下載資料中...";
    
    // 使用 ReadableStream 即時讀取下載進度
    const reader = response.body.getReader();
    const contentLength = +response.headers.get('Content-Length');
    // 代理伺服器可能不提供檔案大小，若無則以台北市 YouBike 資料量約 600KB 進行預估
    const estimatedLength = contentLength ? contentLength : 600000; 
    
    let receivedLength = 0;
    let chunks = [];
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedLength += value.length;
      // 計算百分比，最多卡在 99.9% 直到解析完成
      loadingProgress = min((receivedLength / estimatedLength) * 100, 99.9);
    }
    
    loadingState = "解析資料中...";
    loadingProgress = 100;
    
    // 讓原生 .json() 安全處理字串與格式，避免我們手動分塊導致的中文字元截斷錯誤
    let rawData = await responseClone.json();
    processData(rawData, "即時連線");
  } catch (apiError) {
    console.error("即時 API 連線徹底失敗：", apiError);
    loadingState = "網路連線異常";
    hasError = true;
    isLoading = false;
  }
}

function processData(data, mode = "即時連線") {
  dataModeStr = mode;
  // 容錯處理：如果 API 回傳的不是陣列而是物件包裹，試著提取出來
  if (!Array.isArray(data)) {
    if (data && Array.isArray(data.result)) data = data.result;
    else if (data && Array.isArray(data.records)) data = data.records;
    else data = [];
  }

  // 嘗試取得官方資料更新時間
  if (data.length > 0) {
    officialDataTime = data[0].srcUpdateTime || data[0].updateTime || data[0].mday || "未知";
  }

  let newDistricts = new Set(['全部']);
  let newStations = [];

  for (let item of data) {
    // API 與 CSV 的欄位名稱容錯處理
    let sno = item.sno;
    let sna = (item.sna || "").replace('YouBike2.0_', '');
    let sarea = item.sarea;
    let tot = parseInt(item.tot_quantity || item.tot || 0);
    let sbi = parseInt(item.sbi_quantity || item.sbi || 0);
    let bemp = parseInt(item.bemp || 0);
    let act = parseInt(item.act || 0);

    newDistricts.add(sarea);

    newStations.push({
      sno, sna, sarea, tot, sbi, bemp, act,
      dispSbi: 0,  // 用於動畫的起始可借數
      dispBemp: 0  // 用於動畫的起始空位數
    });
  }

  // 如果是資料更新，保留舊有動畫值以實現無縫過渡
  for (let ns of newStations) {
    let existing = stations.find(s => s.sno === ns.sno);
    if (existing) {
      ns.dispSbi = existing.dispSbi;
      ns.dispBemp = existing.dispBemp;
    } else {
      ns.dispSbi = ns.sbi;
      ns.dispBemp = ns.bemp;
    }
  }

  stations = newStations;
  districts = Array.from(newDistricts);
  
  updateFilter();
  updateFilterLayout();
  
  lastFetchTime = millis();
  isLoading = false;
  hasError = false;
}

// ==========================================
// 4. UI 元件繪製函數
// ==========================================
function drawCard(st, x, y, w, h, clipY) {
  // 判斷滑鼠是否懸停 (並排除滑鼠被頂部面板擋住的情況)
  let isHover = false;
  if (mouseY > clipY) {
    isHover = (mouseX >= x && mouseX <= x + w && mouseY >= y && mouseY <= y + h);
  }

  // 狀態判斷與顏色指派
  let isOffline = (st.act === 0);
  let isSbiWarn = (st.sbi === 0);
  let isBempWarn = (st.bemp === 0);

  let currentSbiColor = isOffline ? colors.disabled : (isSbiWarn ? colors.warning : colors.sbi);
  let currentBempColor = isOffline ? colors.disabled : (isBempWarn ? colors.warning : colors.bemp);

  push();
  translate(x, y);

  // 繪製卡片底框
  fill(colors.card);
  if (isHover) {
    stroke(colors.bemp);
    strokeWeight(2);
    drawingContext.shadowBlur = 10;
    drawingContext.shadowColor = colors.bemp.toString();
  } else {
    stroke(isOffline ? colors.disabled : color(255, 30));
    strokeWeight(1);
    drawingContext.shadowBlur = 0;
  }
  rect(0, 0, w, h, 8);
  drawingContext.shadowBlur = 0; // 重置發光

  // 站點標題與行政區
  noStroke();
  fill(isOffline ? 150 : 255);
  textFont('Noto Sans TC');
  textAlign(LEFT, TOP);
  textSize(18);
  text(st.sna, 15, 15);
  
  fill(130);
  textSize(12);
  text(st.sarea, 15, 42);

  // 停用標籤
  if (isOffline) {
    fill(colors.disabled);
    rect(w - 50, 15, 35, 20, 4);
    fill(255);
    textSize(12);
    textAlign(CENTER, CENTER);
    text("停用", w - 32.5, 25);
  }

  // 平滑過渡動畫 (lerp)
  st.dispSbi = lerp(st.dispSbi, st.sbi, 0.1);
  st.dispBemp = lerp(st.dispBemp, st.bemp, 0.1);

  // ================= 雙向對比進度條 =================
  let barY = 75;
  let barW = w - 30;
  let barH = 10;
  let total = max(st.tot, 1);
  
  let wSbi = (st.dispSbi / total) * barW;
  let wBemp = (st.dispBemp / total) * barW;

  // 軌道背景
  fill(15, 20, 33);
  rect(15, barY, barW, barH, 5);

  // 左側：可借車輛進度條
  if (wSbi > 0) {
    fill(currentSbiColor);
    rect(15, barY, wSbi, barH, 5, 0, 0, 5);
  }
  
  // 右側：空位進度條
  if (wBemp > 0) {
    fill(currentBempColor);
    rect(15 + barW - wBemp, barY, wBemp, barH, 0, 5, 5, 0);
  }

  // ================= 數據文字顯示 =================
  textFont('Share Tech Mono');
  textSize(22);
  
  // 可借數量
  fill(currentSbiColor);
  textAlign(LEFT, TOP);
  text(Math.round(st.dispSbi), 15, barY + 18);
  
  // 空位數量
  fill(currentBempColor);
  textAlign(RIGHT, TOP);
  text(Math.round(st.dispBemp), w - 15, barY + 18);

  // 中文標籤
  textFont('Noto Sans TC');
  textSize(12);
  fill(180);
  textAlign(LEFT, TOP);
  text("可借", 50, barY + 23);
  textAlign(RIGHT, TOP);
  text("空位", w - 50, barY + 23);

  pop();
}

function drawTopPanel() {
  noStroke();
  fill(colors.bg);
  rect(0, 0, width, TOP_PANEL_H);

  // 頂部倒數計時進度條
  let timeLeft = max(0, updateInterval - (millis() - lastFetchTime));
  let progress = timeLeft / updateInterval;
  fill(colors.sbi);
  rect(0, 0, width * progress, 3);

  // 大標題
  fill(255);
  textFont('Rajdhani');
  textSize(34);
  textAlign(LEFT, CENTER);
  text("NEW TAIPEI YOUBIKE 2.0", 25, TOP_PANEL_H / 2 - 8);

  // 更新時間
  textFont('Noto Sans TC');
  textSize(13);
  let d = new Date(Date.now() - (millis() - lastFetchTime));
  let fetchTimeStr = d.toLocaleTimeString('zh-TW', { hour12: false });
  
  // 若非即時連線，用警戒色提示使用者這不是最新資料
  fill(dataModeStr.includes("即時連線") ? 150 : colors.warning);
  text(`連線狀態: ${dataModeStr} | 抓取時間: ${fetchTimeStr} | 官方更新時間: ${officialDataTime}`, 25, TOP_PANEL_H / 2 + 18);

  // 全區統計資料
  let totalSbi = 0;
  let emptyStationsCount = 0;
  for (let s of stations) {
    if (s.act === 1) {
      totalSbi += s.sbi;
      if (s.sbi === 0) emptyStationsCount++;
    }
  }

  // 繪製全區指標
  textAlign(RIGHT, CENTER);
  
  // 指標 1: 總可借車輛
  fill(150);
  textFont('Noto Sans TC');
  textSize(13);
  text("當前總可借車輛", width - 200, TOP_PANEL_H / 2 - 15);
  fill(colors.sbi);
  textFont('Share Tech Mono');
  textSize(28);
  text(totalSbi.toLocaleString(), width - 200, TOP_PANEL_H / 2 + 12);

  // 指標 2: 無車可借站點數
  fill(150);
  textFont('Noto Sans TC');
  textSize(13);
  text("無車可借站點數", width - 25, TOP_PANEL_H / 2 - 15);
  fill(colors.warning);
  textFont('Share Tech Mono');
  textSize(28);
  text(emptyStationsCount.toLocaleString(), width - 25, TOP_PANEL_H / 2 + 12);

  // 底部分隔線
  stroke(25, 32, 51);
  strokeWeight(2);
  line(0, TOP_PANEL_H, width, TOP_PANEL_H);
}

// 根據視窗寬度自動計算標籤折行排版
function updateFilterLayout() {
  filterChips = [];
  drawingContext.font = "14px 'Noto Sans TC'"; 
  
  let x = 25;
  let y = TOP_PANEL_H + 15;
  let chipH = 32;
  let spacingX = 12;
  let spacingY = 12;

  for (let d of districts) {
    let tw = drawingContext.measureText(d).width + 32;
    if (x + tw > width - 25) {
      x = 25;
      y += chipH + spacingY;
    }
    filterChips.push({ text: d, x: x, y: y, w: tw, h: chipH });
    x += tw + spacingX;
  }
  filterPanelH = (y + chipH + 15) - TOP_PANEL_H;
}

function drawFilterPanel() {
  noStroke();
  // 使用半透明背景確保滑動時有一點玻璃透視感，或是純色遮蔽
  fill(11, 14, 23, 240); 
  rect(0, TOP_PANEL_H, width, filterPanelH);

  for (let chip of filterChips) {
    let isSelected = (chip.text === selectedDistrict);
    let isHover = false;
    if (mouseY >= TOP_PANEL_H && mouseY <= TOP_PANEL_H + filterPanelH) {
      isHover = (mouseX >= chip.x && mouseX <= chip.x + chip.w && mouseY >= chip.y && mouseY <= chip.y + chip.h);
    }

    if (isSelected) {
      fill(colors.bemp);
      stroke(colors.bemp);
    } else if (isHover) {
      fill(45, 55, 80);
      stroke(colors.bemp);
    } else {
      fill(colors.card);
      stroke(45, 55, 80);
    }
    
    strokeWeight(1);
    rect(chip.x, chip.y, chip.w, chip.h, 16);

    noStroke();
    fill(isSelected ? 255 : 200);
    textFont('Noto Sans TC');
    textSize(14);
    textAlign(CENTER, CENTER);
    text(chip.text, chip.x + chip.w / 2, chip.y + chip.h / 2);
  }
  
  // 底部分隔線
  stroke(25, 32, 51);
  strokeWeight(2);
  line(0, TOP_PANEL_H + filterPanelH, width, TOP_PANEL_H + filterPanelH);
}

function drawLoading() {
  fill(255);
  textFont('Noto Sans TC');
  textSize(24);
  textAlign(CENTER, CENTER);
  if (hasError) {
    fill(colors.warning);
    text("即時資料載入失敗！", width / 2, height / 2 - 40);
    fill(200);
    textSize(16);
    text("請確認您的網路連線是否正常，系統將會在 60 秒後自動重新嘗試連線。", width / 2, height / 2 + 10);
  } else {
    fill(colors.bemp);
    text(loadingState, width / 2, height / 2 - 30);
    
    // 繪製動態進度條
    let barW = 400;
    let barH = 10;
    let barX = width / 2 - barW / 2;
    let barY = height / 2 + 10;
    
    fill(25, 32, 51);
    rect(barX, barY, barW, barH, 5);
    fill(colors.sbi);
    rect(barX, barY, barW * (loadingProgress / 100), barH, 5);
    
    fill(255);
    textSize(16);
    textFont('Share Tech Mono');
    text(`${loadingProgress.toFixed(1)} %`, width / 2, barY + 30);
  }
}

// ==========================================
// 5. 互動事件監聽
// ==========================================
function updateFilter() {
  if (selectedDistrict === '全部') {
    filteredStations = [...stations];
  } else {
    filteredStations = stations.filter(s => s.sarea === selectedDistrict);
  }
  targetScrollY = 0; // 重置滾動條
}

function mouseClicked() {
  // 檢查是否點擊了篩選標籤
  if (mouseY >= TOP_PANEL_H && mouseY <= TOP_PANEL_H + filterPanelH) {
    for (let chip of filterChips) {
      if (mouseX >= chip.x && mouseX <= chip.x + chip.w && mouseY >= chip.y && mouseY <= chip.y + chip.h) {
        selectedDistrict = chip.text;
        updateFilter();
        return;
      }
    }
  }
}

function mouseWheel(event) {
  // 根據滑鼠滾輪動態增加目標滾動值，並限制在有效範圍內
  targetScrollY += event.delta;
  targetScrollY = constrain(targetScrollY, 0, maxScrollY);
  
  return false; // 阻擋原生頁面滾動行為
}
