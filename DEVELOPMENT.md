> Historical engineering notes from the original 0.33 archive. See README.md and RELEASE.md for current instructions.

# Sendwich — документация для разработки

Перенос векторов, текста и растра из **Illustrator** и **Figma** в **After Effects** одной кнопкой. Бесплатная альтернатива Overlord 2. Версия v0.33, MIT License, © 2026 Saniochk.

## 1. Состав архива

```
Sendwich/
  SendwichAE/        CEP-панель After Effects: принимает клип и строит слои; локальный сервер для Figma
    CSXS/manifest.xml    AEFT 22+, CSXS 9, --enable-nodejs --mixed-context (Node для сервера)
    index.html, css/style.css, js/main.js (панель, опрос, сервер), js/anim.js (Lottie-статус), js/csi-lite.js
    js/lottie_light.min.js  lottie-web 5.12.2 (MIT)
    anim/wait.json, anim/build.json   точечные анимации статуса (заменяемые Lottie)
    jsx/host.jsx         ExtendScript: весь построитель слоёв
    jsx/gradients.aep    шаблон проекта с 16 G-Fill + 16 G-Stroke (для цветов градиентов)
  SendwichAI/        CEP-панель Illustrator: читает выделение и пишет клип
    jsx/host.jsx         ExtendScript: чтение документа + разбор служебного SVG
    (index.html, css, js, anim — как у AE)
  SendwichFigma/     плагин Figma: manifest.json, code.js (собирается), ui.html (собирается)
  FigmaCommunity/        материалы публикации: LISTING.md, PRIVACY.md, CHECKLIST_RU.md, icon-128.png, cover-1920x1080.png
  dev/                   исходники сборки и тесты (в установку не входят)
    build_figma.py       собирает SendwichFigma/code.js и ui.html, синхронизирует анимации в панель AI
    figma-src/code_main.js, ui_tpl.html   исходники плагина
    anim/mknoise.py      генератор анимаций wait/build
    gradients/make_template.py   генератор gradients.aep (библиотека py-aep 0.18.2, MIT)
    tests/               моки Illustrator / After Effects / Figma на Node (раздел 10)
  install_windows.bat, install_mac.command, uninstall_*   установка CEP + копия плагина Figma в Документы
  README.txt, LICENSE, THIRD_PARTY_NOTICES.txt, DEVELOPMENT.md
```

**Стабильные версии** (лежали в выходной папке прошлого чата): v0.16 (текст), v0.21 (интерфейс), v0.27 (Figma + скругления). v0.28 — оптимизации, v0.29 — лицензия, v0.30 — иерархия слоёв как в Illustrator, v0.31 — устойчивость к сбою шаблона градиентов, v0.32 — диагностика растра, v0.33 — кнопки Explode / Merge.

---

## 2. Архитектура и поток данных

```
Illustrator ──(панель AI: vb_send)──► %TEMP%/Sendwich/<stamp>/clip.json + PNG
                                         stamp.txt (имя папки), busy.txt (busy/idle)
                                                     │  панель AE опрашивает каждые 300 мс
Figma ──(плагин: POST http://localhost:7789/clip)──► │  сервер в панели AE пишет то же самое
                                                     ▼
                                After Effects: vb_build(stamp) → слои в активной композиции
```

- Оба источника пишут **один формат** `clip.json` (раздел 3). AE строит его одним кодом.
- `busy.txt`: `busy <ms>` или `busy figma <ms>` в начале отправки, `idle` в конце. AE показывает «Waiting for Illustrator/Figma…».
- Время: источник пишет `stats.t0` (старт) и `stats.aiMs`. AE считает общее время и выводит строку `time X s (Illustrator|Figma A s, After Effects B s)`.

---

## 3. Формат clip.json

