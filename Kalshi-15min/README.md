# COMUNIDAD JD + Kalshi — target, % up/down y tendencia

Tres piezas:

0. **Ventana flotante** — doble clic en [abrir_kalshi_flotante.bat](abrir_kalshi_flotante.bat).
   El panel de Kalshi para los contratos cripto de 15 min, siempre encima de tu chart.
   Ver la sección [Ventana flotante](#ventana-flotante).
1. **[comunidad_jd_kalshi.pine](comunidad_jd_kalshi.pine)** — el indicador para
   TradingView. Tu COMUNIDAD JD intacto + línea del target de Kalshi de izquierda a
   derecha + % UP/DOWN arriba a la derecha + tabla de tendencia (día / 1 hora / 15 min)
   abajo a la izquierda.
2. **Página local** (`python server.py`) — lo mismo pero con los datos de Kalshi en
   vivo, para cuando no quieras estar copiando números.

## Ventana flotante

Doble clic en **`abrir_kalshi_flotante.bat`**. Se abre sin consola, queda siempre encima
y recuerda dónde la dejaste y qué moneda tenías. Solo Python estándar (Tkinter), nada
que instalar.

| En pantalla | De dónde sale |
|---|---|
| `Target · 5:45pm` y el precio | `open_time` (en hora del Este, como Kalshi) y `floor_strike` del contrato |
| `Now ↑ $20.03` y el precio | **El índice con el que Kalshi liquida**, leído del mismo endpoint que usa su página. Verde si va arriba del target, rojo si va abajo |
| `Up · 70%` / `Down · 30%` | **Último precio operado**, acotado al bid/ask vigente; Down = 100 − Up. En tiempo real: sale del libro de órdenes + último trade (~1 actualización por segundo, retraso medido 0.07 s de mediana) |
| `1.38x` / `3.18x` | Lo que paga $1 **neto de comisión**: `1 ÷ (ask + 0.07·m·ask·(1−ask))`, con `m` = `fee_multiplier` que publica la serie. Verificado contra Kalshi: ask 0.71 → `1.38x`, ask 0.30 → `3.18x` |
| `Cierra en 07:42` + barra | Cuenta regresiva a `close_time`; ámbar < 60 s, rojo < 15 s |
| Todo en gris + aviso rojo | El dato tiene más de 6 s o falló la red: **no se pinta como vivo** un precio viejo |
| Fichas BTC, ETH, SOL… | Cripto: todas las series `KX<moneda>15M` con contratos, leídas de la API |
| Fichas GOLD, SILVER, NATGAS, WTI, COPPER, PLAT, PALL | Materias primas de 15 min (categoría *Commodities* de Kalshi), también leídas de la API |

Al cerrar un contrato salta sola al siguiente. **Arrastra** desde cualquier punto;
**clic derecho** para abrir el contrato en Kalshi, quitar "siempre encima", cambiar a
hora local o cerrar. También cierra con la `×` o `Esc`.

**Cosas que debes saber:**

- **El `%` va en tiempo real, no por la lista de mercados.** La lista de la API
  (`/markets?series_ticker=…`) Kalshi la sirve desde una caché de **15 s**
  (`Cache-Control: max-age=15`, medido con `Age: 14`): usarla para el `%` daba hasta 15 s de
  retraso. Ahora solo se usa para lo que no cambia dentro de un contrato (ticker, target,
  horas). El `%` y los multiplicadores salen de `/markets/{ticker}/orderbook` y
  `/markets/trades`, que no tienen caché. Si el libro no responde, la ventana cae a la
  lista y **lo avisa en ámbar** en el pie.
- **La regla del `%` es una deducción**, con dos observaciones reales: con bid/ask 70/71 la
  app mostraba `70`, y con 44/45 la web mostraba `45`. Ni el bid, ni el ask, ni el punto
  medio explican las dos; el último precio operado sí. Si ves una diferencia constante de
  ±1 contra la app, la regla está en `chance()` en [kalshi_flotante.py](kalshi_flotante.py).

- **"Now" es el mismo número que ves en Kalshi**, en las 16 fichas. Sale de
  `api.elections.kalshi.com/v1/live_data/assets/<símbolo>/1s`, el endpoint que usa la
  propia página de Kalshi (oro responde literalmente `Metal.Index.1OZGOLD/USD`, el feed
  de sus reglas). Verificado: dato de menos de 1 s, y el signo de `Now − Target` coincide
  con el lado que favorece el mercado en 16 de 16. Cripto usa el nombre pelado (`BTC`);
  materias primas: `PYTH:GOLD`, `PYTH:SILVER`, `PYTH:NATGAS`, `PYTH:PYTHOIL` (WTI),
  `PYTH:COPPER`, `PYTH:XPT` (platino), `PYTH:XPD` (paladio).
- **Ese endpoint es público pero no está documentado**, así que Kalshi puede cambiarlo sin
  avisar. Si deja de responder, el pie de la ventana lo dice: cripto cae a Coinbase
  (*aproximado*, pie en ámbar: difiere unos dólares del índice) y materias primas quedan
  en *no disponible* — para ellas no hay sustituto público que sirva: los futuros de oro
  van ~$36 desviados y el gas natural de Yahoo un 4.7 % (es otro contrato), y en contratos
  de 15 min eso pondría la flecha al revés.
- Las materias primas tienen horario: fuera de él puede no haber contrato abierto, y el
  índice deja de emitir. En ese caso "Now" dice ***sin ticks ahora*** — es normal, no un
  fallo. *No disponible* se reserva para cuando el endpoint de verdad no respondió (y
  entonces se le da una pausa de 15 s —60 s si es por exceso de peticiones— antes de
  reintentar, para no frenar el resto de la ventana).
- **Las pastillas Up/Down no compran nada.** Es solo lectura: sin API key, sin órdenes,
  pasa por el mismo candado `assert_read_only()` de `server.py`.

Si algo falla con `pythonw` no hay consola: los errores quedan en `kalshi_flotante.log`.

## El indicador de TradingView

**Pine Script no puede llamar APIs.** No tiene funciones de red: corre en los
servidores de TradingView y solo ve datos de mercado. Por eso el target y el % de
Kalshi entran como **inputs** (Ajustes del indicador → grupo *Kalshi*):

| Input | Qué es |
|---|---|
| Target (strike) de Kalshi | El precio del mercado, p.ej. `81249.99`. Con `0` no se dibuja la línea |
| YES % de Kalshi | Precio del YES en centavos = probabilidad UP. DOWN = 100 − YES |
| Nombre del mercado | Opcional, solo para la etiqueta |

Para no buscarlos a mano:

```bash
python kalshi_now.py
```

imprime los dos números listos para pegar (strike más cercano al spot de BTC; acepta
`serie`, `par` y `ticker` como argumentos).

La tabla de tendencia usa **el mismo SuperTrend V1.0** de tu script, pedido en `D`,
`60` y `15` con `request.security` (`lookahead_off`, sin asomarse al futuro). Muestra
dirección y cuántas velas lleva sin girar. Tus 10 plots y las 4 alertas quedan
exactamente como estaban.

Verificado en el Pine Editor de TradingView: **0 errores**. Queda un aviso informativo
(*"v5 está desactualizado, usa v6"*) — se dejó en v5 a propósito para no tocar la
semántica de tu script.

## Qué se portó del Pine

La matemática vive en [indicators.py](indicators.py) y replica las funciones de Pine
tal como las define TradingView (verificado contra cálculo manual al decimal):

| Plot del Pine | Aquí | Cómo se calcula |
|---|---|---|
| 1. SuperTrend (verde/rojo) | línea bicolor | `hl2 ± Factor·ATR(Pd)`; ATR = RMA de Wilder con semilla SMA |
| 2–3. Up / Down Arrow | flecha chica | cruce del cierre con la línea SuperTrend |
| 4–5. Entry Arrow | `LONG` / `SHORT` | giro de `Trend` (+1 ↔ −1) |
| 6. EMA | línea azul | `ta.ema(close, 20)` con semilla SMA |
| 7–8. 고가선 / 저가선 | canal rosa / verde | `highest(close, 8)` / `lowest(close, 8)` |
| 9–10. Buy / Sell | flecha con texto | cruce con la EMA, la vela confirma dirección |

`ta.cross` es bidireccional, igual que en Pine. Los parámetros (`factor`, `pd`, `len`)
van por query string con los mismos defaults (3, 7, 20).

**La tabla de tendencia usa el estado de SuperTrend** por temporalidad: dirección,
velas desde el giro (`62v`), % de cambio desde el giro, y un punto que indica si la
EMA 20 confirma (verde) o contradice (rojo).

Las alertas del Pine no se portaron: en la página el estado ya está a la vista.

## Cómo se corre

```bash
python server.py
```

Luego abre <http://localhost:8787>. No hay que instalar nada: solo librería estándar de Python.

## Modo solo lectura

- **No usa API key.** Los datos de mercado de Kalshi (`/markets`, `/events`, `/series`)
  son públicos y no piden autenticación.
- El servidor solo hace `GET`. No existe `do_POST` ni ninguna ruta de escritura.
- `assert_read_only()` es un candado duro: bloquea cualquier URL que toque
  `/portfolio`, `/orders`, `/positions`, `/fills` o `/balance`, y solo deja pasar
  las rutas de la lista `READ_ONLY_PREFIXES`.
- Los valores que vienen de la URL se escapan con `safe=""` para que no se puedan
  salir de la ruta.

Aunque le pusieras una llave, no podría operar: no hay código que mande órdenes.

## Por qué hace falta un servidor y no solo un HTML

- Kalshi responde **403 si la petición trae cabecera `Origin`** → el navegador no
  puede llamarla directo. El proxy local no reenvía `Origin`.
- Binance responde **451** desde US. Las velas salen de Coinbase.

## Configuración

Por query string:

| Parámetro | Default | Qué es |
|---|---|---|
| `series` | `KXBTCD` | Serie de Kalshi |
| `product` | `BTC-USD` | Par en Coinbase para las velas |
| `ticker` | *(auto)* | Mercado fijo. Si se omite, toma el strike más cercano al spot |

Ejemplo para Ethereum:

```
http://localhost:8787/?series=KXETHD&product=ETH-USD
```

Para ver todos los strikes abiertos de una serie:

```
http://localhost:8787/api/markets?series=KXBTCD
```

## Cómo se decide la tendencia

Por cada temporalidad manda el estado de SuperTrend (`Trend` = +1 alcista, −1 bajista).
Se marca *fuerte* cuando el precio está a más de 1 % de la línea **y** la EMA 20 confirma.
La lógica está en `summarize()` en [indicators.py](indicators.py).

## Nota sobre TradingView

Pine Script **no puede llamar APIs externas**, así que este indicador no se puede
portar tal cual a TradingView con datos de Kalshi en vivo. Por eso es una página aparte.
