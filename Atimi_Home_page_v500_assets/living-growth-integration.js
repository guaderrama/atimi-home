/* Living Growth V4 dentro del diseño de Atimi (Ivan Guaderrama Studio, 24/09/2026).
 *
 * La página de Atimi construye su propia sección del árbol: el marco (figure.living-growth-image) con
 * una imagen fija, sus instrucciones encima, "Growth is in your hands" y sus botones lima. Aquí NO se
 * sustituye nada de eso: solo se pone el árbol animado DENTRO de su marco (en lugar de la imagen fija)
 * y sus botones pasan a controlarlo. Si la experiencia no carga, vuelve a verse su imagen fija.
 */
(function () {
  'use strict';

  var integrationScript = document.currentScript;
  var EXPERIENCE_URL = (integrationScript && integrationScript.getAttribute('data-living-growth-url'))
    || './living-growth/?embed=1&controls=external&autogrow=5000&version=4&updated=2026-09-24';
  var RELEASE_VERSION = '4';
  var RELEASE_DATE = '2026-09-24';
  var LOAD_TIMEOUT_MS = 20000;
  var observer = null;

  function mount() {
    var placeholder = document.querySelector('#digital-evolution .living-growth-placeholder');
    var figure = placeholder && placeholder.querySelector('.living-growth-image');
    var panel = placeholder && placeholder.querySelector('.living-growth-mode-panel');
    if (!placeholder || !figure || !panel) return false;
    if (figure.querySelector('.atimi-living-growth-frame')) return true;

    var buttons = panel.querySelectorAll('.living-growth-control[data-living-mode]');
    var instructions = placeholder.querySelectorAll('.living-growth-mode-instruction');

    placeholder.classList.add('atimi-living-growth-live');
    placeholder.setAttribute('data-living-growth-version', RELEASE_VERSION);
    placeholder.setAttribute('data-living-growth-updated', RELEASE_DATE);
    placeholder.setAttribute('data-living-growth-state', 'loading');

    // Textos (26/09/2026). Su maqueta se anunciaba a los lectores de pantalla como "placeholder" de una
    // imagen fija: con el árbol vivo ya no lo es. Y su instrucción de toque decía "desliza" aunque el
    // árbol solo responde al dedo después de pulsar "Use touch": se escribe en pasos, como la de la mano.
    // Si la experiencia no carga (lg-error), vuelven sus textos originales junto con su imagen fija.
    var caption = figure.querySelector('figcaption');
    var touchSteps = placeholder.querySelector('.living-growth-mode-instruction--touch p');
    var originalTexts = {
      label: placeholder.getAttribute('aria-label'),
      caption: caption ? caption.textContent : null
    };
    var touchList = null;
    placeholder.setAttribute('aria-label', 'Living Growth interaction');
    if (caption) caption.textContent = 'Living Growth interactive experience.';
    if (touchSteps) {
      touchList = document.createElement('ol');
      touchList.className = 'atimi-living-growth-touch-steps';
      touchList.innerHTML = '<li>Click on Use touch</li><li>Slide your finger/<br>mouse up or down</li>';
      touchSteps.replaceWith(touchList);
    }
    function restoreTexts() {
      if (originalTexts.label === null) placeholder.removeAttribute('aria-label');
      else placeholder.setAttribute('aria-label', originalTexts.label);
      if (caption && originalTexts.caption !== null) caption.textContent = originalTexts.caption;
      if (touchList && touchSteps) touchList.replaceWith(touchSteps);
    }

    var frame = document.createElement('iframe');
    frame.className = 'atimi-living-growth-frame';
    // ?animar=1 en la página también anima el árbol con "reducir movimiento" (27/09/2026).
    frame.src = EXPERIENCE_URL + (/[?&]animar=1(&|$)/.test(window.location.search) ? '&animar=1' : '');
    frame.title = 'Interactive eucalyptus: it grows once, then you grow it with your hand or touch';
    frame.setAttribute('allow', 'camera');
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('scrolling', 'no');
    figure.insertBefore(frame, figure.firstChild);

    // Su script marca "Use hand control" como pulsado al cargar (setMode('hand')) aunque la cámara no
    // está encendida, y un lector de pantalla lo anunciaba "activado". Mientras nadie elija, ninguno va
    // pulsado; se repite un fotograma después por si su script corre detrás de este montaje.
    function clearInitialMode() {
      if (placeholder.getAttribute('data-living-instructions-selected') === 'true') return;
      buttons.forEach(function (button) { button.setAttribute('aria-pressed', 'false'); });
      placeholder.removeAttribute('data-living-growth-mode');
    }
    clearInitialMode();
    window.requestAnimationFrame(clearInitialMode);

    var pending = null;
    function api() {
      try { return frame.contentWindow && frame.contentWindow.LivingGrowth; } catch (_error) { return null; }
    }
    function run(action) {
      var target = api();
      if (target && typeof target[action] === 'function') target[action]();
      else pending = action;             // el árbol aún carga: se hace en cuanto esté listo
    }

    // Sus botones controlan el árbol (sus propios manejadores siguen marcando el botón activo).
    // "Use hand control" funciona como interruptor (26/09/2026): si la cámara ya está encendida (o
    // arrancando), pulsarlo otra vez la apaga. Solo con un clic real (teclado incluido): su aviso
    // "Growth is in your hands. Try me" llama a handControl.click() y nunca debe apagarla.
    buttons.forEach(function (button) {
      button.addEventListener('click', function (event) {
        if (placeholder.classList.contains('lg-error')) return;   // sin árbol, como en el original
        var hand = button.getAttribute('data-living-mode') === 'hand';
        var target = api();
        var state = target && typeof target.state === 'function' ? target.state() : null;
        if (hand && event.isTrusted && state && state.mode === 'camera') { run('stopCamera'); return; }
        run(hand ? 'useCamera' : 'useTouch');
      });
    });

    // Y el árbol avisa si cambió de modo por su cuenta (p. ej. la cámara falló y pasó a toque).
    // Sin modo (la cámara se apagó: interruptor, árbol fuera de pantalla, pestaña oculta) los botones
    // dejan de verse pulsados y vuelven las dos instrucciones, como al llegar a la sección.
    function reflectMode(mode) {
      var hostMode = mode === 'camera' ? 'hand' : mode === 'touch' ? 'touch' : null;
      if (!hostMode) {
        buttons.forEach(function (button) { button.setAttribute('aria-pressed', 'false'); });
        placeholder.removeAttribute('data-living-growth-mode');
        placeholder.removeAttribute('data-living-instructions-selected');
        instructions.forEach(function (instruction) { instruction.removeAttribute('aria-hidden'); });
        return;
      }
      buttons.forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-living-mode') === hostMode));
      });
      placeholder.setAttribute('data-living-growth-mode', hostMode);
      placeholder.setAttribute('data-living-instructions-selected', 'true');
      instructions.forEach(function (instruction) {
        instruction.setAttribute('aria-hidden',
          String(!instruction.classList.contains('living-growth-mode-instruction--' + hostMode)));
      });
    }
    window.addEventListener('message', function (event) {
      if (event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
      var data = event.data;
      if (data && data.source === 'living-growth' && data.type === 'mode') reflectMode(data.mode || null);
    });

    var finished = false;
    var timeoutId = 0;
    function finish(state) {
      if (finished) return;
      finished = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      placeholder.setAttribute('data-living-growth-state', state);
      if (state === 'error') {   // vuelve a verse su imagen fija, con sus textos
        placeholder.classList.add('lg-error');
        restoreTexts();
        // Un árbol que llegue tarde ya no puede encender la cámara ni seguir descargando (27/09/2026).
        frame.remove();
      }
      if (state === 'ready' && pending) { var action = pending; pending = null; run(action); }
    }
    frame.addEventListener('load', function () {
      window.requestAnimationFrame(function () { finish(api() ? 'ready' : 'error'); });
    }, { once: true });
    frame.addEventListener('error', function () { finish('error'); }, { once: true });

    if ('IntersectionObserver' in window) {
      var visibilityObserver = new IntersectionObserver(function (entries) {
        if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
        visibilityObserver.disconnect();
        // Si el árbol ya arrancó (su aviso de carga puede no llegar, p. ej. con la fuente de Google
        // colgada), no se esconde: solo se da por fallido si de verdad no está (27/09/2026).
        timeoutId = window.setTimeout(function () { finish(api() ? 'ready' : 'error'); }, LOAD_TIMEOUT_MS);
      }, { rootMargin: '600px 0px' });
      visibilityObserver.observe(figure);
    } else {
      timeoutId = window.setTimeout(function () { finish(api() ? 'ready' : 'error'); }, LOAD_TIMEOUT_MS);
    }
    return true;
  }

  function initialize() {
    if (mount()) return;
    if (!('MutationObserver' in window)) return;
    // La sección la construyen los scripts de Atimi al cargar: se espera a que exista.
    observer = new MutationObserver(function () {
      if (mount()) { observer.disconnect(); observer = null; }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
