# Tube Dubbing — Translate & Dub for YouTube

Tiện ích mở rộng trình duyệt giúp dịch phụ đề video YouTube (và các trang web có phụ đề dạng VTT) sang ngôn ngữ khác và lồng tiếng bằng AI (Gemini + Microsoft Edge TTS), đồng bộ trực tiếp theo thời gian phụ đề gốc xuất hiện trên video.
<p>Truy cập vào <b><a class="api-link" target="_blank" href="https://aistudio.google.com/api-keys">https://aistudio.google.com/api-keys</a></b> để tạo Gemini API key</p>

## Cập nhật phiên bản 2.4.16

- **Hỗ trợ website ngoài YouTube có phụ đề VTT** (thẻ `<track>` hoặc file `.vtt` tải qua network): kích hoạt thủ công qua popup cho từng trang (không xin quyền truy cập rộng vào mọi website).
- **Chọn track phụ đề đúng ngôn ngữ đích đã cấu hình**, thay vì luôn lấy track đầu tiên/mặc định của video.
- **Bỏ qua bước dịch Gemini khi phụ đề gốc đã đúng ngôn ngữ đích** — áp dụng cho cả nút lồng tiếng trực tiếp trên video lẫn nút "Dịch Phụ Đề (AI)" trong popup, giúp tiết kiệm API quota.
- Thêm nút **"Đọc phụ đề gốc"** (đọc bằng TTS, không qua bước dịch) cạnh nút "Dịch Phụ Đề (AI)".
- Dropdown chọn ngôn ngữ đích hiển thị đầy đủ 13 ngôn ngữ đã hỗ trợ giọng đọc.
- **Giọng đọc Edge TTS tự nhiên hơn**: tự động dùng giao thức "Edge Read Aloud" khi chạy trên trình duyệt Microsoft Edge thật, tự động chuyển về phương thức cũ nếu không phải Edge (Chrome, Brave, ...) hoặc khi có lỗi.
- **Giảm âm lượng video gốc khi lồng tiếng xuống mức tối thiểu** (khoảng 5% âm lượng gốc, có sàn an toàn để tránh trình duyệt chặn phát âm thanh khi chuyển tab nền), người dùng vẫn có thể kéo lại thanh âm lượng gốc bình thường.
- Thông báo trạng thái trên video tách biệt rõ **"Đang dịch và lồng tiếng"** (có gọi Gemini) và **"Đang lồng tiếng"** (chỉ tổng hợp giọng đọc, không cần dịch).
- Vá lỗi phát hiện phụ đề: nhận diện đúng ngôn ngữ track kể cả khi thuộc tính ngôn ngữ ghi bằng tên đầy đủ (ví dụ "Vietnamese") thay vì mã ISO chuẩn.

## Chính sách quyền riêng tư

**Cập nhật lần cuối:** 03/09/2026

Tài liệu dưới đây mô tả những dữ liệu tiện ích thu thập, xử lý và chia sẻ.

### 1. Dữ liệu được xử lý

| Dữ liệu | Mục đích | Nơi lưu trữ |
|---|---|---|
| Nội dung phụ đề gốc của video YouTube đang xem | Dùng làm đầu vào để dịch sang ngôn ngữ đích | Chỉ trong bộ nhớ tạm của trang, không lưu lại sau khi đóng tab (trừ bản dịch, xem mục dưới) |
| Gemini API Key do người dùng tự nhập | Xác thực yêu cầu dịch với Google Gemini API | Lưu cục bộ trên máy người dùng (`chrome.storage.local`) |
| Cấu hình cá nhân (giọng đọc, tốc độ đọc, ngôn ngữ đích) | Ghi nhớ tuỳ chọn giữa các lần sử dụng | Lưu cục bộ trên máy người dùng (`chrome.storage.local`) |
| Bản dịch phụ đề đã tạo cho từng video | Tránh phải dịch lại (tốn API quota) khi xem lại cùng video | Lưu cục bộ trên máy người dùng, gắn theo ID video (`chrome.storage.local`) |

Tất cả dữ liệu trên **chỉ lưu cục bộ trên trình duyệt của người dùng** (`chrome.storage.local`), không đồng bộ lên bất kỳ máy chủ nào do nhà phát triển vận hành. Tiện ích **không có tài khoản đăng nhập, không thu thập tên, email hay bất kỳ thông tin định danh cá nhân nào**.

### 2. Dữ liệu được gửi ra bên ngoài

Để thực hiện chức năng dịch và lồng tiếng, tiện ích gửi dữ liệu tới các dịch vụ bên thứ ba sau:

- **Google Generative Language API** (`generativelanguage.googleapis.com`): gửi nội dung phụ đề gốc + Gemini API Key của người dùng để nhận về bản dịch. Việc sử dụng dịch vụ này tuân theo [Chính sách quyền riêng tư của Google](https://policies.google.com/privacy).
- **Microsoft Translator / Speech API** (`dev.microsofttranslator.com`, `*.tts.speech.microsoft.com`, `speech.platform.bing.com`): gửi văn bản đã dịch để nhận về file âm thanh lồng tiếng (Edge Read Aloud chỉ dùng trên trình duyệt Microsoft Edge, tự động dùng lại phương thức cũ trên các trình duyệt khác). Việc sử dụng dịch vụ này tuân theo [Chính sách quyền riêng tư của Microsoft](https://privacy.microsoft.com/).

Tiện ích **không có backend/server riêng nào của nhà phát triển** — mọi request đi thẳng từ trình duyệt người dùng tới Google/Microsoft, nhà phát triển không nhận được, lưu trữ hay xem được bất kỳ dữ liệu nào người dùng gửi đi.

### 3. Quyền truy cập trình duyệt được yêu cầu

- `activeTab`, `storage`: đọc/ghi cấu hình và cache trên máy người dùng.
- `scripting`: chèn kịch bản đọc phụ đề vào **trang web hiện tại** khi người dùng chủ động bấm kích hoạt trong popup (chỉ áp dụng cho tab đang mở, không chạy ngầm hay tự động trên các trang khác).
- Quyền truy cập `youtube.com`: đọc phụ đề và hiển thị lớp phủ bản dịch/nút lồng tiếng trên trang video.
- Quyền truy cập các domain API kể trên: gửi yêu cầu dịch và tổng hợp giọng nói.

Với các website khác ngoài YouTube, tiện ích **không tự động chạy hay theo dõi** — chỉ đọc phụ đề của trang đang mở khi người dùng chủ động bấm kích hoạt trong popup (dựa trên quyền `activeTab`, không xin quyền truy cập thường trực vào mọi website).

### 4. Không chia sẻ, không bán dữ liệu

Nhà phát triển không thu thập, không lưu trữ, không bán hay chia sẻ dữ liệu người dùng cho bất kỳ bên thứ ba nào ngoài các dịch vụ API cần thiết để thực hiện đúng chức năng dịch/lồng tiếng nêu ở mục 2.

### 5. Kiểm soát và xoá dữ liệu

Người dùng có thể xoá toàn bộ dữ liệu cục bộ bất kỳ lúc nào bằng cách:
- Gỡ cài đặt tiện ích, hoặc
- Xoá dữ liệu lưu trữ của tiện ích qua trình duyệt (`chrome://extensions` → chi tiết tiện ích → xoá dữ liệu).

### 6. Liên hệ

Nếu có câu hỏi về chính sách này, vui lòng liên hệ: **2danlv@yahoo.com**
