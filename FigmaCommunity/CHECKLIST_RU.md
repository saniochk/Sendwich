# Подача Sendwich в Figma Community

## Что заполнить перед отправкой

- Выберите профиль издателя Figma Community и включите двухфакторную аутентификацию. Если публикационного ID ещё нет, в Figma Desktop создайте разработческий плагин Sendwich через **Plugins → Development → New plugin…**, выберите **Figma Design** и **Custom UI**. Сохраните созданный Figma ID в отдельной копии манифеста для публикации и используйте его для следующих обновлений.
- Установщики опубликованы. В [описании карточки](LISTING.md) уже указаны системные требования и [актуальный релиз](https://github.com/saniochk/Sendwich/releases/latest).
- Для текста карточки подготовлены [публичная политика конфиденциальности](https://github.com/saniochk/Sendwich/blob/main/FigmaCommunity/PRIVACY.md) и [GitHub Issues](https://github.com/saniochk/Sendwich/issues). Если поле поддержки принимает только email, введите адрес, который готовы опубликовать.
- В Figma Desktop запустите Sendwich из **Plugins → Development** после переноса исходников в созданную Figma папку. Пройдите перенос фигур, текста, градиентов, масок и изображений в After Effects на Windows и macOS. Отдельно проверьте отправку без подтверждённого подключения и с открытой панелью AE.
- Откройте **Plugins → Manage plugins**, найдите Sendwich в разделе **Development** и выберите **Publish** в его меню. Заполните имя, краткое описание, основное описание и категорию. Загрузите [иконку 128 × 128](icon-128.png) и [обложку 1920 × 1080](cover-1920x1080.png).
- В разделе доступа к сети проверьте `http://localhost:7789`. Этот адрес нужен для отправки выделения в открытую панель AE у пользователя, включая опубликованную версию. В необязательной форме Data security можно указать локальную передачу и хранение временных файлов и импортированных изображений.
- После подачи следите за статусом **In review** и почтой аккаунта Figma. При желании добавьте в карусель запись реального переноса.

## Сценарий для ревью

1. Скачайте установщик с указанной страницы релиза, затем запустите After Effects и откройте **Window → Extensions → Sendwich**.
2. В Figma нажмите **Connect to After Effects**. Проверьте совпадение кода на обеих панелях и нажмите **Allow** в After Effects.
3. Создайте в Figma фрейм с цветной фигурой, градиентом и текстом. Выделите фрейм и нажмите **Send to After Effects**.
4. В AE откройте Shape Layer и проверьте свойства градиента. Измените текст на отдельном текстовом слое.

[Публикация классических плагинов](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community) · [Правила ревью](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines) · [Спецификация манифеста](https://developers.figma.com/docs/plugins/manifest/)
