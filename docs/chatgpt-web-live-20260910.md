# 10 Eylül 2026 canlı kurulum kontrol noktası

**Full uçtan uca test henüz çalıştırılmadı.** Gerçek tunnel bağlantısı,
Codex++'ın kendi ChatGPT Web girişi, yeni connector'ın oluşturulması/bağlanması
ve altı published araç doğrulandı. 11 Eylül'de Windows kurulum engeli mevcut
sandbox'ın güvenli, özel profil snapshot'ı ile çözüldü: native `ready`, gerçek
sandbox hesabında komut, izinli dosya yazımı ve sınır dışı yazma reddi doğrulandı.
Bu kayıt, tüm entegrasyonun tamamlandığı anlamına gelmez.

## Kurulum ve korunan sınırlar

- Ana checkout `main`, HEAD `f218a17a95281aeebc343893374b8ebbd90d32de`;
  kullanıcıya ait değişikliklere dokunulmadı.
- Düzeltmeler `../codex-plus-plus-chatgpt-web-fix` worktree'sinde,
  `fix/chatgpt-web-full-harness-20260910` branch'inde; taban commit `a80bb648`.
- Mevcut `%LOCALAPPDATA%\Programs\CodexPP` güncellendi; yeni uygulama/profile
  oluşturulmadı. Mevcut `%LOCALAPPDATA%\CodexPP` profili kullanıldı.
- Ana checkout'taki home isolation ve provider düzeltmeleri korunarak aktarıldı.
- Windows Store uygulaması değiştirilmedi. Push/merge/release yapılmadı.
- Kurulum sonrası, ilk açılıştan önce global/private auth ve config ile account ve
  provider dosyaları yedekleriyle hash olarak aynıydı. Çalışan uygulama normal
  oturum yenilemeleri yapabilir; bu kontrol sürekli değişmezlik iddiası değildir.

## Ölçüm sırası ve bulgular

| Gözlem / kanıt | Dosya / fonksiyon | Düzeltme veya durum | Doğrulama |
| --- | --- | --- | --- |
| Platform'da yeni tunnel kaydı; eski `Codex` kaydı duruyor | Yerel tunnel config | Kullanıcının açık onayıyla `Codex++ Native v2` oluşturuldu | Gerçek Platform UI |
| Kaydedilen anahtar ekranında yalnız `Tunnels: Read, Use`, diğer yetkiler `None` | Yerel `tunnel/runtime-key` | Secret çıktıya yazılmadan kaydedildi; dosya ACL'si yalnız kullanıcı/SYSTEM; pano temizlendi | Gerçek UI + ACL kontrolü |
| İlk açılışta tunnel exit 1; gerçek `doctor` çıktısı `main channel is required` | `hub/tunnel.cjs` / `writeProfile` | Routing channel `main`; connector kimliği ayrı kaldı | Kısa regresyon önce FAIL, sonra PASS; gerçek doctor `ok` |
| Referans kaynak Windows'ta backslash kaçışını şart koşuyor | `hub/tunnel.cjs` / `quoteWindows` | Shell-word parser kaçışları; newline reddi | Regresyon önce FAIL, sonra PASS; gerçek doctor executable yolu PASS |
| Root endpoint görev hazır olmasını kanıtlamaz | `hub/tunnel.cjs` / `waitForHealth` | `/readyz` kontrolü | Regresyon; canlı `/healthz` 200 `live`, `/readyz` 200 `ready` |
| Kurulu hub ile worktree tunnel dosyası aynı | Kurulu `resources/hub/tunnel.cjs` | Düzeltme mevcut uygulamaya yüklendi | Dosya hash karşılaştırması |
| Web status `signedIn:false`, `composerReady:false`, `challenge:false` | `hub/web-session.cjs` / `status` | Kullanıcının giriş penceresi açıldı | Gerçek kurulu uygulama üzerinden CDP |
| Native hesap yenilemede `token refresh failed: HTTP 401` | Mevcut account restore | Hesap yönetimi yeniden yazılmadı; canlı native oturum ayrıca doğrulanmalı | Uygulama başlangıç logu |

