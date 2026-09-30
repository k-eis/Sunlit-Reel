// ── Sunlit Reel エフェクトエンジン（k-eis DESIGN FILTER 00-γ・個人用/非公開）
// 「KODAK DNA」リサーチをもとに、12台のKodakカメラを5つの遺伝子に分解:
// 01 SENSOR     → センサー種別（CCD/CMOS/BSI CMOS）による粒状感・解像感の傾向
// 02 OPTICS     → レンズ構成（単焦点/標準ズーム/超望遠/2眼）による周辺減光・甘さ
// 03 COLOR      → 発色傾向（Vivid/Kodak Color Classic/Natural/Modern）
// 04 PROCESSING → 画像処理世代（初期・強シャープ/洗練・ソフト/現行・クリーン）
// 05 FORM       → 世代・佇まい（DNA MAPの4グループ）による全体のあたたかみ
//
// カメラパッチは「実在する組み合わせ」のショートカットに過ぎず、
// 5つのスライダー自体は独立して自由に動かせる（＝現実にはない組み合わせを楽しむDNA MIXER）

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const outputCanvas = document.getElementById('outputCanvas');
const canvasBadge = document.getElementById('canvasBadge');
const ctx = outputCanvas.getContext('2d');

const axisBtnGroups = document.querySelectorAll('.axis-btn-grid');

// 5つの遺伝子の現在の選択状態（HTML側のactiveボタンの初期値と一致させる）
const geneSelection = { sensor: 0, optics: 1, color: 0, processing: 0, form: 0 };

const adjContrastSlider = document.getElementById('adjContrast');
const adjHighlightSlider = document.getElementById('adjHighlight');
const adjSharpnessSlider = document.getElementById('adjSharpness');
const adjGrainSlider = document.getElementById('adjGrain');
const adjContrastVal = document.getElementById('adjContrastVal');
const adjHighlightVal = document.getElementById('adjHighlightVal');
const adjSharpnessVal = document.getElementById('adjSharpnessVal');
const adjGrainVal = document.getElementById('adjGrainVal');

const compareModeCheckbox = document.getElementById('compareMode');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const themeBtns = document.querySelectorAll('.theme-btn');
const patchBtns = document.querySelectorAll('.profile-btn');

let originalImage = null;
let originalImageData = null;
let previewImageData = null;
let isDragging = false;
let lastResultImageData = null;
let compareTimeout1 = null, compareTimeout2 = null;

// ── 各遺伝子・各選択肢が、最終パラメーターにどれだけ影響するか（差分値）
const SENSOR_DELTA = [
  { grain: 30, sharpness: -5, colorPop: 10 }, // CCD
  { grain: 12, sharpness: 5,  colorPop: 3  }, // CMOS（実機なし・中間区分）
  { grain: 3,  sharpness: 12, colorPop: 0  }, // BSI CMOS
];
const OPTICS_DELTA = [
  { vignette: 8,  cornerSoft: 0,  sharpness: 15  }, // FIXED
  { vignette: 14, cornerSoft: 10, sharpness: 3   }, // STANDARD ZOOM
  { vignette: 18, cornerSoft: 22, sharpness: -10 }, // SUPERZOOM
  { vignette: 30, cornerSoft: 14, sharpness: 0   }, // DUAL-LENS
];
const COLOR_DELTA = [
  { saturation: 35, contrast: 18, colorTemp: 3   }, // VIVID
  { saturation: 25, contrast: 8,  colorTemp: 14  }, // KODAK COLOR CLASSIC
  { saturation: -4, contrast: 0,  colorTemp: 0   }, // NATURAL
  { saturation: 10, contrast: 14, colorTemp: -6  }, // MODERN
];
const PROCESSING_DELTA = [
  { sharpness: 22,  grain: 18,  highlightRolloff: -12 }, // EARLY SHARP+NOISE
  { sharpness: -14, grain: -8,  highlightRolloff: 12  }, // REFINED SOFT
  { sharpness: 8,   grain: -14, highlightRolloff: 4   }, // MODERN CLEAN
];
const FORM_DELTA = [
  { warmGlow: 18, vignette: 8  }, // DIGITAL ORIGIN
  { warmGlow: 9,  vignette: 3  }, // COMPACT / COLOR
  { warmGlow: 4,  vignette: 12 }, // EXPERIMENTAL COMPACT
  { warmGlow: -6, vignette: 0  }, // PIXPRO / NOW
];

