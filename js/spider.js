/* ==========================================================================
   Spell Spider — the spider itself
   An SVG spider with eight long, jointed legs. The walker in app.js decides
   where every foot is; this file shapes each leg (upper leg out from the body,
   lower leg arching down) so the foot lands exactly there, even far out
   across the page.
   ========================================================================== */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const DEG = Math.PI / 180;

  // Where each leg joins the body, right side, front to back. The left side is mirrored.
  // Units are SVG units: the body is drawn in a 100 x 100 box centered on 0,0, head toward -y.
  const HIPS = [[5.2, -9.5], [6.6, -6.6], [6.6, -3.4], [5.6, -0.4]];

  // Which way each upper leg points out of the body (degrees; 0 = straight out to the
  // side, negative = toward the head), right side front to back.
  const FEMUR_ANGLE = [-62, -22, 20, 58];

  // Short legs for the little spider hanging on the welcome screen.
  const HANG = [
    { base: -58, bend: -26, femur: 15, tibia: 19 },
    { base: -22, bend: -12, femur: 15, tibia: 17 },
    { base: 16, bend: 12, femur: 14, tibia: 17 },
    { base: 52, bend: 26, femur: 15, tibia: 19 },
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

  /* Leg k: 0-3 are the right legs (front to back), 4-7 the left legs. */
  function hip(k) {
    const h = HIPS[k & 3];
    return [k < 4 ? h[0] : -h[0], h[1]];
  }

  const f1 = (n) => n.toFixed(1);

  class Spider {
    constructor(options) {
      options = options || {};
      this.legPx = options.legPx || 3; // how thick the legs look on screen, in pixels
      this.size = 1;
      this.svg = el("svg", { viewBox: "-50 -50 100 100", class: "spider", "aria-hidden": "true", overflow: "visible" });
      this.root = el("g", {}, this.svg);
      this.legGroup = el("g", { class: "spider-legs", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, this.root);
      this.legs = [];
      for (let k = 0; k < 8; k++) {
        this.legs.push({
          femur: el("path", {}, this.legGroup),
          tibia: el("path", {}, this.legGroup),
          foot: el("circle", { r: 1.5 }, this.legGroup),
        });
      }
      // Pedipalps (the little feelers at the front)
      this.palps = [
        el("path", { fill: "none", "stroke-linecap": "round" }, this.root),
        el("path", { fill: "none", "stroke-linecap": "round" }, this.root),
      ];
      const body = el("g", { class: "spider-body" }, this.root);
      this.abdomen = el("ellipse", { cx: 0, cy: 12, rx: 11.5, ry: 14, stroke: "rgba(255,255,255,.7)", "stroke-width": 1.1 }, body);
      this.marking = el("path", { d: "M-5 8 Q0 12 5 8 M-4 14 Q0 18 4 14 M-2.5 20 Q0 22.5 2.5 20", fill: "none", "stroke-width": 1.6, "stroke-linecap": "round" }, body);
      this.shine = el("ellipse", { cx: -4, cy: 5, rx: 3.6, ry: 5.5, fill: "#fff", opacity: 0.16 }, body);
      this.thorax = el("ellipse", { cx: 0, cy: -6, rx: 9, ry: 8.5, stroke: "rgba(255,255,255,.7)", "stroke-width": 1.1 }, body);
      // Eyes: two big front eyes, two small side eyes
      this.eyes = el("g", {}, body);
      for (const sx of [-1, 1]) {
        el("circle", { cx: sx * 6.6, cy: -9.4, r: 1.25, fill: "#fff", opacity: 0.85 }, this.eyes);
        el("circle", { cx: sx * 3.4, cy: -11.2, r: 3.3, fill: "#fff" }, this.eyes);
        el("circle", { cx: sx * 3.4, cy: -11.7, r: 2.1, fill: "#120c1d" }, this.eyes);
        el("circle", { cx: sx * 3.4 - 0.8, cy: -12.6, r: 0.75, fill: "#fff" }, this.eyes);
      }
      this.setColor(options.color || "#2b2140");
      this.setSize(options.size || 1);
      this.hangPose(0, 0, 0);
    }

    static hip(k) { return hip(k); }

    setColor(hex) {
      this.color = hex;
      const leg = shade(hex, -0.15);
      for (const L of this.legs) {
        L.femur.setAttribute("stroke", leg);
        L.tibia.setAttribute("stroke", leg);
        L.foot.setAttribute("fill", leg);
      }
      for (const p of this.palps) p.setAttribute("stroke", leg);
      this.abdomen.setAttribute("fill", hex);
      this.thorax.setAttribute("fill", shade(hex, 0.12));
      this.marking.setAttribute("stroke", shade(hex, 0.45));
    }

    /* scale = screen pixels per SVG unit. Legs keep the same on-screen thickness at any size. */
    setSize(scale) {
      this.size = scale;
      const px = Math.max(1, Math.round(100 * scale));
      this.svg.setAttribute("width", px);
      this.svg.setAttribute("height", px);
      const femurW = Math.max(1.6, this.legPx * 1.25) / scale;
      const tibiaW = Math.max(1.2, this.legPx * 0.8) / scale;
      for (const L of this.legs) {
        L.femur.setAttribute("stroke-width", femurW.toFixed(2));
        L.tibia.setAttribute("stroke-width", tibiaW.toFixed(2));
        L.foot.setAttribute("r", (Math.max(1.4, this.legPx * 0.62) / scale).toFixed(2));
      }
      for (const p of this.palps) p.setAttribute("stroke-width", 2.2);
    }

    /* Put the body at x,y (pixels inside its container), angle in degrees (0 = facing up, 180 = down). */
    place(x, y, angle) {
      const half = 50 * this.size;
      this.svg.style.transform = `translate(${x - half}px, ${y - half}px)`;
      this.root.setAttribute("transform", `rotate(${angle})`);
    }

    _drawLeg(k, hx, hy, kx, ky, fx, fy, cx, cy) {
      const L = this.legs[k];
      if (cx === undefined) { cx = (kx + fx) / 2; cy = (ky + fy) / 2; }
      L.femur.setAttribute("d", `M${f1(hx)} ${f1(hy)}L${f1(kx)} ${f1(ky)}`);
      L.tibia.setAttribute("d", `M${f1(kx)} ${f1(ky)}Q${f1(cx)} ${f1(cy)} ${f1(fx)} ${f1(fy)}`);
      L.foot.setAttribute("cx", f1(fx));
      L.foot.setAttribute("cy", f1(fy));
    }

    /* Draw every leg so its foot lands exactly on feet[k] (body units).
       The upper leg (femur) sticks out from the body at the leg's own angle, turning a
       little toward the foot; the lower leg arches from the knee down to the foot and
       stretches as far as it needs to, so a foot can reach anywhere on the page.
       rest[k] is the leg's relaxed reach; lift[k] (0..1) arches a leg that is mid-step. */
    reach(feet, rest, lift) {
      for (let k = 0; k < 8; k++) {
        const [hx, hy] = hip(k);
        const mx = k < 4 ? 1 : -1; // work in right-side terms, then mirror the left legs
        const fx = feet[k][0], fy = feet[k][1];
        const toFoot = Math.atan2(fy - hy, (fx - hx) * mx) / DEG;
        const base = FEMUR_ANGLE[k & 3];
        let delta = ((toFoot - base + 540) % 360) - 180;
        delta = Math.max(-45, Math.min(45, delta));
        const ang = (base + delta * 0.65) * DEG;
        const fem = Math.max(9, rest[k] * 0.4);
        const kx = hx + Math.cos(ang) * fem * mx, ky = hy + Math.sin(ang) * fem;
        // The lower leg bows away from the body; a lifted leg bows more.
        const tx = fx - kx, ty = fy - ky;
        const tl = Math.hypot(tx, ty) || 1;
        let nx = -ty / tl, ny = tx / tl;
        const midx = (kx + fx) / 2, midy = (ky + fy) / 2;
        if (nx * midx + ny * midy < 0) { nx = -nx; ny = -ny; }
        const up = lift ? lift[k] || 0 : 0;
        const bow = Math.min(tl * (0.08 + 0.14 * up), rest[k] * 0.35);
        this._drawLeg(k, hx, hy, kx, ky, fx, fy, midx + nx * bow, midy + ny * bow);
      }
    }

    /* A simple built-in leg animation, used for the small spider on the welcome screen. */
    hangPose(phase, idle, stride) {
      stride = stride === undefined ? 1 : stride;
      for (let side = 0; side < 2; side++) {
        const mirror = side === 0 ? 1 : -1;
        for (let i = 0; i < 4; i++) {
          const L = HANG[i];
          const group = (i + side) % 2;
          const p = phase + (group ? Math.PI : 0);
          const swing = Math.sin(p) * 13 * stride + Math.sin(idle * 1.7 + i + side * 2) * 1.6;
          const reach = 1 - Math.max(0, Math.cos(p)) * stride * 0.14;
          const a1 = (L.base + swing) * DEG;
          const a2 = (L.base + swing + L.bend) * DEG;
          const ax = HIPS[i][0], ay = HIPS[i][1];
          const kx = ax + Math.cos(a1) * L.femur, ky = ay + Math.sin(a1) * L.femur;
          const fx = kx + Math.cos(a2) * L.tibia * reach, fy = ky + Math.sin(a2) * L.tibia * reach;
          this._drawLeg(side * 4 + i, ax * mirror, ay, kx * mirror, ky, fx * mirror, fy);
        }
      }
      this.face(idle, 0);
    }

    /* Feelers and breathing. grab (0..1) curls the feelers in, right after a catch. */
    face(idle, grab) {
      for (let side = 0; side < 2; side++) {
        const mirror = side === 0 ? 1 : -1;
        const palpSwing = Math.sin(idle * 3 + side) * 6 - grab * 14;
        const pa = (-75 + palpSwing) * DEG;
        const px1 = 2.4, py1 = -13.4;
        const px2 = px1 + Math.cos(pa) * 5.5, py2 = py1 + Math.sin(pa) * 5.5;
        this.palps[side].setAttribute("d", `M${f1(px1 * mirror)} ${py1}L${f1(px2 * mirror)} ${f1(py2)}`);
      }
      const breathe = 1 + Math.sin(idle * 2.2) * 0.018;
      this.abdomen.setAttribute("ry", (14 * breathe).toFixed(2));
    }
  }

  window.Spider = Spider;
})();
