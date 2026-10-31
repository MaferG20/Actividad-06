// DIRECCIÓN DE LA API (PHP + MySQL). Es lo ÚNICO que cambia para que Live Server hable con tu servidor/hosting.
//   · Todo en el mismo servidor (Apache/hosting):  './api'
//   · Frontend en Live Server y API en un hosting: la URL completa de la carpeta api/ en el hosting, SIN barra final, p. ej.
//       'https://mi-sitio.infinityfreeapp.com/practica-06-geovisualizacion/api'
// También puedes probar sin editar nada abriendo la página con  ?api=https://tu-hosting/.../api
const enLiveServer = ['5500', '5501'].includes(location.port);
window.P06_API = enLiveServer ? 'http://localhost/practica-06-geovisualizacion/api' : './api';