const BASE_PARAMS = {
  saturation: 50, colorTemp: 50, contrast: 50, sharpness: 30,
  grain: 0, vignette: 0, cornerSoft: 0, highlightRolloff: 20,
  warmGlow: 0, colorPop: 0,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function computeParams(sel) {
  const p = Object.assign({}, BASE_PARAMS);
  const deltas = [
    SENSOR_DELTA[sel.sensor],
    OPTICS_DELTA[sel.optics],
    COLOR_DELTA[sel.color],
    PROCESSING_DELTA[sel.processing],
    FORM_DELTA[sel.form],
  ];
  deltas.forEach(d => { for (const k in d) p[k] = (p[k] || 0) + d[k]; });

  p.saturation = clamp(p.saturation, 0, 100);
  p.colorTemp = clamp(p.colorTemp, 0, 100);
  p.contrast = clamp(p.contrast, 0, 100);
  p.sharpness = clamp(p.sharpness, 0, 100);
  p.grain = clamp(p.grain, 0, 100);
  p.vignette = clamp(p.vignette, 0, 100);
  p.cornerSoft = clamp(p.cornerSoft, 0, 60);
  p.highlightRolloff = clamp(p.highlightRolloff, 0, 100);
  p.warmGlow = clamp(p.warmGlow, 0, 100);
  p.colorPop = clamp(p.colorPop, 0, 30);
  return p;
}

function currentSelection() {
  return geneSelection;
}

// ボタン選択なのでラベル表示は不要（アクティブなボタン自体が選択状態を示す）

// ── MICRO ADJUST：遺伝子から計算した基準値を「そこからのズレ」の出発点として同期する。
// 遺伝子スライダーを動かすたびに呼ばれ、手動で入れた微調整値は上書き（＝リセット）される
function syncMicroAdjustFromGenes() {
  const base = computeParams(currentSelection());
  adjContrastSlider.value = base.contrast;
  adjHighlightSlider.value = base.highlightRolloff;
  adjSharpnessSlider.value = base.sharpness;
  adjGrainSlider.value = base.grain;
  refreshMicroAdjustLabels();
}

function refreshMicroAdjustLabels() {
  adjContrastVal.textContent = adjContrastSlider.value;
  adjHighlightVal.textContent = adjHighlightSlider.value;
  adjSharpnessVal.textContent = adjSharpnessSlider.value;
  adjGrainVal.textContent = adjGrainSlider.value;
}

// ── ファイル読み込み
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadFile(file);
});
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      setupCanvas(img);
      applySunlitReel();
      dropZone.style.display = 'none';
      canvasBadge.style.display = 'block';
      outputCanvas.style.display = 'block';
      downloadBtn.disabled = false;
      resetBtn.disabled = false;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function setupCanvas(img) {
  const MAX_W = 900;
  let w = img.width, h = img.height;
  if (w > MAX_W) { h = h * (MAX_W / w); w = MAX_W; }
  outputCanvas.width = w;
  outputCanvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  originalImageData = ctx.getImageData(0, 0, w, h);

  const PREVIEW_MAX_W = 320;
  const pScale = Math.min(1, PREVIEW_MAX_W / w);
  const pw = Math.max(1, Math.round(w * pScale));
  const ph = Math.max(1, Math.round(h * pScale));
  const pCanvas = document.createElement('canvas');
  pCanvas.width = pw; pCanvas.height = ph;
  const pCtx = pCanvas.getContext('2d');
  pCtx.drawImage(img, 0, 0, pw, ph);
  previewImageData = pCtx.getImageData(0, 0, pw, ph);
}

