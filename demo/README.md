# Tracy MCP Server

## Статус парсера

✅ **Базовая структура реализована**
- Чтение заголовков Tracy (новый и legacy форматы)
- Декомпрессия LZ4/Zstd
- Парсер типов событий (QueueType)
- Matching ZoneBegin/ZoneEnd
- Расчёт статистики по зонам

⚠️ **Требуется реальный trace файл для тестирования**
- Тестовый `test.tracy` содержит только строки, не события
- Для полного тестирования нужен trace от реальной программы с Tracy profiling

## Инструменты MCP сервера

### 1. read_trace
Чтение базовой информации о trace файле.

### 2. list_zones
Список всех зон (эвристический поиск по строкам).

### 3. get_zone_stats
Статистика по конкретной зоне **с реальными таймингами**.

### 4. find_problematic_zones 🔥
Поиск зон, требующих оптимизации **с реальными данными**.

```
find_problematic_zones(path="trace.tracy")
find_problematic_zones(path="trace.tracy", max_avg_time_ms=5, min_count=1)
```

## Создание реального trace файла

Для создания реального .tracy файла:

```bash
# 1. Собрать демо
cd demo
make

# 2. Запустить Tracy Profiler
/Applications/Tracy profiler.app

# 3. Запустить демо (профилировщик захватит данные)
./build/demo/demo

# 4. В Tracy Profiler: File → Save As → trace.tracy

# 5. Использовать MCP сервер
find_problematic_zones(path="trace.tracy")
```

## Формат событий Tracy

Парсер обрабатывает следующие события:
- **ZoneBegin** (29) — начало зоны с timestamp
- **ZoneBeginCallstack** (30) — начало зоны + callstack
- **ZoneEnd** (31) — конец зоны
- **SourceLocation** (88) — метаданные зоны (функция, файл, строка)
- **StringData** (118) — строковые данные
- **ZoneText** (0) — кастомный текст зоны
- **ZoneName** (1) — кастомное имя зоны

## Структура .tracy файла

```
[Header: 8-10 bytes]
├─ Magic: "tracy" (new) or compression magic (old)
├─ Version: major.minor.patch (new format only)
├─ Compression: 0=LZ4, 1=Zstd
└─ Streams: number of streams

[Data Blocks]
├─ Block Size: uint32le
├─ Compressed Data (LZ4 or Zstd, 64KB blocks)
└─ [Repeat...]

[Event Stream] (after decompression)
├─ Event Type: uint8
├─ Event Data (variable)
└─ [Repeat...]
```

## Ограничения текущей реализации

- Поддерживается только базовый набор событий
- Thread tracking упрощён (один поток)
- Callstacks не парсятся
- GPU события не поддерживаются
- Memory profiling не реализован

Для полноценной поддержки нужны:
1. Thread context tracking
2. Callstack parsing
3. Full QueueType support
4. Symbol resolution
