/* ==========================================================================
   Spell Spider — the spider itself
   A small SVG creature with eight legs that move in an alternating gait.
   The walker in app.js tells it where to stand and how far it has walked.
   ========================================================================== */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const DEG = Math.PI / 180;

  // Right-side legs, front to back. Left side is mirrored.
  // attach: where the leg joins the body; base: resting angle (0 = pointing right, negative = forward)
  // bend: how much the lower leg turns; femur/tibia: segment lengths.
  const LEGS = [
    { attach: [5.2, -9.5], base: -58, bend: -26, femur: 15, tibia: 19 },
    { attach: [6.4, -6.5], base: -22, bend: -12, femur: 15, tibia: 17 },
    { attach: [6.4, -3.5], base: 16, bend: 12, femur: 14, tibia: 17 },
    { attach: [5.6, -0.5], base: 52, bend: 26, femur: 15, tibia: 19 },
  ];

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function shade(hex, amount) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = amount < 0 ? 0 : 255, p = Math.abs(amount);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  class Spider {
    constructor(options) {
      options = options || {};
      this.size = 1;
      this.svg = el("svg", { viewBox: "-50 -50 100 100", class: "spider", "aria-hidden": "true" });
      this.root = el("g", {}, this.svg);
      this.legGroup = el("g", { class: "spider-legs" }, this.root);
      this.legs = [];
      for (let i = 0; i < 8; i++) {
        this.legs.push(el("path", { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, this.legGroup));
      }
      // Pedipalps (the little feelers at the front)
      this.palps = [
        el("path", { fill: "none", "stroke-linecap": "round" }, this.root),
        el("path", { fill: "none", "stroke-linecap": "round" }, this.root),
      ];
      this.abdomen = el("ellipse", { cx: 0, cy: 12, rx: 11.5, ry: 14 }, this.root);
      this.marking = el("path", { d: "M-5 8 Q0 12 5 8 M-4 14 Q0 18 4 14 M-2.5 20 Q0 22.5 2.5 20", fill: "none", "stroke-width": 1.6, "stroke-linecap": "round" }, this.root);
      this.shine = el("ellipse", { cx: -4, cy: 5, rx: 3.6, ry: 5.5, fill: "#fff", opacity: 0.16 }, this.root);
      this.thorax = el("ellipse", { cx: 0, cy: -6, rx: 9, ry: 8.5 }, this.root);
      // Eyes: two big front eyes, two small side eyes
      this.eyes = el("g", {}, this.root);
      for (const sx of [-1, 1]) {
        el("circle", { cx: sx * 6.6, cy: -9.4, r: 1.25, fill: "#fff", opacity: 0.85 }, this.eyes);
        el("circle", { cx: sx * 3.4, cy: -11.2, r: 3.3, fill: "#fff" }, this.eyes);
        el("circle", { cx: sx * 3.4, cy: -11.7, r: 2.1, fill: "#120c1d", class: "pupil" }, this.eyes);
        el("circle", { cx: sx * 3.4 - 0.8, cy: -12.6, r: 0.75, fill: "#fff" }, this.eyes);
      }
      this.setColor(options.color || "#2b2140");
      this.setSize(options.size || 1);
      this.pose(0, 0, 0, 0, 0);
    }

    setColor(hex) {
      this.color = hex;
      const leg = shade(hex, -0.15);
      for (const p of this.legs) { p.setAttribute("stroke", leg); }
      for (const p of this.palps) { p.setAttribute("stroke", leg); p.setAttribute("stroke-width", 2.2); }
      this.abdomen.setAttribute("fill", hex);
      this.thorax.setAttribute("fill", shade(hex, 0.12));
      this.marking.setAttribute("stroke", shade(hex, 0.45));
    }

    setSize(scale) {
      this.size = scale;
      const px = Math.round(100 * scale);
      this.svg.setAttribute("width", px);
      this.svg.setAttribute("height", px);
      for (const p of this.legs) p.setAttribute("stroke-width", 2.6);
    }

    /* Place the spider. x,y are in page pixels, angle in degrees (0 = facing up),
       phase is the gait clock, grab (0..1) lifts the front legs to catch something. */
    place(x, y, angle) {
      const half = 50 * this.size;
      this.svg.style.transform = `translate(${x - half}px, ${y - half}px)`;
      this.root.setAttribute("transform", `rotate(${angle})`);
    }

    pose(phase, grab, idle, stride) {
      stride = stride === undefined ? 1 : stride;
      for (let side = 0; side < 2; side++) {
        const mirror = side === 0 ? 1 : -1;
        for (let i = 0; i < 4; i++) {
          const L = LEGS[i];
          // Alternating tetrapod gait: R1 L2 R3 L4 move together, the other four in the opposite phase
          const group = (i + side) % 2;
          const p = phase + (group ? Math.PI : 0);
          let swing = Math.sin(p) * 13 * stride + Math.sin(idle * 1.7 + i + side * 2) * 1.6;
          const lift = Math.max(0, Math.cos(p)) * stride;
          let reach = 1 - lift * 0.14;
          let bend = L.bend;
          if (i === 0 && grab > 0) {
            swing -= 30 * grab;
            bend -= 18 * grab;
            reach = reach * (1 - 0.18 * grab);
          }
          const a1 = (L.base + swing) * DEG;
          const a2 = (L.base + swing + bend) * DEG;
          const ax = L.attach[0], ay = L.attach[1];
          const kx = ax + Math.cos(a1) * L.femur, ky = ay + Math.sin(a1) * L.femur;
          const fx = kx + Math.cos(a2) * L.tibia * reach, fy = ky + Math.sin(a2) * L.tibia * reach;
          const leg = this.legs[side * 4 + i];
          leg.setAttribute("d",
            `M${(ax * mirror).toFixed(2)} ${ay.toFixed(2)} L${(kx * mirror).toFixed(2)} ${ky.toFixed(2)} L${(fx * mirror).toFixed(2)} ${fy.toFixed(2)}`);
        }
        const palpSwing = Math.sin(idle * 3 + side) * 6 - grab * 14;
        const pa = (-75 + palpSwing) * DEG;
        const px1 = 2.4, py1 = -13.4;
        const px2 = px1 + Math.cos(pa) * 5.5, py2 = py1 + Math.sin(pa) * 5.5;
        this.palps[side].setAttribute("d", `M${(px1 * mirror).toFixed(2)} ${py1} L${(px2 * mirror).toFixed(2)} ${py2.toFixed(2)}`);
      }
      const breathe = 1 + Math.sin(idle * 2.2) * 0.018;
      this.abdomen.setAttribute("ry", (14 * breathe).toFixed(2));
    }
  }

  window.Spider = Spider;
})();
