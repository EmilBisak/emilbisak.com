// WebGL backdrop: a ribbon of thin glowing lines that runs down the whole page.
// The ribbon lives in page space, so scrolling travels along it: bright beside the hero,
// then wandering behind the content. Plain WebGL, no library: two programs, two draw calls.
// Reads window.flow (main.js) for pointer, scroll stepping and reduced motion.

const F = window.flow;
const MAX_KEYS = 10;

/* ---------- Shaders ---------- */
const RIBBON_COMMON = /* glsl */ `
uniform vec2 uRes;
uniform float uUnit; // stable screen height: ignores mobile toolbar resizes
uniform float uPx; // CSS px per device pixel
uniform float uScroll;
uniform float uTime;
uniform float uSpeed; // smoothed scroll speed, 0 (still) .. 1 (fast)
uniform vec3 uPointer; // xy in px, z = glow strength (0..1)
uniform float uAnchor[${MAX_KEYS}];
uniform vec4 uKeyA[${MAX_KEYS}]; // x (-1..1), spread (x width), blur (0..1), alpha
uniform vec4 uKeyB[${MAX_KEYS}]; // twist, hue, meander (0 = hold x, 1 = wander), focus drift
uniform float uBlend;

// Ribbon settings at a screen y: later anchors take over as they scroll past
void params(float y, out vec4 a, out vec4 b) {
    a = uKeyA[0];
    b = uKeyB[0];
    for (int i = 1; i < ${MAX_KEYS}; i++) {
        float k = smoothstep(uAnchor[i] - uBlend, uAnchor[i] + uBlend, y);
        a = mix(a, uKeyA[i], k);
        b = mix(b, uKeyB[i], k);
    }
    // Drift in and out of focus along the page, like a slow depth of field
    float doc = y + uScroll;
    a.z = clamp(a.z + b.w * sin(doc * 6.2832 / (uUnit * 1.9) + 0.7), 0.0, 1.0);
}

// Strands twist around each other like a ribbon turning in space (1 = flat, 0 = edge-on)
float twistAt(float doc, float seed, vec4 b) {
    return cos(doc * 0.0015 * b.x + uTime * 0.16 + seed * 0.9);
}

// Horizontal position of one strand at a screen y
float strandX(float y, float lane, float seed, vec4 a, vec4 b) {
    float doc = y + uScroll;
    float t = uTime;
    float w = uRes.x;
    float h = uUnit;
    // A slow meander across the whole page, measured in screen heights.
    // Long waves and a capped swing keep every bend wide and gentle.
    float amp = min(0.28 * w, 0.45 * h);
    float m = 0.5 * w
        + amp * sin(doc * 6.2832 / (h * 3.6) + 0.155)
        + amp * 0.15 * sin(doc * 6.2832 / (h * 2.1) + 1.1)
        + 0.02 * w * sin(doc * 0.0021 - t * 0.12);
    float x = mix((a.x * 0.5 + 0.5) * w, m, b.z);
    x += (sin(doc * 0.0019 + t * 0.21) * 0.02 + sin(doc * 0.0043 - t * 0.15 + 1.7) * 0.012) * w;

    float twist = twistAt(doc, seed, b);
    float spread = a.y * w * (0.7 + 0.3 * sin(doc * 0.0011 + 0.6)) * (1.0 + 0.22 * uSpeed);
    float off = (lane - 0.5) * spread * (0.18 + 0.82 * twist);
    off += sin(doc * 0.0062 + seed * 6.283 + t * 0.45) * spread * 0.07;

    return x + off;
}
`;

const RIBBON_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
attribute float aLane;
attribute float aSeed;
attribute float aDepth;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
varying float vDist;
varying float vSigma;
varying float vAmp;
varying vec3 vColor;
varying float vDoc;
varying float vY;
varying float vSeed;
${RIBBON_COMMON}