```js
{ app: "illustrator"|"figma", version, mode: "vector"|"image", doc,
  artboard: { name, w, h },                      // размер новой композиции, начало координат — левый верх
  items: [ ...item ],                            // ПОРЯДОК: верхний первым (как pageItems в Illustrator)
  stats: { t0, aiMs, notes:[строки для статуса], ... } }

item общие поля: type, name, opacity (0..100), bounds [x1,y1,x2,y2],
                 blend? ("MULTIPLY"… имена как в Illustrator: SOFTLIGHT, COLORDODGE, SATURATIONBLEND, COLORBLEND…),
                 blur? (Blurriness AE), shadow? {color:[r,g,b], op, dx, dy, blur}  (только Figma)

type "group": children[], clipped?, clip? { paths[], evenodd, kind? "opacity" }
type "shape": paths: [{ closed, pts: [[anchor, in, out], ...] }]   // абсолютные координаты артборда, Y вниз
              style: { fill:[r,g,b], fillOp?, fillGrad?, evenodd, grad?,
                       stroke?: { color, width, cap 1|2|3, join 1|2|3, miter, dashes?, op?, grad? } }
              grad: { type 1 linear | 2 radial, stops: [[pos, mid, r, g, b, alpha]], start:[x,y], end:[x,y] }
type "text":  text (переводы строк = \r), box, boxW, boxH, center (box) | anchor (point), rot, sx, sy,
              just: left|center|right|full|fulll|fullc|fullr,
              runs: [{ s, n, font (PostScript), family?, style?, size, tracking, leading, color }]
type "image": file (абсолютный путь PNG), bounds, scale (1|2|4)
```

Служебные поля с `_` (`_vb`, `_src`, `_k`) в JSON не пишутся.

---

## 4. Illustrator: `SendwichAI/jsx/host.jsx`

Вход: `vb_send(mode, scope, scale)`. Ставит `DOCUMENTCOORDINATESYSTEM`, пишет busy-флаг, вызывает `vb__send`.

- **Координаты:** `P()` и `B()` переводят в координаты артборда с Y вниз. Исходный документ **никогда не меняется**: всё, что требует правки, делается во временных документах (`tempDoc`, `dupInto`, `closeTemp`).
- **Дерево:** `ser` / `serRaw`. Каждый объект получает `_vb` — номер в обходе в глубину, включая скрытые (`countDesc`). Это нужно для связи с SVG.
- **Фигуры:** `pathData`, `style`, `gradInfo`. Для градиента: начало и конец из origin, angle, length, а если матрица ставит градиент ближе к объекту — с учётом `matrix`.
- **Текст:** `textItemRaw` читает стиль **посимвольно** (`characters[i].characterAttributes`). Попытка через `textRanges` оказалась медленнее (v0.14), откатили. Путь-текст отправляется картинкой.
- **Растр, символы, меши, плагины, графики:** `imageItem` → PNG через временный документ.
- **Блюр** (панель Appearance скриптам недоступна):
  - блюр определяется по равномерному росту `visibleBounds` относительно `geometricBounds` с учётом обводки (`blurOf`, `shapeBlur`, `groupBlur`);
  - радиус калибруется один раз за сессию: тестовый квадрат с `applyEffect("Adobe PSL Gaussian Blur" 10)` во временном документе (`blurGrowthPerRadius`, `$.global.VB_BLUR_CAL`);
  - перевод в AE: Blurriness = радиус × `AE_PER_RADIUS` = 2. По тесту пользователя: радиус 2 в Illustrator = 4 в AE.
