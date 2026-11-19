# JorgeCGCoach · app de entrenamiento

App web de una sola página para el entrenador y sus clientes: fichas, planes, registro de
entrenamiento, nutrición, negocio, copias de seguridad y avisos.

- **Web publicada:** https://jorgecgcoach.github.io/app/ (GitHub Pages, rama `main`, carpeta raíz).
- **Datos:** Firebase (Firestore + Storage + Authentication), proyecto `appjorgecgcoach`.
- **Acceso:** el entrenador entra con Google o con correo y contraseña; cada cliente, con su código
  personal (C1, activo desde el 15-11-2026). Ver [docs/despliegue-c1.md](docs/despliegue-c1.md).

> ⚠️ **El repositorio es público y todo lo que hay en `main` se publica en la web.**
> Nunca subas claves, contraseñas, códigos de clientes, datos personales ni el UID real del entrenador.
> El UID vive solo en `config/uid-entrenador.txt`, que está en `.gitignore`.

## Cómo se publica

1. Cada cambio va en una rama y llega a `main` mediante un PR.
2. El PR ejecuta las pruebas automáticas ([.github/workflows/pruebas.yml](.github/workflows/pruebas.yml)).
   `main` está protegida: no se fusiona nada con pruebas en rojo.
3. Al fusionar en `main`, GitHub Pages publica la web en 1–2 minutos.
4. **Las reglas de Firebase NO se publican con la web.** Se generan con el UID real
   (`npm run reglas:preparar`), se prueban (`npm run test:reglas-despliegue`) y se publican aparte,
   a mano y con autorización.

## Mapa del repositorio

| Carpeta / archivo | Qué es |
| --- | --- |
| `index.html` | La app entera (HTML + CSS + JS). Es lo que ve el usuario. |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`, `firebase-messaging-sw.js` | App instalable (PWA) y notificaciones. |
| `shared/` | Lógica compartida y probada: guardado seguro, catálogo de clientes, copias aditivas, avisos de negocio. |
| `auth/` | Identidad por código del cliente (C1). |
| `ui/` | Módulos del rediseño (menú, inicio, calendario, biblioteca) y `design-system.css`. |
| `firestore.rules`, `storage.rules` | Reglas de seguridad **con marcador** (`REEMPLAZAR_UID_DEL_COACH`). |
| `firestore.transicion.rules`, `firestore.congelado.rules` | Reglas de transición y de congelado (vuelta atrás sin abrir datos). |
| `firestore/` | Pruebas de reglas contra el emulador. |
| `functions/` | Altas de clientes desde el servidor (preparado, **no desplegado**: requiere plan Blaze). |
| `scripts/` | Copias de seguridad, verificación, restauración aditiva, migración C1 y sus pruebas. |
| `negocio-avisos.js`, `notify/` | Trabajos diarios de GitHub Actions (avisos de negocio y recordatorios). |
| `e2e/` | Servidor y emuladores para probar la app en local sin tocar datos reales. |
| `docs/` | Planes y decisiones (C1, rediseño, auditoría, Cloudflare). |

## Pruebas

Necesitan Node 22 y Java (para los emuladores de Firebase). Ninguna toca datos reales.

```bash
npm ci
npm run test:unidad           # lógica pura
npm run test:copias-unidad    # copias (sin emulador)
npm test                      # reglas básicas (emulador)
npm run test:seguridad        # reglas de Firestore y Storage (emulador)
npm run test:migracion        # migración C1 (emulador)
npm run test:copias           # copias completas (emulador)
```

Solo en local (no en GitHub, porque necesitan cosas que no están en el repositorio):

- `npm run test:reglas-despliegue`: prueba las reglas generadas con el UID real (`config/uid-entrenador.txt`).
- `npm run test:funciones`: necesita `npm ci` dentro de `functions/`.

## Trabajos automáticos (GitHub Actions)

| Flujo | Cuándo | Qué hace |
| --- | --- | --- |
| Pruebas | Cada PR y cada cambio de `main` | Ejecuta las pruebas. Sin secretos. |
| Avisos de negocio | Diario 05:00 UTC | Lee Firestore (solo lectura) y envía el resumen por correo. |
| Notificaciones diarias | Diario 17:00 UTC | Recordatorios de seguimiento a clientes. |

Todos tienen permisos mínimos (`contents: read`). Los secretos (`FIREBASE_SERVICE_ACCOUNT`,
`GMAIL_APP_PASSWORD`) solo existen en *Settings → Secrets* de GitHub.
Dependabot revisa las dependencias cada semana ([.github/dependabot.yml](.github/dependabot.yml)).

## Copias de seguridad

- Desde la app: «Descargar copia».
- Completa por script (solo lectura): `scripts/copia-firestore.js` y `scripts/copia-storage.js`.
- Verificar sin conectarse a nada: `scripts/verificar-copia.js`.
- Restaurar sin pisar cambios posteriores: `scripts/restaurar-copia.js` (solo con autorización).
- Las copias reales se guardan **cifradas y fuera del repositorio**.

## Documentos

- [docs/auditoria-organizacion-2026-11-18.md](docs/auditoria-organizacion-2026-11-18.md): estado de la organización y qué falta.
- [docs/plan-cloudflare.md](docs/plan-cloudflare.md): plan para pasar la web a Cloudflare.
- [docs/despliegue-c1.md](docs/despliegue-c1.md) y [docs/ventana-c1.md](docs/ventana-c1.md): acceso por cuenta (C1).
- [docs/firestore-auth.md](docs/firestore-auth.md): reglas y acceso por código.
- [docs/altas-servidor.md](docs/altas-servidor.md): altas desde el servidor (pendiente de plan Blaze).
- [docs/REDISENO-PLAN.md](docs/REDISENO-PLAN.md): rediseño visual.