// Hover: threads parting around a finger. Each strand picks its side once, where it passes the
// cursor, and the whole strand bows out to that side in one smooth arc along the ribbon. Deciding
// per strand (not per point) is what keeps twisting strands from snapping into sharp S-kinks.
// rn = across the ribbon, rt = along it.
float hoverAmount(float lane, float seed, vec2 rt) {
    vec4 pa, pb;
    params(uPointer.y, pa, pb);
    float xc = strandX(uPointer.y, lane, seed, pa, pb);
    float dc = (xc - uPointer.x) * rt.y + (seed - 0.5) * 6.0; // across-ribbon distance at the cursor
    float stiff = 0.75 + 0.5 * fract(seed * 3.71);
    float r = 24.0 * stiff * uPointer.z;
    // Out to a gap of radius r, side chosen by dc (eased over ~14px, so a strand slips past the
    // cursor instead of flipping), and strands far from the cursor stay put
    return dc / sqrt(dc * dc + 49.0) * (sqrt(dc * dc + r * r) - abs(dc)) * exp(-dc * dc / (2.0 * 90.0 * 90.0));
}

void main() {
    float y = mix(-0.15, 1.15, aT) * uRes.y;
    vec4 a, b;
    params(y, a, b);
    float x0 = strandX(y, aLane, aSeed, a, b);
    float x1 = strandX(y + 3.0, aLane, aSeed, a, b);

    // The ribbon's own direction here, from its center line
    float c0 = strandX(y, 0.5, 0.0, a, b);
    float c1 = strandX(y + 6.0, 0.5, 0.0, a, b);
    vec2 rt = normalize(vec2(c1 - c0, 6.0));
    vec2 rn = vec2(rt.y, -rt.x);
    vec2 p0 = vec2(x0, y);
    vec2 p1 = vec2(x1, y + 3.0);
    if (uPointer.z > 0.001) {
        float amount = hoverAmount(aLane, aSeed, rt);
        float s0 = dot(p0 - uPointer.xy, rt);
        float s1 = dot(p1 - uPointer.xy, rt);
        p0 += rn * amount * exp(-s0 * s0 / (2.0 * 110.0 * 110.0));
        p1 += rn * amount * exp(-s1 * s1 / (2.0 * 110.0 * 110.0));
    }

    // Hover: strands near the cursor glow a little brighter
    vec2 dp = p0 - uPointer.xy;
    float glow = exp(-dot(dp, dp) / (2.0 * 120.0 * 120.0)) * uPointer.z;
    vec2 tang = normalize(p1 - p0);
    vec2 nrm = vec2(tang.y, -tang.x);

    // Depth of field: blur widens the line and spreads its light out
    float blur = clamp(a.z + aDepth * 0.4, 0.0, 1.0);
    float sigmaBase = mix(0.75, 16.0, blur * blur);
    // Never thinner than about a device pixel, so lines don't shimmer as they slide across pixels
    float sigma = sqrt(sigmaBase * sigmaBase + 0.2 * uPx * uPx);
    float half_ = sigma * 2.6 + 1.5 * uPx;
    // Soft strands overlap anyway, so draw fewer of them (each brighter) to save fill rate
    float keep = 1.0 - 0.7 * smoothstep(0.2, 0.9, blur);
    float r = fract(aSeed * 5.13) * 0.85;
    float on = smoothstep(r, r + 0.15, keep);
    half_ *= step(0.001, on);
    vec2 p = p0 + nrm * aSide * half_;

    vDist = aSide * half_;
    vSigma = sigma;
    // Where the ribbon turns edge-on its strands stack up, so each one dims to keep the glow even
    float flat_ = abs(0.18 + 0.82 * twistAt(y + uScroll, aSeed, b));
    vAmp = mix(0.3, 1.0, smoothstep(0.0, 0.6, flat_)) * on / keep * a.w * (0.35 + 0.65 * fract(aSeed * 7.31)) * pow(0.75 / sigmaBase, 0.6) * (1.0 - aDepth * 0.45);
    vAmp *= 1.0 + 0.7 * glow;
    vSeed = aSeed;
    vDoc = y + uScroll;
    vY = y;
    float h = fract(aLane + b.y + vDoc * 0.00004);
    vec3 col = mix(uColA, uColB, smoothstep(0.15, 0.85, h));
    col = mix(col, uColC, smoothstep(0.55, 1.0, abs(h - 0.5) * 2.0) * 0.6);
    col = mix(col, vec3(1.0), step(0.9, fract(aSeed * 3.17)) * 0.55);
    vColor = mix(col, vec3(1.0), glow * 0.25); // and warm toward white
    gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uReveal;
uniform float uPx;
uniform float uPulse;
uniform float uSpeed;
varying float vSeed;
varying float vDist;
varying float vSigma;
varying float vAmp;
varying vec3 vColor;
varying float vDoc;
varying float vY;

float erf_(float x) {
    float x2 = x * x;
    float t = x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2);
    return sign(x) * sqrt(1.0 - exp(-t));
}