İlk yeniden başlatmada CDP `Browser.close` pencereleri kapattı fakat uygulama
arka planda kaldı. Pencere kalmadığı ve executable'ın yalnız bizim başlattığımız
Codex++ olduğu doğrulanarak o ana süreç sonlandırıldı. Çalışan asıl Store
uygulaması kapatılmadı. Bu işlem uygulamanın graceful shutdown testinin geçtiği
anlamına gelmez; o yol henüz doğrulanmış değildir.

## Gerçek çalıştırılan komutlar

Komutlar düzeltme worktree'sinde çalıştırıldı. Aşağıdaki sonuçlar mock/live
ayrımını korur.

| Komut | Sonuç / katman |
| --- | --- |
| `install/windows/install.ps1 -DestDir ...\Programs\CodexPP -DataDir ...\CodexPP -NoDesktopShortcut -AllowUntestedSource -SkipClaudePeers` | Gerçek mevcut kurulum; 24 patch, 9 bundle syntax kontrolü; exit 0 |
| `node --check hub/tunnel.cjs` | PASS |
| `node tools/test-chatgpt-web-lifecycle.mjs` | Önce 10/12; düzeltmeden sonra 12/12; offline/fixture |
| `node tools/test-chatgpt-web-contracts.mjs` | 17/17; offline |
| `node tools/test-home.cjs` | 9/9; geçici fixture |
| `node tools/test-providers.cjs` | 21/21; yerel/fixture, Windows DPAPI dahil; gerçek provider mesajı değil |
| `node tools/test-provider-client.mjs` | 9/9; offline |
| `git diff --check` | Exit 0; CRLF uyarıları var |
| `tunnel-client.exe doctor --config ...\tunnel\profiles\codexpp-native-v2.json --json` | Gerçek binary: önce FAIL, sonra `result:ok`; stdio network probe doctor tarafından SKIP |
| `node tools/cdp-inspect.mjs 127.0.0.1 19333 web-open` | Gerçek uygulamada Web penceresi açıldı |
| `node tools/cdp-inspect.mjs 127.0.0.1 19333 web-status` | Gerçek oturum: giriş bekleniyor |
| Loopback `/healthz` ve `/readyz` HTTP istekleri | Gerçek çalışan tunnel: ikisi de 200 |

Tunnel-client resmi `openai/tunnel-client` v0.0.12 arşivinden alındı; yayımlanan
SHA256SUMS ile arşiv doğrulandı. Binary sürümü
`0.0.12+881c9a8fed7cccbe6607cd419863bbca506b8215`.
MCP initialize/tools/list/nonce preflight'ı kurulu hub tarafından çalıştırıldı;
bu, ChatGPT tarafındaki published connector şemasının doğrulandığı anlamına gelmez.

## Bekleyen kullanıcı adımı ve canlı test

### Giriş sonrası güncelleme

- Kullanıcı giriş yaptığını bildirdikten sonra üretim `webStatus` çıktısı:
  `signedIn:true`, `composerReady:true`, `challenge:false`. Tunnel `/readyz`
  kontrolü yeniden HTTP 200 döndü.
- Gerçek ChatGPT Eklentiler UI'sında eski `Codex Native2` mevcut. Değiştirilmedi.
- Yeni connector formu `Codex++ Native v2` adı ve yeni tunnel seçilerek hazırlandı.
  Formdaki tunnel listesinde yeni ve eski tunnel ayrı ayrı görüldü. Ek MCP OAuth
  katmanı seçilmedi; tunnel'ın Platform yetkisi ve broker turn token doğrulaması
  korunuyor. Güven/onay kutusu ve son Oluştur adımı uygulanmadı.
- Native UI otomasyonu yerine repo yönergesindeki CDP kullanıldı. İlk screenshot
  denemesi görünür olmayan Web penceresinde başarısızdı; üretim `webOpen(show:true)`
  sonrası gerçek screenshot alındı.
- UI tıklama tanısı: istenen CSS `(1446,149)` noktası pointer olayında
  `(1908.72,196.68)` oldu. `Page.getLayoutMetrics` zoom değeri `0.75757575` idi.
  `tools/cdp-inspect.mjs` koordinatları bu değere göre dönüştürdükten sonra
  gerçek trusted pointer/click `(1446,149)` oldu ve yeni connector formu açıldı.
  Bu düzeltme tanı aracına aittir; üretim `web-session.mouse` zoom davranışı
  henüz canlı testle doğrulanmış değildir.
