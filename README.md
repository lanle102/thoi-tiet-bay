# Thời Tiết Bay ✈️

PWA thời tiết hàng không tiếng Việt kiểu AeroWeather cho phi công: METAR/TAF giải mã, SIGMET/AIRMET trên bản đồ, briefing sân bay & chặng bay (theo quy tắc), theo dõi máy bay ADS-B, máy tính giờ phút, quy đổi đơn vị/hiệu năng, kho luật hàng không tra offline.

- Link chính: https://lanle102.github.io/thoi-tiet-bay/ (GitHub Pages, tĩnh, từ nhánh `main`)
- Dự phòng: https://thoi-tiet-bay.vercel.app/ (Vercel – có cả các hàm serverless trong `api/`)
- Bản trên Pages gọi serverless ở `https://thoi-tiet-bay.vercel.app/api/...`.

> Chỉ dùng tham khảo – không thay thế briefing khí tượng/NOTAM chính thức. App không bao giờ tạo số liệu giả: nguồn lỗi thì hiện rõ «không có dữ liệu» kèm link nguồn chính thức.

## Tính năng & nguồn dữ liệu

| Phần | Nguồn | Ghi chú |
|---|---|---|
| METAR, TAF | [aviationweather.gov Data API](https://aviationweather.gov/data/api/) (NOAA/AWC) qua `api/awc.js` | Dự phòng: 2 proxy CORS công khai → METAR từ [OGIMET](https://www.ogimet.com/) (`api/ogimet.js`, không có TAF) → bản lưu tạm (có cảnh báo). |
| International SIGMET, SIGMET/AIRMET Hoa Kỳ, G-AIRMET, CWA, PIREP | aviationweather.gov (`isigmet`, `airsigmet`, `gairmet`, `cwa`, `pirep`) | Vẽ polygon trên bản đồ, màu theo hiện tượng (TS đỏ, TURB cam, ICE xanh, VA xám, TC tím…), bấm xem giải mã + giờ hiệu lực + bản tin gốc. G-AIRMET/AIRMET chỉ có cho Hoa Kỳ. |
| Briefing sân bay & chặng bay | Từ các bản tin trên + đường băng OurAirports | mỗi dòng ghi nguồn + giờ bản tin. Chặng bay: đường vòng lớn, SIGMET/AIRMET trong hành lang ±10 NM, PIREP ±50 NM, sân bay đi/đến/dự bị. |
| NOTAM | FAA NOTAM API chính thức (cần khoá) → FAA NOTAM Search → bản tĩnh `notams/*.json` do GitHub Actions lấy | Hiện FAA NOTAM Search chặn máy chủ Vercel (HTTP 403). Xem mục «Chưa làm được». |
| Theo dõi máy bay | [adsb.lol](https://adsb.lol) → [airplanes.live](https://airplanes.live) → [OpenSky](https://opensky-network.org) qua `api/adsb.js`; chặng/hãng/máy bay từ [adsbdb.com](https://www.adsbdb.com) | Tìm theo callsign, số hiệu chuyến (IATA → ICAO qua adsbdb), số đăng ký, hex ICAO; máy bay quanh sân bay; vết bay vẽ từ các lần cập nhật (6 giây/lần), lưu 3 giờ trên máy. |
| Công cụ (offline) | `calc.js` + `tools.js`, kiểm thử `tests/calc.test.js` (`npm test`) | Cộng/trừ dồn HH:MM, HH:MM ⇄ thập phân, UTC ⇄ giờ địa phương theo sân bay/IANA, ETA; quy đổi ft/m, kt/km/h/mph/m/s, NM/km/SM, hPa/inHg/mmHg, °C/°F/K, kg/lb, lít/US gal/Imp gal, nhiên liệu theo tỷ trọng (Jet A-1 0,800, Avgas 0,720, tự nhập); cao độ áp suất, cao độ mật độ (chính xác + quy tắc 118,8 ft/°C), CAS⇄TAS có tính nén, gió thành phần, tốc độ hạ/độ dốc theo góc. |
| Kho luật (offline) | `scripts/build-laws.mjs`, chạy hằng ngày bằng `.github/workflows/laws.yml` → `laws/index.json` + `laws/c/*.json` | Toàn văn: eCFR 14 CFR Part 1, 61, 91, 121, 135 (api.ecfr.gov, public domain); FAA AIM (faa.gov, public domain); Luật Hàng không dân dụng Việt Nam số 130/2025/QH15 (Công báo, văn bản QPPL không thuộc đối tượng bảo hộ quyền tác giả). **Chỉ tên + link**: ICAO Annex/Doc (bản quyền), EASA Easy Access Rules (không cho tái phân phối nguyên văn). Tìm toàn văn trên máy (không dấu). Bản Vercel đọc kho từ GitHub Pages để luôn mới. |
| Bản đồ | OpenStreetMap, radar RainViewer, ảnh mây NASA GIBS (Himawari/GOES) | Chấm màu hạng bay các trạm METAR. |
| Khác | Đồng bộ yêu thích (Vercel Blob, `api/sync.js`), thông báo đẩy Web Push (`api/push*.js`, GitHub Actions mỗi ~10 phút) | Như bản 2. |

Service worker `sw.js` (cache `ttb-v8`) lưu vỏ app, công cụ, kho luật để chạy offline; dữ liệu thời tiết ưu tiên mạng, mất mạng dùng bản lưu có cảnh báo; không lưu tạm ADS-B.

## Biến môi trường (Vercel → Project → Settings → Environment Variables)

| Biến | Bắt buộc? | Dùng cho |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | có (đã có) | Đồng bộ, đăng ký thông báo |
| `VAPID_PUBLIC`, `VAPID_PRIVATE`, `CRON_SECRET` | có (đã có) | Web Push; `CRON_SECRET` cũng là secret GitHub Actions |
| `FAA_NOTAM_CLIENT_ID`, `FAA_NOTAM_CLIENT_SECRET` | tuỳ chọn | FAA NOTAM API chính thức – đăng ký miễn phí tại https://api.faa.gov (cần email xác minh + duyệt). Có khoá thì `api/notam.js` tự dùng. |

## Triển khai

- GitHub Pages: push lên `main` là xong.
- Vercel: dự án **chưa** nối Git (cần Login Connection GitHub trên tài khoản Vercel), nên deploy bằng CLI: `vercel --prod --yes` trong thư mục repo.
- Kiểm thử công thức: `npm test`.
- Cập nhật kho luật thủ công: `node scripts/build-laws.mjs laws` (cần `pdftotext`).

## Chưa làm được (lý do thật)

- **NOTAM tự động**: FAA NOTAM Search chặn IP máy chủ đám mây (Akamai, HTTP 403 từ Vercel); FAA NOTAM API chính thức cần đăng ký tài khoản + email xác minh + chờ FAA duyệt tại api.faa.gov – không tự làm được trong môi trường không giao diện. Đã chuẩn bị sẵn `FAA_NOTAM_CLIENT_ID/SECRET`. Workflow `notam.yml` (lấy NOTAM công khai từ GitHub Actions ra `notams/*.json`) đã chạy thử 01/11/2026: FAA cũng trả HTTP 403 cho máy GitHub → đã tắt lịch, chỉ để chạy tay. App hiện «không có NOTAM tự động» + link chính thức (FAA, AIS Việt Nam VNAIC). Không có nguồn NOTAM công khai không cần khoá nào khác cho phép truy cập tự động (ICAO API Data Service, Autorouter… đều cần tài khoản).
- **Trace đầy đủ của máy bay**: adsb.lol chặn tải file trace từ máy chủ (trang xác minh chống bot); app vẽ vết từ các lần cập nhật và có link mở trace trên adsb.lol. airplanes.live trả 403 cho máy chủ không đăng ký; OpenSky không truy cập được từ một số mạng – chỉ là nguồn dự phòng.
- **Nguồn thời tiết khu vực châu Á riêng**: chưa có API công khai, ổn định, cho phép dùng tự động (dữ liệu METAR/TAF của châu Á đã có đầy đủ qua AWC/OGIMET vì cùng từ mạng WMO GTS). OGIMET giới hạn tần suất nên chỉ dùng làm dự phòng METAR.
- **G-AIRMET/AIRMET ngoài Hoa Kỳ**: không tồn tại sản phẩm tương đương công khai; các nước khác dùng SIGMET (đã có) và AIRMET dạng văn bản không có toạ độ chuẩn.
- **EASA Easy Access Rules, ICAO Annex/Doc**: không đưa toàn văn vì điều khoản bản quyền – chỉ tên + link.
- Widget màn hình chính iOS: web app không làm được.
