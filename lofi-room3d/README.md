# Habitació amb vistes

Escena lofi en **pixel art 3D**: una noia amb cascos estudia i treballa amb l'ordinador al costat de la finestra d'un pis alt, amb la ciutat i el mar al fons. El cel passa de la nit estrellada a l'alba, el dia i la posta; de tant en tant plou (amb llamps si toca) i passen coloms, que de vegades es posen a l'ampit i fan despertar el gat. Tot va acompanyat de música lofi generada en directe i d'efectes de so.

## Com obrir-la

- Fes doble clic a `index.html` (funciona directament des del disc, sense servidor), o bé
- serveix la carpeta: `python3 -m http.server` i obre `http://localhost:8000`.

Prem **Comença** perquè soni la música (els navegadors només deixen engegar l'àudio després d'un clic).
La tipografia del títol es carrega de Google Fonts; sense connexió se'n fa servir una del sistema.

## Controls

| Tecla | Acció |
| --- | --- |
| `H` o `Tab` | mostra / amaga el panell |
| `F` o doble clic | pantalla completa |
| `Espai` | música sí / no |
| `N` | una altra cançó |
| `M` | silenci |
| `1` `2` `3` `4` | nit estrellada · sortida del sol · dia · posta |
| `←` `→` | hora enrere / endavant |
| `R` | canvia el temps (serè → pluja → tempesta → automàtic) |
| `L` | un llamp |
| `C` | crida un colom |

Des del panell pots triar el moment del dia (cicle, hora real o aturat, i quant dura un dia), el temps que fa, què fa la noia, el flexo, les llumetes, els coloms, el gat i l'espelma, el volum de cada so per separat (música, vinil, pluja, trons, ciutat, ocells i coloms, habitació) i l'aspecte de la imatge (mida del píxel, contorns, resplendor, gra i fotogrames per segon). Els ajustos es desen al navegador.

## Com està fet

Tot és procedural: no hi ha cap imatge ni cap so gravat.

- **Imatge**: [three.js](https://threejs.org) r159 (a `vendor/`) renderitza l'escena a baixa resolució i el navegador l'amplia sense suavitzar. Materials amb la llum quantitzada en esglaons i tramat de Bayer, contorns a partir de la profunditat i les normals, resplendor i una gradació de color suau.
- **Exterior** (`js/outside.js`): cel, sol, lluna, estrelles, mar amb el reflex del sol o la lluna, núvols (cúmuls de pixel art i capa de temps tapat), ciutat amb finestres que s'encenen de nit, far, vaixells, avions, gavines, pluja i llamps.
- **Habitació** (`js/room.js`): finestra amb un vidre que mostra l'exterior amb gotes i regalims, escriptori, flexo, portàtil amb la pantalla animada, plantes que es gronxen, llumetes, rellotge amb l'hora de l'escena i la pols que sura a la llum.
- **Personatges** (`js/characters.js`, `js/pigeons.js`): la noia amb braços amb cinemàtica inversa (teclejar, escriure, beure, pensar, mirar per la finestra i moure el cap al ritme), el gat i els coloms.
- **So** (`js/audio.js`): Web Audio pur. Hip-hop lofi generatiu (progressions jazzístiques, Rhodes, baix, bateria amb swing, melodies, vinil i cinta) que s'adapta a l'hora i a la pluja, més pluja, trons, ciutat, ocells, coloms, teclat, llapis i el ronc del gat.
- **Temps** (`js/timeofday.js`, `js/weather.js`): paleta del cicle del dia i estats del temps.
- **Interfície** (`js/ui.js`, `css/style.css`).