- **Служебный SVG** (`readOpacityMasks` → `applyOpacityMasks`, вызывается при каждой векторной отправке):
  1. Копия выделения во временный документ **без translate**: скриптовый сдвиг оставляет opacity mask на месте. Копии получают имена `vb<N>`, текст из копии удаляется: экспорт текста медленный и не нужен.
  2. Экспорт SVG (`SVGIDREGULAR`, без шрифтов) → `vbx_masks`. Это свой regex-парсер XML и путей `vbx_xml`, `vbx_parseD`, `vbx_shapes`, `vbx_bbox` с учётом трансформаций.
  3. Из SVG берутся:
     - **id объектов с opacity mask**;
     - **радиальные градиенты** (`gradGeo`: центр и конец полоски градиента по оси x её матрицы);
     - **прозрачность заливки и обводки** (`paintOp`; у объектов из Figma бывает обёртка `<g id=vbN>` → `paintLeaf`);
     - **точные границы** для вычисления сдвига SVG→артборд. Считаются лениво: только где нужны, плюс 40 для общего голосования.
  4. **Opacity mask:** на копии запускается **Release Opacity Mask** через временный экшн (`loadReleaseAction`, событие `ai_plugin_transparency`, ключ `rlse`). Освобождённая маска читается как обычный контур (`maskPaths`) и сдвигается на ту же величину, что и её объект. Запасной вариант: контур из SVG.
  5. **Прямоугольник `<mask x/y/w/h>`** — это границы ЗАМАСКИРОВАННОГО объекта, а не маски. Подгонять под него нельзя (ошибка v0.10–0.12).
- **Clipping mask:** путь с `clipping` → `group.clip`.
- **Имена по умолчанию** как в панели Layers: `<Path>`, `<Compound Path>`, `<Group>`, `<Clip Group>`, `<Image>`, имя файла у Placed, имя символа (v0.30).
- **Растр** (v0.32): PNG проверяется на диске; если 2x/4x не записался, повтор в 1x, причина в статусе панели Illustrator.
- **Слои и подслои Illustrator** (v0.30): `layerChain` + `wrapLayers` оборачивают выделенные объекты в группы с именем, opacity и blend слоя. Соседние объекты одного слоя попадают в одну группу. DOM-обёртки слоёв не равны через `===`, поэтому сравнение по ключу `zOrderPosition:name` по цепочке.
- **Режимы наложения:** `blendingMode` из DOM.

---

## 5. After Effects: `SendwichAE/jsx/host.jsx`

Вход: `vb_build(stampId)` → `run(path)` → `build(data)`.

- **Чтение JSON:** `jsonFast`. Проверка «чистый JSON» (regex как в json2), затем `eval`; ручной `jsonParse` — запасной вариант.
- **Одна отмена:** всё строится во **временной композиции** «Sendwich (temp)» вне undo-группы. Потом в ОДНОЙ группе «Sendwich: Import»:
  - `copyToComp` каждого слоя в целевую композицию снизу вверх;
  - заново назначаются track matte;
  - выделяются новые слои;
  - временная композиция удаляется.

  Ctrl+Z снимает весь импорт. После отмены в проекте снова появляется temp-композиция — это известный побочный эффект. Причина такой схемы: `executeCommand` внутри undo-группы давал «Undo group mismatch».
- **Композиция:** активная, иначе новая по размеру артборда (не больше 30000 px). Артборд центрируется: `CTX.offX`, `CTX.offY`.
- **Выбор способа сборки** (`buildItemRaw`):
  - текст → `buildText`;
  - картинка → `buildImage` (копия в «Sendwich Assets» рядом с проектом);
  - группа с `clip` → `buildClipped`;
  - группа или фигура → `buildPlanned` (v0.30). `layerPlan` / `splitNode` идёт по дереву сверху вниз: векторы с группами, opacity и blend копятся в один шейп-слой (`buildNestedLayer`) с той же вложенностью. Отдельный слой получают только «разрывы» (`isBreaker`): текст, картинка, clipping/opacity mask, блюр, тень. Векторы до и после разрыва — два слоя с тем же путём групп, порядок по Z точный. Вынесенный объект получает opacity всех групп над ним и ближайший blend (`lifted`).
  - Больше 16 градиентов в слое → `chunksOf`: подряд идущие куски по 16 + 16 с теми же группами (вместо распада на слои).
  - `planGrads` идёт по тому же плану, поэтому партии шаблонов совпадают со слоями.
  - **v0.32:** `buildImage` пишет в статус, какой картинки нет и по какому пути; если копия в Assets не импортировалась — импорт оригинала. Итог «images: N of M placed», если дошли не все.
  - **v0.31:** каждый кусок плана строится через `buildFrag`. Если шаблон градиентов не импортировался, недостроенные слои удаляются и кусок собирается заново сплошным цветом (`CTX.forceSolid`). Раньше одна ошибка убивала весь слой Illustrator (с v0.30 это одна большая группа). `importTemplate` делает 2 попытки, пишет диагностику (что вернул importFile) и **не удаляет** сбойный `grad_*.aep` из `%TEMP%\Sendwich`. После двух сбоев подряд — `CTX.tplBroken`, дальше сразу сплошной цвет. Числа в XML градиента всегда конечные (`fnum`).