// ── 簡易ボックスブラー（水平→垂直の2パス）。SHARPNESS(アンシャープマスク)とCORNER SOFT/GLOWの両方に流用
function boxBlur(src, w, h, radius) {
  if (radius <= 0) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(src.length);
  const tmp = new Float32Array(src.length);
  const size = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    let rSum = 0, gSum = 0, bSum = 0;
    const rowStart = y * w * 4;
    for (let k = -radius; k <= radius; k++) {
      const xx = clamp(k, 0, w - 1);
      const idx = rowStart + xx * 4;
      rSum += src[idx]; gSum += src[idx + 1]; bSum += src[idx + 2];
    }
    for (let x = 0; x < w; x++) {
      const idx = rowStart + x * 4;
      tmp[idx] = rSum / size; tmp[idx + 1] = gSum / size; tmp[idx + 2] = bSum / size;
      const addX = clamp(x + radius + 1, 0, w - 1);
      const subX = clamp(x - radius, 0, w - 1);
      const addIdx = rowStart + addX * 4, subIdx = rowStart + subX * 4;
      rSum += src[addIdx] - src[subIdx];
      gSum += src[addIdx + 1] - src[subIdx + 1];
      bSum += src[addIdx + 2] - src[subIdx + 2];
    }
  }
  for (let x = 0; x < w; x++) {
    let rSum = 0, gSum = 0, bSum = 0;
    for (let k = -radius; k <= radius; k++) {
      const yy = clamp(k, 0, h - 1);
      const idx = yy * w * 4 + x * 4;
      rSum += tmp[idx]; gSum += tmp[idx + 1]; bSum += tmp[idx + 2];
    }
    for (let y = 0; y < h; y++) {
      const idx = y * w * 4 + x * 4;
      out[idx] = rSum / size; out[idx + 1] = gSum / size; out[idx + 2] = bSum / size; out[idx + 3] = src[idx + 3];
      const addY = clamp(y + radius + 1, 0, h - 1);
      const subY = clamp(y - radius, 0, h - 1);
      const addIdx = addY * w * 4 + x * 4, subIdx = subY * w * 4 + x * 4;
      rSum += tmp[addIdx] - tmp[subIdx];
      gSum += tmp[addIdx + 1] - tmp[subIdx + 1];
      bSum += tmp[addIdx + 2] - tmp[subIdx + 2];
    }
  }
  return out;
}

function pseudoRandom2D(x, y) {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function processImage(imageData, params, fast) {
  const w = imageData.width, h = imageData.height;
  const src = imageData.data;
  const out = new Uint8ClampedArray(src);

  const satFactor = (params.saturation - 50) / 50;   // -1〜+1
  const tempFactor = (params.colorTemp - 50) / 50;   // -1〜+1（負：寒色寄り／正：暖色寄り）
  const contrastFactor = 1 + (params.contrast - 50) / 100; // 0.5〜1.5（50が基準＝変化なし）
  const rolloff = params.highlightRolloff / 100;      // 0〜1
  const colorPop = params.colorPop / 100;             // 0〜0.3

  const cx = w / 2, cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const vignetteStrength = params.vignette / 100;

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2];

    // 彩度
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    r = luma + (r - luma) * (1 + satFactor);
    g = luma + (g - luma) * (1 + satFactor);
    b = luma + (b - luma) * (1 + satFactor);

    // CCD由来のカラーポップ（赤を少し持ち上げるCCD特有の色の転び）
    if (colorPop > 0) { r += colorPop * 40; b -= colorPop * 8; }

    // 色温度（暖色/寒色シフト）
    r += tempFactor * 18;
    b -= tempFactor * 18;

    // コントラスト（128中心）
    r = (r - 128) * contrastFactor + 128;
    g = (g - 128) * contrastFactor + 128;
    b = (b - 128) * contrastFactor + 128;

    // ハイライトロールオフ（白飛びを柔らかく粘らせる）
    if (rolloff > 0) {
      const rollFn = (v) => v > 180 ? 180 + (v - 180) * (1 - rolloff * 0.6) : v;
      r = rollFn(r); g = rollFn(g); b = rollFn(b);
    }

    // 周辺減光（VIGNETTE）
    if (vignetteStrength > 0) {
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / maxDist;
      const fall = 1 - vignetteStrength * 0.6 * Math.pow(dist, 2.2);
      r *= fall; g *= fall; b *= fall;
    }

    out[i] = clamp(r, 0, 255);
    out[i + 1] = clamp(g, 0, 255);
    out[i + 2] = clamp(b, 0, 255);
    out[i + 3] = src[i + 3];
  }

  // GRAIN（センサー/処理世代由来の粒状感）
  if (params.grain > 0) {
    const amt = params.grain / 100 * 34;
    for (let i = 0; i < out.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      const n = (pseudoRandom2D(px, py) - 0.5) * amt;
      out[i] = clamp(out[i] + n, 0, 255);
      out[i + 1] = clamp(out[i + 1] + n, 0, 255);
      out[i + 2] = clamp(out[i + 2] + n, 0, 255);
    }
  }

  // SHARPNESS（アンシャープマスク：軽いボックスブラーとの差分を加算）
  if (!fast && params.sharpness !== 0) {
    const blurred = boxBlur(out, w, h, 2);
    const amt = params.sharpness / 100;
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = out[i + c] - blurred[i + c];
        out[i + c] = clamp(out[i + c] + diff * amt * 1.4, 0, 255);
      }
    }
  }

  // CORNER SOFT（安価なズームレンズの周辺の甘さ：四隅だけブレンドで柔らかく）
  if (!fast && params.cornerSoft > 0) {
    const blurred = boxBlur(out, w, h, 4);
    for (let i = 0; i < out.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor((i / 4) / w);
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / maxDist;
      const blend = clamp((dist - 0.55) / 0.45, 0, 1) * (params.cornerSoft / 60);
      for (let c = 0; c < 3; c++) {
        out[i + c] = out[i + c] * (1 - blend) + blurred[i + c] * blend;
      }
    }
  }

  // WARM GLOW（初期世代らしい、あたたかく柔らかいにじみ）
  if (!fast && params.warmGlow > 0) {
    const blurred = boxBlur(out, w, h, 6);
    const amt = params.warmGlow / 100 * 0.35;
    for (let i = 0; i < out.length; i += 4) {
      out[i] = clamp(out[i] * (1 - amt) + (blurred[i] * 1.06) * amt, 0, 255);
      out[i + 1] = clamp(out[i + 1] * (1 - amt) + (blurred[i + 1] * 1.0) * amt, 0, 255);
      out[i + 2] = clamp(out[i + 2] * (1 - amt) + (blurred[i + 2] * 0.92) * amt, 0, 255);
    }
  }

  return new ImageData(out, w, h);
}

