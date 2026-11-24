# Установка Sendwich через ZXP

| Скачать | Для чего |
| --- | --- |
| [Sendwich.zxp](https://github.com/saniochk/Sendwich/releases/download/v0.34.4/Sendwich.zxp?build=6ea088325efd) | Обе панели: After Effects и Illustrator |
| [Плагин Figma — ZIP](https://github.com/saniochk/Sendwich/releases/download/v0.34.4/Sendwich-0.34.4-Figma.zip) | Плагин Figma с файлом SendwichFigma/manifest.json |

Один файл устанавливает панели After Effects и Illustrator. [Контрольные суммы SHA-256](https://github.com/saniochk/Sendwich/releases/download/v0.34.4/SHA256SUMS.txt?build=6ea088325efd). Плагин Figma устанавливается отдельно. Заявленные версии: After Effects 22+ и Illustrator 25+.

1. Сохраните работу и закройте After Effects и Illustrator.
2. Откройте бесплатный [aescripts ZXP/UXP Installer](https://aescripts.com/learn/post/zxp-installer).
3. Перетащите `Sendwich.zxp` в окно установщика.
4. Если появится **No application compatible with Sendwich was found on your computer**, нажмите **Install** или **Install Anyway**. Это предупреждение о распознавании совместимости не помешало установке на проверенном Windows-компьютере. Для этой установки вход в Creative Cloud не потребовался.
5. Дождитесь завершения установки. Запустите After Effects и Illustrator и в каждой программе откройте **Window → Extensions → Sendwich**.
6. Для переноса держите панель Sendwich в After Effects открытой.

Нажатие Install Anyway относится только к приведённому предупреждению совместимости. Если появилась ошибка проверки подписи или установки, её нужно решить отдельно.

## Что проверено

Установка этого единого ZXP подтверждена пользователем на Windows с After Effects 25.6 и Illustrator 29.8.4. Пользователь подтвердил установку обновлённого пакета и отображение иконки шляпы в ZXP Installer. В пакете один общий манифест. Проверены подпись CEP, временная метка, состав архива и совпадение ресурсов с исходниками. Запуск обеих панелей после установки отдельно ещё не подтверждён. Установка этого ZXP на macOS пока не проверена.

PlayerDebugMode включать не нужно. Подробнее о подписи — в [политике подписи](RELEASE.md#code-signing-policy).

## Установка в Figma Desktop

1. Скачайте ZIP плагина Figma по ссылке в таблице выше.
2. Распакуйте весь архив в постоянную папку, которую выберете сами.
3. В Figma Desktop откройте макет, затем **Plugins → Development → Import plugin from manifest…**.
4. В распакованном архиве откройте папку **SendwichFigma** и выберите **manifest.json**.
5. Сохраните эту папку: Figma загружает плагин из неё. Файлы manifest.json, code.js и ui.html должны оставаться вместе.
6. Откройте Sendwich в After Effects. В плагине Figma нажмите **Connect to After Effects**, сравните код и подтвердите **Allow** в AE. Затем выделите макет и нажмите **Send to After Effects**.
## Удаление

Удалите Adobe-панели через ZXP/UXP Installer. В Figma удалите Sendwich из Plugins → Development; после этого при необходимости можно удалить распакованную папку Figma-плагина.