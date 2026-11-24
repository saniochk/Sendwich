# Установка Sendwich через ZXP

[Скачать Sendwich.zxp](https://github.com/saniochk/Sendwich/releases/download/v0.34.4/Sendwich.zxp)

Один файл устанавливает панели After Effects и Illustrator. Плагин Figma устанавливается отдельно. Заявленные версии: After Effects 22+ и Illustrator 25+.

1. Сохраните работу и закройте After Effects и Illustrator.
2. Откройте бесплатный [aescripts ZXP/UXP Installer](https://aescripts.com/learn/post/zxp-installer).
3. Перетащите `Sendwich.zxp` в окно установщика.
4. Если появится **No application compatible with Sendwich was found on your computer**, нажмите **Install** или **Install Anyway**. Это предупреждение о распознавании совместимости не помешало установке на проверенном Windows-компьютере. Для этой установки вход в Creative Cloud не потребовался.
5. Дождитесь завершения установки. Запустите After Effects и Illustrator и в каждой программе откройте **Window → Extensions → Sendwich**.
6. Для переноса держите панель Sendwich в After Effects открытой.

Нажатие Install Anyway относится только к приведённому предупреждению совместимости. Если появилась ошибка проверки подписи или установки, её нужно решить отдельно.

## Что проверено

Установка этого единого ZXP подтверждена пользователем на Windows с After Effects 25.6 и Illustrator 29.8.4. Проверены подпись CEP, временная метка и структура общего манифеста. Запуск обеих панелей после установки отдельно ещё не подтверждён. Установка этого ZXP на macOS пока не проверена.

PlayerDebugMode включать не нужно. Подпись CEP не является подписью Microsoft для EXE или нотариальным заверением Apple.

## Другие способы установки

[Релиз v0.34.4](https://github.com/saniochk/Sendwich/releases/tag/v0.34.4) также содержит EXE для Windows, DMG для macOS и отдельный Figma-плагин. Выберите один способ установки Adobe-панелей: установка EXE/DMG и ZXP одновременно может оставить несколько копий расширения.

## Удаление

Если Sendwich установлен через ZXP, удалите его через ZXP/UXP Installer.