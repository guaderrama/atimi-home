const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const remap = (value, low, high) => clamp((value - low) / (high - low));

let handLandmarker = null;
let processing = false;

const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

function jointAngle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
  const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const aLength = Math.hypot(ab.x, ab.y, ab.z);
  const cLength = Math.hypot(cb.x, cb.y, cb.z);
  if (!aLength || !cLength) return 0;
  return Math.acos(clamp(dot / (aLength * cLength), -1, 1));
}

function fingerExtension(points, indices) {
  const [mcp, pip, dip, tip] = indices.map((index) => points[index]);
  const pipScore = remap(jointAngle(mcp, pip, dip), 1.55, 2.92);
  const dipScore = remap(jointAngle(pip, dip, tip), 1.55, 2.92);
  return pipScore * .58 + dipScore * .42;
}

function opennessScore(points) {
  const fingers = [
    fingerExtension(points, [5, 6, 7, 8]),
    fingerExtension(points, [9, 10, 11, 12]),
    fingerExtension(points, [13, 14, 15, 16]),
    fingerExtension(points, [17, 18, 19, 20])
  ];

  const palmWidth = Math.max(.0001, pointDistance(points[5], points[17]));
  const thumbAngle = (
    remap(jointAngle(points[1], points[2], points[3]), 1.35, 2.85) +
    remap(jointAngle(points[2], points[3], points[4]), 1.35, 2.85)
  ) / 2;
  const thumbReach = remap(pointDistance(points[4], points[5]) / palmWidth, .32, 1.1);
  const thumbScore = thumbAngle * .55 + thumbReach * .45;

  const palmLength = Math.max(.0001, pointDistance(points[0], points[9]));
  const reach = [8, 12, 16, 20]
    .map((index) => pointDistance(points[0], points[index]) / palmLength)
    .reduce((sum, value) => sum + value, 0) / 4;
  const reachScore = remap(reach, 1.22, 2.05);
  const extensionScore = fingers.reduce((sum, value) => sum + value, 0) / fingers.length;

  return clamp(extensionScore * .67 + thumbScore * .13 + reachScore * .2);
}

async function createDetector() {
  const moduleUrl = new URL('./vendor/mediapipe/vision_bundle.mjs', self.location.href).href;
  const wasmRoot = new URL('./vendor/mediapipe/wasm', self.location.href).href.replace(/\/$/, '');
  const modelUrl = new URL('./vendor/mediapipe/hand_landmarker.task', self.location.href).href;
  const { FilesetResolver, HandLandmarker } = await import(moduleUrl);

  self.postMessage({ type: 'loading', stage: 'model' });
  const [fileset, modelResponse] = await Promise.all([
    FilesetResolver.forVisionTasks(wasmRoot, true),
    fetch(modelUrl, { cache: 'force-cache' })
  ]);
  if (!modelResponse.ok) throw new Error(`Model download failed (${modelResponse.status})`);
  const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());

  const commonOptions = {
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: .55,
    minHandPresenceConfidence: .55,
    minTrackingConfidence: .5
  };

  const userAgent = self.navigator?.userAgent || '';
  const canUseWorkerGpu = /(?:Chrome|Chromium|Edg)\//.test(userAgent);

  try {
    if (!canUseWorkerGpu) throw new Error('Use the broadly compatible CPU delegate.');
    handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      ...commonOptions,
      baseOptions: { modelAssetBuffer: modelAssetBuffer.slice(), delegate: 'GPU' }
    });
    return 'GPU';
  } catch (gpuError) {
    handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      ...commonOptions,
      baseOptions: { modelAssetBuffer: modelAssetBuffer.slice() }
    });
    return 'CPU';
  }
}

self.addEventListener('message', async (event) => {
  const message = event.data || {};

  if (message.type === 'init') {
    try {
      self.postMessage({ type: 'loading', stage: 'runtime' });
      const delegate = await createDetector();
      self.postMessage({ type: 'ready', delegate });
    } catch (error) {
      self.postMessage({ type: 'error', message: error?.message || 'Hand tracking could not start.' });
    }
    return;
  }

  if (message.type === 'frame') {
    const bitmap = message.bitmap;
    if (!bitmap) return;
    if (!handLandmarker || processing) {
      bitmap.close?.();
      self.postMessage({ type: 'result', detected: false, skipped: true });
      return;
    }

    processing = true;
    try {
      const result = handLandmarker.detectForVideo(bitmap, message.timestamp);
      const points = result.worldLandmarks?.[0] || result.landmarks?.[0];
      if (!points) {
        self.postMessage({ type: 'result', detected: false });
      } else {
        const confidence = result.handedness?.[0]?.[0]?.score ?? 1;
        self.postMessage({
          type: 'result',
          detected: true,
          openness: opennessScore(points),
          confidence
        });
      }
    } catch (error) {
      self.postMessage({ type: 'frame-error', message: error?.message || 'Frame analysis failed.' });
    } finally {
      bitmap.close?.();
      processing = false;
    }
    return;
  }

  if (message.type === 'close') {
    try { handLandmarker?.close(); } catch (error) { /* Closing is best effort. */ }
    handLandmarker = null;
    self.close();
  }
});
