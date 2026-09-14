/**
 * sketch.js
 * Boundary X: AI 핸드포즈학습 [MediaPipe + p5.js v6]
 *
 */

// Bluetooth UUIDs
const UART_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const UART_RX_UUID      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("BLE write timeout")), ms))
  ]);
}

// === BLE State ===
let bluetoothDevice = null;
let rxCharacteristic = null;
let isConnected = false;
let bluetoothStatus = "연결 대기 중";
let isSendingData = false;
let isManualDisconnect = false;
let lastSendErrorTime = 0;
let lastSendTime = 0;
const SEND_INTERVAL = 100;

// === MediaPipe State ===
let handLandmarker = null;
let isModelReady = false;
let lastLandmarks = null;
let lastVideoTime = -1;

// === KNN State ===
let trainingData = [];
const KNN_K = 5;

// === App State ===
let video;
let classes = {};
let isTraining = false;
let lastTrainTime = 0;
const TRAIN_INTERVAL = 200;
let isFlipped = true;
let isTracking = false; // 앱 시작시 자동으로 인식 시작
let lastSentLabel = ""; // 마지막으로 전송한 라벨 (변경 감지용)
let learningMode = true; // 학습 모드: true=학습 가능, false=기기 연결 상태

// === UI Elements ===
let resultLabel, resultConf, btDataDisplay;
let trainingList, statusBadge;
let connectBtn;
let currentGestureLabel = null; // 현재 학습 중인 제스처

// =============================================
// p5.js Setup
// =============================================

// 문자열에 한글(자모/완성형)이 포함되어 있는지 검사
function containsKorean(text) {
  return /[\uAC00-\uD7A3\u3131-\u318E]/.test(text);
}

function setup() {
  let canvas = createCanvas(320, 240);
  canvas.parent("p5-container");

  video = createVideo([]);
  video.elt.muted = true;
  video.elt.playsInline = true;
  video.size(320, 240);
  video.hide();

  // DOM 요소 참조
  statusBadge   = select("#status-badge");
  trainingList  = select("#training-list");
  resultLabel   = select("#result-label");
  resultConf    = select("#result-conf");
  btDataDisplay = select("#bluetooth-data-display");

  // === 제스처 버튼 설정 ===
  const gestureLabels = ["forward", "backward", "left", "right", "stop"];
  gestureLabels.forEach(label => {
    const btnEl = document.getElementById(`btn-${label}`);
    if (btnEl) {
      // 마우스 이벤트
      btnEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (!learningMode || activeMode !== "hand") {
          alert("⚠️ 기기가 연결되어 있습니다. 먼저 학습을 재시작하세요.");
          return;
        }
        currentGestureLabel = label;
        isTraining = true;
        btnEl.classList.add("learning");
      });
      btnEl.addEventListener("mouseup", (e) => {
        e.preventDefault();
        isTraining = false;
        btnEl.classList.remove("learning");
        currentGestureLabel = null;
      });
      btnEl.addEventListener("mouseleave", () => {
        isTraining = false;
        btnEl.classList.remove("learning");
        currentGestureLabel = null;
      });

      // 터치 이벤트
      btnEl.addEventListener("touchstart", (e) => {
        e.preventDefault();
        if (!learningMode || activeMode !== "hand") {
          alert("⚠️ 기기가 연결되어 있습니다. 먼저 학습을 재시작하세요.");
          return;
        }
        currentGestureLabel = label;
        isTraining = true;
        btnEl.classList.add("learning");
      });
      btnEl.addEventListener("touchend", (e) => {
        e.preventDefault();
        isTraining = false;
        btnEl.classList.remove("learning");
        currentGestureLabel = null;
      });
    }
  });

  // 초기화 버튼
  let resetBtn = createButton("🗑️ 모델 전체 초기화");
  resetBtn.parent("reset-btn-container");
  resetBtn.addClass("stop-button");
  resetBtn.style("width", "100%");
  resetBtn.style("margin-top", "15px");
  resetBtn.mousePressed(clearAllModel);

  // 블루투스 버튼
  connectBtn = createButton("AI 로딩 중...");
  connectBtn.parent("bluetooth-control-buttons");
  connectBtn.addClass("start-button");
  connectBtn.attribute("disabled", true);
  connectBtn.mousePressed(connectBluetooth);

  let disconnectBtn = createButton("연결 해제");
  disconnectBtn.parent("bluetooth-control-buttons");
  disconnectBtn.addClass("stop-button");
  disconnectBtn.mousePressed(disconnectBluetooth);

  // 인식 제어 버튼
  let startTrackBtn = createButton("🚀 마퀸 조작 시작");
  startTrackBtn.parent("recognition-control-buttons");
  startTrackBtn.addClass("start-button");
  startTrackBtn.mousePressed(() => {
    if (!studioReady()) {
      alert("⚠️ 선택한 모델을 준비하세요. 손모양은 정지를 포함한 두 가지 이상의 명령을 학습해주세요.");
      return;
    }
    if (!isConnected) {
      alert("⚠️ 먼저 마이크로비트와 연결해주세요!");
      return;
    }
    isTracking = true;
    lastPredictionTime = 0;
    desiredCommand = "stop";
    lastSentLabel = "";
    btDataDisplay.html("🤖 마퀸 조작 중...");
    btDataDisplay.style("color", "#0f0");
  });

  let stopTrackBtn = createButton("⏹️ 조작 중지");
  stopTrackBtn.parent("recognition-control-buttons");
  stopTrackBtn.addClass("stop-button");
  stopTrackBtn.mousePressed(() => stopTracking());

  updateBluetoothStatusUI();
  initMediaPipe();
}

