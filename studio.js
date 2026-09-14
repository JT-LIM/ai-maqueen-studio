let activeMode = 'hand';
let lastHandFrameTime = 0;
let lastPredictionTime = 0;
let desiredCommand = 'stop';
let modeGeneration = 0;
let modelLoading = false;
const tmModels = { image: null, pose: null };
const modelUrls = { image: '', pose: '' };
const mappings = { image: new Map(), pose: new Map() };
const commandNames = { forward: '⬆️ 앞으로', backward: '⬇️ 뒤로', left: '⬅️ 왼쪽', right: '➡️ 오른쪽', stop: '⏹️ 정지' };
const byId = id => document.getElementById(id);
const scriptPromises = new Map();

function studioReady() {
  return activeMode === 'hand'
    ? isModelReady && Object.keys(classes).length >= 2 && (classes.stop || 0) >= KNN_K
    : !modelLoading && Boolean(tmModels[activeMode]);
}

function acceptPrediction(label, confidence, command, frameTime = performance.now()) {
  if (document.hidden) return;
  const threshold = Number(byId('threshold').value) / 100;
  desiredCommand = MaqueenControl.choose(command, confidence, threshold);
  lastPredictionTime = frameTime;
  resultLabel.elt.textContent = label in commandNames ? commandNames[label] : label;
  resultConf.elt.textContent = `확신도 ${(confidence * 100).toFixed(0)}% · ${commandNames[desiredCommand]}`;
  resultLabel.style('color', desiredCommand === 'stop' ? '#ffc857' : '#00e676');
}

function loadScript(url) {
  if (!scriptPromises.has(url)) {
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = () => { script.remove(); scriptPromises.delete(url); reject(new Error('라이브러리를 내려받지 못했습니다. 인터넷 연결을 확인해주세요.')); };
      document.head.append(script);
    });
    scriptPromises.set(url, promise);
  }
  return scriptPromises.get(url);
}

async function loadTeachableModel() {
  if (modelLoading || activeMode === 'hand') return;
  const mode = activeMode;
  let base;
  try { base = MaqueenControl.modelBase(byId('model-url').value); }
  catch (error) { byId('model-status').textContent = error.message; return; }
  modelLoading = true;
  byId('load-model').disabled = true;
  byId('model-status').textContent = '모델을 불러오는 중입니다. 잠시 기다려주세요…';
  modeGeneration++;
  await stopTracking();
  let nextModel;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js');
    await loadScript(`https://cdn.jsdelivr.net/npm/@teachablemachine/${mode}@0.8.3/dist/teachablemachine-${mode}.min.js`);
    const library = mode === 'image' ? window.tmImage : window.tmPose;
    nextModel = await library.load(base + 'model.json', base + 'metadata.json');
    const labels = nextModel.getClassLabels();
    if (labels.length < 2) throw new Error('두 가지 이상의 클래스를 학습한 모델이 필요합니다.');
    // In-flight inference retains its own model reference; wait before disposing it.
    while (tmBusy) await new Promise(resolve => setTimeout(resolve, 30));
    disposeLoadedModel(tmModels[mode]);
    tmModels[mode] = nextModel;
    nextModel = null;
    modelUrls[mode] = base;
    mappings[mode] = new Map(labels.map(label => [label, MaqueenControl.commands.includes(label.trim().toLowerCase()) ? label.trim().toLowerCase() : 'stop']));
    if (activeMode === mode) {
      renderMapping();
      byId('model-status').textContent = `✅ ${labels.length}개 클래스 준비 완료. 각 클래스의 마퀸 명령을 선택하세요.`;
      statusBadge.html('✅ 모델 준비 완료 · 인식 미리보기 중');
    }
    if (connectBtn) { connectBtn.removeAttribute('disabled'); connectBtn.html('기기 연결'); }
  } catch (error) {
    disposeLoadedModel(nextModel);
    if (activeMode === mode) byId('model-status').textContent = `불러오기 실패: ${error.message} 이미지/포즈 종류와 모델 업로드 여부를 확인해주세요.`;
  } finally {
    modelLoading = false;
    byId('load-model').disabled = false;
  }
}

function renderMapping() {
  const container = byId('class-mapping');
  container.replaceChildren();
  for (const [label, command] of mappings[activeMode]) {
    const row = document.createElement('label');
    row.className = 'mapping-row';
    const name = document.createElement('span');
    name.textContent = label;
    const select = document.createElement('select');
    for (const value of MaqueenControl.commands) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = commandNames[value];
      select.append(option);
    }
    select.value = command;
    select.addEventListener('change', () => {
      stopTracking();
      mappings[activeMode].set(label, select.value);
    });
    row.append(name, select);
    container.append(row);
  }
}

