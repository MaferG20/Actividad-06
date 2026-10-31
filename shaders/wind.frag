uniform vec3 uColor;
varying vec3 vNormal;
varying float vHeight;

void main() {
  vec3 luzDireccion = normalize(vec3(0.4, 1.0, 0.6));
  
  // Se usa abs(vNormal) e intensidad mínima de 0.85 para evitar zonas oscuras u opacas en los pétalos
  float difusa = max(dot(abs(vNormal), luzDireccion), 0.85); 
  
  vec3 colorBrillante = uColor * difusa * 1.05;
  gl_FragColor = vec4(colorBrillante, 1.0);
}