- Gerçek arayüzle doğrulanabilen bu akış için yeni uzun mock test yazılmadı.
  Bu adımda GPT'ye test mesajı gönderilmedi ve native araç çalıştırılmadı.

Yukarıdaki hazırlık kaydından sonra kullanıcı, yeni connector'ın eklenmesi ve
yalnız geçici test klasörünü hedefleyen normal kayıtlı sohbetleri açıkça onayladı.

### Canlı connector hatası ve düzeltmesi

| Ölçüm → bulgu | Üretim dosyası / düzeltme | Doğrulama |
| --- | --- | --- |
| Gerçek Oluştur isteği HTTP 424; `developer_message: Unsupported MCP protocol version: 2025-11-25` | `hub/mcp-server.cjs:createMessageHandler`: daha yeni MCP teklifi için desteklenen `2025-06-18` sürümünü açıkça yanıtla | Yeni regresyon önce FAIL, sonra PASS; aynı canlı oluşturma HTTP 200 |
| Standart parametresiz MCP ping yanlışlıkla nonce istiyordu | Aynı handler: parametresiz ping `{}`; açık nonce uzantısında broker/instance kontrolü korunur | İkinci kısa regresyon önce FAIL, sonra PASS |
| Tanı aracı yanıt tamamlanmadan hata gövdesini okumaya çalışıyordu | `tools/cdp-inspect.mjs:observe`: bounded 45 saniye, `Network.loadingFinished`, yalnız seçili hata alanları; request body/header/token kaydetmez | Canlı 424 ayrıntısı ve düzeltme sonrası 200 yakalandı |
| ChatGPT bağlantı ekranı | Yeni `Codex++ Native v2` oluşturuldu ve Bağla onayı uygulandı | Detay ekranında Bağla yok, İzinler var; altı doğru araç adı ve inputSchema görüldü |
| Gerçek Codex++ model menüsü | UI değişikliği yapılmadı | Browser-only ve Full satırları görüldü; bir görev henüz gönderilmedi |
| Windows kurulumu bekleniyordu; Devam → Kurulum durduruldu | İzin/sandbox bypass uygulanmadı | Uygulama logunda `windowsSandbox/setupStart` isteği; UI'da Kurulumu yeniden dene. Altta yatan UAC/kurulum hata nedeni henüz kanıtlanmadı |

