# SENSES PARTY

**Juego colectivo en el que los teléfonos son los controles y una pantalla compartida es el escenario.**

Una persona abre la *consola del anfitrión* en un computador o proyector. Los demás escanean un código QR con su teléfono y entran a la misma sala. Desde ahí compiten en minijuegos que usan los sensores del teléfono: **pantalla táctil, giroscopio, micrófono y cámara**. Quien gana rondas suma puntos y el primero en llegar a cinco se lleva la corona.

> Una pantalla. Muchos controles. Cada partida cambia cuando todos entran en juego.

---

## Índice

1. [Qué hace](#qué-hace)
2. [Los minijuegos](#los-minijuegos)
3. [Campeonato, corona y cajas sorpresa](#campeonato-corona-y-cajas-sorpresa)
4. [Cómo funciona por dentro](#cómo-funciona-por-dentro)
5. [Tecnologías y bibliotecas](#tecnologías-y-bibliotecas)
6. [Requisitos](#requisitos)
7. [Instalación y uso](#instalación-y-uso)
8. [Variables de entorno](#variables-de-entorno)
9. [Rutas del servidor](#rutas-del-servidor)
10. [Modos de despliegue](#modos-de-despliegue)
11. [Estructura del proyecto](#estructura-del-proyecto)
12. [Protocolo MQTT (Tacto)](#protocolo-mqtt-tacto)
13. [Solución de problemas](#solución-de-problemas)
14. [Notas de privacidad](#notas-de-privacidad)

---

## Qué hace

- **Consola del anfitrión** (`/exp`): muestra el escenario del juego, el código QR de la sala, el estado de la conexión, la latencia y la corona. Tiene un **modo proyección** para mostrar solo lo importante en una pantalla grande.
- **Control del jugador** (`phone.html`): se abre desde el navegador del teléfono, sin instalar nada. Envía táctil, movimiento, audio y cámara en tiempo real.
- **Salas**: cada partida vive en una sala identificada por un código corto (por ejemplo `k7m2xq`). El código viaja en el QR y en la URL (`?sala=...`).
- **Campeonato automático**: una secuencia de minijuegos que se encadenan solos, con pausa y detención, además de la opción de lanzar una sola ronda.
- **Multijugador local**: los teléfonos se conectan por Wi‑Fi al computador anfitrión; el servidor trae su propio broker MQTT embebido, así que **no necesitas internet ni cuentas externas** para jugar en red local.

---

## Los minijuegos

| Minijuego | Sensor | Cómo se gana |
|---|---|---|
| **Carrera de toques** (`tap`) | Pantalla táctil | Gana quien llegue primero a **100 toques**. Cada dedo nuevo suma 1 (hasta 10 dedos a la vez). Los eventos duplicados se descartan. |
| **Torre en equilibrio** (`tilt`) | Giroscopio / orientación | Dura **60 s**. Hay que inclinar el teléfono para mantenerse dentro de la franja verde, que se mueve. Gana quien acumule más tiempo dentro. |
| **Caza de colores** (`color`) | Cámara | Dura **30 s**. La pantalla pide hasta 5 colores en orden aleatorio y el jugador debe apuntar la cámara a un objeto de ese color. Se compara el tono (hue) y se exige una saturación mínima. |
| **Acierta la nota** (`voice`) | Micrófono | La pantalla reproduce un sonido (registro grave, medio o agudo, con distintas ondas y modificadores como vibrato, trémolo, glissando…) y cada jugador, por turnos, tiene **3 s** para cantar la nota. Gana quien tenga menor error medio en centésimas (*cents*). |

Notas:

- La **Torre en equilibrio** solo entra en el campeonato si al menos un teléfono está enviando datos de giro reales.
- La **Caza de colores** solo entra si algún teléfono puede usar la cámara (se le pide activarla antes de empezar).
- Las reglas de los minijuegos están aisladas en `public/game-engines.js` y **no dependen del DOM ni de MQTT**, por lo que pueden probarse por separado.

---

## Campeonato, corona y cajas sorpresa

- Cada victoria en un minijuego suma **1 punto**.
- La **corona se alcanza con 5 puntos** (`CROWN_TARGET`). Quien la logra es el campeón y termina el campeonato.
- Cada **2 juegos completados** (`SPIN_EVERY`) cada jugador recibe una **caja sorpresa** que abre desde su teléfono. Hay tres cajas y el resultado es:
  - 💥 **Sabotaje**: el jugador elige a un rival y le quita **1 punto**.
  - 🛡 **Escudo**: bloquea el próximo sabotaje que reciba.
  - … **Nada**.
- Entre rondas, la pantalla de resultados dura más tiempo cuando hay cajas pendientes por abrir.
- El botón **Reiniciar campeonato** borra puntos, escudos y cajas.

> En la consola del anfitrión ya no existe el panel "Rumbo a la corona". Los puntos se siguen mostrando en el marcador de la proyección y en la pantalla de resultados, y las cajas se abren únicamente desde los teléfonos.

---

## Cómo funciona por dentro

```
 Teléfono (phone.html)                 Servidor Node (server.js)              Anfitrión (exp.html)
 ─────────────────────                 ──────────────────────────            ────────────────────
 táctil · giro · mic · cámara  ──MQTT/WSS──►  broker Aedes embebido  ──MQTT/WSS──►  mvp.js + game-engines.js
                               ◄──comandos──                         ◄──estado───   (lógica, puntos, dibujo)
```

1. El servidor Express entrega los archivos estáticos de `public/` por **HTTPS** (certificado autofirmado) y levanta un **broker MQTT** (Aedes).
2. Los navegadores se conectan al broker con **MQTT sobre WebSocket** en `/mqtt`. Herramientas externas (Arduino/ESP32, Node-RED, Python, MQTT Explorer…) pueden usar **MQTT sobre TCP** en el puerto `1883`.
3. Cada teléfono publica sus lecturas en temas como `tacto/<sala>/<dispositivo>/touch`, `/motion`, `/mic` y `/cam`. Además publica un mensaje *retained* de estado con **"último testamento"** (`online:false`) para detectar caídas.
4. La consola se suscribe a la sala, convierte los mensajes en **canales planos** (`touch.x`, `ang.g`, `mic.pitch`, `cam.hue`…) y ejecuta la lógica del juego.
5. La consola envía **comandos** a cada teléfono (por ejemplo, "hay una caja disponible", "elige un objetivo para el sabotaje") y mide la latencia con mensajes `cmd`/`pong`.

La capa de comunicación se llama **Tacto** (`public/tacto.js`) y es reutilizable: cualquier otra experiencia web puede hacer `new Tacto()`, `await t.connect()` y leer `t.get('touch.x')`.

---

## Tecnologías y bibliotecas

El proyecto **no usa ningún framework de frontend** (ni React, Vue ni similares): el cliente es HTML, CSS y JavaScript puro. El dibujo del escenario se hace sobre `<canvas>`.

### Dependencias de Node.js (`package.json`)

| Biblioteca | Versión | Para qué se usa |
|---|---|---|
| [`express`](https://expressjs.com/) | ^4.19.2 | Servidor HTTP/HTTPS y entrega de archivos estáticos. |
| [`aedes`](https://github.com/moscajs/aedes) | ^1.2.0 | Broker MQTT embebido en el mismo proceso. |
| [`ws`](https://github.com/websockets/ws) | ^8.18.0 | WebSocket del servidor para MQTT sobre WebSocket (`/mqtt`). |
| [`mqtt`](https://github.com/mqttjs/MQTT.js) | ^5.10.1 | Cliente MQTT. Su bundle de navegador (`mqtt.min.js`) se sirve localmente en `/vendor`. |
| [`qrcode`](https://github.com/soldair/node-qrcode) | ^1.5.4 | Genera el código QR (SVG) con la URL de la sala. |
| [`selfsigned`](https://github.com/jfromaniello/selfsigned) | ^2.4.1 | Genera el certificado HTTPS autofirmado, incluyendo las IPs de la red local. |

### Bibliotecas y recursos del lado del cliente

| Recurso | Uso |
|---|---|
| **MQTT.js 5.10.1** (`public/vendor/mqtt.min.js`) | Cliente MQTT en el navegador. Va incluido en el proyecto, así que funciona sin internet. Si no se pudiera cargar, `tacto.js` usa como respaldo `https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js`. |
| **Google Fonts** | Tipografías **Bungee** (títulos), **Space Grotesk** (texto) e **IBM Plex Mono** (etiquetas y datos). Requieren internet; sin conexión se usan las fuentes de respaldo del sistema. |
| **Broker público EMQX** (`wss://broker.emqx.io:8084/mqtt`) | Solo como último recurso si la página no se sirve desde este servidor (por ejemplo, en GitHub Pages). Cualquiera puede leer sus temas, por eso la sala es un código aleatorio. |

### APIs nativas del navegador

- **Canvas 2D**: escenario de los minijuegos y superficie táctil del teléfono.
- **Touch / Pointer events**: posición, presión y diámetro de hasta 5 dedos.
- **DeviceOrientation y DeviceMotion**: giroscopio y aceleración (en iOS requieren `requestPermission()`).
- **getUserMedia**: micrófono y cámara (solo en contexto seguro HTTPS).
- **Web Audio API**: análisis del micrófono (`AnalyserNode`, bandas de graves/medios/agudos, detección de tono) y síntesis de los sonidos del juego de voz.
- **Screen Wake Lock**: evita que el teléfono apague la pantalla durante la partida.
- **Vibration API**: respuesta háptica en los toques (no disponible en iPhone).
- **localStorage**: recuerda la sala y el nombre del jugador.
- **Web App Manifest** (`manifest.webmanifest`): el control puede añadirse a la pantalla de inicio como app (modo `standalone`, orientación vertical).

---

## Requisitos

- **Node.js 20 o superior** (recomendado) y npm.
- Un computador para el anfitrión y teléfonos en la **misma red Wi‑Fi** (o un hotspot).
- Navegador moderno en los teléfonos (Chrome o Safari). Para micrófono y cámara hace falta abrir el control por el enlace **HTTPS**.
- Para un buen rendimiento del giroscopio, un teléfono con sensores de movimiento.

---

## Instalación y uso

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor
npm start
```

Al arrancar, la terminal muestra algo como:

```
  Tacto
  Experiencia (laptop):   https://localhost:8443/exp
  Teléfonos entran a:     https://192.168.1.20:8443
  Broker MQTT:  wss://localhost:8443/mqtt   ·   tcp :1883
```

**Pasos para jugar**

1. En el computador abre `https://localhost:8443/exp` (o `https://<IP>:8443/`). El navegador avisará que el certificado no es de confianza porque es autofirmado: acepta continuar.
2. Pulsa **Entrar a la sala**. Verás el **código QR** de la sala.
3. Cada jugador escanea el QR con su teléfono, acepta el certificado y escribe su nombre. Se pedirán permisos de movimiento, micrófono y cámara cuando un juego los necesite.
4. Elige un minijuego y pulsa **Iniciar ronda**, o pulsa **Iniciar campeonato** para encadenar los juegos automáticamente.
5. Usa **Ver proyección** para mostrar el escenario a pantalla completa y **Volver a consola** para regresar.

**Controles de la consola**

| Botón | Acción |
|---|---|
| Nueva sala | Genera un código de sala nuevo (hay que volver a escanear el QR). |
| Ver proyección / Volver a consola | Alterna el modo de proyección. También se puede abrir con `?vista=proyector`. |
| Minijuego + Iniciar ronda | Juega una sola ronda del reto elegido. |
| Iniciar campeonato | Encadena los minijuegos disponibles hasta que alguien consiga la corona. |
| Pausar / Detener | Controlan el campeonato en curso. |
| Reiniciar campeonato | Pone puntos, escudos y cajas en cero. |

---

## Variables de entorno

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `8443` | Puerto HTTPS (o HTTP) del servidor. |
| `HTTP` | — | Con `HTTP=1` se sirve por HTTP plano, útil detrás de un túnel o hosting que ya pone el HTTPS. |
| `MQTT_TCP` | `1883` | Puerto MQTT sobre TCP. `0` lo desactiva. |
| `PUBLIC_URL` | — | URL pública que se usa en el QR (por ejemplo, la de un túnel). |
| `HOST_IP` | automática | Fuerza la IP que se anuncia a los teléfonos cuando hay varios adaptadores de red (hotspot, USB, Wi‑Fi…). |

Ejemplos:

```bash
# Forzar una IP concreta
HOST_IP=192.168.43.1 npm start

# Detrás de un túnel con HTTPS propio
HTTP=1 PUBLIC_URL=https://mi-tunel.example.com npm start

# Cambiar el puerto
PORT=9000 npm start
```

En Windows (PowerShell): `$env:HOST_IP="192.168.43.1"; npm start`.

El servidor ignora automáticamente los adaptadores virtuales (WSL, Hyper‑V, VirtualBox, VMware, Docker) al elegir qué IP mostrar, porque los teléfonos no pueden llegar por ellos.

---

## Rutas del servidor

| Ruta | Descripción |
|---|---|
| `/` | Consola del anfitrión (`public/index.html`). |
| `/exp` | La misma consola (`public/exp.html`). |
| `/phone.html?sala=<código>` | Control del jugador. |
| `/info` | JSON con la URL base y los puertos MQTT. |
| `/qr.svg?u=<url>` | QR en SVG de la URL indicada (por defecto, la URL base). |
| `/mqtt` | Endpoint de MQTT sobre WebSocket. |
| `/vendor/*` | Archivos de `node_modules/mqtt/dist` (respaldo local del cliente MQTT). |

---

## Modos de despliegue

**1. Red local (recomendado).** `npm start` y los teléfonos entran por la IP del computador. Todo funciona sin internet, salvo las fuentes de Google.

**2. Túnel o hosting con HTTPS.** Ejecuta con `HTTP=1` y define `PUBLIC_URL`. El servidor sigue incluyendo el broker MQTT.

**3. Sitio estático (por ejemplo, GitHub Pages).** El `index.html` de la raíz redirige a `public/` conservando `?sala=...` y el hash. Sin servidor Node no hay broker embebido ni `/qr.svg`: el cliente usará el broker público de EMQX o el que definas en `public/config.js`, y el QR se oculta.

**Broker propio.** Edita `public/config.js`:

```js
window.TACTO_CONFIG = {
  broker: 'wss://mi-broker.example.com:8084/mqtt',
  username: 'usuario',   // opcional
  password: 'clave'      // opcional
};
```

También se puede indicar en la URL con `?broker=wss://...`. Orden de prioridad: parámetro `?broker=` → `config.js` → broker embebido del servidor → broker público.

---

## Estructura del proyecto

```
.
├── index.html            Redirección a public/ (para GitHub Pages)
├── server.js             Servidor Express + HTTPS autofirmado + broker MQTT (Aedes)
├── package.json
├── package-lock.json
└── public/
    ├── index.html        Consola del anfitrión (portada, escenario, controles)
    ├── exp.html          Copia de la consola, servida en /exp
    ├── phone.html        Control del jugador (táctil, giro, micrófono, cámara)
    ├── mvp.js            Lógica del campeonato, rondas, cajas, dibujo y proyección
    ├── game-engines.js   Reglas puras de TapRace, ColorHunt y NoteChallenge
    ├── tacto.js          Cliente MQTT y catálogo de canales de sensores
    ├── config.js         Configuración opcional del broker
    ├── ui.css            Estilos (tema oscuro, tipografías, responsive)
    ├── icon.svg          Icono de la app
    ├── manifest.webmanifest
    └── vendor/mqtt.min.js
```

---

## Protocolo MQTT (Tacto)

Todos los mensajes son JSON.

| Tema | Retenido | Contenido |
|---|---|---|
| `tacto/<sala>/<dispositivo>/status` | Sí | `{online, name, caps}`. Incluye "último testamento" con `online:false`. |
| `tacto/<sala>/<dispositivo>/touch` | No | `{t, n, ar, p:[{i,x,y,f,d}]}`: `x`,`y` de 0 a 1, `f` presión de 0 a 1, `d` diámetro en px. |
| `tacto/<sala>/<dispositivo>/motion` | No | `{t, a:[alfa,beta,gamma]°, r:[x,y,z]°/s, c:[x,y,z] m/s²}` |
| `tacto/<sala>/<dispositivo>/mic` | No | `{t, l, p, b:[graves,medios,agudos]}`: nivel, tono estimado y bandas de frecuencia. |
| `tacto/<sala>/<dispositivo>/cam` | No | `{t, m, x, y, b, h, s}`: movimiento, centro del movimiento, brillo, tono (hue) y saturación del color. |
| `tacto/<sala>/<dispositivo>/cmd` · `pong` | No | Comandos del anfitrión y medición de latencia. |

Canales planos disponibles en la experiencia: `touch.x`, `touch.y`, `touch.f`, `touch.d`, `touch.n`, `touch.dist`, `touch.ang`, `t1..t5.*`, `ang.a/b/g`, `rot.x/y/z`, `acc.x/y/z`, `mic.level/low/mid/high/pitch`, `cam.motion/x/y/bright/hue/sat`.

Como el broker también escucha en TCP (`1883`), puedes conectar un ESP32, Node‑RED o un script de Python a la misma sala y publicar/leer estos temas.

---

## Solución de problemas

- **El teléfono no carga la página.** Verifica que esté en la misma red que el computador y que el firewall permita el puerto `8443` (y `1883` si usas MQTT por TCP). Si hay varios adaptadores, fuerza la IP con `HOST_IP`.
- **Aviso de certificado no seguro.** Es esperado: el certificado es autofirmado. Acepta continuar. Se regenera solo cuando cambian las IPs de la red.
- **No funcionan micrófono ni cámara.** Los navegadores solo los permiten en contexto seguro. Abre el control por el enlace `https://` del QR.
- **El giroscopio no responde en iPhone.** Hay que aceptar el permiso de "Movimiento y orientación" cuando se solicite.
- **La Torre en equilibrio o la Caza de colores no aparecen en el campeonato.** Se excluyen si ningún teléfono envía giro o no puede usar la cámara.
- **Un jugador se desconecta.** El "último testamento" lo marca como fuera de línea; al reconectarse puede volver a unirse a la carrera de toques en curso.
- **Los teléfonos ven otra sala.** Pulsa **Nueva sala** en la consola y vuelve a escanear el QR, o abre la URL con `?sala=<código>`.
- **Sin internet.** El juego funciona, pero las tipografías de Google no se cargan y se usan las del sistema.

---

## Notas de privacidad

- Con el servidor propio, **los datos de los sensores no salen de tu red local**: viajan teléfono → servidor → consola.
- El audio del micrófono y el vídeo de la cámara **se procesan en el propio teléfono**; solo se envían valores numéricos resumidos (nivel, tono, bandas, tono de color, movimiento), no audio ni imágenes.
- Si usas el broker público de EMQX (respaldo para sitios estáticos), cualquiera que conozca el código de sala puede leer esos mensajes. El código es aleatorio y no se debería compartir públicamente.
