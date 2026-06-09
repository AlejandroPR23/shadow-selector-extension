// v4 — match counter + YAML generator + data-tour injector + history + keyboard shortcuts
(function () {

  if (window.__shadowUIActive) return;
  window.__shadowUIActive = true;

  // ─────────────────────────────────────────────
  // SELECTOR BUILDER
  // ─────────────────────────────────────────────

  function getElementSelector(el, mode) {
    if (!(el instanceof Element)) return null;
    if (el.dataset && el.dataset.tour) return `[data-tour="${el.dataset.tour}"]`;
    if (el.id) return `#${el.id}`;

    const tag     = el.tagName.toLowerCase();
    const isCustom = tag.includes('-');
    const classes = Array.from(el.classList || []).filter(Boolean);

    if (mode === 'short') {
      if (isCustom) return tag;
      if (classes.length) return `.${classes[0]}`;
      return tag;
    }
    if (mode === 'medium') {
      if (isCustom) return tag;
      if (classes.length) return `${tag}.${classes[0]}`;
      return tag;
    }
    // long
    if (isCustom) return tag;
    if (classes.length) return `${tag}.${classes.slice(0, 3).join('.')}`;
    return tag;
  }

  function buildSelector(composedPath, mode) {
    const parts = [];
    let segment = [];
    let isInner = true;

    for (const node of composedPath) {
      if (
        node instanceof Window ||
        node instanceof Document ||
        node === document.documentElement ||
        node === document.body
      ) break;

      if (node instanceof ShadowRoot) {
        if (segment.length > 0) {
          parts.push(partFromSegment(segment, isInner, mode));
          isInner = false;
          segment = [];
        }
      } else if (node instanceof Element) {
        segment.push(node);
      }
    }

    if (segment.length > 0) {
      parts.push(partFromSegment(segment, isInner, mode));
    }

    return parts.reverse().filter(Boolean).join(' >> ');
  }

  function partFromSegment(segment, isInner, mode) {
    if (isInner) {
      const target = segment[0];
      const sel    = getElementSelector(target, mode);
      if (sel.startsWith('#') || sel.startsWith('[data-tour=')) return sel;
      const ctx = segment.slice(1).find(el => (el.dataset && el.dataset.tour) || el.id);
      if (ctx) return `${getElementSelector(ctx, mode)} ${sel}`;
      return sel;
    }
    const shadowHost = segment[0];
    const hostSel    = getElementSelector(shadowHost, mode);
    if (hostSel.startsWith('#') || hostSel.startsWith('[data-tour=')) return hostSel;
    const ctxEl = segment.slice(1).find(el => (el.dataset && el.dataset.tour) || el.id);
    if (ctxEl) return `${getElementSelector(ctxEl, mode)} ${hostSel}`;
    return hostSel;
  }

  function countShadowDepth(path) {
    return path.filter(n => n instanceof ShadowRoot).length;
  }

  // ─────────────────────────────────────────────
  // REAL-DOM PATH BUILDER
  //
  // composedPath() sigue la propagación del evento, que atraviesa slots y
  // expone shadow roots que el querySelector real no ve. Para generar
  // selectores compatibles con querySelector (como los que usa guided_tour),
  // necesitamos recorrer el DOM real con parentNode + getRootNode().
  //
  // Esto distingue correctamente entre:
  //   - hijo light DOM de un WC (mismo segmento, sin >>)
  //   - hijo real del shadow root de un WC (nuevo segmento, con >>)
  // ─────────────────────────────────────────────

  function buildRealPath(el) {
    const path = [];
    let current = el;

    while (current) {
      if (
        current instanceof Window ||
        current instanceof Document ||
        current === document.documentElement ||
        current === document.body
      ) break;

      if (current instanceof Element) {
        path.push(current);
      }

      const parent = current.parentNode;
      if (!parent) break;

      if (parent instanceof ShadowRoot) {
        // Boundary real: marcamos el shadow root y saltamos al host.
        path.push(parent);
        current = parent.host;
      } else {
        current = parent;
      }
    }

    return path;
  }

  // ─────────────────────────────────────────────
  // MATCH COUNTER
  // Cuenta cuántos elementos matchea un selector,
  // incluyendo >> para shadow DOM.
  // ─────────────────────────────────────────────

  function countMatches(selector) {
    if (!selector) return 0;
    try {
      if (!selector.includes(' >> ')) {
        return document.querySelectorAll(selector).length;
      }
      // Shadow DOM: recorrer los segmentos
      const parts   = selector.split(' >> ').map(s => s.trim());
      let contexts = [document];

      for (const part of parts) {
        const nextContexts = [];
        for (const ctx of contexts) {
          const matches = ctx.querySelectorAll(part);
          matches.forEach(el => {
            if (el.shadowRoot) nextContexts.push(el.shadowRoot);
            else nextContexts.push(el);
          });
        }
        contexts = nextContexts;
      }
      return contexts.length;
    } catch {
      return -1; // selector inválido
    }
  }

  function matchBadge(count) {
    if (count === -1) return { text: 'Invalid', color: '#ef4444' };
    if (count === 0)  return { text: '0 matches — not found', color: '#ef4444' };
    if (count === 1)  return { text: '✓ Unique', color: '#22c55e' };
    return { text: `⚠ ${count} matches`, color: '#f59e0b' };
  }

  // ─────────────────────────────────────────────
  // YAML GENERATOR
  // ─────────────────────────────────────────────

  function generateYaml(selector, position = 'bottom') {
    return `- id: step-nuevo
  title: ''
  text: ''
  attachTo:
    element: '${selector}'
    on: ${position}
  buttons:
    - text: 'Anterior'
      type: back
    - text: 'Siguiente'
      type: next`;
  }

  // ─────────────────────────────────────────────
  // HISTORY
  // ─────────────────────────────────────────────

  const history = [];
  const MAX_HISTORY = 5;

  function addToHistory(selectors, label) {
    history.unshift({ selectors, label, time: Date.now() });
    if (history.length > MAX_HISTORY) history.pop();
    renderHistory();
  }

  function renderHistory() {
    const container = document.getElementById('sh-history-list');
    if (!container) return;
    if (history.length === 0) {
      container.innerHTML = '<span style="opacity:0.4">Sin historial aún</span>';
      return;
    }
    container.innerHTML = history.map((item, i) => `
      <div class="sh-history-item" data-index="${i}">
        <span class="sh-history-label">${item.label || item.selectors.medium}</span>
        <button class="sh-history-restore" data-index="${i}">↩</button>
      </div>
    `).join('');
  }

  // ─────────────────────────────────────────────
  // UI — PANEL
  // ─────────────────────────────────────────────

  const panel = document.createElement('div');
  panel.id = 'shadow-helper-panel';
  panel.innerHTML = `
    <div class="sh-header">
      <span class="sh-title">Shadow Selector</span>
      <div class="sh-controls">
        <span id="sh-shortcut-hint" class="sh-hint">Alt+S · Esc</span>
        <button id="sh-toggle" class="sh-btn sh-btn--active">Activo</button>
      </div>
    </div>

    <div class="sh-depth-bar">
      <span id="sh-depth"></span>
    </div>

    <div class="sh-selectors">
      <div class="sh-row">
        <span class="sh-label">SHORT</span>
        <span class="sh-selector-text" id="s-short"></span>
        <span class="sh-badge" id="b-short"></span>
        <button class="sh-copy" data-copy="short">Copy</button>
      </div>
      <div class="sh-row">
        <span class="sh-label">MED</span>
        <span class="sh-selector-text" id="s-medium"></span>
        <span class="sh-badge" id="b-medium"></span>
        <button class="sh-copy" data-copy="medium">Copy</button>
      </div>
      <div class="sh-row">
        <span class="sh-label">LONG</span>
        <span class="sh-selector-text" id="s-long"></span>
        <span class="sh-badge" id="b-long"></span>
        <button class="sh-copy" data-copy="long">Copy</button>
      </div>
    </div>

    <div class="sh-divider"></div>

    <div class="sh-yaml-section">
      <div class="sh-yaml-header">
        <span class="sh-label">YAML</span>
        <div class="sh-yaml-controls">
          <select id="sh-yaml-mode" class="sh-select">
            <option value="medium" selected>Medium</option>
            <option value="short">Short</option>
            <option value="long">Long</option>
          </select>
          <select id="sh-yaml-pos" class="sh-select">
            <option value="bottom" selected>bottom</option>
            <option value="top">top</option>
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
          <button class="sh-copy sh-btn--yaml" id="sh-copy-yaml">Copy YAML</button>
        </div>
      </div>
      <pre class="sh-yaml-preview" id="sh-yaml-preview"></pre>
    </div>

    <div class="sh-divider"></div>

    <div class="sh-inject-section">
      <span class="sh-label">data-tour inyector</span>
      <div class="sh-inject-row">
        <input type="text" id="sh-tour-name" class="sh-input" placeholder="nombre-del-elemento" />
        <button id="sh-inject-btn" class="sh-btn sh-btn--inject">Añadir</button>
      </div>
      <span class="sh-hint" id="sh-inject-hint">Haz clic en un elemento y escribe el nombre</span>
    </div>

    <div class="sh-divider"></div>

    <div class="sh-history-section">
      <span class="sh-label">Historial</span>
      <div id="sh-history-list" class="sh-history-list">
        <span style="opacity:0.4">Sin historial aún</span>
      </div>
    </div>

    <div class="sh-footer">
      <button id="sh-unlock" style="display:none" class="sh-btn sh-btn--unlock">🔓 Desbloquear</button>
    </div>
  `;
  document.body.appendChild(panel);

  const highlight = document.createElement('div');
  highlight.id = 'shadow-highlight';
  document.body.appendChild(highlight);

  // ─────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────

  let active         = true;
  let locked         = false;
  let lastSelectors  = {};
  let lastElement    = null;

  // ─────────────────────────────────────────────
  // HIGHLIGHT — corregido para scroll
  // ─────────────────────────────────────────────

  function updateHighlight(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    Object.assign(highlight.style, {
      top:     (rect.top  + window.scrollY) + 'px',
      left:    (rect.left + window.scrollX) + 'px',
      width:   rect.width  + 'px',
      height:  rect.height + 'px',
      display: 'block',
    });
  }

  // Actualizar highlight al hacer scroll (fix del bug original)
  window.addEventListener('scroll', () => {
    if (lastElement) updateHighlight(lastElement);
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (lastElement) updateHighlight(lastElement);
  }, { passive: true });

  // ─────────────────────────────────────────────
  // UPDATE UI
  // ─────────────────────────────────────────────

  function updateUI(path, el) {
    if (!(el instanceof Element)) return;
    lastElement = el;
    updateHighlight(el);

    const depth = countShadowDepth(path);
    const depthEl = document.getElementById('sh-depth');
    if (depthEl) {
      depthEl.textContent = depth > 0
        ? `${depth} shadow ${depth === 1 ? 'nivel' : 'niveles'}`
        : 'Light DOM';
    }

    const short  = buildSelector(path, 'short');
    const medium = buildSelector(path, 'medium');
    const long   = buildSelector(path, 'long');
    lastSelectors = { short, medium, long };

    // Selectors
    ['short', 'medium', 'long'].forEach(mode => {
      const sel   = lastSelectors[mode];
      const count = countMatches(sel);
      const badge = matchBadge(count);

      const textEl  = document.getElementById(`s-${mode}`);
      const badgeEl = document.getElementById(`b-${mode}`);
      if (textEl)  textEl.textContent = sel;
      if (badgeEl) {
        badgeEl.textContent = badge.text;
        badgeEl.style.color = badge.color;
      }
    });

    updateYamlPreview();
  }

  function updateYamlPreview() {
    const modeEl = document.getElementById('sh-yaml-mode');
    const posEl  = document.getElementById('sh-yaml-pos');
    const preEl  = document.getElementById('sh-yaml-preview');
    if (!modeEl || !posEl || !preEl) return;

    const mode = modeEl.value;
    const pos  = posEl.value;
    const sel  = lastSelectors[mode] || '';
    preEl.textContent = sel ? generateYaml(sel, pos) : '— selecciona un elemento —';
  }

  // ─────────────────────────────────────────────
  // EVENTOS DE PÁGINA
  // ─────────────────────────────────────────────

  document.addEventListener('mousemove', (e) => {
    if (!active || locked) return;
    const composedPath = e.composedPath();
    const el = composedPath.find(n => n instanceof Element && !panel.contains(n) && n !== panel);
    if (el) updateUI(buildRealPath(el), el);
  });

  document.addEventListener('click', (e) => {
    if (!active) return;
    if (panel.contains(e.target) || e.target === panel) return;

    e.preventDefault();
    e.stopPropagation();

    const composedPath = e.composedPath();
    const el = composedPath.find(n => n instanceof Element && !panel.contains(n) && n !== panel);
    if (!el) return;

    locked = true;
    const unlockBtn = document.getElementById('sh-unlock');
    if (unlockBtn) unlockBtn.style.display = '';
    updateUI(buildRealPath(el), el);
    addToHistory(lastSelectors, lastSelectors.medium);
  }, true);

  // ─────────────────────────────────────────────
  // KEYBOARD SHORTCUTS
  // ─────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    // Escape → desbloquear
    if (e.key === 'Escape' && locked) {
      locked = false;
      const unlockBtn = document.getElementById('sh-unlock');
      if (unlockBtn) unlockBtn.style.display = 'none';
      return;
    }

    // Alt+S → toggle activo/inactivo
    if (e.altKey && e.key === 's') {
      e.preventDefault();
      toggleActive();
    }
  });

  function toggleActive() {
    active = !active;
    locked = false;
    const toggleBtn = document.getElementById('sh-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = active ? 'Activo' : 'Inactivo';
      toggleBtn.classList.toggle('sh-btn--active', active);
      toggleBtn.classList.toggle('sh-btn--inactive', !active);
    }
    highlight.style.display = active ? 'block' : 'none';
    const unlockBtn = document.getElementById('sh-unlock');
    if (unlockBtn) unlockBtn.style.display = 'none';
  }

  // ─────────────────────────────────────────────
  // EVENTOS DEL PANEL
  // ─────────────────────────────────────────────

  panel.addEventListener('click', (e) => {
    // Copiar selector
    const copyType = e.target.dataset.copy;
    if (copyType && lastSelectors[copyType]) {
      navigator.clipboard.writeText(lastSelectors[copyType]).then(() => {
        const orig = e.target.textContent;
        e.target.textContent = '✓';
        setTimeout(() => { e.target.textContent = orig; }, 1400);
      });
    }

    // Copiar YAML
    if (e.target.id === 'sh-copy-yaml') {
      const yaml = document.getElementById('sh-yaml-preview')?.textContent;
      if (yaml && yaml !== '— selecciona un elemento —') {
        navigator.clipboard.writeText(yaml).then(() => {
          const orig = e.target.textContent;
          e.target.textContent = '✓ Copiado';
          setTimeout(() => { e.target.textContent = orig; }, 1400);
        });
      }
    }

    // Toggle activo
    if (e.target.id === 'sh-toggle') {
      toggleActive();
    }

    // Desbloquear
    if (e.target.id === 'sh-unlock') {
      locked = false;
      e.target.style.display = 'none';
    }

    // Inyectar data-tour
    if (e.target.id === 'sh-inject-btn') {
      const nameInput = document.getElementById('sh-tour-name');
      const hint      = document.getElementById('sh-inject-hint');
      const name      = nameInput?.value?.trim();

      if (!lastElement) {
        if (hint) { hint.textContent = '⚠ Primero haz clic en un elemento'; hint.style.color = '#f59e0b'; }
        return;
      }
      if (!name) {
        if (hint) { hint.textContent = '⚠ Escribe un nombre primero'; hint.style.color = '#f59e0b'; }
        return;
      }

      lastElement.setAttribute('data-tour', name);
      if (nameInput) nameInput.value = '';
      if (hint) {
        hint.textContent = `✓ data-tour="${name}" añadido`;
        hint.style.color = '#22c55e';
        setTimeout(() => {
          hint.textContent = 'Haz clic en un elemento y escribe el nombre';
          hint.style.color = '';
        }, 2500);
      }

      // Re-calcular selector con el nuevo atributo
      const path = [];
      let node = lastElement;
      while (node) {
        path.push(node);
        node = node.parentElement || (node.getRootNode() instanceof ShadowRoot ? node.getRootNode() : null);
      }
      // Forzar recálculo simple usando el nuevo data-tour
      lastSelectors = {
        short:  `[data-tour="${name}"]`,
        medium: `[data-tour="${name}"]`,
        long:   `[data-tour="${name}"]`,
      };
      ['short', 'medium', 'long'].forEach(mode => {
        const textEl  = document.getElementById(`s-${mode}`);
        const badgeEl = document.getElementById(`b-${mode}`);
        if (textEl) textEl.textContent = lastSelectors[mode];
        const count = countMatches(lastSelectors[mode]);
        const badge = matchBadge(count);
        if (badgeEl) { badgeEl.textContent = badge.text; badgeEl.style.color = badge.color; }
      });
      updateYamlPreview();
    }

    // Restaurar historial
    if (e.target.classList.contains('sh-history-restore')) {
      const index = parseInt(e.target.dataset.index, 10);
      if (!isNaN(index) && history[index]) {
        lastSelectors = history[index].selectors;
        ['short', 'medium', 'long'].forEach(mode => {
          const textEl  = document.getElementById(`s-${mode}`);
          const badgeEl = document.getElementById(`b-${mode}`);
          if (textEl) textEl.textContent = lastSelectors[mode];
          const count = countMatches(lastSelectors[mode]);
          const badge = matchBadge(count);
          if (badgeEl) { badgeEl.textContent = badge.text; badgeEl.style.color = badge.color; }
        });
        updateYamlPreview();
      }
    }
  });

  // YAML se actualiza al cambiar modo o posición
  ['sh-yaml-mode', 'sh-yaml-pos'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateYamlPreview);
  });

  // Render historial inicial
  renderHistory();

})();