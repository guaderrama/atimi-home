const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smoothstep = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

const body = document.body;
const rootStyles = getComputedStyle(document.documentElement);
const integrationBackground = rootStyles.getPropertyValue('--integration-background').trim() || '#030a11';
const transparentBackground = document.documentElement.dataset.background === 'transparent';
// Integración en la página de Atimi: ?controls=external oculta nuestra interfaz (Atimi pone su marco,
// sus botones y sus instrucciones) y ?autogrow=5000 hace crecer el árbol UNA vez al llegar a la sección.
const embedParams = new URLSearchParams(location.search);
const externalControls = embedParams.get('controls') === 'external';
const autoGrowMs = Math.max(0, Math.min(20000, Number(embedParams.get('autogrow')) || 0));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// ?animar=1 (lo pasa la página anfitriona) anima el árbol aunque el equipo pida "reducir movimiento",
// igual que el logo del hero: para enseñarlo desde un equipo con esa preferencia (27/09/2026). Sin el
// parámetro, la preferencia se respeta como antes.
const forceAnimate = embedParams.get('animar') === '1';
const reducedMotion = () => reduceMotion.matches && !forceAnimate;
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const lowData = Boolean(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || ''));

const plantScene = document.getElementById('plantScene');
const plantMedia = document.getElementById('plantMedia');
const plantPoster = document.getElementById('plantPoster');
const adultLoop = document.getElementById('adultLoop');
const plantDescription = document.getElementById('plantDescription');
const growthStage = document.getElementById('growthStage');
const growthConsole = document.querySelector('.growth-console');
const milestones = [...document.querySelectorAll('[data-growth]')];
const milestoneTrack = document.querySelector('.milestones');
const controlButtons = [...document.querySelectorAll('.control-button')];
const enableCamera = document.getElementById('enableCamera');
const enableCameraLabel = enableCamera.querySelector('.control-label');
const stopCameraButton = document.getElementById('stopCamera');
const useTouch = document.getElementById('useTouch');
const cameraFeed = document.getElementById('cameraFeed');
const systemStatus = document.getElementById('systemStatus');
const completionLine = document.getElementById('completionLine');
const announcer = document.getElementById('announcer');
const sequenceStatus = document.getElementById('sequenceStatus');
const modeInstructions = [...document.querySelectorAll('[data-mode-instruction]')];
const mobileLayout = window.matchMedia('(max-width: 720px)');
// El iframe del sitio mide aproximadamente 620 px incluso en desktop. Usar el
// breakpoint visual (720 px) para elegir imágenes hacía que una pantalla de
// escritorio recibiera los frames móviles. La selección de assets se separa
// del layout para mantener la interfaz compacta sin perder nitidez.
const compactFrameAssets = window.matchMedia('(max-width: 520px)');

const FRAME_COUNT = 141;
const ASSET_VERSION = '3';
const transparentFrames = true;
const EXTERNAL_ZOOM = 1.16;   // el árbol llena el marco cuadrado de Atimi
const EXTERNAL_BASE = .85;    // base del cuadro a esta altura: copa a ~7 % del borde de arriba, tierra a ~79 %
// (el póster fijo usa los mismos dos números en plant-experience.css, bloque .lg-external-controls)
const GROWTH_RESPONSE_BASE = .006;
const DIRECT_DRAG_RESPONSE_BASE = .00003;
const DRAG_DISTANCE_SCALE = .85;
const CAMERA_FRAME_MAX_WIDTH = 320;
const CAMERA_PLAY_TIMEOUT = 12000;
const CAMERA_CAPTURE_FAILURE_LIMIT = 4;
const GROWTH_STOPS = [.08, .28, .50, .70, .84, 1];
const FRAME_STOPS = [0, 30, 64, 94, 116, 140];
const FALLBACK_STAGES = ['08', '28', '50', '70', '84', '100'];

const stages = [
  { threshold: .08, number: '01', name: 'Potential', description: 'A tiny eucalyptus sprout is ready to take root.' },
  { threshold: .28, number: '02', name: 'Rooted', description: 'The young eucalyptus is rooted and developing its first leaves.' },
  { threshold: .50, number: '03', name: 'Connected', description: 'The central stem and first branches form one connected structure.' },
  { threshold: .70, number: '04', name: 'Growing', description: 'Branches extend and the eucalyptus canopy begins to open.' },
  { threshold: .92, number: '05', name: 'Living', description: 'A mature eucalyptus canopy is ready to keep evolving.' }
];

let growth = .08;
let growthTarget = .08;
let lastFrameTime = performance.now();
let lastStageIndex = -1;
let lastCanopyMaskPercent = -1;
let ambientPaused = reducedMotion() || lowData;
let pointerSession = null;

let cameraStream = null;
let trackerWorker = null;
let workerReady = false;
let frameBusy = false;
let cameraLoopFrame = 0;
let lastCameraFrame = 0;
let lastDetectionTime = 0;
let handDetected = false;
let opennessSamples = [];
let smoothedOpenness = 0;
let cameraSession = 0;
let detectorTimeout = 0;
let consecutiveFrameErrors = 0;
let trackMuteTimeout = 0;
let mobileRevealTimeout = 0;
let removeTrackListeners = null;
let adultLoopWanted = false;
let adultLoopLoaded = false;
let preferredInputMode = null;
// El árbol está a la vista (lo actualiza el observador de la cámara): la cámara nunca se reanuda sola
// con el árbol fuera de la pantalla (27/09/2026).
let growthStageOnScreen = true;
// El lector de pantalla solo anuncia las etapas cuando el visitante controla el crecimiento: el
// crecimiento automático lo hacía hablar 4 veces sin que nadie hiciera nada (27/09/2026).
let userControlsGrowth = false;
// Últimos valores escritos, para no reescribir atributos iguales en cada fotograma (27/09/2026).
let lastAriaPercent = -1;
let lastComplete = null;
let focusStopWhenReady = false;
let cameraFrameCanvas = null;
let cameraFrameContext = null;
let preferImageBitmapCapture = 'createImageBitmap' in window;

function syncAdultLoop(isComplete) {
  const shouldPlay = Boolean(!transparentFrames && isComplete && !ambientPaused && !reducedMotion() && !lowData);
  if (shouldPlay === adultLoopWanted) return;
  adultLoopWanted = shouldPlay;

  if (!shouldPlay) {
    plantMedia.classList.remove('is-living');
    adultLoop.pause();
    return;
  }

  if (!adultLoopLoaded) {
    adultLoop.src = adultLoop.dataset.src;
    adultLoopLoaded = true;
    adultLoop.load();
  }

  adultLoop.currentTime = 0;
  adultLoop.play().catch(() => {
    plantMedia.classList.remove('is-living');
  });
}

adultLoop.addEventListener('playing', () => {
  if (adultLoopWanted) plantMedia.classList.add('is-living');
});
adultLoop.addEventListener('error', () => {
  plantMedia.classList.remove('is-living');
});

function frameForGrowth(progress) {
  const start = GROWTH_STOPS[0];
  const end = GROWTH_STOPS[GROWTH_STOPS.length - 1];
  const normalized = clamp((progress - start) / (end - start));
  return Math.round(normalized * (FRAME_COUNT - 1));
}