// =============================================
// p5.js Draw (렌더링만 담당)
// =============================================
function draw() {
  background(0);

  push();
  if (isFlipped) { translate(width, 0); scale(-1, 1); }
  if (video && video.elt.readyState >= 2) image(video, 0, 0, width, height);
  pop();

  if (activeMode !== "hand") {
    if (tmModels[activeMode] && video?.elt.readyState >= 2) {
      // Display the same square crop used for TM inference.
      drawingContext.drawImage(tmFrame, 40, 0, 240, 240);
    }
    return;
  }
  if (lastLandmarks) drawLandmarks(lastLandmarks);

  if (!lastLandmarks) return;
  const features = extractFeatures(lastLandmarks);

  if (isTraining) {
    if (!isModelReady) {
      if (statusBadge) statusBadge.html("⚠️ 모델 로딩 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (currentGestureLabel && millis() - lastTrainTime > TRAIN_INTERVAL) {
      addExample(features, currentGestureLabel);
      lastTrainTime = millis();
    }
  } else if (trainingData.length > 0) {
    classifyKNN(features);
  }
}

// =============================================
// MediaPipe 초기화 (동적 import)
// =============================================
async function initMediaPipe() {
  try {
    if (statusBadge) statusBadge.html("MediaPipe 라이브러리 로딩 중...");
    const m = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8");
    const vision = await m.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );
    handLandmarker = await m.HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1
    });
    isModelReady = true;
    if (statusBadge && activeMode === "hand") statusBadge.html("✅ 손모양 모델 준비 완료! 제스처를 학습시키세요.");
    console.log("MediaPipe HandLandmarker Ready");

    // 무거운 WASM/GPU delegate 초기화가 끝난 뒤에만 연결 버튼 활성화
    // → 초기화 도중 클릭 시 블루투스 팝업이 지연되는 문제 방지
    if (connectBtn) {
      connectBtn.removeAttribute("disabled");
      connectBtn.html("기기 연결");
    }

    inferenceLoop();
  } catch (e) {
    console.error("MediaPipe 초기화 실패:", e);
    if (statusBadge && activeMode === "hand") statusBadge.html("❌ 손모양 모델 로드 실패. 인터넷 연결을 확인하고 새로고침 해주세요.");
  }
}

// 추론 루프: draw()와 완전 분리 → 렌더링 항상 부드럽게 유지
function inferenceLoop() {
  if (activeMode !== "hand" || document.hidden || !isModelReady || !video || !handLandmarker) {
    requestAnimationFrame(inferenceLoop);
    return;
  }
  const videoEl = video.elt;
  if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;
    try {
      const result = handLandmarker.detectForVideo(videoEl, performance.now());
      lastHandFrameTime = performance.now();
      lastLandmarks = (result.landmarks && result.landmarks.length > 0)
        ? result.landmarks[0] : null;
    } catch (e) { console.error(e); }
  }
  requestAnimationFrame(inferenceLoop);
}

// =============================================
// 특징 추출 (손목 기준 상대 좌표 + 스케일 정규화)
// =============================================
function extractFeatures(landmarks) {
  const wrist = landmarks[0];
  let maxDist = 0;
  for (let i = 1; i < landmarks.length; i++) {
    const dx = landmarks[i].x - wrist.x;
    const dy = landmarks[i].y - wrist.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxDist) maxDist = d;
  }
  if (maxDist < 0.001) maxDist = 0.001;
  const features = [];
  for (let i = 1; i < landmarks.length; i++) {
    features.push((landmarks[i].x - wrist.x) / maxDist);
    features.push((landmarks[i].y - wrist.y) / maxDist);
  }
  return features;
}

