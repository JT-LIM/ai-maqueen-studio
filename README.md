# AI 마퀸 스튜디오

기존 [AI 손포즈 프로젝트](https://github.com/JT-LIM/ai-handpose-recognition)를 확장한 독립 웹앱입니다.

- 손모양: MediaPipe 손 관절 좌표를 직접 모아 KNN으로 분류합니다.
- 이미지: Teachable Machine 이미지 모델 공유 링크를 불러옵니다.
- 포즈: Teachable Machine 포즈 모델 공유 링크를 불러옵니다.
- 이미지·포즈 클래스마다 `forward`, `backward`, `left`, `right`, `stop` 명령을 선택합니다. 알 수 없는 클래스의 기본값은 정지입니다.

## 사용하기

1. 데스크톱 Chrome 또는 Edge에서 사이트를 열고 카메라를 허용합니다.
2. 손모양 모드는 정지를 포함해 두 개 이상의 명령을 학습합니다. 정지는 최소 5개 샘플이 필요하며, 각 명령 20개 이상을 다양한 각도에서 모으는 것이 좋습니다.
3. 이미지·포즈 모드는 해당 탭의 Teachable Machine 링크에서 모델을 학습한 뒤 **모델 내보내기 → TensorFlow.js → 모델 업로드**로 공유 링크를 만듭니다. 링크를 불러온 후 클래스별 명령을 선택합니다. 이미지·포즈 학습 자체는 Teachable Machine에서 진행합니다.
4. 기존 UART 명령 수신 프로그램이 설치된 마이크로비트와 연결합니다.
5. **마퀸 조작 시작**을 눌러야 명령이 전송됩니다. **조작 중지**로 중단합니다.

모델과 학습 데이터는 메모리에만 유지되어 새로고침하면 사라집니다. 카메라 영상은 이 앱에서 서버로 업로드하지 않으며 추론은 브라우저에서 수행합니다. 라이브러리와 모델 다운로드에는 인터넷이 필요합니다.

## 정지 동작

확신도 기준 미달, 800ms 이상 새 인식 결과 없음, 카메라 준비 안 됨에는 정지 명령을 보냅니다. 탭 숨김·창 포커스 이탈·모드 변경·명령 매핑 변경 시 조작을 해제하며 다시 시작 버튼을 눌러야 합니다. 연결만으로는 주행하지 않습니다.

브라우저 종료·블루투스 단절에서는 정지 신호 도착을 보장할 수 없습니다. 실제 수업용 펌웨어에는 마지막 UART 명령 이후 일정 시간(예: 1초)이 지나면 모터를 정지하는 타임아웃을 함께 넣어주세요. 이 저장소의 MICROBIT_MAKECODE.md는 원본 프로젝트에서 가져온 참고 자료입니다. 사용 중인 마퀸 보드에 맞는 기존 펌웨어를 사용하세요.

## 로컬 실행

```sh
python3 -m http.server 8001 --bind 127.0.0.1
```

http://localhost:8001 에 접속합니다. 별도 npm 설치나 빌드가 없습니다.

## 검증

```sh
node --check sketch.js
node --check studio.js
node --test control.test.cjs
```

로컬 서버의 `/tests/models.html`은 Google 저장소에 있는 공식 예제 모델을 실제로 불러와 이미지·포즈 추론을 검증합니다. 카메라나 로봇은 사용하지 않습니다.

## GitHub Pages

저장소 Settings → Pages에서 **Deploy from a branch**, **main**, **/(root)**를 선택합니다. 이후 main에 푸시하면 반영됩니다.

예정 주소: https://jt-lim.github.io/ai-maqueen-studio/

기반 라이브러리: [Teachable Machine Community](https://github.com/googlecreativelab/teachablemachine-community), MediaPipe, p5.js.
