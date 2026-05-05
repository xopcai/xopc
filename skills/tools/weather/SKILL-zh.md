---
name: weather
description: 获取当前天气和预报（无需 API 密钥）。
license: MIT
---

# 天气

两个免费服务，无需 API 密钥。

## wttr.in（首选）

快速一行命令：
```bash
curl -s "wttr.in/London?format=3"
# 输出：London: ⛅️ +8°C
```

紧凑格式：
```bash
curl -s "wttr.in/London?format=%l:+%c+%t+%h+%w"
# 输出：London: ⛅️ +8°C 71% ↙5km/h
```

完整预报：
```bash
curl -s "wttr.in/London?T"
```

格式代码：`%c` 天气状况 · `%t` 温度 · `%h` 湿度 · `%w` 风速 · `%l` 地点 · `%m` 月相

提示：
- URL 编码空格：`wttr.in/New+York`
- 机场代码：`wttr.in/JFK`
- 单位：`?m`（公制）`?u`（美制）
- 仅今日：`?1` · 仅当前：`?0`
- PNG 图片：`curl -s "wttr.in/Berlin.png" -o /tmp/weather.png`

## Open-Meteo（备用，JSON）

免费，无需密钥，适合程序化使用：
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true"
```

查找城市坐标，然后查询。返回包含温度、风速、天气代码的 JSON。
