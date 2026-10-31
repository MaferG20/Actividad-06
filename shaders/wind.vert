uniform float uTime;
uniform float uWind;
varying vec3 vNormal;
varying float vHeight;

void main() {
  vNormal = normalMatrix * normal;
  vHeight = position.y;
  vec3 pos = position;
  
  // Viento sincronizado y uniforme: Todos los vértices balancean en la misma fase y dirección X/Z
  float factorAltura = max(0.0, pos.y);
  float despl = sin(uTime * 2.2) * 0.06 * uWind * factorAltura;
  
  pos.x += despl;
  pos.z += despl * 0.4;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}