function createFrameSequence() {
  const context = plantScene.getContext('2d', { alpha: transparentFrames || transparentBackground });
  const fallbackImages = new Array(FALLBACK_STAGES.length);
  const frameCache = new Map();
  const queued = new Map();
  const loading = new Set();
  const failed = new Set();
  // Un cuadro que falla (corte breve de red) se reintenta hasta 3 veces; si no, el crecimiento
  // automático se quedaba a medias para siempre esperándolo (27/09/2026).
  const retries = new Map();
  let generation = 0;
  let inflight = 0;
  let useTick = 0;
  let booted = false;
  let framesAvailable = null;
  let stillOnly = reducedMotion() || lowData;
  let variant = compactFrameAssets.matches ? 'mobile' : 'desktop';
  let targetGrowth = GROWTH_STOPS[0];
  let targetFrame = 0;
  let previousTargetFrame = 0;
  let drawnKey = '';
  let resizeQueued = false;
  let warmupTargets = null;
  let warmupSeen = new Set();
  let warmupDone = false;

  fallbackImages[0] = plantPoster;
  plantPoster.addEventListener('load', () => paint());

  // Mientras llega el detalle completo el árbol YA responde, pero sin decirlo
  // esos segundos se leen como un fallo. El aviso informa y se retira solo; no
  // captura el puntero, así que no interrumpe el control en ningún momento.
  function resetWarmup() {
    warmupTargets = null;
    warmupSeen = new Set();
    warmupDone = false;
    if (sequenceStatus) sequenceStatus.classList.remove('is-visible');
  }

  function updateSequenceStatus() {
    if (!sequenceStatus || warmupDone) return;
    if (stillOnly || framesAvailable === false) {
      warmupDone = true;
      sequenceStatus.classList.remove('is-visible');
      return;
    }
    if (!warmupTargets || !warmupTargets.size) return;

    // Se cuenta lo que YA LLEGÓ por red, no lo que sigue en memoria: la caché
    // de imágenes es más pequeña que la malla y va expulsando cuadros, así que
    // contar frameCache dejaría el progreso estancado por debajo del 100%.
    let ready = 0;
    warmupTargets.forEach((index) => {
      if (warmupSeen.has(index) || failed.has(index)) ready += 1;
    });
    const progress = ready / warmupTargets.size;

    if (progress >= 1) {
      warmupDone = true;
      sequenceStatus.classList.remove('is-visible');
      window.setTimeout(() => { sequenceStatus.textContent = ''; }, 600);
      return;
    }
    sequenceStatus.innerHTML = `Loading full detail <b>${Math.round(progress * 100)}%</b> · the tree already responds`;
    sequenceStatus.classList.add('is-visible');
  }

  function fallbackUrl(index) {
    return frameUrl(FRAME_STOPS[index]);
  }

  function frameUrl(index, requestedVariant = variant) {
    return new URL(`frames/transparent/${requestedVariant}/frame-${String(index + 1).padStart(4, '0')}.webp?v=${ASSET_VERSION}`, import.meta.url).href;
  }

  function cacheLimit() {
    return variant === 'mobile' ? 18 : 26;
  }

  function concurrencyLimit() {
    return variant === 'mobile' ? 2 : 4;
  }

  function closeImage(image) {
    if (typeof image?.close === 'function') image.close();
  }

  function clearFrameCache() {
    frameCache.forEach((entry) => closeImage(entry.image));
    frameCache.clear();
    drawnKey = '';
  }

  function evictFrames() {
    while (frameCache.size > cacheLimit()) {
      let victim = null;
      frameCache.forEach((entry, index) => {
        if (index === targetFrame || FRAME_STOPS.includes(index)) return;
        if (!victim || entry.used < victim.entry.used) victim = { index, entry };
      });
      if (!victim) return;
      closeImage(victim.entry.image);
      frameCache.delete(victim.index);
    }
  }

  async function decodeImage(url) {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Frame request failed (${response.status})`);
    const blob = await response.blob();
    if ('createImageBitmap' in window) {
      try {
        return await createImageBitmap(blob);
      } catch (error) {
        // Some Safari builds expose createImageBitmap but cannot decode WebP blobs.
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Frame decode failed'));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function drawSource(image, key, mode) {
    if (!context || !image) return false;
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const width = plantMedia.clientWidth;
    const height = plantMedia.clientHeight;
    if (!sourceWidth || !sourceHeight || !width || !height) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, variant === 'mobile' ? 1.5 : 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (plantScene.width !== pixelWidth || plantScene.height !== pixelHeight) {
      plantScene.width = pixelWidth;
      plantScene.height = pixelHeight;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, width, height);
    if (!transparentFrames && !transparentBackground) {
      const background = context.createRadialGradient(
        width * .5,
        height * .4,
        0,
        width * .5,
        height * .45,
        Math.max(width, height) * .72
      );
      background.addColorStop(0, '#08201a');
      background.addColorStop(.56, '#04110e');
      background.addColorStop(.64, integrationBackground);
      background.addColorStop(1, integrationBackground);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }

    const drawY = variant === 'mobile'
      ? 0
      : clamp(height * .05, 28, 48);
    const mediaTop = plantMedia.getBoundingClientRect().top;
    const consoleTop = growthConsole && growthConsole.offsetParent !== null
      ? growthConsole.getBoundingClientRect().top - mediaTop
      : height;
    const availableDesktopHeight = Math.max(1, Math.min(height, consoleTop - 16) - drawY);
    const scale = externalControls
      ? Math.min(width / sourceWidth, height / sourceHeight) * EXTERNAL_ZOOM
      : variant === 'mobile'
      ? Math.min(width / sourceWidth, height / sourceHeight)
      : Math.min(Math.min(width, 1600) / sourceWidth, availableDesktopHeight / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const desktopShift = !externalControls && variant !== 'mobile' && width > 1040 ? Math.min(36, width * .022) : 0;
    const drawX = (width - drawWidth) * .5 - desktopShift;
    const resolvedDrawY = externalControls
      ? height * EXTERNAL_BASE - drawHeight
      : variant === 'mobile'
      ? (height - drawHeight) * .5
      : drawY;

    if (variant !== 'mobile' && !externalControls) {
      plantMedia.style.setProperty('--desktop-media-width', `${drawWidth}px`);
      plantMedia.style.setProperty('--desktop-media-top', `${resolvedDrawY}px`);
      plantMedia.style.setProperty('--desktop-media-shift', `${desktopShift}px`);
    }

    context.drawImage(image, drawX, resolvedDrawY, drawWidth, drawHeight);

    if (variant !== 'mobile' && !transparentFrames && !transparentBackground) {
      const rightGap = Math.max(0, width - drawX - drawWidth);
      const sideFade = Math.min(84, drawWidth * .07);
      const topFade = Math.min(62, drawHeight * .085);
      if (drawX > 0) {
        const leftEnd = drawX + sideFade;
        const leftFade = context.createLinearGradient(0, 0, leftEnd, 0);
        leftFade.addColorStop(0, integrationBackground);
        leftFade.addColorStop(clamp(drawX / leftEnd), integrationBackground);
        leftFade.addColorStop(1, 'transparent');
        context.fillStyle = leftFade;
        context.fillRect(0, 0, leftEnd, height);
      }
      if (rightGap > 0) {
        const rightStart = drawX + drawWidth - sideFade;
        const rightFade = context.createLinearGradient(rightStart, 0, width, 0);
        rightFade.addColorStop(0, 'transparent');
        rightFade.addColorStop(clamp(sideFade / (sideFade + rightGap)), integrationBackground);
        rightFade.addColorStop(1, integrationBackground);
        context.fillStyle = rightFade;
        context.fillRect(rightStart, 0, width - rightStart, height);
      }
      if (resolvedDrawY > 0) {
        const topEnd = resolvedDrawY + topFade;
        const topBlend = context.createLinearGradient(0, 0, 0, topEnd);
        topBlend.addColorStop(0, integrationBackground);
        topBlend.addColorStop(clamp(resolvedDrawY / topEnd), integrationBackground);
        topBlend.addColorStop(1, 'transparent');
        context.fillStyle = topBlend;
        context.fillRect(0, 0, width, topEnd);
      }
    }
    drawnKey = key;
    plantMedia.dataset.frame = key;
    plantMedia.dataset.frameMode = mode;
    plantMedia.classList.add('is-ready');
    return true;
  }

  function nearestFallbackIndex() {
    let nearest = 0;
    let distance = Infinity;
    GROWTH_STOPS.forEach((stop, index) => {
      const nextDistance = Math.abs(stop - targetGrowth);
      if (nextDistance <= distance) {
        nearest = index;
        distance = nextDistance;
      }
    });
    return nearest;
  }

  function nearestLoadedFallback(preferred) {
    if (fallbackImages[preferred]?.complete && fallbackImages[preferred].naturalWidth) return preferred;
    let nearest = null;
    let distance = Infinity;
    fallbackImages.forEach((image, index) => {
      if (!image?.complete || !image.naturalWidth) return;
      const nextDistance = Math.abs(index - preferred);
      if (nextDistance < distance) {
        nearest = index;
        distance = nextDistance;
      }
    });
    return nearest;
  }

  function paintFallback() {
    const preferred = nearestFallbackIndex();
    loadFallback(preferred);
    const index = nearestLoadedFallback(preferred);
    if (index === null) return false;
    const key = `still-${FALLBACK_STAGES[index]}`;
    if (drawnKey === key) return true;
    return drawSource(fallbackImages[index], key, 'still');
  }

  function nearestCachedFrame() {
    let winner = null;
    let distance = Infinity;
    const direction = Math.sign(targetFrame - previousTargetFrame) || 1;
    frameCache.forEach((entry, index) => {
      const nextDistance = Math.abs(index - targetFrame);
      const preferredSide = direction > 0 ? index >= targetFrame : index <= targetFrame;
      const winnerPreferred = winner === null ? false : (direction > 0 ? winner.index >= targetFrame : winner.index <= targetFrame);
      if (nextDistance < distance || (nextDistance === distance && preferredSide && !winnerPreferred)) {
        winner = { index, entry };
        distance = nextDistance;
      }
    });
    return winner;
  }

  function paint() {
    if (stillOnly || framesAvailable === false) {
      paintFallback();
      return;
    }

    const cached = frameCache.get(targetFrame);
    const selected = cached ? { index: targetFrame, entry: cached } : nearestCachedFrame();
    if (!selected) {
      paintFallback();
      return;
    }

    selected.entry.used = ++useTick;
    const key = `frame-${String(selected.index + 1).padStart(4, '0')}`;
    if (drawnKey !== key) drawSource(selected.entry.image, key, 'sequence');
  }

  function loadFallback(index) {
    if (index === 0 || fallbackImages[index]) return;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => paint();
    fallbackImages[index] = image;
    image.src = fallbackUrl(index);
  }

  function loadFallbacks() {
    FALLBACK_STAGES.forEach((stage, index) => loadFallback(index));
  }

  function enqueue(index, priority) {
    if (stillOnly || framesAvailable === false) return;
    if (index < 0 || index >= FRAME_COUNT || frameCache.has(index) || failed.has(index)) return;
    if (loading.has(`${generation}:${index}`)) return;
    const current = queued.get(index);
    if (current === undefined || priority > current) queued.set(index, priority);
  }

  function takeNextQueued() {
    let winner = null;
    let priority = -Infinity;
    queued.forEach((value, index) => {
      if (value > priority) {
        winner = index;
        priority = value;
      }
    });
    if (winner !== null) queued.delete(winner);
    return winner;
  }

  function queueNeighborhood() {
    if (!booted || stillOnly || framesAvailable !== true) return;
    const direction = Math.sign(targetFrame - previousTargetFrame) || 1;
    const offsets = direction > 0
      ? [0, 1, 2, 3, 4, 6, 8, -1, -2, -4, -6, -8]
      : [0, -1, -2, -3, -4, -6, -8, 1, 2, 4, 6, 8];
    offsets.forEach((offset, order) => enqueue(targetFrame + offset, 1000 - order));
    pump();
  }

  function queueCoarsePass() {
    const warmup = [];
    // Malla gruesa sobre toda la secuencia.
    for (let index = 0; index < FRAME_COUNT; index += 8) warmup.push(index);
    // Y una malla más densa en el arranque. El usuario empieza siempre en
    // "Potential", así que el primer tramo es el que decide si la experiencia
    // se siente fluida o a saltos — y es el más barato de traer: ahí los
    // cuadros pesan ~25KB frente a los ~250KB del árbol maduro. El tramo se
    // corta en el 32 y va de 4 en 4 a propósito: con paso 3 la precarga subía
    // a 46 cuadros en móvil y qa/functional-check.mjs impone un techo de 45.
    for (let index = 0; index <= 32; index += 4) warmup.push(index);
    FRAME_STOPS.forEach((index) => warmup.push(index));

    warmupTargets = new Set(warmup.filter((index) => index >= 0 && index < FRAME_COUNT));
    for (let index = 0; index < FRAME_COUNT; index += 8) {
      enqueue(index, 220 - Math.abs(index - targetFrame));
    }
    for (let index = 0; index <= 32; index += 4) {
      enqueue(index, 300 - Math.abs(index - targetFrame));
    }
    FRAME_STOPS.forEach((index) => enqueue(index, 360 - Math.abs(index - targetFrame)));
    queueNeighborhood();
    updateSequenceStatus();
  }

  async function loadFrame(index, token, requestedVariant, loadKey) {
    try {
      const image = await decodeImage(frameUrl(index, requestedVariant));
      if (token !== generation || requestedVariant !== variant || stillOnly) {
        closeImage(image);
        return;
      }

      frameCache.set(index, { image, used: ++useTick });
      warmupSeen.add(index);
      if (index === 0 && framesAvailable === null) {
        framesAvailable = true;
        queueCoarsePass();
      }
      evictFrames();
      paint();
    } catch (error) {
      if (token !== generation || requestedVariant !== variant) return;
      failed.add(index);
      const tries = (retries.get(index) || 0) + 1;
      retries.set(index, tries);
      if (index !== 0 && tries <= 3) window.setTimeout(() => { if (token === generation) failed.delete(index); }, 1500 * tries);
      if (index === 0 && framesAvailable === null) {
        framesAvailable = false;
        queued.clear();
        paintFallback();
      }
    } finally {
      loading.delete(loadKey);
      inflight = Math.max(0, inflight - 1);
      updateSequenceStatus();
      pump();
    }
  }

  function pump() {
    if (!booted || stillOnly || framesAvailable === false) return;
    while (inflight < concurrencyLimit()) {
      const index = takeNextQueued();
      if (index === null) return;
      const token = generation;
      const requestedVariant = variant;
      const loadKey = `${token}:${index}`;
      if (loading.has(loadKey)) continue;
      loading.add(loadKey);
      inflight += 1;
      loadFrame(index, token, requestedVariant, loadKey);
    }
  }

  function probeFrames() {
    framesAvailable = null;
    failed.clear();
    retries.clear();
    enqueue(0, 2000);
    pump();
  }

  function boot() {
    if (booted) return;
    booted = true;
    requestResize();
    if (stillOnly) {
      framesAvailable = false;
      paintFallback();
      return;
    }
    probeFrames();
  }

  function update(progress) {
    targetGrowth = clamp(progress, GROWTH_STOPS[0], GROWTH_STOPS[GROWTH_STOPS.length - 1]);
    previousTargetFrame = targetFrame;
    targetFrame = frameForGrowth(targetGrowth);
    if (booted && !stillOnly && framesAvailable === true) queueNeighborhood();
    paint();
  }

  function resize() {
    resizeQueued = false;
    drawnKey = '';
    paint();
  }

  function requestResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(resize);
  }

  function resetVariant() {
    const nextVariant = compactFrameAssets.matches ? 'mobile' : 'desktop';
    if (nextVariant === variant) {
      requestResize();
      return;
    }
    variant = nextVariant;
    generation += 1;
    queued.clear();
    failed.clear();
    retries.clear();
    clearFrameCache();
    resetWarmup();
    if (booted && !stillOnly) probeFrames();
    requestResize();
  }

  function setStillOnly(value) {
    const nextValue = Boolean(value);
    if (nextValue === stillOnly) return;
    stillOnly = nextValue;
    generation += 1;
    queued.clear();
    failed.clear();
    retries.clear();
    clearFrameCache();
    resetWarmup();
    loadFallbacks();
    if (stillOnly) {
      framesAvailable = false;
      paintFallback();
    } else if (booted) {
      probeFrames();
    }
  }

  window.addEventListener('resize', requestResize, { passive: true });
  compactFrameAssets.addEventListener?.('change', resetVariant);
  window.addEventListener('pagehide', clearFrameCache, { once: true });

  function isLoaded(index) {
    return warmupSeen.has(index) || frameCache.has(index);
  }

  // Hasta qué cuadro se puede avanzar sin huecos (se tolera saltar uno): el crecimiento
  // automático nunca adelanta a la red, así que en una conexión lenta va más despacio pero sin saltos.
  function loadedRunFrom(start) {
    if (stillOnly || framesAvailable === false) return FRAME_COUNT - 1;
    if (framesAvailable !== true) return start;
    let index = Math.max(0, start);
    // Un cuadro que agotó sus reintentos ya no detiene el avance (se dibuja el vecino más cercano).
    const ok = (i) => isLoaded(i) || (failed.has(i) && (retries.get(i) || 0) > 3);
    while (index < FRAME_COUNT - 1) {
      if (ok(index + 1)) index += 1;
      else if (index + 2 <= FRAME_COUNT - 1 && ok(index + 2)) index += 2;
      else break;
    }
    return index;
  }

  function prefetchAhead(start, count) {
    if (!booted || stillOnly || framesAvailable !== true) return;
    for (let offset = 1; offset <= count; offset += 1) {
      const index = start + offset;
      if (index >= FRAME_COUNT) break;
      if (!isLoaded(index)) enqueue(index, 1500 - offset);
    }
    pump();
  }

  return { boot, update, setStillOnly, loadedRunFrom, prefetchAhead };
}

const frameSequence = createFrameSequence();

// Dentro de la página de Atimi el aviso ya no se queda para siempre (en el teléfono tapaba la copa):
// "listo" se retira a los 3 s y un error a los 8 s, salvo con la cámara encendida o arrancando
// (27/09/2026). El lector de pantalla ya lo leyó al aparecer (role=status).
let statusHideTimer = 0;
function setSystemStatus(message, state = '') {
  window.clearTimeout(statusHideTimer);
  systemStatus.className = `system-status${state ? ` is-${state}` : ''}`;
  systemStatus.querySelector('span').textContent = message;
  if (externalControls && (state === 'ready' || state === 'error')) {
    statusHideTimer = window.setTimeout(() => {
      if (cameraStream || body.classList.contains('camera-loading')) return;
      systemStatus.className = 'system-status';
    }, state === 'error' ? 8000 : 3000);
  }
}

function setCameraButtonLabel(label) {
  enableCameraLabel.textContent = label;
}

function setInputModeSelection(mode) {
  const selectedMode = mode === 'camera' || mode === 'touch' ? mode : null;
  enableCamera.setAttribute('aria-pressed', String(selectedMode === 'camera'));
  useTouch.setAttribute('aria-pressed', String(selectedMode === 'touch'));
  if (selectedMode) body.dataset.inputModeSelected = selectedMode;
  else delete body.dataset.inputModeSelected;
  if (externalControls && window.parent !== window) {
    try { window.parent.postMessage({ source: 'living-growth', type: 'mode', mode: selectedMode }, location.origin); } catch (error) {}
  }
  modeInstructions.forEach((instruction) => {
    const visible = !selectedMode || instruction.dataset.modeInstruction === selectedMode;
    instruction.setAttribute('aria-hidden', String(!visible));
  });
}

function createWaterRipple(button, event = null) {
  if (reducedMotion() || button.disabled) return;
  const rect = button.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.hypot(rect.width, rect.height) * 1.7;
  const x = event ? clamp(event.clientX - rect.left, 0, rect.width) : rect.width / 2;
  const y = event ? clamp(event.clientY - rect.top, 0, rect.height) : rect.height / 2;
  ripple.className = 'water-ripple';
  ripple.setAttribute('aria-hidden', 'true');
  ripple.style.setProperty('--ripple-x', `${x}px`);
  ripple.style.setProperty('--ripple-y', `${y}px`);
  ripple.style.setProperty('--ripple-size', `${size}px`);
  button.classList.add('is-rippling');
  button.append(ripple);
  const remove = () => {
    ripple.remove();
    if (!button.querySelector('.water-ripple')) button.classList.remove('is-rippling');
  };
  ripple.addEventListener('animationend', remove, { once: true });
  window.setTimeout(remove, 1100);
}

controlButtons.forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    createWaterRipple(button, event);
  });
  button.addEventListener('click', (event) => {
    if (event.detail === 0) createWaterRipple(button);
  });
});

function stageForProgress(progress) {
  let active = 0;
  stages.forEach((stage, index) => {
    if (progress >= stage.threshold) active = index;
  });
  return active;
}

function updateStage(progress) {
  const activeIndex = stageForProgress(progress);
  const active = stages[activeIndex];
  const percent = Math.round(progress * 100);
  if (percent !== lastCanopyMaskPercent) {
    const canopyGrowth = clamp((progress - .08) / .92);
    plantMedia.style.setProperty("--canopy-mask-x", `${9 + canopyGrowth * 37}%`);
    plantMedia.style.setProperty("--canopy-mask-y", `${20 + canopyGrowth * 68}%`);
    plantMedia.style.setProperty("--canopy-mask-center-y", `${90 - canopyGrowth * 40}%`);
    lastCanopyMaskPercent = percent;
  }
  if (percent !== lastAriaPercent) {
    growthStage.setAttribute('aria-valuenow', String(percent));
    growthStage.setAttribute('aria-valuetext', `${percent} percent grown`);
    milestoneTrack?.style.setProperty('--track-progress', String(clamp((progress - .08) / .92)));
    lastAriaPercent = percent;
  }

  if (activeIndex !== lastStageIndex) {
    milestones.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === activeIndex));
    });
    plantDescription.textContent = active.description;
    if (lastStageIndex >= 0 && userControlsGrowth) announcer.textContent = `${percent} percent grown. ${active.description}`;
    lastStageIndex = activeIndex;
  }
}

function updateScene(progress) {
  frameSequence.update(progress);
  updateStage(progress);

  const isComplete = progress >= .985;
  body.classList.toggle('growth-complete', isComplete);
  if (isComplete !== lastComplete) {
    completionLine.setAttribute('aria-hidden', String(!isComplete));
    lastComplete = isComplete;
  }
  syncAdultLoop(isComplete);
}

// El bucle de dibujo solo corre mientras hay algo que mover: crecimiento en curso, un arrastre o el
// crecimiento automático esperando o avanzando con el árbol a la vista. En reposo se detiene (antes
// corría a ~60 fps para siempre, también fuera de pantalla) y kick() lo reanuda (27/09/2026).
// Todo cambio de growthTarget pasa por setGrowthTarget, que llama a kick().
let renderFrame = 0;
let rendering = false;
function kick() {
  if (renderFrame || rendering) return;
  lastFrameTime = performance.now();
  renderFrame = requestAnimationFrame(render);
}

function render(now) {
  renderFrame = 0;
  rendering = true;
  try {
    if (autoGrow.state !== 'off') stepAutoGrow(now);
    const elapsed = Math.max(0, Math.min(50, now - lastFrameTime));
    lastFrameTime = now;
    const responseBase = pointerSession ? DIRECT_DRAG_RESPONSE_BASE : GROWTH_RESPONSE_BASE;
    const response = reducedMotion() ? 1 : 1 - Math.pow(responseBase, elapsed / 1000);
    growth += (growthTarget - growth) * response;
    if (Math.abs(growthTarget - growth) < .0002) growth = growthTarget;
    updateScene(growth);
  } finally {
    rendering = false;
  }
  const busy = growth !== growthTarget || pointerSession || autoGrow.state === 'running'
    || ((autoGrow.state === 'waiting' || autoGrow.state === 'paused') && autoGrow.visible);
  if (busy && !renderFrame) renderFrame = requestAnimationFrame(render);
}

function setGrowthTarget(value) {
  growthTarget = clamp(value, .08, 1);
  kick();
}

function activateTouchMode({ focus = false, updateStatus = true } = {}) {
  const wasTouch = body.classList.contains('is-touch-control') && !cameraStream && !body.classList.contains('camera-loading');
  cancelAutoGrow();
  preferredInputMode = 'touch';
  frameSequence.boot();
  if (cameraStream || body.classList.contains('camera-loading')) {
    stopCamera({ message: 'Touch control ready' });
  }
  body.classList.add('is-touch-control');
  growthStage.dataset.inputMode = 'touch';
  setInputModeSelection('touch');
  if (updateStatus && !wasTouch) setSystemStatus('Touch control ready', 'ready');
  if (!focus) return;
  growthStage.focus({ preventScroll: true });
}

milestones.forEach((button) => {
  button.addEventListener('click', () => {
    activateTouchMode();
    setGrowthTarget(Number(button.dataset.growth) / 100);
  });
});

useTouch.addEventListener('click', (event) => activateTouchMode({ focus: event.detail === 0 }));

// ── Arrastre en modo toque: un scroll anidado, no una trampa (26/09/2026) ─────────────────────────
// Deslizar el dedo sobre el árbol lo hace crecer (hacia arriba) o encoger (hacia abajo). Antes eso
// secuestraba el scroll de la página: en un teléfono el árbol ocupa el 91 % del ancho y no quedaba por
// dónde seguir bajando. Ahora se comporta como un área con scroll dentro de la página: el gesto mueve
// primero el árbol y, cuando ya no puede crecer (o encoger) más, el resto del mismo gesto desplaza la
// página, con inercia al soltar. Una vez que el gesto pasó a la página, se queda en la página hasta
// levantar el dedo (igual que un scroll anidado nativo). Con ratón no cambia nada: la rueda ya movía
// la página y arrastrar solo controla el árbol.
// Se mide con screenY y no con clientY: al desplazarse la página, el iframe se mueve bajo el dedo y
// clientY no cambiaría aunque el dedo sí se moviera, y el scroll se frenaría solo.
function pageScroller() {
  try {
    if (window.parent !== window && window.parent.document) return window.parent;
  } catch (error) { /* otro origen: se desplaza este mismo documento */ }
  return window;
}

let inertiaFrame = 0;
let inertiaHost = null;

function scrollPageBy(px) {
  const host = pageScroller();
  const root = host.document.documentElement;
  // la página de Atimi lleva html{scroll-behavior:smooth}: el dedo necesita un desplazamiento inmediato
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  host.scrollBy(0, px);
  root.style.scrollBehavior = previous;
}

function stopInertia() {
  if (inertiaFrame && inertiaHost) inertiaHost.cancelAnimationFrame(inertiaFrame);
  inertiaFrame = 0;
}

function startInertia(velocity) {
  stopInertia();
  // el bucle corre en la página anfitriona: el iframe sale de pantalla mientras la página avanza
  inertiaHost = pageScroller();
  let last = inertiaHost.performance.now();
  let v = velocity;
  const step = (now) => {
    const dt = Math.min(64, now - last);
    last = now;
    scrollPageBy(v * dt);
    v *= Math.exp(-dt / 325);
    inertiaFrame = Math.abs(v) > .02 ? inertiaHost.requestAnimationFrame(step) : 0;
  };
  inertiaFrame = inertiaHost.requestAnimationFrame(step);
}

// Cualquier toque, clic o rueda en la página detiene la inercia, como en un scroll nativo.
(() => {
  const host = pageScroller();
  ['touchstart', 'pointerdown', 'wheel', 'keydown'].forEach((type) => {
    host.addEventListener(type, stopInertia, { passive: true, capture: true });
  });
})();

// Un clic de ratón sobre el árbol no le entrega el teclado (27/09/2026): Espacio seguía sin bajar la
// página y las flechas encogían el árbol. También suelta el botón de la página que tuviera el foco
// ("Use hand control"), porque si no Espacio lo volvía a pulsar. Con Tab se sigue llegando al árbol.
growthStage.addEventListener('mousedown', (event) => {
  event.preventDefault();
  try { const a = window.parent.document.activeElement; if (a && a !== window.parent.document.body && a !== window.frameElement) a.blur(); } catch (error) {}
});

growthStage.addEventListener('pointerdown', (event) => {
  if (!body.classList.contains('is-touch-control')) return;
  stopInertia();
  pointerSession = {
    id: event.pointerId,
    lastY: event.screenY,
    chains: event.pointerType !== 'mouse',
    onPage: false,
    samples: []
  };
  growthStage.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

growthStage.addEventListener('pointermove', (event) => {
  if (!pointerSession || pointerSession.id !== event.pointerId) return;
  event.preventDefault();
  const dy = pointerSession.lastY - event.screenY;   // > 0: el dedo sube
  pointerSession.lastY = event.screenY;
  if (!dy) return;
  let toPage = dy;
  if (!pointerSession.onPage) {
    const rect = growthStage.getBoundingClientRect();
    const dragDistance = Math.max(260, rect.height * .72) * DRAG_DISTANCE_SCALE;
    const before = growthTarget;
    setGrowthTarget(growthTarget + dy / dragDistance);
    toPage = dy - (growthTarget - before) * dragDistance;   // lo que el árbol ya no pudo absorber
    if (!pointerSession.chains || Math.abs(toPage) < .5) return;
    pointerSession.onPage = true;
  }
  scrollPageBy(toPage);
  const samples = pointerSession.samples;
  samples.push({ t: event.timeStamp, px: toPage });
  while (samples.length > 1 && event.timeStamp - samples[0].t > 100) samples.shift();
});

function endPointer(event) {
  if (!pointerSession || pointerSession.id !== event.pointerId) return;
  const session = pointerSession;
  pointerSession = null;
  growthStage.releasePointerCapture?.(event.pointerId);
  const info = { tipo: event.type, enPagina: session.onPage, muestras: session.samples.length };
  window.__lgUltimoGesto = info;   // diagnóstico: cómo terminó el último gesto (inerte)
  if (event.type !== 'pointerup' || !session.onPage || session.samples.length < 2) return;
  const first = session.samples[0], lastSample = session.samples[session.samples.length - 1];
  const span = Math.max(16, lastSample.t - first.t);
  info.hueco = Math.round(event.timeStamp - lastSample.t);
  info.span = Math.round(span);
  if (info.hueco > 100) return;   // el dedo se detuvo antes de soltar: sin inercia
  const velocity = session.samples.reduce((sum, sample) => sum + sample.px, 0) / span;
  info.velocidad = +velocity.toFixed(3);
  if (Math.abs(velocity) > .25) startInertia(velocity);
}

growthStage.addEventListener('pointerup', endPointer);
growthStage.addEventListener('pointercancel', endPointer);

growthStage.addEventListener('keydown', (event) => {
  const steps = {
    ArrowUp: .025,
    ArrowRight: .025,
    ArrowDown: -.025,
    ArrowLeft: -.025,
    PageUp: .10,
    PageDown: -.10
  };
  if (event.key === 'Home') {
    activateTouchMode();
    setGrowthTarget(.08);
  } else if (event.key === 'End') {
    activateTouchMode();
    setGrowthTarget(1);
  } else if (steps[event.key]) {
    activateTouchMode();
    setGrowthTarget(growthTarget + steps[event.key]);
  } else {
    return;
  }
  event.preventDefault();
});

function cameraErrorMessage(error) {
  if (!window.isSecureContext) return 'Hand control needs a secure connection. Open this page over HTTPS.';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Camera access is blocked. Allow Camera for this site in your browser settings, then try again.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No camera was found. Connect or enable a camera, then try again.';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return 'The camera is being used by another app. Close it there, then try again.';
  if (error?.name === 'OverconstrainedError') return 'This camera is not compatible. Try another camera.';
  if (error?.name === 'AbortError') return 'The camera connected but video did not start. Close other camera apps, then try again.';
  return 'Hand control could not start.';
}

function trackerErrorMessage(detail = '') {
  if (/GLctx|WebGL|ModuleFactory|activeTexture/i.test(detail)) {
    return 'Hand tracking needs WebGL. Enable browser hardware acceleration or try the latest Chrome or Edge.';
  }
  return 'Hand tracking could not start in this browser.';
}

function handleHandResult(message) {
  frameBusy = false;
  consecutiveFrameErrors = 0;
  if (message.skipped) return;
  if (!message.detected) {
    if (performance.now() - lastDetectionTime > 650 && handDetected) {
      handDetected = false;
      body.classList.remove('hand-detected');
      setSystemStatus('Camera ready. Hold one hand in view.', 'ready');
    }
    return;
  }

  lastDetectionTime = performance.now();
  if (!handDetected) {
    handDetected = true;
    body.classList.add('hand-detected');
    setSystemStatus('Hand detected. Open or close it to grow the tree.', 'detected');
  }

  opennessSamples.push(clamp(message.openness));
  if (opennessSamples.length > 5) opennessSamples.shift();
  const sorted = [...opennessSamples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  if (opennessSamples.length === 1) smoothedOpenness = median;
  else smoothedOpenness += (median - smoothedOpenness) * .26;

  const openGrowth = smoothstep((smoothedOpenness - .16) / .74);
  const nextGrowth = .08 + openGrowth * .92;
  if (Math.abs(nextGrowth - growthTarget) >= .008) setGrowthTarget(nextGrowth);
}

function revealPlantOnMobile() {
  // Solo en teléfonos: se mide la ventana de la PÁGINA, no la del marco (que en escritorio mide
  // ~620 px y hacía saltar la página también en portátiles; 27/09/2026).
  var hostIsPhone; try { hostIsPhone = window.parent.matchMedia('(max-width: 720px)').matches; } catch (_) { hostIsPhone = mobileLayout.matches; }
  if (!hostIsPhone) return;
  window.clearTimeout(mobileRevealTimeout);
  window.requestAnimationFrame(() => {
    growthStage.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  });
  mobileRevealTimeout = window.setTimeout(() => {
    if (cameraStream) body.classList.add('camera-viewing');
  }, reducedMotion() ? 0 : 450);
}

function useTouchAfterCameraFailure(message) {
  stopCamera({ message: `${message} Touch control is ready.`, error: true });
  activateTouchMode({ updateStatus: false });
}

function handleWorkerMessage(event, worker, session) {
  if (worker !== trackerWorker || session !== cameraSession) return;
  const message = event.data || {};
  if (message.type === 'loading') {
    setSystemStatus(
      message.stage === 'model'
        ? 'Camera connected. Loading the hand model — first use may take up to a minute…'
        : 'Camera connected. Preparing hand tracking…',
      'loading'
    );
    return;
  }
  if (message.type === 'ready') {
    window.clearTimeout(detectorTimeout);
    detectorTimeout = 0;
    workerReady = true;
    body.classList.remove('camera-loading');
    body.classList.add('camera-active');
    growthStage.dataset.inputMode = 'camera';
    enableCamera.disabled = false;
    enableCamera.removeAttribute('aria-busy');
    setCameraButtonLabel('Hand control active');
    setInputModeSelection('camera');
    enableCamera.hidden = true;
    stopCameraButton.hidden = false;
    if (focusStopWhenReady && !document.hidden) {
      stopCameraButton.focus({ preventScroll: true });
    }
    focusStopWhenReady = false;
    setSystemStatus('Camera ready. Hold one hand in view.', 'ready');
    cameraLoopFrame = requestAnimationFrame(cameraLoop);
    revealPlantOnMobile();
    return;
  }
  if (message.type === 'result') {
    handleHandResult(message);
    return;
  }
  if (message.type === 'frame-error') {
    frameBusy = false;
    consecutiveFrameErrors += 1;
    if (consecutiveFrameErrors >= CAMERA_CAPTURE_FAILURE_LIMIT) {
      useTouchAfterCameraFailure(trackerErrorMessage(message.message));
    }
    return;
  }
  if (message.type === 'error') {
    useTouchAfterCameraFailure(trackerErrorMessage(message.message));
  }
}

function captureCameraImageData() {
  const sourceWidth = cameraFeed.videoWidth || 320;
  const sourceHeight = cameraFeed.videoHeight || 240;
  const scale = Math.min(1, CAMERA_FRAME_MAX_WIDTH / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (!cameraFrameCanvas) {
    cameraFrameCanvas = document.createElement('canvas');
    cameraFrameContext = cameraFrameCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!cameraFrameContext) throw new Error('Canvas capture is not available.');
  if (cameraFrameCanvas.width !== width || cameraFrameCanvas.height !== height) {
    cameraFrameCanvas.width = width;
    cameraFrameCanvas.height = height;
  }
  cameraFrameContext.drawImage(cameraFeed, 0, 0, width, height);
  return cameraFrameContext.getImageData(0, 0, width, height);
}

async function captureCameraFrame() {
  if (preferImageBitmapCapture) {
    try {
      const frame = await createImageBitmap(cameraFeed);
      return { frame, transfer: [frame] };
    } catch (error) {
      preferImageBitmapCapture = false;
    }
  }

  return {
    frame: captureCameraImageData(),
    transfer: []
  };
}

async function cameraLoop(now) {
  if (!cameraStream || !workerReady || !trackerWorker) return;
  if (!frameBusy && cameraFeed.readyState >= 2 && now - lastCameraFrame > 72) {
    frameBusy = true;
    lastCameraFrame = now;
    const activeStream = cameraStream;
    const activeWorker = trackerWorker;
    try {
      const { frame, transfer } = await captureCameraFrame();
      if (activeStream !== cameraStream || activeWorker !== trackerWorker) {
        frame.close?.();
        frameBusy = false;
        return;
      }
      activeWorker.postMessage({ type: 'frame', bitmap: frame, timestamp: now }, transfer);
    } catch (error) {
      frameBusy = false;
      consecutiveFrameErrors += 1;
      if (consecutiveFrameErrors >= CAMERA_CAPTURE_FAILURE_LIMIT) {
        useTouchAfterCameraFailure('The camera image could not be read in this browser.');
        return;
      }
    }
  }
  cameraLoopFrame = requestAnimationFrame(cameraLoop);
}

async function playCameraStream() {
  let playTimeout = 0;
  try {
    await Promise.race([
      Promise.resolve(cameraFeed.play()),
      new Promise((resolve, reject) => {
        playTimeout = window.setTimeout(() => {
          reject(new DOMException('Camera video did not start in time.', 'AbortError'));
        }, CAMERA_PLAY_TIMEOUT);
      })
    ]);
  } finally {
    window.clearTimeout(playTimeout);
  }
}

async function startCamera() {
  cancelAutoGrow();
  if (cameraStream || body.classList.contains('camera-loading')) return;
  focusStopWhenReady = document.activeElement === enableCamera;
  preferImageBitmapCapture = typeof createImageBitmap === 'function';
  preferredInputMode = 'camera';
  frameSequence.boot();
  setInputModeSelection('camera');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.Worker) {
    setSystemStatus('Hand control is not available in this browser. Touch control is ready.', 'error');
    activateTouchMode({ updateStatus: false });
    return;
  }

  const session = ++cameraSession;

  body.classList.remove('is-touch-control');
  body.classList.add('camera-loading');
  growthStage.dataset.inputMode = 'camera-loading';
  enableCamera.disabled = true;
  enableCamera.setAttribute('aria-busy', 'true');
  setCameraButtonLabel('Starting…');
  setSystemStatus('Allow camera access to start hand control…', 'loading');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 }
      },
      audio: false
    });
    if (session !== cameraSession || document.hidden) {
      stream.getTracks().forEach((track) => track.stop());
      if (session === cameraSession) {
        stopCamera({ message: 'Hand control paused. Tap Use hand control to try again.', clearPreference: true });
      }
      return;
    }

    cameraStream = stream;
    opennessSamples = [];
    smoothedOpenness = 0;
    setGrowthTarget(.08);

    setSystemStatus('Camera connected. Preparing hand tracking…', 'loading');
    revealPlantOnMobile();

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const handleEnded = () => {
        if (session === cameraSession) useTouchAfterCameraFailure('The camera disconnected.');
      };
      const handleMute = () => {
        window.clearTimeout(trackMuteTimeout);
        trackMuteTimeout = window.setTimeout(() => {
          if (session === cameraSession && videoTrack.muted && !document.hidden) {
            useTouchAfterCameraFailure('The camera stopped sending video.');
          }
        }, 3000);
      };
      const handleUnmute = () => {
        window.clearTimeout(trackMuteTimeout);
        trackMuteTimeout = 0;
      };
      videoTrack.addEventListener('ended', handleEnded);
      videoTrack.addEventListener('mute', handleMute);
      videoTrack.addEventListener('unmute', handleUnmute);
      removeTrackListeners = () => {
        videoTrack.removeEventListener('ended', handleEnded);
        videoTrack.removeEventListener('mute', handleMute);
        videoTrack.removeEventListener('unmute', handleUnmute);
      };
    }

    cameraFeed.srcObject = stream;
    await playCameraStream();
    if (session !== cameraSession) return;

    const worker = new Worker(`hand-tracker.worker.js?v=1`, { type: 'module' });
    trackerWorker = worker;
    worker.addEventListener('message', (event) => handleWorkerMessage(event, worker, session));
    worker.addEventListener('error', (event) => {
      if (worker === trackerWorker && session === cameraSession) {
        useTouchAfterCameraFailure(trackerErrorMessage(event.message));
      }
    });
    detectorTimeout = window.setTimeout(() => {
      if (worker === trackerWorker && session === cameraSession && !workerReady) {
        useTouchAfterCameraFailure('Hand control took too long to start on this connection.');
      }
    }, 60000);
    worker.postMessage({ type: 'init' });
  } catch (error) {
    if (session !== cameraSession) return;
    useTouchAfterCameraFailure(cameraErrorMessage(error));
  }
}

function stopCamera({ message = 'Hand control stopped', error = false, clearPreference = false } = {}) {
  const restoreCameraFocus = document.activeElement === stopCameraButton || focusStopWhenReady;
  focusStopWhenReady = false;
  if (clearPreference) preferredInputMode = null;
  cameraSession += 1;
  window.clearTimeout(detectorTimeout);
  window.clearTimeout(trackMuteTimeout);
  window.clearTimeout(mobileRevealTimeout);
  detectorTimeout = 0;
  trackMuteTimeout = 0;
  mobileRevealTimeout = 0;
  removeTrackListeners?.();
  removeTrackListeners = null;
  if (cameraLoopFrame) cancelAnimationFrame(cameraLoopFrame);
  cameraLoopFrame = 0;
  frameBusy = false;
  workerReady = false;
  consecutiveFrameErrors = 0;
  handDetected = false;
  opennessSamples = [];
  smoothedOpenness = 0;
  body.classList.remove('camera-loading', 'camera-active', 'camera-viewing', 'hand-detected');
  growthStage.dataset.inputMode = 'idle';

  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraFeed.pause();
  cameraFeed.srcObject = null;

  if (trackerWorker) {
    const worker = trackerWorker;
    trackerWorker = null;
    try { worker.postMessage({ type: 'close' }); } catch (workerError) { /* Worker may already be closed. */ }
    window.setTimeout(() => worker.terminate(), 80);
  }

  enableCamera.hidden = false;
  enableCamera.disabled = false;
  enableCamera.removeAttribute('aria-busy');
  setCameraButtonLabel('Use hand control');
  stopCameraButton.hidden = true;
  setInputModeSelection(null);
  if (restoreCameraFocus && !document.hidden) enableCamera.focus({ preventScroll: true });
  setSystemStatus(message, error ? 'error' : '');
}

enableCamera.addEventListener('click', startCamera);
stopCameraButton.addEventListener('click', () => stopCamera({ clearPreference: true }));

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (cameraStream || body.classList.contains('camera-loading'))) {
    const wasLoading = body.classList.contains('camera-loading');
    stopCamera({ message: 'Hand control paused', clearPreference: wasLoading });
  } else if (!document.hidden && preferredInputMode === 'camera' && !cameraStream && growthStageOnScreen) {
    startCamera();
  }
});
window.addEventListener('pagehide', () => {
  if (cameraStream || body.classList.contains('camera-loading')) stopCamera();
});

// ── La cámara se apaga cuando el árbol ya no se ve (26/09/2026) ─────────────────────────────────
// Antes seguía encendida aunque el visitante bajara hasta el footer (y en la página de Atimi el botón
// "Stop hand control" va oculto). Ahora, si el árbol sale por completo de la pantalla durante más de
// un segundo, la cámara se detiene. No se vuelve a encender sola al regresar: se pulsa otra vez
// "Use hand control" (clearPreference evita que la reanude el cambio de pestaña).
if ('IntersectionObserver' in window) {
  let cameraOffscreenTimeout = 0;
  new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    growthStageOnScreen = visible;
    window.clearTimeout(cameraOffscreenTimeout);
    cameraOffscreenTimeout = 0;
    if (visible) return;
    cameraOffscreenTimeout = window.setTimeout(() => {
      cameraOffscreenTimeout = 0;
      if (cameraStream || body.classList.contains('camera-loading')) {
        stopCamera({ message: 'Hand control paused', clearPreference: true });
      } else if (preferredInputMode === 'camera') { preferredInputMode = null; }
    }, 1000);
  }, { threshold: 0 }).observe(growthStage);
}
window.addEventListener('pageshow', (event) => {
  if (event.persisted && preferredInputMode === 'camera' && !cameraStream && growthStageOnScreen) startCamera();
});

reduceMotion.addEventListener?.('change', (event) => {
  frameSequence.setStillOnly((event.matches && !forceAnimate) || lowData);
  ambientPaused = (event.matches && !forceAnimate) || lowData;
  body.classList.toggle('motion-paused', ambientPaused);
  syncAdultLoop(growth >= .985);
});

if (ambientPaused) {
  body.classList.add('motion-paused');
}

// ── Crecimiento automático: una sola vez por visita, al llegar a la sección ──────────────
// Sube del brote al árbol adulto en autoGrowMs (5 s) para que se vea que hay movimiento, y después
// queda en manos del visitante. Se pausa fuera de pantalla, se cancela cuando el visitante TOMA el
// control (modo toque, teclas de crecimiento, hitos o cámara: todos pasan por activateTouchMode o
// startCamera), nunca adelanta a los cuadros que ya llegaron, y con "reducir movimiento" pone el árbol
// adulto. Un toque suelto, un scroll con el dedo que empieza sobre el árbol o un Tab NO lo cancelan:
// no controlan nada y dejaban el árbol congelado a medio crecer.
const autoGrow = { state: autoGrowMs ? 'waiting' : 'off', elapsed: 0, last: 0, visible: false };

function cancelAutoGrow() {
  userControlsGrowth = true;
  if (autoGrow.state === 'waiting' || autoGrow.state === 'running' || autoGrow.state === 'paused') {
    autoGrow.state = 'cancelled';
  }
}

function stepAutoGrow(now) {
  if (autoGrow.state === 'waiting' && autoGrow.visible) {
    if (reducedMotion()) {
      autoGrow.state = 'done';
      setGrowthTarget(1);
      return;
    }
    autoGrow.state = 'running';
    autoGrow.last = now;
  }
  if (autoGrow.state === 'running' && !autoGrow.visible) autoGrow.state = 'paused';
  if (autoGrow.state === 'paused' && autoGrow.visible) { autoGrow.state = 'running'; autoGrow.last = now; }
  if (autoGrow.state !== 'running') return;

  const dt = Math.min(100, now - autoGrow.last);
  autoGrow.last = now;
  const growthAt = (time) => {
    const t = clamp(time / autoGrowMs);
    const eased = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    return GROWTH_STOPS[0] + (1 - GROWTH_STOPS[0]) * eased;
  };
  const currentFrame = frameForGrowth(growthTarget);
  frameSequence.prefetchAhead(currentFrame, 24);
  const reachable = frameSequence.loadedRunFrom(currentFrame);
  const reachableGrowth = GROWTH_STOPS[0] + (1 - GROWTH_STOPS[0]) * (reachable / (FRAME_COUNT - 1));
  // Si el siguiente tramo aún no llegó por la red, el reloj de los 5 s ESPERA: el árbol nunca salta.
  if (growthAt(autoGrow.elapsed + dt) <= reachableGrowth + .004) autoGrow.elapsed += dt;
  setGrowthTarget(Math.max(growthTarget, growthAt(autoGrow.elapsed)));
  if (autoGrow.elapsed >= autoGrowMs) {
    autoGrow.state = 'done';
    setGrowthTarget(1);
  }
}

if (autoGrowMs) {
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => { autoGrow.visible = entry.isIntersecting && entry.intersectionRatio >= .35; });
      if (autoGrow.visible) kick();
    }, { threshold: [0, .35, .6] }).observe(growthStage);
  } else {
    autoGrow.visible = true;
  }
}

// API para la página anfitriona (mismo origen): sus botones controlan el árbol.
window.LivingGrowth = {
  useCamera: () => startCamera(),
  useTouch: () => activateTouchMode(),
  stopCamera: () => stopCamera({ clearPreference: true }),
  state: () => ({ growth, growthTarget, autoGrow: autoGrow.state, mode: body.dataset.inputModeSelected || null })
};

frameSequence.boot();
updateScene(growth);
setInputModeSelection(null);
kick();
