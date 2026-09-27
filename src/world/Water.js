import * as THREE from 'three';
import { WORLD } from './WorldConfig.js';

// Stylized animated water: vertex waves, fresnel sky reflection, sun glints, shore foam by depth.
export class Water {
  constructor(terrain, dayNight) {
    this.dayNight = dayNight;
    const size = 700;
    const geo = new THREE.PlaneGeometry(size, size, 140, 140);
    geo.rotateX(-Math.PI / 2);
    // Bake water depth per vertex for shore foam + shallow color
    const pos = geo.attributes.position;
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      depth[i] = WORLD.waterLevel - terrain.getHeight(pos.getX(i), pos.getZ(i));
    }
    geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));

    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        deepColor: { value: new THREE.Color('#0f3b4f') },
        shallowColor: { value: new THREE.Color('#2f8a8a') },
        skyColor: { value: new THREE.Color('#9cc4e0') },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color('#ffffff') },
        daylight: { value: 1 },
      },
    ]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      fog: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float time;
        attribute float depth;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNormal;
        #include <fog_pars_vertex>
        void main() {
          vec3 p = position;
          float w1 = sin(p.x * 0.18 + time * 1.2) * cos(p.z * 0.14 + time * 0.9);
          float w2 = sin(p.x * 0.45 - p.z * 0.35 + time * 2.1);
          p.y += (w1 * 0.08 + w2 * 0.03);
          vec3 n = normalize(vec3(-cos(p.x * 0.18 + time * 1.2) * 0.02 - cos(p.x * 0.45 - p.z * 0.35 + time * 2.1) * 0.013,
                                  1.0,
                                  sin(p.z * 0.14 + time * 0.9) * 0.015 + cos(p.x * 0.45 - p.z * 0.35 + time * 2.1) * 0.01));
          vNormal = n;
          vDepth = depth;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float time, daylight;
        uniform vec3 deepColor, shallowColor, skyColor, sunDir, sunColor;
        varying float vDepth;
        varying vec3 vWorld;
        varying vec3 vNormal;
        #include <fog_pars_fragment>
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          if (vDepth < -0.4) discard;
          vec2 uv = vWorld.xz;
          float n1 = vnoise(uv * 0.6 + vec2(time * 0.3, time * 0.2));
          float n2 = vnoise(uv * 1.7 - vec2(time * 0.25, -time * 0.35));
          vec3 n = normalize(vNormal + vec3((n1 - 0.5) * 0.18, 0.0, (n2 - 0.5) * 0.18));
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          float d = clamp(vDepth / 3.5, 0.0, 1.0);
          vec3 col = mix(shallowColor, deepColor, d);
          col = mix(col, skyColor, 0.25 + fres * 0.6);
          vec3 H = normalize(sunDir + V);
          float spec = pow(max(dot(n, H), 0.0), 180.0) * 2.5 * max(sunDir.y + 0.1, 0.0);
          col += sunColor * spec;
          // Shore foam
          float foam = smoothstep(0.35, 0.0, vDepth) * (0.6 + 0.4 * sin(time * 2.0 + vWorld.x * 0.8 + n1 * 6.0));
          col = mix(col, vec3(0.9, 0.95, 0.95) * (0.4 + 0.6 * daylight), foam * 0.55);
          float alpha = mix(0.55, 0.92, d) + fres * 0.1;
          alpha *= smoothstep(-0.4, 0.05, vDepth);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WORLD.waterLevel;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'water';
  }

  update(time) {
    const u = this.uniforms;
    u.time.value = time;
    const dn = this.dayNight;
    u.sunDir.value.copy(dn.sunDir.y > -0.05 ? dn.sunDir : dn.sunDir.clone().negate().setZ(0.2).normalize());
    u.sunColor.value.copy(dn.sun.color).multiplyScalar(Math.min(1, dn.sun.intensity / 2));
    u.skyColor.value.copy(dn.sky.uniforms.horizonColor.value).lerp(dn.sky.uniforms.topColor.value, 0.35);
    u.daylight.value = dn.daylight;
    u.deepColor.value.setRGB(0.02, 0.1, 0.14).multiplyScalar(0.3 + 0.7 * dn.daylight);
    u.shallowColor.value.setRGB(0.07, 0.3, 0.3).multiplyScalar(0.3 + 0.7 * dn.daylight);
  }
}
