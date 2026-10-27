/* ==========================================================================
   Spell Spider — the spider itself
   A colorful SVG spider with eight two-tone legs. Legs walk with an
   alternating gait, and any leg can stretch out to grab a point on the page.
   ========================================================================== */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const DEG = Math.PI / 180;
  let instance = 0;

  // Right-side legs, front to back. The left side is a mirror image.
  // attach: where the leg joins the body; base: resting angle (0 = pointing right, negative = forward)
  // bend: how much the lower leg turns; femur/tibia: segment lengths; knee: which way the knee bows
  const LEGS = [
    { attach: [5.2, -9.5], base: -58, bend: -26, femur: 15, tibia: 19, knee: -1 },
    { attach: [6.4, -6.5], base: -22, bend: -12, femur: 15, tibia: 17, knee: -1 },
    { attach: [6.4, -3.5], base: 16, bend: 12, femur: 14, tibia: 17, knee: 1 },
    { attach: [5.6, -0.5], base: 52, bend: 26, femur: 15, tibia: 19, knee: 1 },
  ];

  /* Color themes. body/thorax are gradient stops; legs are [upper, lower] colors per leg pair. */
  const THEMES = {
    rainbow: {
      name: "Rainbow",
      body: ["#ff4d6d", "#ff9f1c", "#ffd23f", "#2ec4b6", "#3a86ff", "#8338ec"],
      thorax: ["#8338ec", "#c13dd6"],
      legs: [["#ff4d6d", "#ff9f1c"], ["#ffd23f", "#2ec4b6"], ["#2ec4b6", "#3a86ff"], ["#8338ec", "#f15bb5"]],
      palps: "#f15bb5", outline: "#2a1840", marks: "#ffffff",
    },
    peacock: {
      name: "Peacock",
      body: ["#023e8a", "#0096c7", "#48cae4", "#ffb703", "#fb8500", "#d62828"],
      thorax: ["#1d3557", "#2a6f97"],
      legs: [["#1d3557", "#48cae4"], ["#fb8500", "#ffb703"], ["#1d3557", "#48cae4"], ["#fb8500", "#ffb703"]],
      palps: "#ffb703", outline: "#0b1a2e", marks: "#ffffff",
    },
    neon: {
      name: "Neon",
      body: ["#f72585", "#b5179e", "#7209b7", "#4361ee", "#4cc9f0", "#39ff14"],
      thorax: ["#3a0ca3", "#4361ee"],
      legs: [["#39ff14", "#4cc9f0"], ["#f72585", "#fee440"], ["#4cc9f0", "#39ff14"], ["#fee440", "#f72585"]],
      palps: "#39ff14", outline: "#10002b", marks: "#fee440",
    },
    candy: {
      name: "Candy",
      body: ["#ff8fab", "#ffb3c6", "#cdb4db", "#a2d2ff", "#bde0fe"],
      thorax: ["#ff8fab", "#cdb4db"],
      legs: [["#ff8fab", "#a2d2ff"], ["#cdb4db", "#ffc8dd"], ["#a2d2ff", "#ff8fab"], ["#ffc8dd", "#cdb4db"]],
      palps: "#ff8fab", outline: "#5a2a4a", marks: "#ffffff",
    },
    midnight: {
      name: "Midnight",
      body: ["#2b2140", "#3d2f5c"],
      thorax: ["#463764", "#3a2d55"],
      legs: [["#2a2040", "#3a2d55"], ["#2a2040", "#3a2d55"], ["#2a2040", "#3a2d55"], ["#2a2040", "#3a2d55"]],
      palps: "#3a2d55", outline: "#120c1d", marks: "#8f7fb5",
    },
  };

  function shade(hex, amount) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amount < 0 ? 0 : 255, p = Math.abs(amount);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /* Build a theme from a single color picked by the user. */
  function themeFromColor(hex) {
    return {
      name: "Custom",
      body: [shade(hex, -0.1), hex, shade(hex, 0.35)],
      thorax: [shade(hex, 0.15), hex],
      legs: [0, 1, 2, 3].map(() => [shade(hex, -0.15), shade(hex, 0.25)]),
      palps: shade(hex, 0.3), outline: shade(hex, -0.65), marks: "#ffffff",
    };
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  /* Where the knee goes for a leg from (ax,ay) to foot (fx,fy).
     Short reach: a real two-bone bend. Long reach: the leg stretches with a gentle arch. */
  function kneeFor(ax, ay, fx, fy, a, b, sign) {
    const dx = fx - ax, dy = fy - ay;
    const d = Math.hypot(dx, dy) || 0.001;
    const ux = dx / d, uy = dy / d;
    const px = -uy * sign, py = ux * sign;
    if (d < a + b - 0.5) {
      const cos = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
      const ang = Math.acos(cos);
      return [ax + ux * a * Math.cos(ang) + px * a * Math.sin(ang), ay + uy * a * Math.cos(ang) + py * a * Math.sin(ang)];
    }
    const bulge = Math.min(24, 5 + d * 0.06);
    return [ax + dx * 0.45 + px * bulge, ay + dy * 0.45 + py * bulge];
  }

  class Spider {
    constructor(options) {
      options = options || {};
      this.uid = "sp" + ++instance;
      this.size = 1;
      this.svg = el("svg", { viewBox: "-50 -50 100 100", class: "spider", "aria-hidden": "true" });
      const defs = el("defs", {}, this.svg);
      this.bodyGrad = el("linearGradient", { id: this.uid + "-body", x1: "0", y1: "0", x2: "1", y2: "1" }, defs);
      this.thoraxGrad = el("linearGradient", { id: this.uid + "-thorax", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);

      this.root = el("g", {}, this.svg);
      const legGroup = el("g", { "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" }, this.root);
      this.legs = [];
      for (let i = 0; i < 8; i++) {
        const outline = el("path", { "stroke-width": 4.8 }, legGroup);
        const upper = el("path", { "stroke-width": 3 }, legGroup);
        const lower = el("path", { "stroke-width": 2.7 }, legGroup);
        const tip = el("circle", { r: 1.7 }, legGroup);
        this.legs.push({ outline, upper, lower, tip });
      }
      this.palps = [
        el("path", { fill: "none", "stroke-linecap": "round", "stroke-width": 2.4 }, this.root),
        el("path", { fill: "none", "stroke-linecap": "round", "stroke-width": 2.4 }, this.root),
      ];
      this.abdomen = el("ellipse", { cx: 0, cy: 12, rx: 11.5, ry: 14, fill: `url(#${this.uid}-body)`, "stroke-width": 1.4 }, this.root);
      this.marking = el("path", {
        d: "M-5.5 6.5 Q0 10.5 5.5 6.5 M-5 12.5 Q0 16.5 5 12.5 M-3.5 18.5 Q0 21.5 3.5 18.5",
        fill: "none", "stroke-width": 1.7, "stroke-linecap": "round", opacity: 0.85,
      }, this.root);
      this.spots = el("g", {}, this.root);
      for (const [x, y, r] of [[-6.5, 9.5, 1.3], [6.5, 9.5, 1.3], [-6, 16, 1.1], [6, 16, 1.1]]) {
        el("circle", { cx: x, cy: y, r }, this.spots);
      }
      this.shine = el("ellipse", { cx: -4.5, cy: 4.5, rx: 3.2, ry: 5, fill: "#fff", opacity: 0.28 }, this.root);
      this.thorax = el("ellipse", { cx: 0, cy: -6, rx: 9, ry: 8.5, fill: `url(#${this.uid}-thorax)`, "stroke-width": 1.4 }, this.root);
      this.eyes = el("g", {}, this.root);
      for (const sx of [-1, 1]) {
        el("circle", { cx: sx * 6.6, cy: -9.4, r: 1.25, fill: "#fff", opacity: 0.9 }, this.eyes);
        el("circle", { cx: sx * 3.4, cy: -11.2, r: 3.4, fill: "#fff", stroke: "#120c1d", "stroke-width": 0.6 }, this.eyes);
        el("circle", { cx: sx * 3.4, cy: -11.7, r: 2.1, fill: "#120c1d" }, this.eyes);
        el("circle", { cx: sx * 3.4 - 0.8, cy: -12.6, r: 0.75, fill: "#fff" }, this.eyes);
      }

      this.setTheme(options.theme || "rainbow", options.color);
      this.setSize(options.size || 1);
      this.pose(0, 0, 0, 0, null);
    }

    setTheme(name, customColor) {
      const t = name === "custom" ? themeFromColor(customColor || "#7b2cbf") : (THEMES[name] || THEMES.rainbow);
      const fillStops = (grad, colors) => {
        grad.textContent = "";
        colors.forEach((c, i) => el("stop", { offset: colors.length > 1 ? i / (colors.length - 1) : 0, "stop-color": c }, grad));
      };
      fillStops(this.bodyGrad, t.body);
      fillStops(this.thoraxGrad, t.thorax);
      this.legs.forEach((leg, n) => {
        const pair = t.legs[n % 4];
        leg.outline.setAttribute("stroke", t.outline);
        leg.upper.setAttribute("stroke", pair[0]);
        leg.lower.setAttribute("stroke", pair[1]);
        leg.tip.setAttribute("fill", t.outline);
      });
      for (const p of this.palps) p.setAttribute("stroke", t.palps);
      this.abdomen.setAttribute("stroke", t.outline);
      this.thorax.setAttribute("stroke", t.outline);
      this.marking.setAttribute("stroke", t.marks);
      this.spots.setAttribute("fill", t.marks);
    }

    setSize(scale) {
      this.size = scale;
      const px = Math.round(100 * scale);
      this.svg.setAttribute("width", px);
      this.svg.setAttribute("height", px);
    }

    /* Place the spider. x,y are page pixels; angle in degrees (0 = facing up, 180 = facing down). */
    place(x, y, angle) {
      const half = 50 * this.size;
      this.svg.style.transform = `translate(${x - half}px, ${y - half}px)`;
      this.root.setAttribute("transform", `rotate(${angle})`);
    }

    /* phase: gait clock. busy (0..1): wiggles the feelers. idle: time for small idle motion.
       stride (0..1): how much the legs swing. reach: optional array of 8 entries, each null or
       { x, y, k } where x,y is a point in the spider's own coordinates and k (0..1) how far that leg reaches for it. */
    pose(phase, busy, idle, stride, reach) {
      stride = stride === undefined ? 1 : stride;
      for (let side = 0; side < 2; side++) {
        const mirror = side === 0 ? 1 : -1;
        for (let i = 0; i < 4; i++) {
          const L = LEGS[i];
          const n = side * 4 + i;
          const group = (i + side) % 2; // alternating tetrapod gait
          const p = phase + (group ? Math.PI : 0);
          const swing = Math.sin(p) * 13 * stride + Math.sin(idle * 1.7 + i + side * 2) * 1.6;
          const lift = Math.max(0, Math.cos(p)) * stride;
          const reachLen = 1 - lift * 0.14;
          const a1 = (L.base + swing) * DEG;
          const a2 = (L.base + swing + L.bend) * DEG;
          const ax = L.attach[0], ay = L.attach[1];
          let kx = ax + Math.cos(a1) * L.femur, ky = ay + Math.sin(a1) * L.femur;
          let fx = kx + Math.cos(a2) * L.tibia * reachLen, fy = ky + Math.sin(a2) * L.tibia * reachLen;

          const r = reach && reach[n];
          if (r && r.k > 0) {
            // Target in this side's un-mirrored frame
            const tx = r.x * mirror, ty = r.y;
            const gx = fx + (tx - fx) * r.k, gy = fy + (ty - fy) * r.k;
            const [ikx, iky] = kneeFor(ax, ay, gx, gy, L.femur, L.tibia, L.knee);
            kx += (ikx - kx) * Math.min(1, r.k * 1.4);
            ky += (iky - ky) * Math.min(1, r.k * 1.4);
            fx = gx; fy = gy;
          }

          const A = `${(ax * mirror).toFixed(2)} ${ay.toFixed(2)}`;
          const K = `${(kx * mirror).toFixed(2)} ${ky.toFixed(2)}`;
          const F = `${(fx * mirror).toFixed(2)} ${fy.toFixed(2)}`;
          const leg = this.legs[n];
          leg.outline.setAttribute("d", `M${A} L${K} L${F}`);
          leg.upper.setAttribute("d", `M${A} L${K}`);
          leg.lower.setAttribute("d", `M${K} L${F}`);
          leg.tip.setAttribute("cx", (fx * mirror).toFixed(2));
          leg.tip.setAttribute("cy", fy.toFixed(2));
        }
        const palpSwing = Math.sin(idle * (3 + busy * 9) + side) * (6 + busy * 6);
        const pa = (-75 + palpSwing) * DEG;
        const px1 = 2.4, py1 = -13.4;
        const px2 = px1 + Math.cos(pa) * 5.5, py2 = py1 + Math.sin(pa) * 5.5;
        this.palps[side].setAttribute("d", `M${(px1 * mirror).toFixed(2)} ${py1} L${(px2 * mirror).toFixed(2)} ${py2.toFixed(2)}`);
      }
      const breathe = 1 + Math.sin(idle * 2.2) * 0.018;
      this.abdomen.setAttribute("ry", (14 * breathe).toFixed(2));
    }
  }

  Spider.THEMES = THEMES;
  window.Spider = Spider;
})();