async function switchMode(mode) {
  if (mode === activeMode) return;
  modeGeneration++;
  activeMode = mode;
  isTraining = false;
  currentGestureLabel = null;
  document.querySelectorAll('.gesture-btn').forEach(button => button.classList.remove('learning'));
  lastLandmarks = null;
  lastPredictionTime = 0;
  stopTracking();
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  byId('hand-panel').hidden = mode !== 'hand';
  byId('tm-panel').hidden = mode === 'hand';
  byId('mode-description').textContent = {
    hand: '손의 관절을 학습합니다. 각 명령 버튼을 길게 눌러 다양한 손모양을 모아주세요.',
    image: '카메라 속 물체·카드·이미지를 구분합니다. Teachable Machine 이미지 모델을 연결하세요.',
    pose: '온몸의 자세를 구분합니다. Teachable Machine 포즈 모델을 연결하세요.'
  }[mode];
  resultLabel.html('대기 중');
  resultConf.html('선택한 모델의 인식 결과가 표시됩니다.');
  if (mode !== 'hand') {
    byId('tm-title').textContent = mode === 'image' ? '🖼️ Teachable Machine 이미지 모델' : '🧍 Teachable Machine 포즈 모델';
    byId('tm-link').href = `https://teachablemachine.withgoogle.com/train/${mode}`;
    byId('model-url').value = modelUrls[mode];
    byId('model-status').textContent = tmModels[mode] ? '✅ 모델 준비 완료. 명령 연결을 확인하세요.' : '아직 불러온 모델이 없습니다.';
    renderMapping();
  }
  statusBadge.html(mode === 'hand' ? (isModelReady ? '✅ 손모양 학습 준비 완료' : '손모양 모델 준비 중…') : (tmModels[mode] ? '✅ 모델 준비 완료' : '모델 공유 링크를 불러오세요'));
}

const tmFrame = document.createElement('canvas');
tmFrame.width = 224;
tmFrame.height = 224;
const tmContext = tmFrame.getContext('2d');
let tmBusy = false;
let lastTmVideoTime = -1;
async function tmLoop() {
  try {
    const element = video?.elt;
    const model = tmModels[activeMode];
    if (activeMode === 'hand' || !model || modelLoading || document.hidden || !element || element.readyState < 2 || lastTmVideoTime === element.currentTime) return;
    tmBusy = true;
    lastTmVideoTime = element.currentTime;
    const generation = modeGeneration;
    const mode = activeMode;
    const frameTime = performance.now();
    // Square, mirrored crop matches Teachable Machine's webcam training input.
    const size = Math.min(element.videoWidth, element.videoHeight);
    tmContext.save();
    tmContext.translate(224, 0);
    tmContext.scale(-1, 1);
    tmContext.drawImage(element, (element.videoWidth - size) / 2, (element.videoHeight - size) / 2, size, size, 0, 0, 224, 224);
    tmContext.restore();
    let prediction;
    if (mode === 'pose') {
      const { pose, posenetOutput } = await model.estimatePose(tmFrame);
      if (!pose || pose.score < 0.2) {
        if (generation === modeGeneration) acceptPrediction('사람을 찾는 중', 0, 'stop', frameTime);
        return;
      }
      prediction = await model.predict(posenetOutput);
    } else prediction = await model.predict(tmFrame);
    if (generation !== modeGeneration || document.hidden) return;
    const top = prediction.reduce((best, item) => item.probability > best.probability ? item : best);
    acceptPrediction(top.className, top.probability, mappings[mode].get(top.className) || 'stop', frameTime);
  } catch (error) {
    desiredCommand = 'stop';
    lastPredictionTime = 0;
    if (isTracking) stopTracking();
    byId('model-status').textContent = `인식 오류: ${error.message}`;
  } finally {
    tmBusy = false;
    setTimeout(tmLoop, 100);
  }
}

// A single send loop serves all recognition modes. Stale predictions never move a robot.
setInterval(() => {
  if (!isTracking || !isConnected) return;
  const command = MaqueenControl.current({
    armed: isTracking, command: desiredCommand, timestamp: lastPredictionTime,
    now: performance.now(), hidden: document.hidden, cameraReady: video?.elt.readyState >= 2
  });
  sendBluetoothData(command);
  btDataDisplay.elt.textContent = `📡 전송 명령: ${commandNames[command]}`;
}, 100);

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => switchMode(button.dataset.mode)));
byId('load-model').addEventListener('click', loadTeachableModel);
byId('threshold').addEventListener('input', () => {
  byId('threshold-value').textContent = byId('threshold').value + '%';
  lastPredictionTime = 0;
  desiredCommand = 'stop';
});
document.addEventListener('visibilitychange', () => { if (document.hidden && btDataDisplay) stopTracking(); });
window.addEventListener('blur', () => {
  isTraining = false;
  currentGestureLabel = null;
  document.querySelectorAll('.gesture-btn').forEach(button => button.classList.remove('learning'));
  if (isTracking) stopTracking();
});
window.addEventListener('pagehide', () => { if (btDataDisplay) stopTracking(); });
setTimeout(tmLoop, 500);

byId('start-camera').addEventListener('click', async () => {
  const button = byId('start-camera');
  button.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:320,height:240},audio:false});
    video.elt.srcObject = stream;
    await video.elt.play();
    byId('camera-status').textContent = '✅ 카메라 준비 완료';
    button.textContent = '📷 카메라 사용 중';
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      stopTracking();
      button.disabled = false;
      button.textContent = '📷 카메라 다시 시작';
      byId('camera-status').textContent = '카메라 연결이 끊겼습니다.';
    }));
  } catch (error) {
    button.disabled = false;
    byId('camera-status').textContent = `카메라를 열지 못했습니다. 브라우저의 카메라 권한과 연결을 확인해주세요. (${error.name})`;
  }
});