// =============================================
// KNN (ml5 없이 직접 구현)
// =============================================
function euclideanDistSq(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return sum;
}

function addExample(features, label) {
  trainingData.push({ label, features });
  if (!classes[label]) classes[label] = 0;
  classes[label]++;

  // 해당 클래스 배지만 실시간 갱신 (목록 전체 재렌더 없음)
  const badge = document.querySelector(`.badge-label[data-label="${label}"] .badge-count`);
  if (badge) {
    badge.innerText = `${classes[label]} data`;
  } else {
    updateListUI();
  }
}

function classifyKNN(features) {
  if (trainingData.length === 0) return;
  const dists = trainingData.map(d => ({
    label: d.label,
    distSq: euclideanDistSq(features, d.features)
  }));
  dists.sort((a, b) => a.distSq - b.distSq);
  const kNearest = dists.slice(0, KNN_K);
  const votes = {};
  for (const n of kNearest) votes[n.label] = (votes[n.label] || 0) + 1;
  const label = Object.keys(votes).reduce((a, b) => votes[a] > votes[b] ? a : b);
  const conf = votes[label] / kNearest.length;

  acceptPrediction(label, conf, label, lastHandFrameTime);

}

// =============================================
// 랜드마크 시각화
// =============================================
function drawLandmarks(landmarks) {
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
  ];
  stroke(0, 200, 0); strokeWeight(2);
  for (const [a, b] of connections) {
    let ax = landmarks[a].x * width, ay = landmarks[a].y * height;
    let bx = landmarks[b].x * width, by = landmarks[b].y * height;
    if (isFlipped) { ax = width - ax; bx = width - bx; }
    line(ax, ay, bx, by);
  }
  noStroke();
  for (let i = 0; i < landmarks.length; i++) {
    let x = landmarks[i].x * width;
    let y = landmarks[i].y * height;
    if (isFlipped) x = width - x;
    fill(i === 0 ? color(255, 0, 0) : color(0, 255, 0));
    ellipse(x, y, 7, 7);
  }
}

// =============================================
// 학습 목록 UI
// =============================================
function updateListUI() {
  if (!trainingList) return;
  trainingList.html("");
  if (Object.keys(classes).length === 0) {
    trainingList.html('<div class="empty-msg">아직 학습된 데이터가 없습니다.</div>');
    return;
  }
  const labelDisplayMap = {
    "forward": "⬆️ Forward (앞으로)",
    "backward": "⬇️ Backward (뒤로)",
    "left": "⬅️ Left (왼쪽)",
    "right": "➡️ Right (오른쪽)",
    "stop": "⏹️ Stop (정지)"
  };
  for (const label in classes) {
    const li   = createDiv().addClass("list-item");
    const left = createDiv().addClass("list-item-left badge-label");
    left.attribute("data-label", label);
    createSpan(labelDisplayMap[label] || label).parent(left);
    createSpan(`${classes[label]} data`).addClass("badge-count").parent(left);
    left.parent(li);
    const delBtn = createButton("✕").addClass("delete-btn");
    delBtn.attribute("title", "삭제");
    delBtn.mousePressed(() => deleteClass(label));
    delBtn.parent(li);
    li.parent(trainingList);
  }
}

function deleteClass(label) {
  stopTracking();
  trainingData = trainingData.filter(d => d.label !== label);
  delete classes[label];
  updateListUI();
  if (resultLabel) { resultLabel.html("대기 중"); resultConf.html("데이터 삭제됨"); }
}

function clearAllModel() {
  // 기기 연결되어 있으면 자동으로 해제
  if (isConnected) {
    disconnectBluetooth();
    console.log("학습 재시작: 블루투스 자동 연결 해제됨");
  }

  // 학습 모드 활성화
  learningMode = true;

  trainingData = []; classes = {};
  updateListUI();
  if (resultLabel) {
    resultLabel.html("대기 중");
    resultLabel.style("color", "#00E676");
    resultConf.html("데이터 없음");
  }

  // 상태 메시지 업데이트
  if (statusBadge) {
    statusBadge.html("✅ 학습 모드 활성화! 새로운 제스처를 학습시키세요.");
  }
}

// =============================================
// 인식 중지
// =============================================
async function stopTracking(sendStopSignal = true) {
  isTracking = false;
  desiredCommand = "stop";
  btDataDisplay.html("전송 중지됨");
  btDataDisplay.style("color", "#EA4335");
  if (!sendStopSignal) return;
  const sent = await sendBluetoothDataReliable("stop");
  if (!sent && isConnected) {
    btDataDisplay.html("⚠️ 정지 신호 전송 실패 - 연결을 확인해주세요");
  }
}

