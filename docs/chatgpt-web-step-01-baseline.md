# ChatGPT Web — Adım 1: kaynak, kurulum ve geri dönüş kaydı

11 Eylül 2026. Durum: **PASS-LOCAL — yalnız başlangıç noktası doğrulandı.**

Kapsam: [uygulama planındaki Adım 1](chatgpt-web-step-by-step-plan.md). Ürün kodu, installer, kurulu uygulama ve hesap ayarları değiştirilmedi. Uygulama yeniden başlatılmadı; canlı ChatGPT mesajı gönderilmedi. Yeni branch/worktree veya uygulama oluşturulmadı. Sonuç kaydında docs-generator'ın kanıt → bulgu → izlenecek yol ayrımı kullanıldı; yardımcı araç indeksi bu kurulumda bulunmadığından ek araç kurulmadan mevcut Git/PowerShell/Node araçları kullanıldı.

## 1. En önemli düzeltme: Git sırası

Önceki rapordaki “main ileride ve Web dosyaları kaldırılmış” yorumu yanlıştı. Dizin farkı atalık bilgisiyle birlikte okunmamıştı. Bu adımda iki yönlü Git atalık kontrolü yapıldı:

```powershell
git merge-base --is-ancestor f218a17a95281aeebc343893374b8ebbd90d32de a80bb648f0cb9e27baaec09848d95c2d2005fb23
git merge-base --is-ancestor a80bb648f0cb9e27baaec09848d95c2d2005fb23 f218a17a95281aeebc343893374b8ebbd90d32de
git rev-list --left-right --count f218a17a95281aeebc343893374b8ebbd90d32de...a80bb648f0cb9e27baaec09848d95c2d2005fb23
git log --format='%h %cs %s' f218a17a95281aeebc343893374b8ebbd90d32de..a80bb648f0cb9e27baaec09848d95c2d2005fb23
git ls-remote origin HEAD
```

Sonuçlar sırasıyla: exit `0`, exit `1`, `0 6`, altı ileri commit ve uzak HEAD `a80bb648f0cb9e27baaec09848d95c2d2005fb23`.

İleri commitler: `006cf52` Web gateway; `376cca8` per-chat account; `351ccff` default account korunması; `ec1e7f9`, `8a9a4a8`, `a80bb64` native Computer Use/imza korumaları. Dolayısıyla Web dosyalarının `f218a17`de bulunmaması bir geri kaldırma değil, eski tabanda henüz eklenmemiş olmasıdır.

**Karar:** Uygulama tabanı mevcut `codex-plus-plus-chatgpt-web-fix` worktree'si ve `fix/chatgpt-web-full-harness-20260910` branch'i olarak kalacak. Ana checkout force checkout/pull/rebase yapılmadan korunacak. Bu bir yeni uygulama kararı değildir; kurulu uygulama zaten bu kaynakla eşleşiyor.

## 2. Kaynak ve kurulum eşlemesi

| Katman | Ölçülen değer | Kanıt / sınır |
|---|---|---|
| Ana checkout | `C:\Users\ahmet\OneDrive\Masaüstü\freelance\codex-plus-plus`, main `f218a17` | 17 modified/untracked dosyanın başlangıç hash'i alındı; değişiklikler korunuyor. |
| Web worktree | `C:\Users\ahmet\OneDrive\Masaüstü\freelance\codex-plus-plus-chatgpt-web-fix`, HEAD `a80bb64` | 51 modified/untracked dosyanın başlangıç hash'i alındı. |
| Referans | `C:\Users\ahmet\AppData\Local\Temp\codex-chatgpt-web-e85e3693`, HEAD `e85e3693` | `git status --short` boş; referans kaynak değiştirilmedi. |
| Kurulu uygulama | `C:\Users\ahmet\AppData\Local\Programs\CodexPP\ChatGPT.exe` | Aynı mevcut Codex++; yeni kurulum yok. |
| App sürümü | `26.903.61454`, build `8378`, flavor `prod` | `app.asar/package.json` ve `resources/owl-app.ini` birlikte okundu. Chromium `152.*` sürümü Codex build'i olarak kullanılmadı. |
| Native engine | `resources\codex.exe`, `codex-cli 0.153.4` | Tam kurulu binary `--version` ile çalıştırıldı. App-server veya tool komutu başlatılmadı. |
| Engine imzası | `Valid`, OpenAI OpCo, LLC | Windows Authenticode kontrolü. Sandbox setup executable imzası da `Valid`; kurulum çalıştırılmadı. |
| Hub kaynağı | Kurulu `resources/hub` içindeki 36 dosya | 36/36 SHA-256, Web worktree'sindeki karşılığıyla birebir aynı. |
| Paket patch'leri | 24/24 `APPLIED` | Mevcut kurulu ASAR'da patch marker'ları bulundu; UI davranışı veya bütün injected byte'ların kaynakla eşitliği iddiası değil. |
| Çalışan uygulama | Ana PID `25680`, child engine PID `32708`, CDP `19333`, private user-data flag mevcut | Süreçler kapatılmadı. Adım sonunda aynı ana PID hâlâ çalışıyordu. |
| Stock Windows uygulaması | `OpenAI.Codex_26.903.8094.0_x64__2p2nqsd0c76g0` | Yalnız paket metadata'sı okundu; stock dosyalarına yazılmadı. Paket revision'ı ile uygulama içi build karıştırılmadı. |
| Test runtime | Node `v22.22.3`, npm `10.9.8` | Mevcut runtime; dependency kurulumu yapılmadı. |

