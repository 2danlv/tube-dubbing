# Chính sách quyền riêng tư — Tube Dubbing (Translate & Dub for YouTube)

**Cập nhật lần cuối:** 27/08/2026

Tube Dubbing là tiện ích mở rộng trình duyệt giúp dịch phụ đề video YouTube và lồng tiếng bằng AI. Tài liệu này mô tả những dữ liệu tiện ích thu thập, xử lý và chia sẻ.

## 1. Dữ liệu được xử lý

| Dữ liệu | Mục đích | Nơi lưu trữ |
|---|---|---|
| Nội dung phụ đề gốc của video YouTube đang xem | Dùng làm đầu vào để dịch sang ngôn ngữ đích | Chỉ trong bộ nhớ tạm của trang, không lưu lại sau khi đóng tab (trừ bản dịch, xem mục dưới) |
| Gemini API Key do người dùng tự nhập | Xác thực yêu cầu dịch với Google Gemini API | Lưu cục bộ trên máy người dùng (`chrome.storage.local`) |
| Cấu hình cá nhân (giọng đọc, tốc độ đọc, ngôn ngữ đích) | Ghi nhớ tuỳ chọn giữa các lần sử dụng | Lưu cục bộ trên máy người dùng (`chrome.storage.local`) |
| Bản dịch phụ đề đã tạo cho từng video | Tránh phải dịch lại (tốn API quota) khi xem lại cùng video | Lưu cục bộ trên máy người dùng, gắn theo ID video (`chrome.storage.local`) |

Tất cả dữ liệu trên **chỉ lưu cục bộ trên trình duyệt của người dùng** (`chrome.storage.local`), không đồng bộ lên bất kỳ máy chủ nào do nhà phát triển vận hành. Tiện ích **không có tài khoản đăng nhập, không thu thập tên, email hay bất kỳ thông tin định danh cá nhân nào**.

## 2. Dữ liệu được gửi ra bên ngoài

Để thực hiện chức năng dịch và lồng tiếng, tiện ích gửi dữ liệu tới các dịch vụ bên thứ ba sau:

- **Google Generative Language API** (`generativelanguage.googleapis.com`): gửi nội dung phụ đề gốc + Gemini API Key của người dùng để nhận về bản dịch. Việc sử dụng dịch vụ này tuân theo [Chính sách quyền riêng tư của Google](https://policies.google.com/privacy).
- **Microsoft Translator / Speech API** (`dev.microsofttranslator.com`, `*.tts.speech.microsoft.com`): gửi văn bản đã dịch để nhận về file âm thanh lồng tiếng. Việc sử dụng dịch vụ này tuân theo [Chính sách quyền riêng tư của Microsoft](https://privacy.microsoft.com/).

Tiện ích **không có backend/server riêng nào của nhà phát triển** — mọi request đi thẳng từ trình duyệt người dùng tới Google/Microsoft, nhà phát triển không nhận được, lưu trữ hay xem được bất kỳ dữ liệu nào người dùng gửi đi.

## 3. Quyền truy cập trình duyệt được yêu cầu

- `activeTab`, `storage`: đọc/ghi cấu hình và cache trên máy người dùng.
- Quyền truy cập `youtube.com`: đọc phụ đề và hiển thị lớp phủ bản dịch/nút lồng tiếng trên trang video.
- Quyền truy cập các domain API kể trên: gửi yêu cầu dịch và tổng hợp giọng nói.

Tiện ích không yêu cầu quyền truy cập vào các trang web khác ngoài YouTube.

## 4. Không chia sẻ, không bán dữ liệu

Nhà phát triển không thu thập, không lưu trữ, không bán hay chia sẻ dữ liệu người dùng cho bất kỳ bên thứ ba nào ngoài các dịch vụ API cần thiết để thực hiện đúng chức năng dịch/lồng tiếng nêu ở mục 2.

## 5. Kiểm soát và xoá dữ liệu

Người dùng có thể xoá toàn bộ dữ liệu cục bộ bất kỳ lúc nào bằng cách:
- Gỡ cài đặt tiện ích, hoặc
- Xoá dữ liệu lưu trữ của tiện ích qua trình duyệt (`chrome://extensions` → chi tiết tiện ích → xoá dữ liệu).

## 6. Liên hệ

Nếu có câu hỏi về chính sách này, vui lòng liên hệ: **2danlv@yahoo.com**