void main() {
    float x = vDist;
    // Light the whole pixel the line passes through, not just its center: brightness stays
    // steady while the ribbon glides under the pixel grid
    float d = x / uPx;
    float s = vSigma / uPx * 1.4142;
    float core = 0.5 * (erf_((d + 0.5) / s) - erf_((d - 0.5) / s)) * s * 1.7725;
    float halo = exp(-x * x / (2.0 * pow(vSigma * 4.0 + 5.0, 2.0))) * 0.1;
    // Light pulses travel down the strands
    // Fast scrolling stretches the pulses into longer streaks
    float pulse = pow(0.5 + 0.5 * sin(vDoc * 0.009 - uPulse + vSeed * 40.0), mix(8.0, 3.5, uSpeed));
    float i = (core + halo) * vAmp * (0.7 + pulse * 0.9);
    i *= 1.0 - smoothstep(uReveal - 260.0, uReveal, vY);
    vec3 c = vColor * i;
    // Valid premultiplied output (color never above alpha) so the page composites it the same way every frame
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}
`;

const SPARK_VERT = /* glsl */ `
attribute float aLane;
attribute float aSeed;
uniform float uSize;
uniform float uReveal;
varying float vAlpha;
${RIBBON_COMMON}

void main() {
    // Each spark is born on the ribbon, drifts out into the dark and fades away, then is
    // born again. Every spark keeps its own pace, so they never move in step.
    float life = fract(uTime * (0.07 + 0.06 * fract(aSeed * 7.7)) + aSeed * 3.1);
    float span = uRes.y * 1.3;
    float y0 = mod(aSeed * span * 7.0 - uScroll - uTime * (8.0 + aSeed * 18.0), span) - uRes.y * 0.15;
    vec4 a, b;
    params(y0, a, b);
    float x0 = strandX(y0, aLane, aSeed, a, b) + sin(aSeed * 91.0) * a.y * uRes.x * 0.06;

    // Out to the side it started on, with a lazy curl and a slow rise
    float side = sign(sin(aSeed * 91.0) + 0.001);
    float reach = 90.0 + 300.0 * fract(aSeed * 5.31);
    float x = x0 + side * pow(life, 1.4) * reach + sin(life * 6.0 + aSeed * 17.0) * 14.0 * life;
    float y = y0 - life * (30.0 + 50.0 * fract(aSeed * 2.9));
    gl_Position = vec4(x / uRes.x * 2.0 - 1.0, 1.0 - y / uRes.y * 2.0, 0.0, 1.0);

    float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
    float fade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.35, 1.0, life));
    vAlpha = a.w * (1.0 - a.z * 0.8) * (0.3 + 0.7 * tw) * fade;
    vAlpha *= 1.0 - smoothstep(uReveal - 260.0, uReveal, y0); // appear with the ribbon
    gl_PointSize = uSize * (0.5 + fract(aSeed * 13.7)) * (1.0 - 0.45 * life);
}
`;

const SPARK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(uColor * a, a);
}
`;

