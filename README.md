# Tacto MVP · prototipo funcional genérico

Proyecto separado de `tacto-main`. `tacto-main` se utilizó únicamente como referencia y no se modificó.

## Qué contiene

- Una sala MQTT compartida, con QR para abrir el control en teléfonos.
- Identificación por dispositivo y nombre, presencia en línea y estado de conexión.
- Lectura en vivo de posición táctil, cantidad de dedos, inclinación y aceleración.
- Carrera por toques y prueba de equilibrio por inclinación.
- Puntuación local en la pantalla principal.
- Pantalla de teléfono y cliente MQTT de Tacto reutilizados sin credenciales del broker guardadas en el proyecto.

## Estructura y responsabilidades

| Archivo | Función |
| --- | --- |
| `server.js` | Servidor HTTPS, broker Aedes por WebSocket (`/mqtt`) y TCP (1883), entrega de páginas, `/info` y QR. Es la infraestructura de Tacto reutilizada. |
| `package.json` / `package-lock.json` | Dependencias y comando de inicio del servidor. |
| `public/index.html` | Control móvil de Tacto: tacto, giro opcional, capacidades, nombre e identificador persistente. |
| `public/tacto.js` | Cliente MQTT reutilizado: crea/recuerda sala, conecta, escucha `tacto/<sala>/#`, identifica dispositivos y aplana mensajes en canales consultables con `get()`. |
| `public/exp.html` | Pantalla principal de partida y visualización Canvas 2D. |
| `public/mvp.js` | Lógica de la sala, jugadores, sensores, minijuegos y puntuación. |
| `public/config.js` | Configuración neutral. Vacía para que Tacto detecte el broker local. No contiene credenciales. |
| `public/ui.css` | Estilos reutilizados por el control móvil. |
| `public/vendor/mqtt.min.js` | Cliente MQTT del navegador, servido localmente. |
| `public/manifest.webmanifest`, `public/icon.svg` | Instalación opcional del control como acceso directo. |

## Cómo viajan los datos

El teléfono conserva el esquema Tacto: publica su presencia en `tacto/<sala>/<dispositivo>/status` y sensores en `.../touch` y `.../motion`. La experiencia se suscribe a la sala, conserva un registro por ID de dispositivo y consulta canales como `touch.x`, `touch.down`, `ang.g` y `acc.x`. El estado de conexión usa mensaje retenido y último testamento; el cliente reutilizado reconecta si se interrumpe MQTT.

El proyecto no incluye un servidor de usuarios ni persiste puntos: la sala y la partida viven en la pantalla principal. Los navegadores pueden asignar valores de presión distintos o no ofrecerlos; la posición táctil y la inclinación son las entradas de esta primera prueba.

## Inicio

Requisitos: Node.js 18 o superior y npm. En esta carpeta:

```powershell
npm install
node server.js
```

Abre en el computador la dirección `/exp` que imprime el servidor. Acepta el certificado local y escanea el QR. Conecta el computador y los teléfonos a la misma red. Si aparece más de una dirección de red, usa la dirección que puedan alcanzar los teléfonos.

La página móvil y el movimiento requieren HTTPS para acceder a los sensores con permisos. El certificado generado localmente es autofirmado; cada dispositivo puede pedir que se acepte la primera vez. El micrófono y la cámara de Tacto permanecen disponibles como canales experimentales, pero no son necesarios para estos dos juegos.

## Pruebas rápidas

1. Inicia el servidor y abre `/exp`; verifica que indique conectado y muestre código de sala y QR.
2. Abre el QR en dos teléfonos, asigna nombres distintos y conecta.
3. Confirma que aparecen dos jugadores identificados y que cambian los valores de sensores.
4. Inicia la carrera: cada toque nuevo avanza al jugador; el primero en llegar suma un punto.
5. Cambia a equilibrio: inclina el teléfono lateralmente; sostenerlo cerca del centro durante cinco segundos suma un punto.
6. Cambia a una sala nueva y comprueba que queda vacía hasta que entren dispositivos.

## Validación realizada en esta entrega

Se comprobó sintaxis con `node --check` para el servidor, el cliente de Tacto y la lógica del MVP, además de la estructura JSON del manifiesto. No se pudo ejecutar una prueba de conexión real en este entorno: no hay npm ni `node_modules` instalados. Después de instalar dependencias, se requiere la comprobación con teléfonos y una red local descrita arriba.