Referans `src/adapters/chatgpt-web/mcp-server.ts`, `McpServer` SDK'sı ve stdio
transport kullanıyor; launcher kopyalanmadı. Sürüm uzlaşması ve parametresiz ping
[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#version-negotiation)
ve [MCP ping](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping)
sözleşmelerinden doğrulandı. Yeni protokolü destekliyormuş gibi işaretlenmedi.

Gerçek komutlar: `node tools/test-chatgpt-web-lifecycle.mjs` önce **12/14**,
düzeltme sonrası **14/14**; `node tools/test-chatgpt-web-contracts.mjs` **17/17**;
`node --check hub/mcp-server.cjs` ve `node --check tools/cdp-inspect.mjs` exit 0.
Kurulu `resources/hub/mcp-server.cjs` kaynakla SHA256 eşitliği doğrulanarak
güncellendi. Yalnız doğrulanmış kendi tunnel PID 8320 durduruldu; uygulama
yöneticisi PID 5172 ile yeniden açtı; `/readyz` yeniden 200. Ana uygulama PID
10768 ve tarayıcı oturumu korunuyor. Bu kontrollü helper restart testidir;
uygulamanın tam graceful-shutdown testi değildir.

Yeni connector kimliği `asdk_app_6aa314f43b608191b8eb8f21b0755fcc`, yayımlanan
sürüm `asdk_app_v_6aa314f43b6c8191baa4245a02f38be3`.
Varsayılan ChatGPT araç izinleri genişletilmedi; eski `Codex Native2` değişmedi.
Geçici boş klasör `%TEMP%\codexpp-live-9d5cb1de9c00` oluşturuldu; henüz fixture
yazılmadı, GPT mesajı gönderilmedi veya native araç/file-effect kanıtı alınmadı.

Platform oturumu ile `persist:codexpp-chatgpt` partition'ı ayrıdır. Kullanıcı
Codex++'ın açtığı ChatGPT penceresine giriş yaptı. Platform anahtarı ChatGPT
oturumunu veya ücretli model erişimini sağlamaz.

Yeni connector kuruldu; önceki `Codex` / `Codex Native2` connector'ları
silinmemeli. Gerçek picker satırları, published araçlar ve yerel nonce preflight
doğrulandı. Windows kurulumu tamamlandıktan sonra gerçek picker → Web → native
tool → Web dönüşü, geçici workspace'te dosya etkisi ve ikinci kullanıcı mesajı
ile sınanmalı. GPT turn'ü, native tool receipt ve dosya etkisi **NOT RUN**;
tam zincir testi Windows kurulumunda **BLOCKED**.

Yeni/güncellenen connector'ın kalıcı erişim onayı gerekiyorsa kullanıcıdan o
somut adım için onay alınmalı. Geçici sohbet/normal kaydedilen sohbet davranışı
hesap üzerinde henüz test edilmedi; normal sohbet sessiz fallback sayılmamalı.

## Hata mesajları ve rollback

### 11 Eylül: Windows kurulum hatasının gerçek nedeni (düzeltme öncesi)

Bu bölüm önceki “neden henüz kanıtlanmadı” kaydını günceller. Connector hatası
ile Windows sandbox kurulum hatası ayrıdır; connector tekrar silinmedi/yenilenmedi.

| Ölçüm → bulgu | Dosya / işlem | Gerçek sonuç |
| --- | --- | --- |
| Kurulu engine `codex-cli 0.153.4`, Windows 11 Pro `10.0.26200`; setup helper'ın OpenAI imzası geçerli | Mevcut kurulu binary sürümü ve Authenticode kontrolü | Sürüm ve imza doğrulandı; binary değişmedi |
| Private config `sandbox_mode = "danger-full-access"`; native setup managed profil istiyor | Gerçek renderer client `startWindowsSandboxSetup("elevated", testWorkspace)` | `success:false`, `only managed permission profiles can be enforced by the Windows sandbox`; UAC öncesi hata |
| Aynı engine, yalnız child process için `workspace-write` / `on-request` override | `tools/run-windows-sandbox-setup.mjs`; mevcut private home, boş geçici workspace; thread/tool başlatılmaz | `started:true`; gerçek `consent.exe` gözlendi. 120 saniyede completion alınamadı; işlem exit 1. Kurulum başarılı sayılmadı |
| Tekrar kurulum diğer Codex'i etkileyebilir | Aynı sürüm `run_setup_full` → `provision_sandbox_users` → mevcut kullanıcı için `NetUserSetInfo(1003)` | Windows'ta `CodexSandboxOffline` ve `CodexSandboxOnline` zaten var. Parola yenileme riski nedeniyle otomatik tekrar durduruldu; tanı scriptine mevcut hesapta launch öncesi ret eklendi |
| Son durum | Gerçek `windowsSandbox/readiness` | Hâlâ `updateRequired`; private `.sandbox` boş; son kontrolde UAC/helper yok. Full E2E **BLOCKED / NOT RUN** |

Kurulu engine ile `app-server generate-json-schema --experimental --out ...`
çalıştırılarak `windowsSandbox/setupStart`, completion ve readiness sözleşmeleri
doğrulandı. Read-only SQLite log taramasında sandbox hata kaydı bulunamadı;
asıl hata native RPC completion üzerinden alındı. Bundle akışı geçici parser
ile AST'den çıkarıldı; bundle yazılmadı.

Kaynak doğrulaması: aynı sürümün
[managed profil kontrolü](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/windows-sandbox-rs/src/resolved_permissions.rs),
[full setup çağrısı](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/windows-sandbox-rs/src/bin/setup_main/win.rs)
ve [Windows hesap provision kodu](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/windows-sandbox-rs/src/bin/setup_main/win/sandbox_users.rs).
Başka home'un sandbox secret dosyaları okunmadı/kopyalanmadı; sandbox marker'ı
uydurulmadı, unelevated/full-access fallback uygulanmadı. Sadece native setup
için daraltılmış geçici profil kullanılması, kalıcı bir üretim düzeltmesi değildir.

Tanı değişiklikleri: `tools/cdp-inspect.mjs` native readiness/setup tanısı;
`tools/extract-windows-setup.mjs` AST okuma; `tools/probe-windows-setup.mjs`
read-only log sorgusu; `tools/run-windows-sandbox-setup.mjs` bounded ve çakışmada
kapalı native kurulum tanısı. Bu turda uzun mock suite eklenmedi/koşturulmadı.
Bu dört dosyada `node --check` çalıştırıldı. Mevcut hesap kontrolü sonrasında
setup scripti aynı makinede tekrar çağrıldığında **beklenen exit 1 / BLOCKED**
verdi; native setup başlatılmadı. Bu bir sandbox başarı testi değildir.

Test öncesi `backups\windows-setup-20260911` altında private/global config-auth
ve Codex++ accounts yedeklendi. Test sonrası beş dosyanın hash'i yedekleriyle
aynı kaldı; restore gerekmedi. Ortak Windows hesaplarının güvenli sahipliği/reuse
yolu çözülmeden yeniden provisioning yapılmamalı. Tekrar giriş veya connector
yenileme bu hatayı çözmez. Native araç receipt'i, dosya etkisi ve ikinci GPT
kullanıcı mesajı hâlâ **NOT RUN**.

### 11 Eylül: Ortak hesapları yeniden oluşturmadan düzeltme

| Bulgu → düzeltme | Dosya / fonksiyon | Gerçek doğrulama |
| --- | --- | --- |
| Orijinal marker v5; engine 0.153.4 de v5 kullanıyor. Native `require_logon_sandbox_creds` mevcut şifreli kaydı okuyup yalnız ACL refresh yapabiliyor | `install/windows/sandbox-state.ps1:Copy-CodexSandboxState` | Aynı makinedeki gerçek marker + opaque DPAPI dosyası private home'a alındı; kaynak/kopya hash eşitliği korundu |
| Full setup önce marker'ı; başarısız login recovery önce credential dosyasını siliyor | Private kopyalarda korumalı DACL + ReadOnly | Kısa Windows fixture testinde native DeleteFile eşdeğeri silme reddi; private credential/marker sandbox grubuna kapalı. Kaynak ACL değiştirilmedi |
| Önce native readiness `updateRequired` | Mevcut uygulama `windowsSandbox/readiness` | Adoption sonrası `ready`; uygulama yeniden kurulmadı/kapatılmadı |
| Hazır etiketi gerçek yürütme kanıtı değildir | `tools/cdp-inspect.mjs:sandbox-probe`, gerçek uygulamanın `command/exec` yolu, `readOnly`, ağ kapalı | `whoami.exe`: `hulusi\codexsandboxoffline`, exitCode 0, stderr boş |
| Yazma sınırı korunmalı | `sandbox-file-probe`, `workspaceWrite`, yalnız geçici workspace, TMP istisnaları kapalı | İçeride rastgele fixture birebir yazıldı; ayrı kardeş klasöre yazma UnauthorizedAccess ile reddedildi. Native exitCode 0; dosya etkisi bağımsız diskte doğrulandı |
| UI eski başarısız durumunu tutuyordu | Gerçek trusted tıklama: Kurulumu yeniden dene | Native kaynakta hazır state için provisioning'in atlandığı doğrulandı; gerçek UI “Windows kurulumu tamamlandı” oldu. UAC/parola reseti çalıştırılmadı |

Komutlar ve sonuçlar:

- `./tools/test-sandbox-state.ps1`: önce eksik adoption modülü nedeniyle exit 1
  (yeni özellik sözleşmesi, eski üretim hatasının reproducer'ı değildir); sonra
  **6 kontrol PASS**: opaque byte eşitliği, değişmeyen kaynak, korumalı ACL,
  readonly silme engeli, üzerine yazma reddi, uyumsuz sürüm reddi. Gerçek hesap
  gerektirmeyen sentetik fixture; Windows CI adımı eklendi, remote CI koşmadı.
- `Copy-CodexSandboxState -SourceHome C:\Users\ahmet\.codex -DestinationHome
  C:\Users\ahmet\AppData\Local\CodexPP\codex-home`: gerçek yerel adoption PASS.
  Şifreli dosyanın içeriği parse edilmedi, deşifre edilmedi veya çıktıya yazılmadı.
- `node tools/cdp-inspect.mjs 127.0.0.1 19333 sandbox-status`: **ready**.
- `node tools/cdp-inspect.mjs 127.0.0.1 19333 sandbox-probe
  C:\Users\ahmet\AppData\Local\Temp\codexpp-live-9d5cb1de9c00`: **exitCode 0**.
  İlk deneme native Windows'un desteklemediği `outputBytesCap` ile -32600 aldı;
  yalnız tanı isteğindeki bu alan kaldırıldı, koruma veya engine değiştirilmedi.
- Aynı argümanlarla `sandbox-file-probe`: **insideMatches:true,
  outsideAbsent:true, exitCode:0**. `native-2abfd8f6-bf39-4c89-abf6-c89ff2f03272.txt`
  yalnız geçici workspace'te oluşturuldu; normal proje dosyası değiştirilmedi.
- `node tools/test-home.cjs`: **9/9 PASS**; otomatik home import'un secret
  taşımama ve orijinal home izolasyon sözleşmesi korundu. Explicit adoption
  ayrı bir operasyondur. `node --check tools/cdp-inspect.mjs` ve
  `git diff --check`: exit 0 (Git CRLF uyarıları var).
- `codex.exe sandbox windows --help`: bu build'de beklenen yardım çağrısı
  değildi; `windows --help` çalıştırılmaya çalışıldı ve CreateProcessAsUserW
  error 2 aldı. Başarılı test sayılmadı; sonraki ölçümler engine'in ürettiği
  `command/exec` şemasına göre yapıldı.

UI retry sonrası private/global config-auth ve Codex++ accounts dosyalarının
beşi de önceki yedekleriyle aynı hash'te kaldı. Private/source marker ve şifreli
kimlik dosyaları eşit kaldı; private ReadOnly guard'ları duruyor. Kurulumun
tamamlanması yetkiyi full access'e çevirmedi: native testlerde readOnly ve
workspaceWrite açıkça istendi. Ağ engeli için ayrı trafik testi yapılmadı.

Bu düzeltme mevcut **Windows kurulum engelini kapatır**. `command/exec` gerçek
kurulu uygulamanın native yürütücüsüdür fakat bir GPT tool receipt'i veya Full
Web testi değildir. Picker → Web → connector → native tool → aynı Web yanıtı
ve ikinci kullanıcı mesajı zinciri hâlâ **NOT RUN**. Snapshot rotasyonu ve
rollback sınırları [v2 Windows preflight](chatgpt-web-v2.md#windows-private-home-preflight)
bölümündedir; gelecekteki engine veya parola rotasyonu otomatik desteklenmiş
sayılmaz.

- `no runtime key`: Yerel runtime anahtarı dosyası yok; geniş yetkili başka anahtara
  otomatik düşülmez.
- `main channel is required`: Eski profil/yanlış kanal; yeni üretim `writeProfile`
  çıktısını ve gerçek doctor kontrolünü kullan.
- `tunnel health endpoint did not become ready`: `/readyz` başarısı alınamadı;
  process varlığını hazır kabul etme.
- `token refresh failed: HTTP 401`: Native hesap yenileme başarısız; Web girişinden
  ayrı ele alınmalı, token loglanmamalı.
- `Unsupported MCP protocol version: 2025-11-25` / HTTP 424: Eski MCP sunucusu;
  sürüm uzlaşması düzeltmesini kur, kendi tünel yardımcısını yeniden başlat,
  ardından yalnız v2 connector'ı oluştur/yenile ve yayımlanan şemayı doğrula.
- `Windows kurulumu tamamlanmadı / Kurulum durduruldu`: Bu kurulumda native
  completion hatası managed profil uyuşmazlığıdır. Kör Retry aynı hatayı tekrarlar.
  Yukarıdaki 11 Eylül düzeltmesine bak; uyumlu mevcut kurulum açık adoption ile
  korunur. Ortak hesapları yeniden provision etme. Sandbox'ı kapatmak veya
  full-access fallback doğrulama değildir.

Önceki mevcut kurulum geri alınabilir yedekte:
`%LOCALAPPDATA%\CodexPP\backups\CodexPP-20260910195443Z`.
Oturum/config yedeği `backups\web-full-state-20260910` içinde. Rollback için
Codex++'ı kapatıp eski uygulama dizinini geri yükle; mevcut userData'yı veya
global `.codex` dosyalarını silme. Secret ve hesap yedekleri repoya alınmaz.
Yeni tunnel/key'in iptali ayrı, açık kullanıcı onaylı işlem olmalıdır; eski
tunnel/key'lere dokunulmaz. Bu turda rollback veya key iptali yapılmadı.
