import * as THREE from 'three';

// Procedural gradient sky dome with sun disc, moon and twinkling stars.
export class Sky {
  constructor() {
    this.uniforms = {
      topColor: { value: new THREE.Color('#3b78c4') },
      horizonColor: { value: new THREE.Color('#bcd6e8') },
      groundColor: { value: new THREE.Color('#6f7f86') },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color('#fff2d0') },
      starIntensity: { value: 0 },
      time: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_Position.z = gl_Position.w; // push to far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor, horizonColor, groundColor, sunDir, sunColor;
        uniform float starIntensity, time;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55));
          col = mix(col, groundColor, smoothstep(0.0, -0.25, h));
          // Sun glow + disc
          float sd = max(dot(d, sunDir), 0.0);
          col += sunColor * pow(sd, 8.0) * 0.35 * smoothstep(-0.2, 0.1, sunDir.y);
          col += sunColor * pow(sd, 64.0) * 0.6;
          col += sunColor * smoothstep(0.9993, 0.9997, sd) * 4.0;
          // Warm horizon band near the sun at dusk/dawn
          float dusk = 1.0 - smoothstep(0.0, 0.35, abs(sunDir.y));
          col += vec3(1.0, 0.45, 0.2) * dusk * pow(sd, 3.0) * (1.0 - smoothstep(0.0, 0.4, h)) * 0.55;
          // Moon opposite to the sun
          vec3 moonDir = normalize(vec3(-sunDir.x, -sunDir.y, -sunDir.z + 0.2));
          float md = dot(d, moonDir);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9988, 0.9992, md) * starIntensity * 1.5;
          col += vec3(0.4, 0.5, 0.7) * pow(max(md, 0.0), 60.0) * starIntensity * 0.25;
          // Stars
          if (starIntensity > 0.01 && h > 0.0) {
            vec3 sp = d * 220.0;
            vec3 cell = floor(sp);
            float s = hash(cell);
            if (s > 0.985) {
              vec3 f = fract(sp) - 0.5;
              float star = smoothstep(0.18, 0.0, length(f));
              float tw = 0.6 + 0.4 * sin(time * 3.0 + s * 100.0);
              col += vec3(0.9, 0.95, 1.0) * star * tw * starIntensity * smoothstep(0.0, 0.25, h);
            }
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }

  update(cameraPos, time) {
    this.mesh.position.copy(cameraPos);
    this.uniforms.time.value = time;
  }
}
