# Thời Tiết Bay ✈️

Ứng dụng web (PWA) xem thời tiết hàng không METAR/TAF, giao diện tiếng Việt.

- Link: https://lanle102.github.io/thoi-tiet-bay/ (bản dự phòng: https://thoi-tiet-bay.vercel.app/)
- Dữ liệu: [aviationweather.gov](https://aviationweather.gov/data/api/) (NOAA/AWC).
- API của aviationweather.gov không trả header CORS, nên trình duyệt gọi qua một proxy rất nhỏ
  (`api/awc.js`, Vercel serverless) – chỉ cho phép các endpoint đọc `metar`, `taf`, `airport`, `stationinfo`, có cache 60 giây.
- Danh bạ sân bay (`airports.json`, ~7.900 sân bay có mã IATA): từ dự án mã nguồn mở mwgg/Airports (MIT).

Chỉ dùng tham khảo, không thay thế briefing khí tượng chính thức.