// =============================================
// Bluetooth
// =============================================
async function connectBluetooth() {
  if (isConnected) return;
  if (!navigator.bluetooth) {
    alert("블루투스는 데스크톱 Chrome 또는 Edge에서 사용해주세요.");
    return;
  }
  try {
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "BBC micro:bit" }],
      optionalServices: [UART_SERVICE_UUID]
    });
    const server  = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(UART_SERVICE_UUID);
    rxCharacteristic = await service.getCharacteristic(UART_RX_UUID);
    bluetoothDevice.addEventListener("gattserverdisconnected", onDisconnected);
    isConnected = true;
    isTracking = false;
    desiredCommand = "stop";
    await sendBluetoothDataReliable("stop");

    // 학습 모드 비활성화 (기기 연결 상태)
    learningMode = false;

    // Extract device ID from brackets (e.g., "BBC micro:bit [XXXXX]" -> "XXXXX")
    const deviceId = bluetoothDevice.name.match(/\[(.*?)\]/)?.[1] || bluetoothDevice.name;
    bluetoothStatus = "연결됨: " + deviceId;
    updateBluetoothStatusUI(true);

    // 상태 메시지 업데이트
    if (statusBadge) {
      statusBadge.html("✅ 기기 연결 완료! 마퀸 조작을 시작하세요.");
    }

    // 학습 버튼들에 시각적 피드백 제공
    if (btDataDisplay) {
      btDataDisplay.html("🔒 학습 비활성화 - 기기가 연결되어 있습니다");
      btDataDisplay.style("color", "#FFA500");
    }
  } catch (error) {
    console.error(error);
    bluetoothStatus = "연결 실패";
    updateBluetoothStatusUI(false, true);
  }
}

async function disconnectBluetooth() {
  await stopTracking();
  learningMode = true;
  if (bluetoothDevice && bluetoothDevice.gatt.connected) {
    isManualDisconnect = true;
    bluetoothDevice.gatt.disconnect();
  } else {
    isConnected = false;
    bluetoothStatus = "연결 해제됨";
    rxCharacteristic = null;
    bluetoothDevice = null;
    updateBluetoothStatusUI(false);
  }
}

function onDisconnected() {
  isConnected = false;
  learningMode = true;
  rxCharacteristic = null;
  bluetoothDevice = null;

  const wasTracking = isTracking;
  if (isTracking) stopTracking(false);

  if (isManualDisconnect) {
    bluetoothStatus = "연결 해제됨";
    updateBluetoothStatusUI(false);
  } else {
    bluetoothStatus = "연결이 끊어졌습니다. 다시 연결해주세요.";
    updateBluetoothStatusUI(false, true);
  }

  if (wasTracking) {
    btDataDisplay.html(
      isManualDisconnect
        ? "연결 해제로 인식이 중지되었습니다"
        : "⚠️ 연결이 끊어져 인식이 자동으로 중지되었습니다"
    );
    btDataDisplay.style("color", isManualDisconnect ? "#888" : "#EA4335");
  }
  isManualDisconnect = false;
}

function updateBluetoothStatusUI(connected = false, error = false) {
  const el = select("#bluetoothStatus");
  if (!el) return;
  el.html(`상태: ${bluetoothStatus}`);
  el.removeClass("status-connected").removeClass("status-error");
  if (connected) el.addClass("status-connected");
  else if (error) el.addClass("status-error");
}

async function sendBluetoothData(data) {
  if (!rxCharacteristic || !isConnected) return false;
  if (isSendingData) return false;
  try {
    isSendingData = true;
    await withTimeout(
      rxCharacteristic.writeValue(new TextEncoder().encode(data + "\n")), 2000
    );
    return true;
  } catch (error) {
    console.error(error);
    isTracking = false;
    desiredCommand = "stop";
    bluetoothDevice?.gatt.disconnect();
    const now = Date.now();
    if (now - lastSendErrorTime > 3000) {
      lastSendErrorTime = now;
      bluetoothStatus = "⚠️ 데이터 전송 실패";
      updateBluetoothStatusUI(false, true);
    }
    return false;
  } finally {
    isSendingData = false;
  }
}

async function sendBluetoothDataReliable(data, maxRetries = 5, retryDelayMs = 80) {
  for (let i = 0; i < maxRetries; i++) {
    if (await sendBluetoothData(data)) return true;
    await new Promise(r => setTimeout(r, retryDelayMs));
  }
  return false;
}
