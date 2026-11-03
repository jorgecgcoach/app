# AGENTS.md — jorgecgcoach/app

Instrucciones para agentes de código (OpenAI Codex, Cursor y otros). Las reglas completas están en
`CLAUDE.md`; este archivo las resume y **ambos deben mantenerse coherentes**.

- Idioma: español (es-ES) en commits, PRs, comentarios y respuestas.
- Stack: PWA en un único `index.html` (HTML+CSS+JS, ~1,1 MB) + Firebase (Auth, BD, Cloud Messaging),
  `firebase-messaging-sw.js`, scripts Node en `notify/` y `negocio-avisos.js` lanzados por GitHub Actions.
- Edita `index.html` con cambios localizados; no lo reformatees entero.
- Nunca: secretos/tokens en código, datos reales de clientes (sobre todo datos de salud), push a `main`,
  merge, dependencias o servicios de pago nuevos.
- No tocar sin petición explícita: reglas de seguridad Firebase, login/autenticación, workflows,
  cobros/recordatorios, textos legales.
- PRs pequeños (≈200 líneas máx.), una cosa por PR, con: Qué cambia / Por qué / Cómo probarlo / Riesgos.
- Pruebas: `node --check` en JS de Node; describir prueba manual de la PWA (móvil + escritorio).
- Revisión de código (Codex `@codex review`): prioriza seguridad (secretos, reglas Firebase, XSS en
  `innerHTML`), regresiones en notificaciones push y en flujos de pago; comenta en español.
