/* Shared, testable command rules. No device I/O. */
const MaqueenControl = {
  commands: ['forward', 'backward', 'left', 'right', 'stop'],
  choose(label, confidence, threshold) {
    return this.commands.includes(label) && Number.isFinite(confidence) && confidence >= threshold ? label : 'stop';
  },
  current({ armed, command, timestamp, now, hidden, cameraReady }) {
    if (!armed || hidden || !cameraReady || !timestamp || now - timestamp > 800) return 'stop';
    return this.commands.includes(command) ? command : 'stop';
  },
  modelBase(value) {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'teachablemachine.withgoogle.com' ||
        !/^\/models\/[\w-]+\/?$/.test(url.pathname) || url.username || url.password) {
      throw new Error('Teachable Machine의 모델 공유 링크를 입력해주세요.');
    }
    return `${url.origin}${url.pathname.replace(/\/$/, '')}/`;
  }
};
if (typeof module !== 'undefined') module.exports = MaqueenControl;