/* ---------- Ribbon keyframes, each anchored to the top of an element ---------- */
// a: [x (-1 left .. 1 right), spread (share of width), blur (0 sharp .. 1 haze), alpha]
// b: [twist, hue shift, meander (0 hold x .. 1 wander), focus drift]
// The hero holds the ribbon on the right, clear of the headline; from About on it wanders freely
// behind everything, sharp the whole way. Phones dim it a little behind text, since it crosses
// whole paragraphs there.
const KEYS_WIDE = [
    { at: "#top", a: [0.6, 0.2, 0.0, 1.0], b: [1.0, 0.0, 0.0, 0.0] },
    { at: ".stats", a: [0.7, 0.2, 0.0, 0.95], b: [1.1, 0.08, 0.0, 0.0] },
    // x only matters while the wander blends in, so it stays right instead of pulling left
    { at: "#about", a: [0.6, 0.2, 0.0, 0.9], b: [1.2, 0.15, 1.0, 0.0] },
    { at: "#contact", a: [0.0, 0.22, 0.0, 1.0], b: [1.0, 0.05, 1.0, 0.0] },
];
const KEYS_NARROW = [
    { at: "#top", a: [0.55, 0.38, 0.0, 1.0], b: [1.0, 0.0, 0.0, 0.0] },
    { at: ".hero-copy", a: [0.6, 0.34, 0.0, 0.65], b: [1.0, 0.05, 0.5, 0.0] },
    { at: "#about", a: [0.0, 0.34, 0.0, 0.6], b: [1.2, 0.15, 1.0, 0.0] },
    { at: "#contact", a: [0.0, 0.38, 0.0, 0.75], b: [1.0, 0.05, 1.0, 0.0] },
];

// Hex color to linear RGB (the shaders light and blend in linear space)
function linear(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
}

const VERT_HEAD = "precision highp float;\n";
const FRAG_HEAD = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";

function buildRibbon(lines, segments) {
    const verts = lines * (segments + 1) * 2;
    const data = new Float32Array(verts * 5); // aT, aSide, aLane, aSeed, aDepth
    const index = new Uint16Array(lines * segments * 6);
    let v = 0;
    let k = 0;
    for (let l = 0; l < lines; l++) {
        // Golden-ratio lanes: any prefix of lines still covers the whole ribbon
        const lane = (l * 0.618034 + 0.31) % 1;
        const seed = Math.random();
        const depth = Math.random() < 0.22 ? 0.5 + Math.random() * 0.5 : 0;
        for (let s = 0; s <= segments; s++) {
            for (const side of [-1, 1]) {
                data.set([s / segments, side, lane, seed, depth], v * 5);
                v++;
            }
            if (s < segments) {
                const i = v - 2;
                index.set([i, i + 1, i + 2, i + 1, i + 3, i + 2], k);
                k += 6;
            }
        }
    }
    return { data, index };
}

function buildSparks(count) {
    const data = new Float32Array(count * 2); // aLane, aSeed
    for (let i = 0; i < count * 2; i++) data[i] = Math.random();
    return data;
}