- **Шейпы без градиентов:** `buildShape` → `addItem` → `addGroup`, `addShapePaths`, `addStroke`, `addFill`. Значения, совпадающие с умолчаниями AE, не выставляются. Ссылки на свойства «протухают» после `addProperty` в том же родителе: контейнеры ищутся по пути индексов (`container`).
- **Параметрика:** `detectPrimitive` распознаёт Rect (в т. ч. повёрнутый и скруглённый), Ellipse и Polystar. Поворот уходит в трансформацию группы.
- **Градиенты:** цвета градиента скриптом задать нельзя, поэтому:
  - `gradients.aep` — шаблон: композиция и слой `VB_TEMPLATE`, группы `GF0..15` и `GS0..15`;
  - в RIFX-чанки `Utf8` с «Gradient Color Data» пишется XML стопов (`gradientXML`; чанки 0–15 — заливки, 16–31 — обводки);
  - копия шаблона импортируется (`importTemplate`), слой копируется (`copyTemplate`);
  - `planGrads` раскладывает все градиенты импорта по партиям по 16, одна партия — один импорт; в конце `dropImports`;
  - `fillGradLeaf` вставляет контур в группу шаблона и выставляет тип и точки (`setGradProps`, `localPt`).
- **Вложенные группы с градиентами:**
  - листья кладутся в корень слоя с токенами `__vbN`;
  - группы собираются снизу вверх командой «Group Shapes» (`groupRoot`, `nestNode`);
  - у новой группы сбрасывается трансформация, точки градиентов переставляются заново из `CTX.gradRec`, имена восстанавливаются (`renameDeep`);
  - окно просмотра открывается только когда нужна эта команда (`CTX.viewer`).
- **Маски:** `buildClipped` строит один слой маски над содержимым и ставит `setTrackMatte(M, ALPHA)` всем слоям содержимого, `M.enabled=false`. Вложенные маски идут цепочкой: слой, у которого уже есть matte, пропускается, внутренний слой маски получает внешнюю маску. Для AE до 23 — `trackMatteType`.
- **Эффекты:**
  - блюр: `addBlur`, «ADBE Gaussian Blur 2», запасной вариант — legacy;
  - тень: `addShadow`, «ADBE Drop Shadow», direction = atan2(dx, −dy), прозрачность масштабируется по `maxValue`;
  - режим наложения верхнего объекта слоя: `setBlend` (режим слоя), карта `BLEND`;
  - режим наложения внутри слоя (v0.30): Blend Mode у Fill / Stroke / G-Fill / G-Stroke, `setPaintBlend`, карта `BLEND_SHAPE` (значения меню взяты из экспортёра Bodymovin). Смешивается только с тем, что ниже внутри того же слоя. Blend группы раздаётся её листьям (`annotateBlend`);
  - блюр/тень → отдельный слой. У clip-группы эффекты ставятся один раз на все её слои (`clipContent`; до v0.30 блюр и тень дублировались на содержимом).
