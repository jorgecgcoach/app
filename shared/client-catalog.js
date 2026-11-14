/* =======================================================================
   Catálogo de vídeos para clientes (C1 · H1, opción A).
   -----------------------------------------------------------------------
   Con AUTH_ENABLED el cliente ya no descarga clients/coach_data (ahí están
   los códigos, el negocio y el CRM). Pero hoy ve el vídeo de un ejercicio
   que no lo trae en su entrenamiento buscando por nombre en la biblioteca
   propia del entrenador (DATA.exLibrary, dentro de coach_data).

   Este catálogo es un documento aparte, catalog/exercises, con lo MÍNIMO:
   { n: nombre, v: vídeo general } de los ejercicios propios que tienen vídeo.
   Nada más: ni descripción, ni «vídeo del entrenador», ni datos de clientes.
   Lo escribe el entrenador (solo si cambia) y lo lee cualquier sesión.

   index.html lo carga con <script src> y las pruebas con require().
   ======================================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClientCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ITEMS = 3000;
  const MAX_NAME = 200;
  const MAX_URL = 500;

  const key = n => String(n == null ? '' : n).trim().toLowerCase();

  function cleanUrl(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s || s.length > MAX_URL || /\s/.test(s)) return '';
    return /^https:\/\/[^/]+\.[^/]+/i.test(s) || /^http:\/\/[^/]+\.[^/]+/i.test(s) ? s : '';
  }

  function cleanName(n) {
    const s = String(n == null ? '' : n).trim();
    return s && s.length <= MAX_NAME ? s : '';
  }

  // Misma regla que libVideoByName en index.html: gana la PRIMERA entrada con ese nombre,
  // y si esa entrada no tiene vídeo, el cliente no ve vídeo (igual que hoy).
  function build(exLibrary) {
    const seen = new Set();
    const items = [];
    (Array.isArray(exLibrary) ? exLibrary : []).forEach(x => {
      if (!x || typeof x !== 'object') return;
      const n = cleanName(x.n);
      const k = key(n);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const v = cleanUrl(x.v);
      if (v) items.push({ n, v });
    });
    items.sort((a, b) => (key(a.n) < key(b.n) ? -1 : key(a.n) > key(b.n) ? 1 : 0));
    return { items: items.slice(0, MAX_ITEMS) };
  }

  // Lo que se recibe de la nube se vuelve a limpiar: solo { n, v } de texto y enlaces http(s).
  function sanitize(items) {
    return build((Array.isArray(items) ? items : []).map(x => (x && typeof x === 'object' ? { n: x.n, v: x.v } : null))).items;
  }

  function signature(items) {
    return JSON.stringify((Array.isArray(items) ? items : []).map(x => [key(x && x.n), String((x && x.v) || '')]));
  }

  return { build, sanitize, signature, MAX_ITEMS };
});
