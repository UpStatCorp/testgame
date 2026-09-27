// Per-weapon gameplay stats and procedural animation keyframes.
// Poses are {p: [x,y,z], r: [x,y,z]} in camera space, keyed by normalized time u (0..1).

const deg = Math.PI / 180;

export const WEAPONS = {
  fists: {
    id: 'fists', name: 'Кулаки', damage: 7, range: 1.9, arc: 60 * deg, cooldown: 0.42, stamina: 4,
    duration: 0.4, hitTime: 0.4, knockback: 2.5, heavy: false, trail: null,
    rest: { p: [0.28, -0.32, -0.45], r: [0.1, 0, 0] },
    swings: [
      [
        { u: 0, p: [0.28, -0.32, -0.45], r: [0.1, 0, 0] },
        { u: 0.25, p: [0.3, -0.3, -0.3], r: [0.2, 0.2, 0] },
        { u: 0.45, p: [0.05, -0.2, -0.75], r: [0, -0.1, 0] },
        { u: 1, p: [0.28, -0.32, -0.45], r: [0.1, 0, 0] },
      ],
    ],
  },
  sword: {
    id: 'sword', name: 'Одноручный меч', damage: 22, range: 2.5, arc: 80 * deg, cooldown: 0.5, stamina: 8,
    duration: 0.52, hitTime: 0.42, knockback: 4, heavy: false,
    trail: { radius: 1.1, width: 0.5, color: '#dff4ff', arc: 110 },
    rest: { p: [0.3, -0.34, -0.55], r: [-0.55, 0.05, -0.3] },
    swings: [
      // right-to-left diagonal slash
      [
        { u: 0, p: [0.3, -0.34, -0.55], r: [-0.55, 0.05, -0.3] },
        { u: 0.28, p: [0.48, -0.08, -0.42], r: [0.15, -0.25, -1.25] },
        { u: 0.52, p: [-0.3, -0.42, -0.62], r: [-1.35, 0.5, 1.15] },
        { u: 0.7, p: [-0.24, -0.45, -0.58], r: [-1.25, 0.45, 1.0] },
        { u: 1, p: [0.3, -0.34, -0.55], r: [-0.55, 0.05, -0.3] },
      ],
      // left-to-right backhand
      [
        { u: 0, p: [0.3, -0.34, -0.55], r: [-0.55, 0.05, -0.3] },
        { u: 0.28, p: [-0.2, -0.1, -0.45], r: [-0.2, 0.3, 1.3] },
        { u: 0.52, p: [0.5, -0.4, -0.6], r: [-1.3, -0.45, -1.3] },
        { u: 0.7, p: [0.46, -0.42, -0.58], r: [-1.2, -0.4, -1.1] },
        { u: 1, p: [0.3, -0.34, -0.55], r: [-0.55, 0.05, -0.3] },
      ],
    ],
    trailRoll: [0.45, Math.PI - 0.45],
  },
  greatsword: {
    id: 'greatsword', name: 'Двуручный меч', damage: 60, range: 3.4, arc: 140 * deg, cooldown: 1.25, stamina: 22,
    duration: 1.15, hitTime: 0.5, knockback: 11, heavy: true,
    trail: { radius: 1.8, width: 1.0, color: '#ffd9a0', arc: 150 },
    rest: { p: [0.22, -0.52, -0.62], r: [-0.4, 0.2, -0.55] },
    swings: [
      [
        { u: 0, p: [0.22, -0.52, -0.62], r: [-0.4, 0.2, -0.55] },
        { u: 0.35, p: [0.55, 0.05, -0.3], r: [0.55, -0.35, -1.05] }, // heavy wind-up over the shoulder
        { u: 0.42, p: [0.55, 0.08, -0.3], r: [0.62, -0.38, -1.1] },
        { u: 0.58, p: [-0.45, -0.62, -0.75], r: [-1.6, 0.6, 1.2] }, // massive sweep
        { u: 0.8, p: [-0.4, -0.66, -0.7], r: [-1.5, 0.55, 1.1] },
        { u: 1, p: [0.22, -0.52, -0.62], r: [-0.4, 0.2, -0.55] },
      ],
    ],
    trailRoll: [0.6],
  },
  staff: {
    id: 'staff', name: 'Жезл телекинеза', magic: true,
    rest: { p: [0.3, -0.5, -0.6], r: [-0.18, 0.1, -0.08] },
    cast: { p: [0.22, -0.36, -0.72], r: [-0.85, 0.12, -0.1] },
  },
  item: {
    id: 'item',
    rest: { p: [0.26, -0.3, -0.5], r: [0.1, 0.4, 0] },
    swings: [
      [
        { u: 0, p: [0.26, -0.3, -0.5], r: [0.1, 0.4, 0] },
        { u: 0.3, p: [0.2, -0.18, -0.35], r: [0.8, 0.4, 0] },
        { u: 0.6, p: [0.15, -0.25, -0.8], r: [-0.6, 0.2, 0] },
        { u: 1, p: [0.26, -0.3, -0.5], r: [0.1, 0.4, 0] },
      ],
    ],
    duration: 0.5,
  },
};