Uygulamadaki görev listesi yalnız durum tespiti için okundu; mevcut görev aktifti. Liste sınırlı bir sayfa olduğundan bütün makinede başka çalışan iş olmadığı sonucu çıkarılmadı. Hiçbir görev/thread/browser kapatılmadı.

ASAR içinde üretim Git commit'ini bağlayan ayrı bir Codex++ manifest bulunmadı. Bu nedenle “ASAR tümüyle şu git commit'in birebir reproducible build'i” iddiası yok. Kanıt: uygulama metadata/build/hash, 24 patch marker'ı ve 36/36 external hub byte eşleşmesidir.

### Korunan binary hash'leri

| Dosya | Byte | SHA-256 |
|---|---:|---|
| `resources/app.asar` | 309555440 | `54B592222C32CBABA6B229FF1FE5CF9BEC34333170B4005422F8B5606E5E0187` |
| `resources/codex.exe` | 295408944 | `CCDC9EB9DD71FBCFB03AD42C4ECA2B0D6FF6FBD32EBE9416550E6244561E559B` |
| `ChatGPT.exe` | 4620592 | `23796D3D11D19CD4CC0AEF5B00B33F362CDCDA98AA82607C27B9011F3C8E095F` |
| `Codex.exe` | 1105200 | `AEF54618342D6BB03FDE9BC2DCEED50D31119F74D2523039B2E0BC2E27E1C4BA` |

## 3. Önceki değişikliklerin sınıflandırılması

| Karar | Dosya / davranış | Gerekçe ve sonraki sınır |
|---|---|---|
| Koru | `a80bb64` tabanındaki account/thread-routing ve macOS Computer Use korumaları | Altı ileri commit içinde kullanıcı tarafından korunması istenen davranışlar var. Eski main dosyalarıyla üstlerine yazılmayacak. |
| Koru | `hub/home.cjs`, `provider-gateway.cjs`, `provider-wire.cjs`, patch `020` ve `121`, Windows install private-home bağlantısı | Ana checkout ile anlamlı farklar EOL/son boş satırlar yok sayılarak incelendi; bu parçalar eşdeğer. Özel home/provider iyileştirmeleri Web worktree'sinde zaten bulunuyor. |
| Koru | `tools/test-home.cjs`, `tools/test-provider-client.mjs` | İki worktree'de byte eşleşmesi var. Yeni kopya test gerekmiyor. |
| Referansa göre düzelt; şimdilik koru | `gateway`, `native-tools`, `mcp-server`, `responses-stream` | Exec zorunluluğu/direct-native eksikleri sonraki Adım 2–3'e ait. Bu adımda kodları değiştirilmedi. |
| Referansa göre düzelt; şimdilik koru | `turn-broker`, `broker-socket`, `tunnel` | Retry/final/timeout/owner sözleşmeleri sonraki adımlar. Mevcut waiter/queue/EOF iyileştirmeleri topluca silinmeyecek. |
| Referansa göre düzelt; şimdilik koru | `web-session`, `web-contract`, patch `120` | Prompt/model/retained context/compaction davranışları ilgili adımda ölçülerek değişecek. Başlangıç testlerinin geçmesi bu eksikleri kapatmıyor. |
| Kurulum öncesi uzlaştır; şimdi dokunma | `install/windows/uninstall.ps1` | Main private `DataDir/codex-home` kullanıyor; Web worktree eski `CODEX_HOME`/global fallback içeriyor. Web işi için uninstaller çalıştırılmayacak. |
| Kurulum öncesi uzlaştır; şimdi dokunma | `install/mac/install.sh` | Main private-home iyileştirmesi; Web worktree yeni özgün imza korumaları içeriyor. Birini diğerinin üstüne kopyalamak uygun değil. macOS kurulumu bu adımda yapılmadı. |
| Sonraki regresyon adımında hizala | `tools/test-claude-peers.mjs` | Main testi private-home davranışını bekliyor, Web worktree testi eski CODEX_HOME beklentisini taşıyor. Bu suite burada çalıştırılmadı ve yeşil sayılmadı. |
| İlgisiz, dokunma | Main'deki provider/home belgeleri, README/CI'nin mevcut kullanıcı değişiklikleri | Korunuyor; bu adımda yalnız yeni baseline belgesi ve önceki plan kaydı düzenlendi. |
| İlgili adımda değerlendir | Windows sandbox-state/probe yardımcıları, eski canlı E2E script'leri | Yeni sandbox kurulumu/UAC veya tekrar E2E başlatmak Adım 1 kapsamında değil. |