- **Текст:**
  - `buildTextRaw`: point text или box text;
  - разные стили внутри текста — через `TextDocument.characterRange` (AE 24.3+);
  - шрифт из Figma (family + style) → `app.fonts.getFontsByFamilyNameAndStyleName` (AE 24+), с кэшем (`resolveFont`);
  - неустановленный шрифт помечается после первой неудачи и больше не ставится (`fontBad`).
- **Статус:** `summary()` (заметки через « | ») и отдельная строка времени. Ответ: `OK:<слои>:<doc>:<notes>:<time>`.

---

## 6. Панели CEP (`js/main.js`)

- **AE:**
  - опрос `stamp.txt` и `busy.txt` каждые 300 мс;
  - статус: строка с кружком над плашкой, в плашке анимация (wait/build) или статистика; через 3 с после результата приглушается (`.idle`);
  - **сервер Figma:** Node `http`, `127.0.0.1:7789`, CORS `*` и `Access-Control-Allow-Private-Network`;
  - эндпоинты: `/ping`, `/busy`, `/idle`, `/clip`. `/clip` пишет папку `<ms>-figma`, PNG и clip.json, вызывает `importClip` и отвечает JSON с результатом **после** сборки (`pending`, `answer`). При старте сервер удаляет папки старше суток.
- **Illustrator:** кнопки Send to After Effects и Send as image (Rasterize: Selection/Artboard, 1×/2×/4×). Такой же статус и плашка. Перед `evalScript` пауза 60 мс, чтобы анимация успела отрисоваться.
- **Анимации:** `anim.js` (`VBAnim.init/load/play`) читает JSON через `cep.fs` и показывает с `preserveAspectRatio: xMinYMid slice`. Генератор `dev/anim/mknoise.py`:
  - сетка 480×72, шаг 8, квадрат 6 px;
  - 5 размеров: 0/33/50/67/100 %, выровненных по частоте;
  - шумовые волны плюс случайное дрожание;
  - цикл 96 кадров, 24 fps;
  - `make("build", …)` активная, `make("wait", …)` спокойная.

---

## 7. Плагин Figma (`dev/figma-src` → `SendwichFigma`)

- **Сборка:** `python3 dev/build_figma.py`. code.js = code_main.js + `vbx_parseD` из хоста AI. ui.html = шаблон + lottie + build.json.
- **manifest.json:**
  - `documentAccess: dynamic-page`, `editorType: ["figma"]`;
  - `networkAccess.allowedDomains: ["http://localhost:7789"]` + `reasoning`. **IP 127.0.0.1 Figma не принимает.**
  - `id: sendwich-dev` заменяется на ID, выданный Figma при публикации.
- **code.js:**
  - `send` → `artboardFor`: верхний фрейм выделения, секции пропускаются (`topOf`);
  - `ser` строит дерево. Фреймы, группы, компоненты → `groupItem`: фон фрейма отдельной фигурой, Clip content → clip;
  - маски `isMask` обрезают всех соседей выше себя (`kids`);
  - фигуры → `shapeItem`. Несколько заливок = несколько фигур;
  - картинки и прочее → `imageItem` (`exportAsync` PNG);
  - текст → `textItem` (`getStyledTextSegments`, box text с запасом ширины);
  - `common`: opacity, режим наложения, LAYER_BLUR (×1), DROP_SHADOW.
- **Геометрия** (`geometry`):
  - VECTOR замкнутый с заливкой → `fillGeometry` (скругления и smoothing уже внутри);
  - открытый → `vectorPaths` + своё скругление углов (`radiusFn`, `roundSub`; только углы между прямыми);
  - без fillGeometry → аналитика: `rectD` (радиус на каждом углу), `ellipseD`, `polyD`.
  - **Файл Figma не изменять** (требование ревью): никаких clone и временных узлов.
