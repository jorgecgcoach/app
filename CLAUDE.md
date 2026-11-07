# CLAUDE.md — jorgecgcoach/app

Instrucciones para Claude Code (local y GitHub Actions). Idioma de trabajo: **español (es-ES)** en
comentarios, mensajes de commit, descripciones de PR y respuestas.

## Qué es este repo
App web (PWA) de JorgeCGCoach para clientes de coaching online.
- `index.html` — la app completa (HTML + CSS + JS en un único archivo, ~1,1 MB). **Edita con cambios
  localizados** (buscar/reemplazar acotado). Nunca reescribas ni reformatees el archivo entero.
- `firebase-messaging-sw.js` — service worker de Firebase Cloud Messaging (notificaciones push).
- `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png` — PWA.
- `notify/` (`notify.js`, `package.json`) y `negocio-avisos.js` — scripts Node ejecutados por los
  workflows `.github/workflows/notify.yml` y `negocio-avisos.yml` (avisos / recordatorios de pago).
- Backend: Firebase (Auth, Firestore/Realtime DB, Cloud Messaging). La configuración pública del SDK
  web de Firebase puede estar en `index.html`; eso es normal. Las claves privadas NO.

## Reglas obligatorias
1. **Cero secretos.** Nunca añadas, imprimas ni muevas a código: tokens, claves de cuenta de servicio,
   `FIREBASE_*` privados, contraseñas, `CLAUDE_CODE_OAUTH_TOKEN`, etc. Los secretos viven solo en
   *GitHub → Settings → Secrets and variables → Actions*. Si detectas un secreto en el código, avisa en
   el PR; no lo copies.
2. **Cero datos de clientes.** No pegues ni generes datos reales de clientes (nombres, teléfonos,
   emails, estado de salud, dolor, lesiones, notas clínicas, pagos). Para pruebas usa datos ficticios
   (`Cliente Demo`, `+34600000000`, `demo@example.com`).
3. **PRs pequeños.** Un cambio = una rama `claude/...` = un PR. Máx. ~200 líneas cambiadas salvo que
   Jorge lo pida. Nunca hagas push directo a `main` ni merge: Jorge revisa y fusiona.
4. **No tocar sin permiso explícito** en el issue/comentario: reglas de seguridad de Firebase
   (`firestore.rules`, `database.rules.json`, `storage.rules`), autenticación/login (aplazado por
   decisión de Jorge), workflows de `.github/workflows/`, lógica de cobros/recordatorios de pago,
   textos legales/privacidad.
5. **Pruebas.** Antes de proponer el PR:
   - JS de Node (`notify/`, `negocio-avisos.js`): `node --check <archivo>`; si hay tests, ejecútalos.
   - `index.html`: verifica que el HTML sigue bien formado y que no rompes el JS (sin errores de
     sintaxis en bloques `<script>` modificados). Describe en el PR cómo probarlo a mano (pasos en
     móvil y escritorio).
   - Si añades lógica nueva no trivial, añade un test mínimo o explica por qué no.
6. **Sin dependencias nuevas** ni servicios de pago sin aprobación explícita.
7. **Compatibilidad PWA/móvil:** no rompas el service worker, el manifest ni las notificaciones push.

## Formato del PR
- Título: `tipo: resumen` (tipos: `fix`, `feat`, `refactor`, `docs`, `chore`).
- Descripción en español: **Qué cambia**, **Por qué**, **Cómo probarlo**, **Riesgos**, issue enlazado.

## Si hay dudas
Pregunta en el comentario antes de hacer cambios grandes o ambiguos. Mejor un plan corto que un PR enorme.
