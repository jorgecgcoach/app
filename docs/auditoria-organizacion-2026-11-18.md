# Auditoría de organización · 18-11-2026

Hecha solo leyendo (GitHub, Google Cloud/Firebase, Cloudflare y el PC). Sin datos personales.

**Nota global antes de ordenar: 6/10.** La app funciona y es bastante segura; lo flojo era la
organización y, sobre todo, la forma de publicar la web.

## Notas por área

| Área | Antes | Tras la limpieza del 18-11 | Qué falta para el 10 |
| --- | --- | --- | --- |
| Seguridad de secretos | 8 | 8 | Restringir la clave de API web por dominio; revisar la 2.ª clave de `firebase-adminsdk-fbsvc`. |
| Pruebas | 7 | 7 | Subir el workflow «Pruebas» (preparado) y arreglar `test:funciones` (ver abajo). |
| Documentación | 6 | 9 | Mantener el README al día. |
| Repositorios en GitHub | 5 | 9 | Decidir el PR borrador nº 1. |
| Estructura del código | 5 | 5 | Seguir sacando piezas de `index.html` a módulos (`ui/`, `shared/`), poco a poco y con pruebas. |
| Orden en el PC | 4 | 8 | Cerrar las carpetas que aún tienen trabajo sin fusionar cuando se terminen. |
| Publicación y empaquetado | 4 | 4 | Publicar solo una carpeta de salida (plan de Cloudflare). |
| Preparación para Cloudflare | 6 | 7 | Dominio propio y prueba con un proyecto de Firebase de pruebas. |

## Hallazgos

1. **Se publica todo el repositorio, no solo la app.** GitHub Pages sirve la carpeta entera:
   `firestore.rules`, `docs/`, `scripts/`, `functions/`, `e2e/`… La app solo necesita unos 20 archivos.
   No es una filtración nueva (el repositorio ya es público), pero no deberían estar en la web.
   → Se resuelve publicando solo una carpeta de salida ([plan-cloudflare.md](plan-cloudflare.md)).
2. **`main` no tenía protección.** Un push directo publicaba la web al instante.
   → Resuelto: `main` exige PR. Cuando se suba el workflow «Pruebas», exigirá también pruebas en verde.
3. **Desorden en GitHub:** ramas fusionadas sin borrar, ramas `cursor/…` viejas, sin README ni
   Dependabot. → Resuelto: ramas fusionadas borradas, las no fusionadas archivadas como etiquetas
   `archivo/…`, README, Dependabot y borrado automático de ramas al fusionar.
4. **Las pruebas no se ejecutan solas.** → Preparado en la rama `organizacion/workflows`. Subirlo necesita
   el permiso `workflow` en el acceso de GitHub de este PC, que hay que aprobar en el navegador.
5. **Todo el código en un archivo** (`index.html`, ~1,2 MB, >10.000 líneas). Pendiente, a largo plazo.
6. **PC desordenado:** varias carpetas de trabajo y la principal en una rama antigua.
   → Ordenado: la carpeta principal está en `main`; carpetas ya fusionadas, retiradas.
7. **Google Cloud / Firebase** (no se ha cambiado nada, requiere tu «sí»):
   - la clave de API web no tiene restricción por dominio (no es secreta por diseño, pero conviene limitarla);
   - `firebase-adminsdk-fbsvc` tiene 2 claves creadas por usuario; una está en el secreto de GitHub
     y hay que confirmar si la otra sobra;
   - `firestore-recuperador` y la base de recuperación siguen existiendo;
   - alertas de presupuesto: no comprobadas (falta permiso).
8. **Sin cabeceras de seguridad.** GitHub Pages no permite CSP ni controlar la caché.
   → Se resolverá con `_headers` en Cloudflare.
9. **Workflows diarios sin permisos explícitos.** → Preparado (`permissions: contents: read`), misma rama y mismo motivo.

## Pruebas sobre `main` (e1fee60), 18-11-2026

| Suite | Resultado |
| --- | --- |
| `test:unidad` | 182/182 |
| `test` | 36/36 |
| `test:seguridad` | 95/95 |
| `test:migracion` | 23/23 |
| `test:reglas-despliegue` | 96/96 |
| `test:copias` | 21/21 |
| `test:copias-unidad` | 22/22 |
| `test:funciones` | **5/6** |

`test:funciones` falla en «el entrenador da el alta… el cliente entra y solo ve la suya».
Es un fallo **antiguo**: la prueba es del 10-11 y las reglas del 11-11 (guardia `_rev` y campos
del cliente) la dejaron atrás. Afecta solo a las altas por servidor, que **no están desplegadas**
(`ALTAS_SERVIDOR=false`, requiere plan Blaze). No afecta a la web publicada. Arreglarlo es
actualizar la prueba antes de activar esa función.

## Estado de C1 (solo lectura, 18-11-2026)

- 24 cuentas en Authentication: el entrenador (Google + contraseña) y 23 clientes, ninguno desactivado.
- 15 de 23 clientes ya han entrado con su código nuevo.
- Reglas publicadas: Firestore y Storage definitivas de C1, sin cambios desde la ventana.

## Orden recomendado a partir de aquí

1. Cloudflare en modo copia de pruebas, con un proyecto de Firebase de pruebas y sin datos reales.
2. Decidir el dominio propio.
3. Restringir la clave de API web y revisar claves y cuentas de servicio (con tu «sí», de día).
4. Migrar la web a Cloudflare con ventana y aviso a los clientes.
5. Seguir troceando `index.html` sin prisa.
