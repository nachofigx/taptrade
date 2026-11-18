# Poner el tuner a trabajar en tu VPS de Hostinger

El tuner reajusta las cuotas del juego con precios reales de Coinbase cada 6 horas y las publica para que el juego las lea.
Todo corre en tu VPS, **sin abrir puertos, sin dominio y sin HTTPS**.

```
Coinbase (precios públicos)  ->  VPS: baja operaciones nuevas, simula, ajusta, valida
                                      |  si el guardián aprueba
                                      v
                     GitHub, rama `odds-data` (odds.json + status.json)
                                      |
                                      v
              El juego lee https://raw.githubusercontent.com/nachofigx/taptrade/odds-data/odds.json
              (si no hay archivo válido, usa el odds.json del sitio y, si no, las tablas integradas)
```

## Requisitos
- VPS con **Debian o Ubuntu** y acceso `root` por SSH (en Hostinger: hPanel -> VPS -> Acceso SSH). Si tu VPS usa otra distribución, dímelo.
- 1 vCPU y 1 GB de RAM alcanzan. Medido en pruebas locales: el cálculo más pesado (BTC, 25 h) usó ~190 MB de pico y ~1 minuto.
  El servicio tiene un tope de 900 MB.
- ~1 GB de disco. Salida a internet (descarga de `api.exchange.coinbase.com`, `github.com`).

## Pasos

**1. Conéctate por SSH y descarga el instalador**
```bash
ssh root@TU_IP
apt-get update && apt-get install -y git
git clone https://github.com/nachofigx/taptrade.git /tmp/taptrade-setup
bash /tmp/taptrade-setup/deploy/setup.sh
```
El instalador crea un usuario sin privilegios (`tapline`), instala Node 20 si hace falta, deja el código en `/opt/tapline`,
genera una **clave de despliegue** y activa el temporizador. Al final imprime la clave pública.

**2. Autoriza la clave en GitHub** (para que el VPS solo pueda escribir en este repositorio)
Repositorio -> *Settings* -> *Deploy keys* -> *Add deploy key* -> pega la clave pública -> marca **Allow write access**.

**3. Primera ejecución**
```bash
sudo systemctl start --no-block tapline-tuner
journalctl -fu tapline-tuner         # Ctrl+C para dejar de seguir
```
La primera vez baja 48 horas de operaciones (BTC es lo más pesado: del orden de 15 a 20 minutos). Las siguientes solo bajan lo nuevo.
Al terminar debe aparecer la rama `odds-data` en GitHub. Comprueba que abre:
`https://raw.githubusercontent.com/nachofigx/taptrade/odds-data/odds.json`
(GitHub puede tardar unos 5 minutos en reflejar un cambio).

**4. Verifica en el juego**: perfil -> *Dificultad*. Debe decir "cuotas del tuner con datos hasta ...".
Si el archivo tiene más de 36 horas de antigüedad, el juego lo avisa en ese mismo texto.

## Cómo saber si va bien
```bash
systemctl list-timers tapline-tuner.timer      # próxima ejecución
cat /var/lib/tapline/status.json               # resultado de la última: published | refused | failed
journalctl -u tapline-tuner -n 60 --no-pager   # registro completo
```
- `published`: cuotas nuevas publicadas.
- `refused`: el **guardián** rechazó las cuotas nuevas (por ejemplo, vio ventaja clara para el jugador en el backtest reciente).
  Es normal de vez en cuando; se mantienen las anteriores. Si pasa durante muchas ejecuciones seguidas, avísame.
- `failed`: algo técnico (red, clave de GitHub). El mensaje lo explica.

## Qué pasa si el VPS se cae
Nada grave: el juego sigue funcionando con la última versión publicada, luego con el `odds.json` del sitio y, si no, con las tablas
integradas. Solo se van quedando viejas (el perfil avisa a las 36 h).

## Seguridad: qué puede y qué no puede hacer
- El VPS solo tiene una **clave de despliegue de este repositorio**, no tu token personal ni acceso a tu cuenta.
- El servicio corre sin privilegios y con restricciones de systemd (solo escribe en `/var/lib/tapline` y `/opt/tapline`).
- El juego **valida** cada archivo de cuotas: aunque alguien comprometa el VPS, solo podría mover las probabilidades dentro de unos
  rangos acotados (factores de 0,5x a 2x), no poner cuotas absurdas.
- **Punto a tener en cuenta:** cada ejecución hace `git pull --ff-only` del repositorio y ejecuta ese código. Quien pueda hacer
  `push` a `main` controla lo que corre en el VPS. Mantén `main` protegido. Para desactivarlo: `UPDATE_CODE=0` en el servicio.

## Mantenimiento
```bash
sudo systemctl stop tapline-tuner.timer && sudo systemctl disable tapline-tuner.timer      # pausar
sudo systemctl start --no-block tapline-tuner                                                # ejecutar ya
sudo sed -i 's/HOURS=48/HOURS=24/' /etc/systemd/system/tapline-tuner.service && sudo systemctl daemon-reload   # ventana menor
```
Para desinstalar: `systemctl disable --now tapline-tuner.timer`, borrar `/etc/systemd/system/tapline-tuner.*`, `/opt/tapline`, `/var/lib/tapline`
y el usuario con `userdel tapline`. Después quita la *deploy key* en GitHub.

## Alternativa con dominio propio
Si algún día prefieres servir el archivo desde el VPS (con un dominio y HTTPS, por ejemplo con nginx + certbot), copia
`/var/lib/tapline/odds.new.json` a la carpeta web, añade `Access-Control-Allow-Origin: *`, y pon esa URL primero en `config.js`.
No es necesario con el flujo de arriba.

## Qué está probado y qué no
- **Probado** (con datos reales de Coinbase, publicando a un repositorio Git local de prueba): descarga incremental, simulación, ajuste, guardián,
  publicación en la rama `odds-data`, segunda ejecución, rechazo del guardián (el servicio no se marca como fallido), fallo de subida (sí se marca).
  También que el archivo publicado lo acepta el validador del juego.
- **No probado**: la instalación en un VPS real. No se ejecutaron `setup.sh`, systemd, la instalación de Node por `apt`, ni la clave de despliegue
  con GitHub, porque desde mi entorno no puedo llegar a tu servidor. Si algo falla, pega el mensaje de error y lo corregimos.
