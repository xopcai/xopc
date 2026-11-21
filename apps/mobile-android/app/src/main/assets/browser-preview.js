'use strict';

const video = document.querySelector('video');
let channel;
let peer;
let timer;
let monitor;
let mode = 'normal';
let restarted = false;
let offered = false;
let playing = false;
let checking = false;
let bad = 0;
let good = 0;
let freezes = 0;
let frames = 0;
let packets;
let recovery = 0;
let recoveryDeadline = 0;
const localCandidates = [];
const remoteCandidates = [];

function send(payload) {
  channel.postMessage(JSON.stringify(payload));
}

function quality(next) {
  if (mode === next) return;
  mode = next;
  if (next === 'snapshot') {
    recovery = performance.now() + 15000;
    recoveryDeadline = 0;
  }
  send({type: 'quality', quality: next});
}

function armTimeout(callback, delay) {
  clearTimeout(timer);
  timer = setTimeout(callback, delay);
}

async function offer(iceRestart = false) {
  offered = false;
  await peer.setLocalDescription(await peer.createOffer({iceRestart}));
  send({type: 'signal', signal: {type: 'offer', sdp: peer.localDescription.sdp}});
  offered = true;
  for (const candidate of localCandidates.splice(0)) send({type: 'signal', signal: candidate});
}

function failed() {
  if (mode === 'snapshot') return;
  if (peer?.remoteDescription && peer.signalingState === 'stable' && !restarted) {
    restarted = true;
    armTimeout(() => quality('snapshot'), 3000);
    void offer(true).catch(() => quality('snapshot'));
    return;
  }
  quality('snapshot');
}

async function sampleStats() {
  if (!peer || checking) return;
  checking = true;
  try {
    const stats = await peer.getStats();
    const entries = [...stats.values()];
    const inbound = entries.find(entry => entry.type === 'inbound-rtp' && entry.kind === 'video');
    const previousFrames = frames;
    frames = inbound?.framesDecoded ?? frames;
    const previousPackets = packets;
    packets = inbound && {received: inbound.packetsReceived ?? 0, lost: inbound.packetsLost ?? 0};
    const received = packets && previousPackets ? Math.max(0, packets.received - previousPackets.received) : 0;
    const lost = packets && previousPackets ? Math.max(0, packets.lost - previousPackets.lost) : 0;
    if (mode === 'snapshot') {
      if (peer.connectionState === 'connected' && performance.now() >= recovery) {
        recoveryDeadline = performance.now() + 3500;
        quality('low');
      }
      return;
    }
    if (recoveryDeadline) {
      if (frames > previousFrames) {
        recoveryDeadline = 0;
        send({type: 'playing'});
      } else if (performance.now() >= recoveryDeadline) quality('snapshot');
      return;
    }
    if (!playing) return;
    const transport = entries.find(entry => entry.type === 'transport' && entry.selectedCandidatePairId);
    const pair = transport && stats.get(transport.selectedCandidatePairId);
    const nextFreeze = inbound?.freezeCount ?? freezes;
    const congested = nextFreeze > freezes || (pair?.currentRoundTripTime ?? 0) >= 0.25
      || (received + lost >= 20 && lost / (received + lost) >= 0.03);
    freezes = nextFreeze;
    bad = congested ? bad + 1 : 0;
    good = congested ? 0 : good + 1;
    if (mode === 'normal' && bad >= 2) {
      bad = 0;
      quality('low');
    } else if (mode === 'low' && bad >= 5) quality('snapshot');
    else if (mode === 'low' && good >= 10) quality('normal');
  } finally {
    checking = false;
  }
}

async function start(ice) {
  if (peer) return;
  peer = new RTCPeerConnection(ice);
  const transceiver = peer.addTransceiver('video', {direction: 'recvonly'});
  const codecs = RTCRtpReceiver.getCapabilities?.('video')?.codecs ?? [];
  const h264 = codecs.filter(codec => codec.mimeType === 'video/H264');
  if (h264.length && transceiver.setCodecPreferences) {
    transceiver.setCodecPreferences([...h264, ...codecs.filter(codec => codec.mimeType !== 'video/H264')]);
  }
  peer.ontrack = event => {
    video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void video.play().catch(failed);
  };
  peer.onicecandidate = ({candidate}) => {
    if (!candidate) return;
    const signal = {type: 'candidate', ...candidate.toJSON(), candidate: candidate.candidate};
    if (offered) send({type: 'signal', signal});
    else if (localCandidates.length < 64) localCandidates.push(signal);
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'failed') failed();
    else if (peer.connectionState === 'disconnected') armTimeout(failed, 2000);
    else if (peer.connectionState === 'connected' && playing) clearTimeout(timer);
  };
  armTimeout(failed, 5000);
  monitor = setInterval(() => { void sampleStats().catch(() => {}); }, 1000);
  await offer();
}

video.addEventListener('playing', () => {
  playing = true;
  clearTimeout(timer);
  if (mode !== 'snapshot' && !recoveryDeadline) send({type: 'playing'});
});

window.addEventListener('message', event => {
  if (channel || event.data !== 'xopc-browser-preview' || !event.ports[0]) return;
  channel = event.ports[0];
  let queue = Promise.resolve();
  channel.onmessage = event => {
    queue = queue.then(async () => {
      const message = JSON.parse(event.data);
      if (message.type === 'stop') {
        clearTimeout(timer);
        clearInterval(monitor);
        video.srcObject = null;
        peer?.close();
      } else if (message.type === 'accepted') await start(message.ice);
      else if (message.type === 'signal' && peer) {
        const signal = message.signal;
        if (signal.type === 'answer') {
          await peer.setRemoteDescription(signal);
          for (const candidate of remoteCandidates.splice(0)) await peer.addIceCandidate(candidate).catch(() => {});
        } else if (signal.type === 'candidate') {
          if (peer.remoteDescription && peer.signalingState === 'stable') await peer.addIceCandidate(signal).catch(() => {});
          else if (remoteCandidates.length < 64) remoteCandidates.push(signal);
        }
      }
    }).catch(failed);
  };
  send({type: 'ready'});
});

window.addEventListener('pagehide', () => {
  clearTimeout(timer);
  clearInterval(monitor);
  video.srcObject = null;
  peer?.close();
  channel?.close();
});
