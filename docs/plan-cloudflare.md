# Plan: pasar la web a Cloudflare

Estado: **solo plan**. No hay nada publicado en Cloudflare: la cuenta está vacía (sin Workers, KV,
bases de datos ni R2), y no hay dominio comprado. Cada paso que toque la web real, Firebase o
dinero necesita el «sí» del entrenador.

## Por qué

- **Publicar solo la app.** Hoy GitHub Pages sirve el repositorio entero (`scripts/`, `docs/`,
  `functions/`, reglas…). Con Cloudflare se publica solo una carpeta de salida con lo que la app necesita.
- **Cabeceras de seguridad** (CSP, `X-Frame-Options`, caché por archivo), que GitHub Pages no permite.
- **Dominio propio**, independiente de GitHub.

## Qué usar

- **Workers con archivos estáticos** (*Workers Static Assets*). Es lo que Cloudflare recomienda
  para proyectos nuevos; Pages sigue funcionando, pero las novedades van a Workers.
- Admite `_headers` y `_redirects` en la carpeta publicada. Límite: 25 MiB por archivo
  (`index.html` pesa ~1,2 MB).
- Sin servidor propio: la app sigue hablando directamente con Firebase.

## Lo que ya existe

- Rama **local** `cloudflare/copia-pruebas` (sesión del rediseño, no subida a GitHub).
  Un script arma una carpeta con solo los archivos de la app y el ayudante de inicio de sesión de
  Google, en «modo copia de pruebas» o «modo real». Es el punto de partida; no se ha tocado.

## Carpeta de salida (lo único que se publicaría)

```
index.html
manifest.webmanifest
firebase-messaging-sw.js
apple-touch-icon.png, icon-192.png, icon-512.png
shared/safe-save.js, shared/copia-aditiva.js, shared/client-catalog.js, shared/campos-cliente.js
auth/code-identity.js
ui/coach-nav.js, ui/coach-home.js, ui/coach-calendar.js, ui/coach-library.js, ui/design-system.css
_headers
```

El script de empaquetado debe **fallar** si falta un archivo que `index.html` carga, y nunca debe
copiar `config/`, `reglas-despliegue/`, `functions/.env*`, copias ni claves.

## Cabeceras propuestas (`_headers`)

Primero en **modo informe** (`Content-Security-Policy-Report-Only`) una o dos semanas: la app tiene
cientos de `onclick` en línea y carga vídeos e imágenes de varios sitios, así que una CSP estricta
rompería cosas. Cuando el informe esté limpio, se pasa a `Content-Security-Policy`.

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://firebasestorage.googleapis.com; frame-src https://www.youtube.com https://player.vimeo.com https://drive.google.com https://jorgecgcoach.github.io https://*.firebaseapp.com; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'

/index.html
  Cache-Control: no-cache

/firebase-messaging-sw.js
  Cache-Control: no-cache
```

Los archivos con `?v=…` (módulos de `shared/`, `auth/`, `ui/`) pueden ir con caché larga cuando el
empaquetado ponga la versión en el nombre; mientras tanto, caché corta.

## Pasos

| # | Paso | Riesgo | Necesita «sí» |
| --- | --- | --- | --- |
| 1 | Terminar el script de empaquetado y probarlo en local (comprobar que la carpeta solo tiene lo de arriba). | Ninguno | No |
| 2 | Publicar en `*.workers.dev` en **modo copia de pruebas**, con un proyecto de Firebase de pruebas y sin datos reales. Probar acceso, guardado, fotos, avisos y la app instalada en iPhone. | Bajo | Sí (cuenta de Cloudflare) |
| 3 | Decidir y comprar el **dominio propio** (Cloudflare lo vende a precio de coste). | Coste anual | Sí |
| 4 | Preparar Firebase para la nueva dirección: dominios autorizados, dirección de vuelta de Google (OAuth), restricción de la clave de API por dominio. | Medio | Sí, paso a paso |
| 5 | Ventana de cambio: publicar en el dominio nuevo, avisar a los clientes y dejar la web antigua avisando/redirigiendo. | Medio | Sí |
| 6 | Seguimiento 1–2 semanas y retirar GitHub Pages cuando nadie use la dirección antigua. | Bajo | Sí |

## Riesgos de cambiar la dirección de la app

- **Cada dirección tiene su propio almacenamiento** del navegador: los clientes vuelven a escribir su
  código y el entrenador vuelve a iniciar sesión.
- **Series pendientes sin subir.** Si un móvil tiene series guardadas sin sincronizar, se quedan en la
  dirección antigua. La web antigua debe seguir funcionando durante la ventana para que suban, y
  solo después avisar o redirigir.
- **iPhone:** el icono instalado apunta a la dirección antigua; hay que reinstalarlo.
- **Inicio de sesión con Google:** hoy `authDomain` es `jorgecgcoach.github.io` (repositorio ayudante
  `jorgecgcoach.github.io`). Con dominio propio, el ayudante se sirve desde el dominio nuevo y hay que
  añadirlo en Firebase (dominios autorizados) y en Google Cloud (OAuth). Se prueba antes en modo copia.
- **Notificaciones:** los tokens de aviso van ligados a la dirección; cada cliente las vuelve a activar.
- **Lo que no cambia:** las reglas de Firebase, los datos y los trabajos diarios de GitHub Actions.

## Vuelta atrás

Mientras GitHub Pages siga publicando `main`, volver atrás es simplemente usar la dirección antigua.
Por eso no se retira hasta el paso 6.
