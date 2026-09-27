// Global layout constants for the handcrafted + procedural world.
export const WORLD = {
  seed: 1337,
  size: 520, // terrain side length in meters
  segments: 260,
  waterLevel: 0.4,
  playRadius: 185, // invisible boundary
  village: { x: 0, z: 0, radius: 34, height: 3.2 },
  lake: { x: 18, z: -78, radius: 34 },
  pond: { x: -92, z: 40, radius: 14 },
  spawn: { x: 4, z: 34 },
  // Dirt paths as polylines (x, z)
  paths: [
    [[0, 0], [6, -20], [10, -40], [14, -52]],
    [[0, 0], [-20, 10], [-45, 22], [-78, 36]],
    [[0, 0], [4, 25], [10, 55], [30, 90], [40, 130]],
    [[0, 0], [28, 4], [60, -2], [100, 12]],
  ],
};