function applySunlitReel(fast) {
  if (!originalImageData) return;
  const sel = currentSelection();
  const params = computeParams(sel);
  // MICRO ADJUST：手動で動かした4つはここで遺伝子由来の値を上書きする
  params.contrast = +adjContrastSlider.value;
  params.highlightRolloff = +adjHighlightSlider.value;
  params.sharpness = +adjSharpnessSlider.value;
  params.grain = +adjGrainSlider.value;
  const source = fast ? previewImageData : originalImageData;
  const result = processImage(source, params, fast);

  if (fast) {
    // ドラッグ中：小さいプレビューを引き伸ばして即時反映（velvet-glow方式と同様）
    const tmp = document.createElement('canvas');
    tmp.width = source.width; tmp.height = source.height;
    tmp.getContext('2d').putImageData(result, 0, 0);
    ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, outputCanvas.width, outputCanvas.height);
  } else {
    ctx.putImageData(result, 0, 0);
    lastResultImageData = result;
  }
}

let driftRAF = null;
function requestApply() {
  if (driftRAF) cancelAnimationFrame(driftRAF);
  driftRAF = requestAnimationFrame(() => {
    driftRAF = null;
    if (isDragging) {
      applySunlitReel(true);
    } else {
      const oldText = canvasBadge.textContent;
      canvasBadge.textContent = '処理中… PROCESSING';
      canvasBadge.style.display = originalImageData ? 'block' : 'none';
      setTimeout(() => {
        applySunlitReel(false);
        canvasBadge.textContent = 'PREVIEW';
      }, 10);
    }
  });
}

// setAxisValueが単独の入り口。ボタンクリックでも、パッチ適用でも必ずここを通す
function setAxisValue(axis, value, { fromPatch = false } = {}) {
  geneSelection[axis] = value;
  const group = document.querySelector(`.axis-btn-grid[data-axis="${axis}"]`);
  if (group) {
    group.querySelectorAll('.axis-btn').forEach(b => {
      b.classList.toggle('active', +b.dataset.value === value);
    });
  }
  if (!fromPatch) {
    syncMicroAdjustFromGenes(); // 遺伝子が変わったらMICRO ADJUSTは新しい基準値にリセット
    patchBtns.forEach(b => b.classList.remove('active'));
    requestApply();
  }
}

