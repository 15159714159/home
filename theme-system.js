// theme-system.js — 记忆管理页专属主题引擎（摘自 Ombre-Brain-folio v2/theme-system.js 并改造）
// 只作用于 #page-log 容器（scope 元素），不碰 document.documentElement，主聊天页黑白灰主题不受影响。
(function () {
  const THEME_STORAGE_KEY = 'nest_memory_theme_v1';

  const PRESETS = [
    {
      id: 'moonlight-purple',
      name: '月光紫',
      desc: '默认 · 冷紫 · 略带粉气',
      vars: {
        '--bg': '#f4f3f7',
        '--paper': '#ffffff',
        '--ink': '#1a1922',
        '--accent': '#6e4f9a',
        '--rose': '#d291b3',
        '--gold': '#d4a85f',
      },
    },
    {
      id: 'rose-metal',
      name: '玫瑰金属',
      desc: '浅玫粉 · 玫瑰金 · 深紫',
      vars: {
        '--bg': '#f4e4e1',
        '--bg-2': '#ead5d1',
        '--paper': '#faeeea',
        '--paper-2': '#ead5d1',
        '--ink': '#3a2530',
        '--ink-3': '#8a6d76',
        '--line': 'rgba(58,37,48,0.08)',
        '--line-2': 'rgba(58,37,48,0.20)',
        '--accent': '#5a3a52',
        '--rose': '#c98a85',
        '--rose-deep': '#8e544f',
        '--gold': '#b87a6a',
      },
    },
    {
      id: 'fairy-candy',
      name: '童话糖纸',
      desc: '奶油底 · 粉紫 · 天青',
      vars: {
        '--bg': '#fffeec',
        '--bg-2': '#fbf6df',
        '--paper': '#ffffff',
        '--paper-2': '#faf6e6',
        '--ink': '#4e416f',
        '--ink-2': '#6b5d8e',
        '--ink-3': '#8e82ad',
        '--ink-4': '#b8aecf',
        '--line': 'rgba(78,65,111,0.10)',
        '--line-2': 'rgba(78,65,111,0.22)',
        '--accent': '#c7bce6',
        '--accent-2': '#eec9ea',
        '--rose': '#eec9ea',
        '--rose-deep': '#b07ab0',
        '--gold': '#b0e8f9',
      },
    },
    {
      id: 'fog-blue',
      name: '雾蓝纸笺',
      desc: '烟蓝 · 浅紫 · 深蓝 ink',
      vars: {
        '--bg': '#f4f3f7',
        '--paper': '#ffffff',
        '--ink': '#3d4a6b',
        '--accent': '#8696bc',
        '--rose': '#d3bdd4',
        '--gold': '#646b9c',
      },
    },
  ];

  const MANAGED_VARS = [
    '--bg', '--bg-2', '--paper', '--paper-2',
    '--ink', '--ink-2', '--ink-3', '--ink-4',
    '--line', '--line-2',
    '--accent', '--accent-2', '--accent-3',
    '--c-accent', '--c-accent-2',
    '--accent-a06', '--accent-a08', '--accent-a10', '--accent-a15', '--accent-a20',
    '--accent-a25', '--accent-a30', '--accent-a40', '--accent-a45', '--accent-a55', '--accent-a60',
    '--rose', '--rose-deep', '--c-rose',
    '--rose-a08', '--rose-a10', '--rose-a12', '--rose-a18', '--rose-a25',
    '--rose-a28', '--rose-a30', '--rose-a45', '--rose-a55', '--rose-a80',
    '--gold', '--gold-soft', '--c-gold',
  ];

  function clearManagedVars(scopeEl) {
    if (!scopeEl) return;
    MANAGED_VARS.forEach(k => scopeEl.style.removeProperty(k));
  }

  const FALLBACK = {
    accent: '#6e4f9a',
    rose: '#d291b3',
    gold: '#d4a85f',
    bg: '#f4f3f7',
    paper: '#ffffff',
    ink: '#1a1922',
  };

  const DARK_FALLBACK = {
    accent: '#a78bd0',
    rose: '#e0a3c4',
    gold: '#a78bd0',
    bg: '#14131c',
    paper: '#1d1c27',
    ink: '#ece9f2',
  };

  function _hexToRgba(hex, alpha) {
    const m = String(hex || '').replace('#', '');
    if (m.length !== 6) return `rgba(110, 79, 154, ${alpha})`;
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  function _shift(hex, delta) {
    const m = String(hex || '').replace('#', '');
    if (m.length !== 6) return hex;
    const clamp = (v) => Math.max(0, Math.min(255, v));
    const r = clamp(parseInt(m.substring(0, 2), 16) + delta);
    const g = clamp(parseInt(m.substring(2, 4), 16) + delta);
    const b = clamp(parseInt(m.substring(4, 6), 16) + delta);
    const hex2 = (n) => n.toString(16).padStart(2, '0');
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }

  function _isDark() {
    return document.documentElement.classList.contains('dark');
  }

  function _scopeEl() {
    return document.getElementById('page-log');
  }

  // null/undefined 字段不动（保留 CSS 默认）；暗色模式下强制走 DARK_FALLBACK
  function applyTheme(colors) {
    if (!colors) return;
    const scopeEl = _scopeEl();
    if (!scopeEl) return;
    if (_isDark()) colors = DARK_FALLBACK;
    clearManagedVars(scopeEl);
    const root = scopeEl.style;
    if (colors.accent) {
      root.setProperty('--accent', colors.accent);
      root.setProperty('--c-accent', colors.accent);
      root.setProperty('--accent-2', _shift(colors.accent, 30));
      root.setProperty('--c-accent-2', _shift(colors.accent, 30));
      root.setProperty('--accent-3', _hexToRgba(colors.accent, 0.10));
      root.setProperty('--accent-a06', _hexToRgba(colors.accent, 0.06));
      root.setProperty('--accent-a08', _hexToRgba(colors.accent, 0.08));
      root.setProperty('--accent-a10', _hexToRgba(colors.accent, 0.10));
      root.setProperty('--accent-a15', _hexToRgba(colors.accent, 0.15));
      root.setProperty('--accent-a20', _hexToRgba(colors.accent, 0.20));
      root.setProperty('--accent-a25', _hexToRgba(colors.accent, 0.25));
      root.setProperty('--accent-a30', _hexToRgba(colors.accent, 0.30));
      root.setProperty('--accent-a40', _hexToRgba(colors.accent, 0.40));
      root.setProperty('--accent-a45', _hexToRgba(colors.accent, 0.45));
      root.setProperty('--accent-a55', _hexToRgba(colors.accent, 0.55));
      root.setProperty('--accent-a60', _hexToRgba(colors.accent, 0.60));
    }
    if (colors.rose) {
      root.setProperty('--rose', colors.rose);
      root.setProperty('--c-rose', colors.rose);
      root.setProperty('--rose-deep', _shift(colors.rose, -30));
      root.setProperty('--rose-a08', _hexToRgba(colors.rose, 0.08));
      root.setProperty('--rose-a10', _hexToRgba(colors.rose, 0.10));
      root.setProperty('--rose-a12', _hexToRgba(colors.rose, 0.12));
      root.setProperty('--rose-a18', _hexToRgba(colors.rose, 0.18));
      root.setProperty('--rose-a25', _hexToRgba(colors.rose, 0.25));
      root.setProperty('--rose-a28', _hexToRgba(colors.rose, 0.28));
      root.setProperty('--rose-a30', _hexToRgba(colors.rose, 0.30));
      root.setProperty('--rose-a45', _hexToRgba(colors.rose, 0.45));
      root.setProperty('--rose-a55', _hexToRgba(colors.rose, 0.55));
      root.setProperty('--rose-a80', _hexToRgba(colors.rose, 0.80));
    }
    if (colors.gold) {
      root.setProperty('--gold', colors.gold);
      root.setProperty('--c-gold', colors.gold);
      root.setProperty('--gold-soft', _shift(colors.gold, 40));
    }
    if (colors.bg) {
      root.setProperty('--bg', colors.bg);
      root.setProperty('--bg-2', _shift(colors.bg, -8));
    }
    if (colors.paper) {
      root.setProperty('--paper', colors.paper);
      root.setProperty('--paper-2', _shift(colors.paper, -8));
    }
    if (colors.ink) {
      root.setProperty('--ink', colors.ink);
    }
  }

  function applyPreset(preset) {
    if (!preset || !preset.vars) return;
    const scopeEl = _scopeEl();
    if (!scopeEl) return;
    if (_isDark()) { applyTheme(DARK_FALLBACK); return; }
    clearManagedVars(scopeEl);
    const root = scopeEl.style;
    Object.entries(preset.vars).forEach(([k, v]) => root.setProperty(k, v));
    const accent = preset.vars['--accent'];
    if (accent) {
      const alphaSpecs = [
        ['--accent-a06', 0.06], ['--accent-a08', 0.08], ['--accent-a10', 0.10],
        ['--accent-a15', 0.15], ['--accent-a20', 0.20], ['--accent-a25', 0.25],
        ['--accent-a30', 0.30], ['--accent-a40', 0.40], ['--accent-a45', 0.45],
        ['--accent-a55', 0.55], ['--accent-a60', 0.60], ['--accent-3', 0.10],
      ];
      alphaSpecs.forEach(([k, a]) => {
        if (preset.vars[k] === undefined) root.setProperty(k, _hexToRgba(accent, a));
      });
      if (preset.vars['--accent-2'] === undefined) root.setProperty('--accent-2', _shift(accent, 30));
      root.setProperty('--c-accent', accent);
      if (preset.vars['--c-accent-2'] === undefined) root.setProperty('--c-accent-2', _shift(accent, 30));
    }
    const rose = preset.vars['--rose'];
    if (rose) {
      const roseSpecs = [
        ['--rose-a08', 0.08], ['--rose-a10', 0.10], ['--rose-a12', 0.12],
        ['--rose-a18', 0.18], ['--rose-a25', 0.25], ['--rose-a28', 0.28],
        ['--rose-a30', 0.30], ['--rose-a45', 0.45], ['--rose-a55', 0.55],
        ['--rose-a80', 0.80],
      ];
      roseSpecs.forEach(([k, a]) => {
        if (preset.vars[k] === undefined) root.setProperty(k, _hexToRgba(rose, a));
      });
      if (preset.vars['--rose-deep'] === undefined) root.setProperty('--rose-deep', _shift(rose, -30));
      root.setProperty('--c-rose', rose);
    }
    const gold = preset.vars['--gold'];
    if (gold) {
      if (preset.vars['--gold-soft'] === undefined) root.setProperty('--gold-soft', _shift(gold, 40));
      root.setProperty('--c-gold', gold);
    }
    if (preset.vars['--bg'] && preset.vars['--bg-2'] === undefined) {
      root.setProperty('--bg-2', _shift(preset.vars['--bg'], -8));
    }
    if (preset.vars['--paper'] && preset.vars['--paper-2'] === undefined) {
      root.setProperty('--paper-2', _shift(preset.vars['--paper'], -8));
    }
  }

  function loadTheme() {
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function saveTheme(state) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function getCurrentColors(state) {
    if (!state) return { ...FALLBACK };
    const p = PRESETS.find(x => x.id === state.preset);
    if (!p) return { ...FALLBACK };
    return {
      accent: p.vars['--accent'] || FALLBACK.accent,
      rose: p.vars['--rose'] || FALLBACK.rose,
      gold: p.vars['--gold'] || FALLBACK.gold,
      bg: p.vars['--bg'] || FALLBACK.bg,
      paper: p.vars['--paper'] || FALLBACK.paper,
      ink: p.vars['--ink'] || FALLBACK.ink,
    };
  }

  function applyCurrent(state) {
    if (_isDark()) { applyTheme(DARK_FALLBACK); return; }
    if (!state) { applyTheme(FALLBACK); return; }
    const p = PRESETS.find(x => x.id === state.preset);
    if (!p) { applyTheme(FALLBACK); return; }
    applyPreset(p);
  }

  window.OB_THEME = {
    PRESETS,
    FALLBACK,
    DARK_FALLBACK,
    applyTheme,
    applyPreset,
    applyCurrent,
    loadTheme,
    saveTheme,
    getCurrentColors,
  };
})();