- **Градиенты:** `gradOf`, точки = inverse(gradientTransform) · (0,0.5)/(1,0.5), для радиального центр (0.5,0.5).
- **ui.html:**
  - цвета Figma (`themeColors`), фиолетовый акцент;
  - кнопка Send неактивна без выделения;
  - отправка: POST из iframe (text/plain, без preflight). Если не вышло — через `fetch` основного потока (`type:"post"`);
  - числа округляются до 3 знаков;
  - понятные ошибки, без технических.

---

## 8. Установка и отладка

- **Windows:**
  1. Установщик Sendwich копирует расширения в `%APPDATA%\Adobe\CEP\extensions`. Установщик предлагает включить CEP и установить плагин Figma в «Документы».
  2. Перезапустить Illustrator и AE.
  3. Окна: Window › Extensions › Sendwich.
- **Figma:** только приложение для компьютера (плагин в разработке). Plugins › Development › Import plugin from manifest… После обновления файлов заново импортировать не нужно.
- **Данные:** клипы лежат в `%TEMP%\Sendwich\<stamp>\`: clip.json, PNG, служебный `aN.svg`. Удаляются через 24 ч.
- **Отладка в Illustrator:** `dev/tools/Sendwich_Inspect.jsx` (дерево, gradient origin, matrix) и `dev/tools/Sendwich_FindMask.jsx`: File › Scripts › Other Script…, отчёт на рабочем столе.

---

## 9. Публикация в Figma Community

См. `FigmaCommunity/CHECKLIST_RU.md`. Главное:
- включить 2FA;
- выложить панель AE с инструкцией и поставить ссылку в LISTING.md;
- разместить PRIVACY.md;
- указать контакт поддержки;
- Publish из приложения Figma и вставить выданный ID в manifest.

**Риски:**
- ревью плагина, которому нужно внешнее приложение (прецедент — Overlord for Figma);
- Chrome 142+ спрашивает разрешение на доступ к локальной сети (Local Network Access).

---

## 10. Тесты (Node, без Adobe и Figma)

Из корня архива:

```
node dev/tests/figmock.js SendwichFigma/code.js   # мок Figma → /tmp/figclip.json + сводка
node dev/tests/h14.js                                  # тот клип через мок AE (слои, matte, градиенты)
node dev/tests/h13.js                                  # мок Illustrator (глаз, маски, блюр, blend) → мок AE
node dev/tests/srvtest/run.js                          # сервер панели AE: /ping /busy /clip
node dev/tests/optest2.js SendwichAI/jsx/host.jsx  # SVG: прозрачность заливки, обёртки <g>
node dev/tests/gradtest.js SendwichAI/jsx/host.jsx <svg>   # радиальные градиенты из SVG
node dev/tests/roundtest.js SendwichFigma/code.js  # скругление углов, rectD
```

Ошибки вида «no index 1 in ADBE Gaussian Blur 2» и «addBoxText is not a function» в моках ожидаемы: там нет эффектов и box text.

Проверка синтаксиса ExtendScript: `cp host.jsx /tmp/c.js && node --check /tmp/c.js`.

---

## 11. Подводные камни и решения (история)

- **Цвета градиентов в AE скриптом не задаются.** Решение — шаблон .aep с патчем RIFX. От ffx-пресетов отказались: подвешивали AE.
- **Нули не нужны:** иерархия через Group Shapes. С v0.30 смешанные группы режутся только на разрывах (текст, растр, маски, блюр, тень), векторы остаются вместе.
- **Opacity mask нет в DOM Illustrator.** Только SVG + Release Opacity Mask на копии. `translate()` не двигает маску, поэтому копию не сдвигаем. `<mask>` rect = границы содержимого.
- **Окно «Transforms are expanded»** при экспорте SVG: `userInteractionLevel = DONTDISPLAYALERTS`.
- **Текст был медленным** из-за экспорта текста в служебный SVG (не из-за чтения). Текст из копии удаляется.
- **Undo group mismatch** из-за `executeCommand` в undo-группе. Решение — temp-композиция.
- **Радиальный градиент из матрицы Illustrator ненадёжен** (эллиптические градиенты), поэтому берётся из SVG.
- **Блюр:** соотношение подобрано по тесту пользователя (AI 2 → AE 4).
- **Figma:**
  - 127.0.0.1 в манифесте не принимается;
  - секции делали артборд шириной 34723 px;
  - corner radius у VECTOR есть только в fillGeometry, в vectorPaths его нет;
  - после первого запуска сервер не отвечал на тяжёлой сцене — помог перезапуск AE (не воспроизведено).
- **Инструмент Write** превращает `\uXXXX` в настоящие символы. U+2028 ломает регулярки в JS, поэтому такие строки исправлять через Python.
- **Opacity внутри Fill у файлов Figma → AI** найти так и не удалось (отложено). Из самой Figma переносится точно.

---

## 13. Открытые задачи и идеи

- Ускорить Illustrator: служебный SVG делается при каждой отправке. Вариант — переключатель «быстрый режим».
- Ускорить AE: вложенные группы с градиентами — по команде Group Shapes на группу. Нужен другой способ вставлять цвета градиента.
- Тяжёлая сцена из Figma: проверить на v0.28+.
- Точные параметры эффектов Illustrator из Appearance: чтение .ai без сжатия (нужен тестовый файл).
- Проверить в AE 0.33: Explode / Merge на слоях с градиентами и ключами (особенно время вставленных ключей при Paste).
- Найти причину «gradient template comp not found» на большой сцене (33 объекта, 164 градиента, v0.30): нужен clip.json и сохранённый grad_*.aep.
- Проверить в AE 0.30: blend внутри слоя (значения меню), слои Illustrator как группы, куски >16 градиентов. Возможно — поднять шаблон до 64 слотов (`make_template.py`).
- Эллиптический радиальный градиент → в AE пока круг.
- Inner shadow и background blur из Figma; inside/outside обводки (сейчас по центру).
- Скругление углов у открытых контуров Figma, где к углу подходит кривая.
- Анимации статуса — дорабатывать по желанию. Идея мини-игры в плашке отложена.
- Подпись расширений (ZXPSignCmd) для обычного распространения; публикация плагина в Figma Community.


## Инструменты слоёв (v0.33, `VB_TOOLS` в конце AE host.jsx, кнопки в панели AE)

Цвета градиента скриптом не читаются и не пишутся, поэтому ничего не пересобирается.

- **Explode** (`vb_explode`): для каждой группы `layer.duplicate()`, в копии удаляется всё лишнее (`keepOnly`: на уровнях предков удаляются только соседние группы и пути, заливки/модификаторы предков остаются). Цели: выделенные в таймлайне группы, иначе группы верхнего уровня (пока группа одна — на уровень глубже, `targetsOf`). Копии встают над исходником в порядке групп, имя = имя группы, anchor в центр без сдвига картинки (только статичный 2D-трансформ, `centerAnchor`). У исходника удаляются разобранные группы; если геометрии не осталось — слой удаляется. Одна undo-группа, executeCommand не используется.
- **Merge** (`vb_merge`): вся работа во временной композиции «Sendwich (merge)» вне undo-группы. Каждый слой: `copyToComp` → Group Shapes на всё содержимое → трансформ слоя (anchor, position, scale, rotation, opacity — значения, ключи, изинги, тангенсы, выражения; `copyTr`) в трансформ группы → blend слоя в Blend Mode заливок с Normal → Copy / Paste (команды 19 / 20) в итоговый слой с нулевым трансформом. Перед Copy время ставится на первый ключ группы (вставленные ключи начинаются с текущего времени). Потом одна undo-группа: копия в комп на место верхнего слоя, исходники удаляются.
- Merge пропускает (`mergeProblem`): не шейп, 3D, parent, есть дети, эффекты, маски, track matte, time remap, раздельные измерения позиции, неизвестный blend. Список — в статусе.