Bu farklar Adım 2'nin salt okunur ölçümünü engellemiyor. Installer veya global home davranışını değiştirmek gerekirse ilgili adımda ayrıca kapsamı sunulacak; bu kayıt o birleştirmenin yapıldığı anlamına gelmez.

## 4. Gerçekte çalıştırılan başlangıç kontrolleri

Çalışma dizini: `C:\Users\ahmet\OneDrive\Masaüstü\freelance\codex-plus-plus-chatgpt-web-fix`.

| Gerçek komut | Sonuç | Tür / neyi kanıtlamaz? |
|---|---|---|
| `node tools/test-chatgpt-web-contracts.mjs` | exit 0; 18/18, yaklaşık 1.11 s komut süresi | Üretim modülleri + sentetik contract. Browser, native engine veya hesap kullanılmadı. |
| `node tools/test-chatgpt-web-lifecycle.mjs` | exit 0; 14/14, yaklaşık 1.14 s | Yerel TCP/named-pipe ve sentetik tool/tunnel/DOM. Gerçek ChatGPT veya yayınlanan tunnel kullanılmadı. Çıktıdaki “live” test adı canlı hesap kanıtı değil. |
| `node tools/test-provider-client.mjs` | exit 0; 9/9, yaklaşık 1.18 s | VM/sentetik renderer kontratı; gerçek provider hesabı kullanılmadı. |
| Aşağıdaki `check-patches` komutu | exit 0; 24/24 `APPLIED` | Kurulu ASAR kopyası üzerinde marker kontrolü. Yeni stock build'e patch uygulanabilirliği ve gerçek UI testi değil. |
| Kurulu `resources/codex.exe --version` | exit 0; `codex-cli 0.153.4` | Yalnız binary kimliği; engine tool-call/live test değil. |
| `Get-AuthenticodeSignature` | Engine ve sandbox setup `Valid` | Windows imza kontrolü; macOS codesign testi değil. |

```powershell
node tools/check-patches.mjs --src 'C:\Users\ahmet\AppData\Local\Programs\CodexPP\resources\app.asar' --work '.build\web-step1-20260911-070637\installed-check' --keep
```

Patch kontrolü kurulu paketi yalnız okudu, `.build/.../installed-check` altında ayrı çıkarım yaptı. Bu ignored çalışma dizini kanıt amaçlı bırakıldı. Testler için yeni test kodu yazılmadı ve başarısız davranışı yeşile çevirecek ürün değişikliği yapılmadı.