axisBtnGroups.forEach(group => {
  const axis = group.dataset.axis;
  group.querySelectorAll('.axis-btn').forEach(btn => {
    btn.addEventListener('click', () => setAxisValue(axis, +btn.dataset.value));
  });
});

// MICRO ADJUST側：遺伝子ボタンには触れず、値の上書きだけ行う
[adjContrastSlider, adjHighlightSlider, adjSharpnessSlider, adjGrainSlider].forEach(slider => {
  slider.addEventListener('input', () => {
    refreshMicroAdjustLabels();
    requestApply();
  });
  slider.addEventListener('pointerdown', () => { isDragging = true; });
  window.addEventListener('pointerup', () => {
    if (isDragging) { isDragging = false; requestApply(); }
  });
});

syncMicroAdjustFromGenes();

// ── カメラパッチ：5つの遺伝子ボタンへのショートカット
// 実在する12台の「本来の組み合わせ」。あくまで出発点で、そこから自由に組み替えてよい
const CAMERA_PATCHES = {
  dc4800: { sensor: 0, optics: 1, color: 0, processing: 0, form: 0 },
  dx6490: { sensor: 0, optics: 2, color: 1, processing: 1, form: 0 },
  dx7590: { sensor: 0, optics: 2, color: 2, processing: 1, form: 0 },
  p880:   { sensor: 0, optics: 2, color: 2, processing: 1, form: 0 },
  ls753:  { sensor: 0, optics: 1, color: 0, processing: 0, form: 1 },
  c875:   { sensor: 0, optics: 1, color: 0, processing: 0, form: 1 },
  v570:   { sensor: 0, optics: 3, color: 1, processing: 1, form: 2 },
  v610:   { sensor: 0, optics: 3, color: 1, processing: 1, form: 2 },
  v705:   { sensor: 0, optics: 3, color: 1, processing: 1, form: 2 },
  fz45:   { sensor: 2, optics: 1, color: 3, processing: 2, form: 3 },
  fz55:   { sensor: 2, optics: 1, color: 3, processing: 2, form: 3 },
  c1:     { sensor: 2, optics: 0, color: 3, processing: 2, form: 3 },
};

// ── 個体差クイーク：5遺伝子の組み合わせが同じ機種同士でも、その1台固有の
// 実写観察に基づく小さなクセをMICRO ADJUSTへ上乗せする（B方式）。
// あくまで「遺伝子は同じでも個体ごとに少しクセがある」という体裁の微補正で、
// MICRO ADJUST側の値（表示・操作対象）に直接足し込む
const PATCH_QUIRKS = {
  dc4800: { sharpness: 8,  grain: 6  },  // 初期機らしい強めのシャープ＋アーティファクト傾向
  dx6490: { grain: -8,     contrast: 4 },  // 強いノイズリダクションが効いた滑らかさ
  dx7590: { highlight: 6,  sharpness: -4 }, // 自然な階調、やや柔らかい解像感
  p880:   { sharpness: 6,  grain: -4 },  // 高精細機らしいクリアさ
  ls753:  { contrast: 8,   sharpness: 4 },  // 小型CCDらしいパキッとした発色
  c875:   { contrast: 4,   sharpness: 10, grain: 4 }, // 5倍ズーム機、より鮮やかで強めのシャープ
  v570:   { highlight: -4, grain: 4  },  // 超広角特有の硬めのハイライト
  v610:   { contrast: 2 },               // 薄型ズーム機、標準的な個性
  v705:   { highlight: -8, sharpness: -4 }, // より広角・個性的な光学系
  fz45:   { grain: -2,     sharpness: 2 }, // AA電池機、素直なモダンさ
  fz55:   { contrast: 4,   highlight: 4 }, // 薄型ボディ、少し優しいトーン
  c1:     { contrast: 6,   grain: 2  },  // 固定レンズ機らしい締まった描写
};

function applyPatchQuirk(patchKey) {
  const q = PATCH_QUIRKS[patchKey];
  if (!q) return;
  if (q.contrast)  adjContrastSlider.value  = clamp(+adjContrastSlider.value  + q.contrast,  0, 100);
  if (q.highlight) adjHighlightSlider.value = clamp(+adjHighlightSlider.value + q.highlight, 0, 100);
  if (q.sharpness) adjSharpnessSlider.value = clamp(+adjSharpnessSlider.value + q.sharpness, 0, 100);
  if (q.grain)      adjGrainSlider.value     = clamp(+adjGrainSlider.value     + q.grain,     0, 100);
  refreshMicroAdjustLabels();
}

patchBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const p = CAMERA_PATCHES[btn.dataset.patch];
    if (!p) return;
    const compareOn = compareModeCheckbox.checked;
    const beforeSnapshot = lastResultImageData;

    setAxisValue('sensor', p.sensor, { fromPatch: true });
    setAxisValue('optics', p.optics, { fromPatch: true });
    setAxisValue('color', p.color, { fromPatch: true });
    setAxisValue('processing', p.processing, { fromPatch: true });
    setAxisValue('form', p.form, { fromPatch: true });
    syncMicroAdjustFromGenes();
    applyPatchQuirk(btn.dataset.patch);

    patchBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (driftRAF) { cancelAnimationFrame(driftRAF); driftRAF = null; }
    if (compareTimeout1) { clearTimeout(compareTimeout1); compareTimeout1 = null; }
    if (compareTimeout2) { clearTimeout(compareTimeout2); compareTimeout2 = null; }

    canvasBadge.textContent = '処理中… PROCESSING';
    canvasBadge.style.display = originalImageData ? 'block' : 'none';
    setTimeout(() => {
      applySunlitReel(false);
      canvasBadge.textContent = 'PREVIEW';

      const canCompare = compareOn && beforeSnapshot &&
        beforeSnapshot.width === outputCanvas.width && beforeSnapshot.height === outputCanvas.height;
      if (canCompare) {
        canvasBadge.textContent = 'AFTER（新）';
        compareTimeout1 = setTimeout(() => {
          ctx.putImageData(beforeSnapshot, 0, 0);
          canvasBadge.textContent = 'BEFORE（前）';
          compareTimeout2 = setTimeout(() => {
            if (lastResultImageData) ctx.putImageData(lastResultImageData, 0, 0);
            canvasBadge.textContent = 'PREVIEW';
            compareTimeout2 = null;
          }, 2000);
          compareTimeout1 = null;
        }, 2000);
      }
    }, 10);
  });
});

// ── テーマ切り替え（Kodak Retroが既定＝クラス無し、Yellow/Redはbodyにクラス付与）
themeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    document.body.classList.remove('theme-yellow', 'theme-red');
    if (btn.dataset.theme !== 'retro') {
      document.body.classList.add('theme-' + btn.dataset.theme);
    }
    themeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── ダウンロード
downloadBtn.addEventListener('click', () => {
  try {
    const dataUrl = outputCanvas.toDataURL('image/png');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
      showSaveOverlay(dataUrl);
    } else {
      const link = document.createElement('a');
      link.download = 'sunlit-reel.png';
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.error('PNG保存に失敗しました:', err);
    alert('画像の保存に失敗しました。ブラウザを再読み込みしてもう一度お試しください。');
  }
});

function showSaveOverlay(dataUrl) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position: fixed; inset: 0; z-index: 9999; background: rgba(10,10,10,0.96);
    display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;`;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'max-width: 100%; max-height: 75vh; border-radius: 2px;';
  const hint = document.createElement('p');
  hint.innerHTML = '画像を長押しして「写真に保存」を選んでください<br><span style="color:#888; font-size:11px;">Press and hold the image, then tap "Save to Photos"</span>';
  hint.style.cssText = 'color: #ccc; font-family: sans-serif; font-size: 13px; margin-top: 16px; text-align: center; line-height: 1.6;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる / Close';
  closeBtn.style.cssText = `margin-top: 20px; padding: 10px 24px; background: transparent; color: white; border: 1px solid #666; border-radius: 2px; font-family: sans-serif; font-size: 13px; cursor: pointer;`;
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.appendChild(img); overlay.appendChild(hint); overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
}

resetBtn.addEventListener('click', () => {
  originalImage = null;
  originalImageData = null;
  outputCanvas.style.display = 'none';
  canvasBadge.style.display = 'none';
  dropZone.style.display = 'flex';
  downloadBtn.disabled = true;
  resetBtn.disabled = true;
  fileInput.value = '';
});
