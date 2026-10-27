# Thời Tiết Bay ✈️

Ứng dụng web (PWA) xem thời tiết hàng không METAR/TAF, giao diện tiếng Việt.

- Link: https://lanle102.github.io/thoi-tiet-bay/ (bản dự phòng: https://thoi-tiet-bay.vercel.app/)
- Dữ liệu: [aviationweather.gov](https://aviationweather.gov/data/api/) (NOAA/AWC).
- API của aviationweather.gov không trả header CORS, nên trình duyệt gọi qua một proxy rất nhỏ
  (`api/awc.js`, Vercel serverless) – chỉ cho phép các endpoint đọc `metar`, `taf`, `airport`, `stationinfo`, có cache 60 giây.
- Danh bạ sân bay (`airports.json`, ~7.900 sân bay có mã IATA): từ dự án mã nguồn mở mwgg/Airports (MIT).

## Bản 2
- Tab **Bản đồ** (Leaflet + OpenStreetMap): chấm màu hạng bay các trạm METAR, radar mưa RainViewer có hoạt cảnh, ảnh mây hồng ngoại NASA GIBS (Himawari/GOES).
- **Đường băng & gió ngang** (dữ liệu OurAirports, đóng gói trong `data/ap/`), thông tin sân bay + tần số.
- **NOTAM**: `api/notam.js` thử FAA NOTAM Search; hiện bị FAA chặn từ máy chủ nên app hiện link nguồn chính thức (không làm giả).
- **Đồng bộ** yêu thích + cài đặt bằng mã 8 ký tự (`api/sync.js`, Vercel Blob riêng tư), link/QR, xuất/nhập không cần máy chủ.
- **Thông báo**: khi app mở + Web Push thật (VAPID, `api/push.js`, `api/push-check.js` được GitHub Actions gọi mỗi ~10 phút).
- Chuẩn hạng bay FAA / ICAO-EASA (VMC/IMC) / mã màu NATO; tên tiếng Việt; múi giờ thật cho mọi toạ độ (tz-lookup).
- Proxy lỗi → thử 2 proxy CORS công khai → dữ liệu lưu tạm kèm cảnh báo.

Chỉ dùng tham khảo, không thay thế briefing khí tượng chính thức.