Kaynak inceleme sırasında EOL farkları önce bütün dosya değişmiş gibi göründü; `--ignore-cr-at-eol --ignore-blank-lines` ile anlamlı farklar ayrıldı. `git diff --no-index` exit 1 fark bulunduğunu, ters atalık kontrolünün exit 1 olması atalık olmadığını ifade eder; bunlar ürün testi hatası değildir. İki PowerShell tanı komutu pipe sözdizimi nedeniyle çalışmadı; ölçümleri geçerli komutlarla tekrar alındı. ASAR paketi ilk relative import ile çözülemedi, mevcut `createRequire(.../patch/apply.mjs)` paket çözümlemesiyle okundu; dependency kurulumu yapılmadı.

**Bu adımda NOT RUN:** canlı ChatGPT E2E, gerçek engine tool-loop/idle, sandbox/UAC kurulumu, hesap değiştirme, native/cxp canlı passthrough, compaction, parent-child, macOS signing/Computer Use canlı testi. İlgili sonraki adımlarda ayrı sonuç verilecek.

## 5. Geri dönüş kopyası

Yedek kökü:

```text
C:\Users\ahmet\AppData\Local\CodexPP\backups\web-step1-20260911-070637
```

İçerik:

- `installed/`: kurulu `app.asar`, `ChatGPT.exe`, launcher `Codex.exe`, `owl-app.ini` ve 36 hub dosyası — toplam 40 dosya.
- `source/main-checkout/`: ana checkout'un başlangıçtaki 17 modified/untracked dosyası.
- `source/web-worktree/`: Web worktree'sinin başlangıçtaki 51 modified/untracked dosyası.
- `manifest.json`: tam kaynak/hedef yolları, SHA-256, build/head bilgileri ve çalıştırılan üç başlangıç testinin çıktısı.

**108 kopyanın tamamı kaynak hash'iyle doğrulandı.** Manifest hariç toplam 316314383 byte. Yedek klasöründe inheritance kapalı; erişim mevcut kullanıcı ve SYSTEM ile sınırlandı. Mevcut uygulama/data klasörünün ACL'si değiştirilmedi.

Bu tam uygulama/hesap yedeği değildir. `codex.exe` değiştirilmeyeceği için ikinci 295 MB binary kopyası oluşturulmadı; hash ve özgün imzası kayıtlı. Ortak veya özel auth/account/key/cookie dosyaları bu adımda kopyalanmadı ve değiştirilmedi. Gelecekte hesap durumuna yazabilecek testin hemen öncesinde ayrı, güncel, erişimi kısıtlı state yedeği alınmalı. Tam yeniden kurulum gerekirse kapsamına uygun yeni snapshot alınmalı; bu dar yedek tüm kurulumu kapsıyormuş gibi kullanılmamalı.

Rollback henüz çalıştırılmadı. Gerektiğinde önce kullanıcıya haber verilecek; yalnız bu testin owned işlemleri güvenli biçimde durdurulacak. Sonra manifest'teki değişmiş kurulum dosyaları kendi kopyalarından geri alınacak ve hash eşleşmesi doğrulanacak. Source snapshot'ları kullanıcı değişikliklerinin üstüne topluca yazılmayacak. Geniş klasör silme, stock uygulamaya müdahale veya connector silme yok.

## 6. Değişmeden kalma kontrolü ve kapanış

Testler, ASAR incelemesi ve yedekleme sonrasında, rapor/plan güncellemesinden önce:

- Başlangıçtaki 68 modified/untracked source dosyasının 68'i de aynı hash'teydi.
- İzlenen 41 kurulu dosyanın tamamı aynı hash'teydi: 36 hub + 5 uygulama/binary/metadata dosyası.
- Ana uygulama PID `25680` hâlâ çalışıyordu.
- Yeni uygulama, key, tunnel veya connector oluşturulmadı; canlı mesaj gönderilmedi.

Bu adımın tek repo düzenlemeleri bu kayıt ve plan belgesinin Adım 1/commit sırası güncellemesidir. Yedek ve ignored ASAR çıkarımı dışında ürün dosyası üretilmedi/değiştirilmedi. Commit/push/merge yapılmadı.

**Adım 1 kabulü sağlandı:** çalışma tabanı belli, kurulu build ve hub kaynağı eşleşiyor, korunacak farklar sınıflandırıldı, dar ve doğrulanmış geri dönüş kopyası hazır. Full entegrasyonunun çalıştığı iddia edilmiyor.

**Sıradaki tek iş: Adım 2 — gerçek engine isteği ve hatanın katmanını ölçmek. Henüz başlatılmadı.**
