# Huginn

[Huginn](https://github.com/huginn/huginn) es un sistema de agentes libre y
autoalojado que vigilan la web por usted y actúan según lo que encuentran: una
página que cambia, un feed RSS, un precio, el tiempo, un correo, un webhook.
Cada agente crea **eventos** que otros agentes transmiten. Esta integración
lleva sus agentes a Gladys: cada uno se convierte en un dispositivo (funciona,
último evento, eventos guardados, mensaje de error), las escenas reaccionan
cuando **cualquier** agente crea un evento o pasa a tener error, Gladys puede
enviar un evento a un Webhook Agent o ejecutar un agente, y un widget del panel
muestra los últimos eventos.

Probada con un Huginn real (imagen Docker `ghcr.io/huginn/huginn`); todavía no
en todas las instalaciones: sus comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-huginn/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Huginn, accesible desde la máquina de Gladys (en la red local, o en Internet
  por HTTPS).
- Una cuenta de Huginn: su usuario (o correo electrónico) y su contraseña.

Huginn no tiene clave de API: la integración inicia sesión con la cuenta, como
su navegador, y lee las páginas de la interfaz en JSON. Solo ve los agentes de
esa cuenta. Una cuenta dedicada sirve, siempre que los agentes que quiera
seguir le pertenezcan.

## Puesta en marcha

### 1. Elegir la cuenta

Use su propia cuenta de Huginn, o cree una para Gladys (sus agentes son los que
Gladys ve). La integración nunca modifica un agente, salvo para ejecutarlo
cuando una escena lo pide.

### 2. Configurar la integración

En Gladys, abra la integración y luego su pestaña **Configuración**:

- **Dirección de Huginn**: la dirección con la que abre Huginn, con el puerto,
  por ejemplo `http://192.168.1.2:3000`. También funciona una dirección copiada
  del navegador.
- **Usuario o correo electrónico** y **Contraseña**: la cuenta de arriba.
- **Intervalo de actualización**: con qué frecuencia Gladys lee Huginn (1 minuto
  por defecto). Tres peticiones por lectura cuando no ha pasado nada, algunas
  más tras nuevos eventos.
- **Aceptar certificados autofirmados**: solo para una dirección `https://`
  cuyo certificado tampoco acepta su navegador.
- **Idioma de los nombres**: el idioma de los nombres de las funciones, de las
  fechas y de los resultados de escena (francés por defecto).

Guarde y pulse **Probar la conexión**: muestra el número de agentes, los que
tienen error y los eventos de las últimas 24 horas.

Una contraseña rechazada se prueba **una sola vez**: Huginn bloquea una cuenta
tras 10 inicios de sesión fallidos. La integración vuelve a probar cuando
guarda la configuración o pulsa **Probar la conexión**.

### 3. Añadir los agentes

La pestaña **Descubrir** muestra un dispositivo **Huginn** y un dispositivo por
agente. Añada los que quiera ver en Gladys. Los disparadores de escena
funcionan para todos los agentes, añadidos o no.

## Los dispositivos

Cada agente tiene:

- **Funciona**: encendido mientras el agente no tiene un error reciente (un
  error registrado después de su último evento, o menos de 2 minutos antes,
  como lo cuenta Huginn).
- **Último evento**: un breve extracto de su último evento (su título, su
  mensaje o su texto; si no, su contenido en JSON).
- **Fecha del último evento**: la fecha y la hora de su último evento.
- **Eventos guardados**: los eventos que Huginn guarda para este agente
  (caducan tras la duración configurada en el agente).
- **Mensaje de error**: la primera línea de su error más reciente mientras
  tiene error, «Ninguno» si no.

El dispositivo **Huginn** cuenta los **Agentes**, los **Agentes con error**, los
**Agentes desactivados**, los **Eventos en 24 h** y los **Jobs fallidos (5 días)** (las tareas en segundo plano de Huginn que han fallado, de todas las
cuentas).

## Panel

El widget **Eventos de Huginn** muestra los eventos de las últimas 24 horas y
los agentes con error, luego una fila por agente, el evento más reciente
arriba: nombre, extracto de su último evento (o su error), fecha y una
insignia «Error». Los agentes con error van primero. Al tocar una fila se abre
el detalle.

En sus ajustes, **Agentes** lo limita a los dispositivos elegidos (solo se
pueden elegir los dispositivos añadidos a Gladys); el mosaico de las 24 horas
desaparece entonces, cuenta toda la instancia.

## Escenas

### Disparadores

Se disparan para todos los agentes, añadidos a Gladys o no. Deje **Agentes**
vacío para reaccionar a cualquiera, o elija algunos.

- **Un agente crea un evento**: un agente de Huginn ha creado un evento.
  Variables: nombre del agente, extracto (500 caracteres como máximo),
  contenido (el evento en JSON, 1000 caracteres como máximo), número del
  evento. 20 eventos por lectura como máximo, los más recientes: un agente que
  crea cientos de golpe no inunda Gladys.
- **Un agente pasa a tener error**: un agente ha registrado un error y no ha
  creado ningún evento desde entonces. Una vez, hasta que vuelva a funcionar.
  Variables: nombre del agente, mensaje de error.
- **Huginn no está accesible**: Huginn deja de responder (dos lecturas fallidas
  seguidas). Variable: el motivo.
- **Huginn responde de nuevo**: Huginn responde de nuevo, con la duración de la
  caída en minutos.

Un evento creado durante un reinicio de Gladys o de la integración se anuncia
igualmente, una vez. No se anuncia nada en la primera lectura.

### Acciones

- **Enviar un evento a Huginn**: envía un texto a un **Webhook Agent**, que lo
  convierte en un evento de Huginn. Un objeto JSON se envía tal cual
  (`{"sala": "salón"}`), cualquier otro texto como `{"text": "…"}`. Se pueden
  insertar valores de la escena. Salidas: aceptado, estado HTTP, respuesta de
  Huginn. El agente debe aceptar `post` en sus `verbs` (por defecto). La
  dirección del webhook, con su secreto, se lee del agente: nada que copiar.
- **Ejecutar un agente de Huginn**: Huginn comprueba el agente ahora (una
  página, un feed, un resumen) en lugar de esperar a su programación. Sus
  eventos disparan después los disparadores de arriba, en la lectura
  siguiente.
- **Último evento de un agente**: lee el último evento de un agente para las
  acciones siguientes. Salidas: extracto, contenido (JSON), fecha (ISO 8601),
  funciona, mensaje de error y una frase preparada («Agente: extracto»).

### Ideas de escenas

- **Vigilancia de un precio**: disparador «Un agente crea un evento» en un
  Website Agent que sigue un precio → enviar un mensaje «💶 …» con el
  «Extracto».
- **Gladys alimenta Huginn**: cuando se activa la alarma → «Enviar un evento a Huginn» con `{"alarma": "on", "hora": "…"}`; un escenario de Huginn lo
  registra o lo añade al resumen de la noche.
- **Agente averiado**: disparador «Un agente pasa a tener error» → enviar un
  mensaje «⚠️ Huginn: … (…)» con «Nombre del agente» y «Mensaje de error».
- **Resumen de la mañana**: cada día a las 7:30 → «Ejecutar un agente de Huginn» en el agente del tiempo, y un minuto después «Último evento de un agente» → decir la «Frase».

## Solución de problemas

- **«Inicio de sesión rechazado»**: compruebe el usuario (o el correo) y la
  contraseña y guarde. «Your account is locked» en los registros de la
  integración: Huginn ha bloqueado la cuenta tras demasiados fallos;
  desbloquéela (por correo, o espere una hora) y guarde.
- **«Huginn no responde»**: compruebe la dirección y el puerto (3000 por
  defecto) desde la máquina de Gladys. `localhost` es el propio contenedor de
  la integración: use la dirección IP de la máquina donde se ejecuta Huginn.
- **«Certificado rechazado»**: el certificado HTTPS es autofirmado o ha
  caducado; marque «Aceptar certificados autofirmados», o use la dirección
  `http://` en la red local.
- **«No hay ningún Huginn en esta dirección»**: la dirección apunta a otro
  servicio, o a una subruta que no es la de Huginn.
- **«La dirección redirige»**: introduzca la dirección `https://`.
- **«Este agente no es un Webhook Agent»**: «Enviar un evento a Huginn»
  necesita un Webhook Agent (un agente con una opción `secret` escrita en claro, no una credencial Liquid).
- **«Huginn ha rechazado el evento (HTTP 401)»**: el secreto del Webhook Agent
  ha cambiado; la integración lo vuelve a leer en la lectura siguiente, pruebe
  de nuevo.
- **«Funciona» sigue apagado**: el agente ha registrado un error después de su
  último evento. Abra sus registros en Huginn; se vuelve a encender con su
  próximo evento.

## Límites

- Huginn no tiene API REST: la integración lee las páginas JSON de la interfaz
  web con una sesión. Una versión futura de Huginn podría cambiarlas.
- Un agente de otra cuenta no se ve; los jobs fallidos se cuentan para toda la
  instancia.
- «Funciona» solo sigue los errores registrados; la columna «Working?» de
  Huginn también comprueba, para algunos tipos de agentes, que los eventos
  llegan con suficiente frecuencia.
- Se leen como máximo 8 páginas de 25 eventos nuevos por actualización: más
  allá, los eventos se cuentan pero no se anuncian ni se extractan.
- Los eventos de las últimas 24 horas se cuentan por hora (la hora más antigua
  cuenta entera).
- Los agentes se crean, modifican y eliminan en Huginn; Gladys solo envía
  eventos a los Webhook Agents y ejecuta agentes.