function init() {
    const root = document.documentElement;
    const canvas = document.querySelector("[data-stage]");
    const isSmallDevice = Math.min(window.innerWidth, window.innerHeight) < 600;
    const reduceMotion = F.reduceMotion;
    const attrs = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" };
    const gl = canvas.getContext("webgl2", attrs) || canvas.getContext("webgl", attrs);
    if (!gl) throw new Error("no WebGL context");

    let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    const ribbonMesh = buildRibbon(isSmallDevice ? 44 : 72, isSmallDevice ? 90 : 140);
    const sparkData = buildSparks(isSmallDevice ? 100 : 240);
    let ribbonCount = ribbonMesh.index.length;
    let showSparks = true;

    const COL_A = linear("#4fd1e8");
    const COL_B = linear("#a093ff");
    const COL_C = linear("#5f8dff");
    const COL_SPARK = linear("#cfefff");

    /* ---------- GPU resources (rebuilt if the context is lost and restored) ---------- */
    let ribbonProg, sparkProg, ribbonBuf, ribbonIdx, sparkBuf;

    const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
    };
    const link = (vert, frag, attributes) => {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT_HEAD + vert));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG_HEAD + frag));
        attributes.forEach((name, i) => gl.bindAttribLocation(p, i, name));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
        const cache = {};
        return { p, u: (name) => (name in cache ? cache[name] : (cache[name] = gl.getUniformLocation(p, name))) };
    };
    const setup = () => {
        ribbonProg = link(RIBBON_VERT, RIBBON_FRAG, ["aT", "aSide", "aLane", "aSeed", "aDepth"]);
        sparkProg = link(SPARK_VERT, SPARK_FRAG, ["aLane", "aSeed"]);
        ribbonBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuf);
        gl.bufferData(gl.ARRAY_BUFFER, ribbonMesh.data, gl.STATIC_DRAW);
        ribbonIdx = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ribbonIdx);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ribbonMesh.index, gl.STATIC_DRAW);
        sparkBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sparkData, gl.STATIC_DRAW);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE); // additive, premultiplied
        gl.clearColor(0, 0, 0, 0);
    };
    setup();

    /* ---------- Shared uniform state ---------- */
    const S = {
        resX: 1,
        resY: 1,
        unit: 1,
        px: 1,
        scroll: 0,
        time: 0,
        speed: 0,
        pointer: new Float32Array([-9999, -9999, 0]),
        anchors: new Float32Array(MAX_KEYS).fill(1e7),
        keyA: new Float32Array(MAX_KEYS * 4),
        keyB: new Float32Array(MAX_KEYS * 4),
        blend: 400,
        reveal: 0,
        pulse: 0,
    };
    const setShared = (prog) => {
        gl.uniform2f(prog.u("uRes"), S.resX, S.resY);
        gl.uniform1f(prog.u("uUnit"), S.unit);
        gl.uniform1f(prog.u("uPx"), S.px);
        gl.uniform1f(prog.u("uScroll"), S.scroll);
        gl.uniform1f(prog.u("uTime"), S.time);
        gl.uniform1f(prog.u("uSpeed"), S.speed);
        gl.uniform3fv(prog.u("uPointer"), S.pointer);
        gl.uniform1fv(prog.u("uAnchor"), S.anchors);
        gl.uniform4fv(prog.u("uKeyA"), S.keyA);
        gl.uniform4fv(prog.u("uKeyB"), S.keyB);
        gl.uniform1f(prog.u("uBlend"), S.blend);
        gl.uniform1f(prog.u("uReveal"), S.reveal);
    };
    // One float per attribute, interleaved, bound to locations 0..n-1
    const bindAttrs = (buffer, count) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        for (let i = 0; i < 5; i++) {
            if (i < count) {
                gl.enableVertexAttribArray(i);
                gl.vertexAttribPointer(i, 1, gl.FLOAT, false, count * 4, i * 4);
            } else {
                gl.disableVertexAttribArray(i);
            }
        }
    };
    const draw = () => {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(ribbonProg.p);
        setShared(ribbonProg);
        gl.uniform1f(ribbonProg.u("uPulse"), S.pulse);
        gl.uniform3fv(ribbonProg.u("uColA"), COL_A);
        gl.uniform3fv(ribbonProg.u("uColB"), COL_B);
        gl.uniform3fv(ribbonProg.u("uColC"), COL_C);
        bindAttrs(ribbonBuf, 5);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ribbonIdx);
        gl.drawElements(gl.TRIANGLES, ribbonCount, gl.UNSIGNED_SHORT, 0);

        if (showSparks) {
            gl.useProgram(sparkProg.p);
            setShared(sparkProg);
            gl.uniform1f(sparkProg.u("uSize"), 4 * pixelRatio);
            gl.uniform3fv(sparkProg.u("uColor"), COL_SPARK);
            bindAttrs(sparkBuf, 2);
            gl.drawArrays(gl.POINTS, 0, sparkData.length / 2);
        }
    };

    /* ---------- Layout: anchor keyframes to the page ---------- */
    let keys = KEYS_WIDE;
    let anchorsDoc = [];
    let needsRender = true;

    const measure = () => {
        const y = window.scrollY;
        anchorsDoc = keys.map((k, i) => {
            if (i === 0) return -1e7;
            const el = document.querySelector(k.at);
            return el ? el.getBoundingClientRect().top + y : 1e7;
        });
        for (let i = 0; i < MAX_KEYS; i++) {
            const k = keys[Math.min(i, keys.length - 1)];
            S.keyA.set(k.a, i * 4);
            S.keyB.set(k.b, i * 4);
        }
        needsRender = true;
    };

    // The canvas scrolls with the page (style.css) and is put back over the screen every frame.
    // It reaches `over` px past the screen at the top and bottom, so on a frame where the page
    // scrolled ahead of the drawing (scrollbar drag, keys, touch) the edges still show ribbon.
    let viewH = window.innerHeight;
    let over = 0;
    const fitStage = () => {
        viewH = window.innerHeight;
        over = Math.round(Math.min(140, Math.max(64, viewH * 0.12)));
        canvas.style.height = `${viewH + 2 * over}px`;
    };

    const resize = () => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;
        canvas.width = Math.round(w * pixelRatio);
        canvas.height = Math.round(h * pixelRatio);
        // The ribbon's shape is measured in screen heights; only re-measure when the width
        // changes, so a mobile toolbar sliding in and out never reshapes it mid-scroll
        if (w !== S.resX || S.unit === 1) {
            S.unit = viewH;
            S.blend = Math.min(viewH * 0.45, 420);
        }
        S.resX = w;
        S.resY = h;
        S.px = 1 / pixelRatio;
        keys = w >= 900 ? KEYS_WIDE : KEYS_NARROW;
        measure();
    };

    /* ---------- Adaptive quality ---------- */
    // 2: full, 1: 1x resolution without sparks, 0: also half the strands. A short hitch
    // (another busy app, a background task) must never cost sharpness for the whole visit, so
    // a step down needs sustained slow frames, is undone when it did not help (a frame-rate
    // cap such as battery saver, not the GPU), and is climbed back once frames are smooth again.
    const fullRatio = pixelRatio;
    const fullCount = ribbonCount;
    // Golden-ratio lanes keep the ribbon full with half the strands
    const halfCount = Math.floor(ribbonMesh.index.length / 2 / 6) * 6;
    let quality = 2;
    let frames = [];
    let windowMs = 0;
    let slowWindows = 0;
    let smoothWindows = 0;
    let droppedAt = 0; // median that caused the last step down, until the next window judges it
    let climbs = 0;
    let settled = false;
    const setQuality = (q) => {
        quality = q;
        F.quality = q;
        showSparks = q === 2;
        ribbonCount = q === 0 ? halfCount : fullCount;
        const ratio = q === 2 ? fullRatio : 1;
        if (ratio !== pixelRatio) {
            pixelRatio = ratio;
            resize();
        }
    };
    const watch = (ms) => {
        if (settled || reduceMotion) return;
        frames.push(ms);
        windowMs += ms;
        if (frames.length < 90 && (windowMs < 2000 || frames.length < 8)) return;
        const median = frames.sort((a, b) => a - b)[frames.length >> 1];
        frames = [];
        windowMs = 0;

        if (droppedAt) {
            const helped = median < droppedAt * 0.8;
            droppedAt = 0;
            if (!helped) {
                setQuality(quality + 1);
                settled = true;
                return;
            }
        }

        if (median > 24) {
            smoothWindows = 0;
            if (++slowWindows < 2 || quality === 0) return;
            slowWindows = 0;
            droppedAt = median;
            setQuality(quality - 1);
            // Slow again after climbing back: this is the level the device can hold
            if (climbs > 0) settled = true;
        } else {
            slowWindows = 0;
            if (quality === 2 || median > 18 || ++smoothWindows < 3) return;
            smoothWindows = 0;
            climbs++;
            setQuality(quality + 1);
        }
    };

    /* ---------- Context loss: show the CSS ribbon until the GPU is back ---------- */
    let lost = false;
    canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        lost = true;
        root.classList.add("no-webgl");
    });
    canvas.addEventListener("webglcontextrestored", () => {
        try {
            setup();
            lost = false;
            root.classList.remove("no-webgl");
            needsRender = true;
        } catch (error) {
            console.warn("WebGL ribbon could not be restored:", error);
        }
    });

    /* ---------- Loop ---------- */
    let time = Math.random() * 50;
    let last = performance.now();
    let lastScroll = window.scrollY;
    let energy = 0;
    let speed01 = 0; // energy, smoothed once more so the ribbon breathes instead of twitching
    let pulse = 0; // integrated, so a change in scroll speed never makes the pulses jump
    // Hover glow: follows a softened cursor, fades in quickly and dies away slowly
    const ptr = { x: -9999, y: -9999, seen: false };
    let glow = 0;
    let reveal = reduceMotion ? 1 : 0;
    let reported = false;

    document.addEventListener("visibilitychange", () => {
        last = performance.now();
        frames = [];
        windowMs = 0;
        slowWindows = 0;
        smoothWindows = 0;
    });

    const frame = (now) => {
        requestAnimationFrame(frame);
        const ms = now - last;
        const dt = Math.min(ms / 1000, 0.05);
        last = now;
        // Advance the smooth scroll first so the ribbon never lags the page by a frame
        if (F.stepScroll) F.stepScroll(now);
        if (lost) return;
        const scroll = window.scrollY;
        const h = viewH;

        if (reduceMotion) {
            // Still ribbon: only redraw when the page moves under it
            if (scroll === lastScroll && !needsRender) return;
        } else {
            time += dt;
            reveal = Math.min(1, reveal + dt / 1.8);
            const speed = Math.abs(scroll - lastScroll) / Math.max(dt, 0.001);
            energy += (Math.min(speed / 2500, 1) - energy) * (1 - Math.exp(-dt * (speed > energy ? 6 : 1.5)));
            pulse += dt * (1.6 + energy * 2.0);
            speed01 += (energy - speed01) * (1 - Math.exp(-dt * 3));
            const p = F.pointer;
            const tx = ((p.x + 1) / 2) * S.resX;
            const ty = ((1 - p.y) / 2) * h;
            if (p.active && !ptr.seen) Object.assign(ptr, { x: tx, y: ty, seen: true });
            const kp = 1 - Math.exp(-dt * 8);
            ptr.x += (tx - ptr.x) * kp;
            ptr.y += (ty - ptr.y) * kp;
            const target = p.active ? 1 : 0;
            glow += (target - glow) * (1 - Math.exp(-dt * (target > glow ? 5 : 1.6)));
            // The cursor is in screen space; the canvas starts `over` px above the screen
            S.pointer[0] = ptr.x;
            S.pointer[1] = ptr.y + over;
            S.pointer[2] = glow;
        }
        lastScroll = scroll;
        needsRender = false;
        // Adapt quality before drawing: resizing clears the canvas, so never do it after a draw
        if (reveal >= 1) watch(ms);

        // Put the canvas back over the screen for this frame. The page position and the drawing
        // reach the screen together, and between frames the canvas moves with the content.
        const top = scroll - over;
        canvas.style.transform = `translate3d(0, ${top}px, 0)`;

        S.scroll = top;
        S.time = time;
        S.speed = speed01;
        S.pulse = pulse;
        for (let i = 0; i < MAX_KEYS; i++) S.anchors[i] = i < anchorsDoc.length ? anchorsDoc[i] - top : 1e7;
        const r = reveal * reveal * (3 - 2 * reveal);
        S.reveal = over + (-300 + r * (h * 1.3 + 600));

        draw();
        if (!reported) {
            reported = true;
            F.onReady();
        }
    };

    new ResizeObserver(resize).observe(canvas);
    // The canvas height follows the screen; the observer above then resizes the drawing buffer
    window.addEventListener("resize", fitStage);
    // Section heights shift as fonts and images load
    new ResizeObserver(measure).observe(document.body);
    fitStage();
    resize();
    requestAnimationFrame((t) => {
        last = t;
        frame(t);
    });
}

// Start last, once every shader and keyframe constant above is defined
if (F && !F.disabled) {
    try {
        init();
    } catch (error) {
        console.warn("WebGL ribbon disabled:", error);
        document.documentElement.classList.add("no-webgl");
        F.onReady();
    }
}
