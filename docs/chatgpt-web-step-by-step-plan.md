# ChatGPT Web / Full: adım adım uygulama ve doğrulama planı

Tarih: 11 Eylül 2026.

**K1/K2 uygulama güncellemesi:** Compaction thread/turn iptal kimliği ve reserved
tek kullanımlık MCP checkpoint teslimi uygulandı. Gerçek retained v2 compaction
10:38:36Z'de engine `compacted`/yeni window ile geçti. Aynı native görevin
özet sonrası native patch+okuma zinciri dosyayı `fourth-f70279e1` yaptı ve `7319`
görsel bilgisini korudu (10:41:05Z hatasız final). Ayrı compaction native Durdur
ile `turn_aborted/interrupted`, engine idle ve Web Stop=false oldu. Eski başarısız
denemeler tarihsel kanıt olarak aşağıda tutuluyor; tüm plan hâlâ tamamlanmış değil.
K3 pre-tool baseline ve owned-partial Undo kaynakta; K4 kullanıcı görseli/uzun
exec/exit7/iptal sonrası session kontrolü; K5 gerçek renderer crash ve aynı görevde
native patch ile yeni lease canlı geçti. Ana offline grup artık **61/61**.
K6 Web→native, checkpoint sonrası aynı görevde canlı geçti. Ters yön native engine'in
şifreli compaction kaydı nedeniyle browser açmadan açık unsupported verdi; bu varyant
PASS değildir. Referans blob'u çözmek yerine okunamayan-geçmiş notu kullanıyor;
kayıpsızlık şartı nedeniyle kopyalanmadı. K3 gerçek partial/remount çeşitleri,
account/fork/remote matrisi ve K7 aktif-tool handoff/subagent desteği açık kaldı.
Güncel komutlar, live/offline ayrımı ve rollback worktree execution log'unda.

Tarihsel önceki durum (aşağıdaki 44/44 ve BLOCKED kayıtları son kabul özeti değildir): Mevcut Codex++'ta native patch → exec/session_id → write_stdin/exit 0 → aynı Web final zinciri, ikinci user mesajında dosya değişimi, aynı Web sohbetinde fresh-token takip mesajı, advertised MCP app aracı ve gerçek view_image sonucu canlı doğrulandı. O andaki 10 dosyalı offline grup **44/44**, contract **18/18**, lifecycle **14/14**.

İptal testinin ilk denemesinde native görev kesilse de browser lease sızdı. Referansın Stop focus+Enter yolu uyarlanınca normal canlı tekrar: native pasif 2749 ms, Web stop=false 3443 ms; sonraki işlem kapasite hatasına takılmadan başladı. Aktif owned browser close da native terminal hata + kapalı kalan pencere ile 7367 ms içinde doğrulandı. Uzun native komut sırasında iptal ise OpenAI inventory güvenlik engeli nedeniyle BLOCKED; komut başlamadı. Compaction'ın otomatik tekrar gönderimi düzeltildi (v1/v2 aynı bounded journal); canlı v2 3910 karakterde terminal işareti gelmeyerek deadline_exceeded ile FAIL oldu. Yeni epoch/başarılı compaction iddia edilmedi. O takılmada Stop da yanıt vermedi; owned pencere kapatıldıktan sonra aynı görevin canonical full bağlamıyla doğru dosya/görsel bilgisi geri geldi. OS crash, user-origin image ve kalan model/geçiş varyantları ayrıca doğrulanacak. Aktif-tool compaction handoff ve subagent multiplexing desteklenmiyor.

Ayrıntılı kanıt Web worktree'sindeki `docs/chatgpt-web-execution-20260911.md` kaydında. [Adım 1 ölçüm ve geri dönüş kaydı](chatgpt-web-step-01-baseline.md). Her takılmada önce referansın ilgili kaynak çözümü okunur; global config/auth rotası değiştirilmez.

**Son kaynak incelemesi:** [Bölüm 12 — açık kalan senaryolar ve referansa dayalı devam sırası](#12-açık-kalan-senaryolar-referansa-dayalı-devam-sırası). Bu bölüm 11 Eylül'deki son canlı kayıtların ardından hazırlanmıştır; yeni uygulama veya canlı test sonucu değildir. Alttaki ilk bulgu tablosu tarihsel başlangıç bulgularıdır, bugünkü eksik listesi olarak okunmamalıdır.

## 1. Amaç ve çalışma sınırı

Mevcut Codex++ uygulamasındaki ChatGPT Web / Full entegrasyonunu, incelenen referansın gerekli sözleşmelerini uyarlayarak çalıştırmak. Başarı; ChatGPT'nin aynı Codex++ görevinin bağlamını alması, o görevin gerçekten sunduğu ve izin verdiği native araçları kullanması ve sonuçların aynı Web yanıtına dönmesidir. İlk kabul, gerçek arayüzden başlatılan bir dosya değişikliğidir; bütün özelliklerin tamamlandığı ilanı değildir.

Yeni bir launcher, ikinci bir test uygulaması, yeni hesap yönetimi veya genel amaçlı bir framework yapılmayacak. Kaynak için branch/worktree kullanmak, ayrı uygulama kurmak anlamına gelmez. Referansın tamamı kopyalanmayacak; Codex++'ın mevcut hub, renderer ve kurulum sınırları korunacak.

Değişmeyecek kurallar:

- Yalnız mevcut Codex++ kurulumu hedefte. Stock uygulama ve CLI davranışı korunacak. Kullanıcının açık izni mevcut Codex++'ı yeniden kurmayı kapsıyor; buna rağmen yalnız gerekli olduğunda, önceden haber vererek yapılacak.
- Kaydedilmemiş değişiklikler korunacak. Zorla checkout, `reset --hard`, geniş temizleme, habersiz süreç kapatma yok.
- Push, merge, release ve yeni dış kaynak oluşturma bu planın uygulama adımları değil; ayrıca açık talep gerektirir.
- Ortak `~/.codex/config.toml` ve `auth.json` üzerinde kalıcı global Web rotası oluşturulmayacak. Native abonelik, hesap değiştirme, thread-account yönlendirmesi ve `cxp/` provider'lar korunacak.
- Araçlar hub içinde ayrı ve sınırsız shell ile yürütülmeyecek. Native sandbox, approval ve OS izinleri geçerli kalacak. Bir reddi aşmak için sandbox kapatılmayacak.
- Hesap durumunu değiştirebilecek testlerden önce ilgili auth/account dosyaları erişimi kısıtlı yedeklenecek. İlgisiz hesaplara dokunulmayacak; yalnız testin değiştirdiği durum geri alınacak.
- Key, cookie, turn token veya kullanıcı prompt'u loglara yazılmayacak. Kanıtta yalnız gerekli kimlik hash'leri, olay türleri, boyutlar ve kontrollü fixture verileri bulunacak.
- Referansın `Codex Native2` connector'ı silinmeyecek veya üzerine yazılmayacak. Codex++ ayrı, sürümlü kimliğini koruyacak.
- Temporary Chat başarısızsa normal, geçmişe kaydedilen konuşmaya sessiz geçiş yapılmayacak. Test ve kalıcı ürün davranışı için bu tercih ayrı ve açık olacak.
- macOS'ta `codex`, `codex-code-mode-host`, `cua_node/bin/node`, `node_repl` ve `Codex Computer Use.app` alt ağacının özgün imzaları korunacak. Bozuk eski kurulum timeout artırma veya ad-hoc imzalama ile düzelmiş sayılmayacak.

## 2. Başlangıç noktası ve kanıt sınırı

| Kaynak | İncelemede doğrulanan durum | Uygulama açısından anlamı |
|---|---|---|
| Ana checkout | `main`, `f218a17a95281aeebc343893374b8ebbd90d32de`; kullanıcı değişiklikleri mevcut | Adım 1 düzeltmesi: Bu HEAD, `a80bb64`ün 6 commit gerisinde. Web dosyaları kaldırılmamış; sonraki commitlerde eklenmiş. Kullanıcı değişiklikleri korunacak. |
| Web uygulama worktree'si | `codex-plus-plus-chatgpt-web-fix`, `a80bb648f0cb9e27baaec09848d95c2d2005fb23` tabanı; commit edilmemiş düzeltmeler mevcut | Adım 1'de uzak HEAD ile eşleşti ve kurulu 36 hub dosyası bu worktree ile birebir aynı çıktı. Uygulama tabanı burası; main zorla güncellenmeyecek. |
| Referans | `miuuyy/codex-chatgpt-web`, `e85e3693fdb4e3e033348c08df0298c20fcdb612`, paket `5.0.6` | Önceki incelemede yerel kaynak ile uzak HEAD eşleşti. Uygulama bu sabit referansla başlayacak; sonraki güncellemeler ayrıca incelenecek. |
| Kurulu uygulama/engine | Adım 1: app `26.903.61454`, build `8378`, `codex-cli 0.153.4` | Tam yol, SHA-256 ve Windows native engine imzası ölçüldü. Başka engine ile elde edilen sonuç kurulu uygulamanın kanıtı olmayacak. |
| Canlı Full sonucu | Aynı native görevde dosya oluşturma/değiştirme; patch + exec + stdin, retained fresh token, image ve app tool receipt'leri doğrulandı | Native komut sırasında iptal BLOCKED; compaction ve kalan canlı kenar durumları ayrı. Bütün plan tamamlandı değil. |

Bu plan hazırlanırken ana checkout HEAD/status yeniden okundu; mevcut test dosyalarının girişleri ve CI incelendi. Uygulama testi, kurulum veya canlı mesaj çalıştırılmadı.

### Kanıt → bulgu → yapılacak adım

Bu tablo önceki kaynak incelemesini izlenebilir kılar; statik bulguyu canlı test sonucu yerine koymaz. Hedef dosya adları Adım 1'de seçilen `codex-plus-plus-chatgpt-web-fix` worktree'sini ifade eder. Önceki commit sırası yorumu Adım 1'de Git atalık ölçümüyle düzeltildi.

| Kanıt | Kaynakta gözlenen bulgu | Karşılık gelen adım |
|---|---|---|
| E01: Referans `mcp-server.ts` doğrudan native araç seçiyor; hedef `gateway.cjs` `hasExecGateway` şartı koyuyor | Full, referanstan daha dar bir araç sözleşmesine bağlanmış | 2–3 |
| E02: Referans `browser-worker.ts` tam prompt karşılaştırması ve düz metin ekleme kullanıyor; hedef `typePrompt/promptLanded` farklı | Önceki paragraf okuma düzeltmesi bütün gönderim sözleşmesini karşılamıyor | 5–6 |
| E03: Referans `turn-execution.ts` round olaylarını tutuyor; hedef gateway tekrarları reddediyor veya disconnect'te turn'ü kapatıyor | Token yenilemesi mevcut olsa da tekrar bağlanma devamlılığı eksik | 4 ve 10 |
| E04: Referans broker completion fence kullanıyor; hedef `readAnswer` DOM ve metin uzunluğuna dayanıyor | Final kabulü native araç durumuyla yeterince bağlanmamış | 4 ve 10 |
| E05: Hedef MCP beklemesi 90 saniye, broker tool beklemesi 300 saniye; socket close pending çağrıyı iptal etmiyor | İstemci beklemeyi bıraktıktan sonra kuyruktaki çağrı yürütülebilir | 4 ve 7 |
| E06: Hedef v1 compaction son iki user mesajını seçiyor ve farklı summary prefix kullanıyor | Native replacement-history sözleşmesine tam uyum yok | 12 |
| E07: Hedef tek global browser; referans görev bazlı sahiplik ve sınırlı paralellik kullanıyor | Mevcut güvenli kapasite reddi multi-agent desteği değil | 6 ve 13 |
| E08: Referans account/model token ve karakter sınırlarını ayırıyor; hedef bazı değerleri genel byte sınırı yapıyor | Web limitleri ve picker kapasite iddiaları yeniden bağlanmalı | 5–6 ve 11 |
| E09: Referans connector verification yalnız seçim yapıyor, mesaj göndermiyor | Pill veya yerel ping gerçek tool dönüşünü kanıtlamaz | 7–9 |
| E10: Ana checkout Web worktree'sinin 6 commit gerisinde; ikisinde de kaydedilmemiş değişiklikler var | Main'in private-home iyileştirmeleri ile yeni Web/thread-account/imza korumaları birlikte korunmalı; tam klasör üstüne yazma uygun değil | 1 ve 14 |

Kaynak yeniden kontrolü için çalışma dizinlerinde okunabilecek örnekler; bunlar gelecekteki uygulama testleri değildir:

```powershell
# Ana checkout veya Web worktree'sinde, bulunduğun dizinin kimliğini önce kontrol et.
git status --short
git branch --show-current
git rev-parse HEAD
```

```powershell
# Eski Web worktree'sinde, yalnız kaynak okumak için.
rg -n 'hasExecGateway|native freeform exec' hub/gateway.cjs
rg -n 'CALL_TIMEOUT_MS' hub/mcp-server.cjs
rg -n 'TOOL_TIMEOUT_MS' hub/turn-broker.cjs
rg -n 'SUMMARY_PREFIX|slice\(-2\)' hub/web-contract.cjs
```

## 3. Her adımın çalışma biçimi

1. Önce gözlem ve referanstaki ilgili sözleşme yazılır.
2. UI'de güvenle gösterilebilen sorun UI'de ölçülür. Zamanlama, retry, iptal, queue, parser ve bozuk frame gibi UI'de güvenilir biçimde üretilemeyen durum için küçük bir üretim-modülü regresyon testi eklenir.
3. Yeni regresyon testinin düzeltmeden önce beklenen nedenle başarısız olduğu kaydedilir. Mevcut test yeterliyse kopyası yazılmaz.
4. Yalnız o adımın gerekli üretim değişikliği uygulanır. İlgisiz refactor yapılmaz.
5. Odaklı test tekrar çalıştırılır; canlı doğrulama gerekiyorsa ayrıca yapılır.
6. Sonuç, değişen dosyalar ve gerçek komutlarla kaydedilir; kısa ilerleme bilgisi verilerek sıradaki adıma devam edilir.

Durumlar:

- `NOT STARTED`: Adım başlamadı.
- `IN PROGRESS`: O adım üzerinde çalışılıyor.
- `PASS-OFFLINE`: Yalnız hesap/ağ/Electron/native shell gerektirmeyen kontrol geçti.
- `PASS-LOCAL`: Gerçek yerel engine/IPC/sandbox bileşeniyle geçti; ChatGPT browser'ı sahte ise canlı başarı değildir.
- `PASS-LIVE`: Gerçek Codex++ UI, ChatGPT, connector/tunnel ve native tool zinciri kanıtlandı.
- `FAIL`: Çalıştırıldı ve başarısız oldu; beklenen/gerçek sonuç kayıtlı.
- `BLOCKED`: Somut izin, hesap, platform veya dış servis engeli var.
- `NOT RUN`: Çalıştırılmadı. Çıkış kodu sıfır olan bir `skip` da geçti diye yazılmaz.

Bir adımın kabul koşulu sağlanmadığında bağımlı adım başarılı gösterilmez. Canlı izin engeli varsa somut engel bildirilir ve bağımsız offline işler tamamlanmaya devam edilir.

## 4. Uygulama adımları

### Adım 1 — Kaynak, kurulum ve geri dönüş noktasını sabitle

**Amaç:** Hangi kodun hangi uygulamada çalıştığını tartışmasız hale getirmek. Durum: `PASS-LOCAL` — kaynak/kurulum/rollback başlangıç noktası doğrulandı; canlı Full testi yapılmadı. [Kanıt ve sonuç](chatgpt-web-step-01-baseline.md).

Yapılacaklar:

- Ana checkout ve eski Web worktree'sinin status/branch/HEAD/diff'lerini ayır; kullanıcı değişikliklerine dokunma.
- İki HEAD'in farkını ve Git atalık sırasını ölç; dizin/branch adına göre güncellik çıkarma. Adım 1 sonucu: `f218a17 → a80bb64`, 6 ileri commit; Web ve imza korumaları sonraki commitlerde eklenmiş.
- Taşınacak eski düzeltmeleri “koru / referansa göre değiştir / ilgisiz, dokunma” olarak sınıflandır. Güncel tabana uyarlamayı tercih et; kullanıcı değişiklikleriyle çakışma varsa kod değiştirmeden kapsamı sun.
- Kurulu Codex++ yolu, app build'i, `app.asar` ve engine yolu/hash/sürümünü kaydet. Chromium dosya sürümünü Codex build'i diye raporlama.
- İlgili süreçlerin sahipliğini ve açık oturumları tespit et. Plan çalışması veya ölçüm için uygulamayı kapatma.
- İleride kurulum değişecekse yalnız değişecek dosyalar için timestamp'li yedek ve manifest hazırla; hassas state yedeğini ayrı ve erişimi kısıtlı tut.
- Mevcut testleri çalıştırma koşullarına göre sınıflandır; baseline hatalarını bizim değişikliğin hatasından ayır.

**Çıktı:** Tek kaynak/kurulum eşleme tablosu, seçilen çalışma tabanı, korunacak değişiklikler ve somut rollback hedefleri.

**Kabul:** “Şu uygulama şu kaynak/build'den çalışıyor” kanıtı ve geri dönüş yolu belli. Bu adımdan sonra da uygulama davranışı değişmiş olmayacak.

### Adım 2 — Gerçek engine isteğini ve mevcut hatayı ölç

**Amaç:** Referansın hangi wire biçimini mevcut engine'e uyarlayacağımızı belirlemek. Durum: `PASS-LOCAL` — kurulu 0.153.4 ile gerçek start/resume/fork, direct/gateway ve startup catalog ölçüldü; desktop arg gölgelemesi canlıda ayrıca doğrulandı.

Yapılacaklar:

- Gerekli şema/fixture'ları kurulu uygulamanın aynı engine binary'sinden, ayrı geçici çalışma alanında elde et; ortak config/auth rotasını değiştirme.
- `thread/start`, `thread/resume`, `thread/fork` ve `turn/start` parametrelerinin gerçek sözleşmesini kaydet.
- `tools[]`, `additional_tools`, namespace, function/freeform ve code-mode gateway yerleşimini gerçek istek üzerinden ölç. Parser'ı yalnız tarihsel tek şekle bağlama.
- Thread kimliği, mantıksal turn, request/round, compaction bilgisi ve advertised tool özetini kaydet. Gerçek prompt/token/cookie gövdesini kalıcı loglama; kontrollü fixture dışındaki içerikleri saklama.
- Kurulu UI'den bir kontrollü başarısız Full denemesi gerekiyorsa önce bu amaç ve geçici workspace gösterilir. Hatanın picker, route, gateway, browser, MCP veya native executor'dan hangisinde çıktığı ölçülür.
- `exec` yokluğu ile bütün native araçların yokluğunu ayır. Mevcut native araçların varlığını bilmeden engine/sandbox arızası sonucu çıkarma.
- Okunamayan encrypted/native protokol biçimini browser açmadan reddetme koşulunu belirle.

**Dosyalar:** `hub/gateway.cjs`, `hub/web-contract.cjs`, `120-web-models.mjs`, ilgili engine kontrat testleri.

**Kabul:** Sanitized gerçek wire fixture'ı, araç türleri ve hatayı üreten katman belli. Bu aşamada hata yalnız gözlenir; rastgele feature flag açılmaz.

### Adım 3 — Native araç köprüsünü referansın iki yoluna uyarla

**Amaç:** Full modunun gereksiz `exec` zorunluluğunu kaldırmak; araçları gerçekten advertised yüzeyden çağırmak. Durum: `PASS-OFFLINE`, test edilen direct native araçlarda `PASS-LIVE` — patch, exec, stdin, view_image, inventory, get_usage_limits; bütün nested araçlara genellenmez.

Yapılacaklar:

- `codex_exec`, `codex_write_stdin`, `codex_apply_patch`, `codex_view_image`, `codex_tool_inventory`, `codex_tool_call` için tek native çözümleme yolu oluştur.
- Araç doğrudan function/freeform olarak sunuluyorsa doğru wire adı/namespace/input biçimiyle doğrudan çağır. Native `exec` gateway yalnız gerçekten sunuluyorsa kullanılabilir; gateway içindeki isim de gerçek `ALL_TOOLS` envanterinden gelmeli.
- `exec_command` ve `shell_command` varsa yalnız gerçekten mevcut olanın argüman sözleşmesine uyumlu native eşlemesi yapılır. Olmayan araç tahmin edilmez; başka yolla sessizce taklit edilmez.
- `responses-stream.cjs` yalnız custom `exec` üretmek yerine gerçek function/freeform tool-call biçimini, callId ve namespace'i korur.
- Inventory sorgusu filtreli ve sayfalanabilir olur; bütün tool dokümanı prompt'a eklenmez. Native direct registry ile gateway içi inventory açıkça ayrılır.
- Sonuç normalizasyonu `output` dışındaki `session_id`, `exit_code`, `isError`, `structuredContent`, content block, image/audio/resource ve gerekli metadata'yı korur. Native hata/approval sonucu başarıya çevrilmez.
- Native apply_patch kullanılır; shell ile dosya yazmak patch desteğinin kanıtı sayılmaz.
- Alınan referans kodu için MIT copyright/lisans/commit atfı korunur.

**Dosyalar:** `hub/native-tools.cjs`, `hub/mcp-server.cjs`, `hub/web-contract.cjs`, `hub/gateway.cjs`, `hub/responses-stream.cjs`.

**Doğrulama:** Doğrudan araç olup exec olmayan fixture; namespace/custom/function biçimleri; gerçek gateway mevcut/yok; bilinmeyen isim; freeform argüman ayrımı; zengin sonuç kayıpsızlığı. Üretim modüllerine bağlı küçük contract testleri.

**Kabul:** Exec olmadan sunulan doğrudan native araç çağrısı doğru üretilebiliyor; eksik araç açık hata veriyor. Bu sonuç henüz canlı E2E değildir.

### Adım 4 — Token, broker ve tool boundary temelini düzelt

**Amaç:** Bir kullanıcı turn'ünün araç döngüsünü doğru kimlikle ve tek yürütmeyle tutmak. Durum: `PASS-OFFLINE`; üç round ve retained fresh-token canlı kanıtlı, canlı old-token replay ayrıca çalıştırılmadı.

Yapılacaklar:

- Thread, mantıksal user turn, HTTP request/round, browser conversation/lease ve compaction epoch ayrı tutulur. `prompt_cache_key` bunların ortak yerine kullanılmaz.
- Her yeni mantıksal user turn'ünün tam veya retained prompt'una güncel transport sözleşmesi eklenir. Aynı turn'ün tool-result round'larında aynı token/authority korunur; terminal eski token geçersizdir.
- Eksik zorunlu kimlik açıklayıcı hata olur; browser'a `token:null` gönderilmez.
- Kuyrukta bekleyen, dispatch edilmiş, tamamlanmış, iptal/expired ve sonucu belirsiz callId durumları ayrılır. Aynı callId/farklı payload reddedilir.
- Timeout, henüz dispatch edilmemiş çağrıyı kuyruktan da çıkarır. Dispatch edilmiş işlemin timeout'unda yan etki yokmuş gibi davranılmaz ve otomatik yeniden yürütülmez.
- `end/revoke/cancel` bütün tüketicileri ve tool waiter'larını sonuçlandırır. Kapalı turn üzerinde yeni sonsuz waiter oluşmaz; tek wake callback yerine kontrollü waiter kümesi kullanılır.
- Bir round'daki bütün tool sonuçları doğru callId'lerle teslim edilir; stale/duplicate/unknown ayrılır, başarısız teslim yok sayılmaz.
- Araç çağrısıyla kapanan HTTP response bütün Web turn'ünün bitişi sayılmaz. Browser ve token aynı mantıksal işte korunur.
- Final kabulü, aktif MCP/tool işi bulunmaması ve broker activity revision'ın değişmemesiyle atomik olarak bağlanır.

**Dosyalar:** `hub/turn-broker.cjs`, `hub/gateway.cjs`, `hub/broker-socket.cjs`, `hub/web-session.cjs`.

**Doğrulama:** Fresh token/eski token reddi; üç tool boundary; expired queue dispatch=0; tüm waiter'ların sonuçlanması; stale/duplicate/unknown output; aynı çağrının yan etkisinin bir kez üretilmesi; final ile yeni tool çağrısının yarışı.

**Kabul:** Üretim modüllerindeki bu deterministik senaryolar geçer. Genel HTTP yeniden bağlanma testi Adım 10'da ayrıca yapılır.

### Adım 5 — Görev bağlamını ve görsel taşıma sözleşmesini düzelt

**Amaç:** ChatGPT'ye yalnız son user metnini değil, aynı görevin gerekli canonical bağlamını taşımak. Durum: `PASS-OFFLINE`; retained metadata ve native image dönüşü canlı kanıtlı, kullanıcı kaynaklı input image UI kabulü henüz `NOT RUN`.

Yapılacaklar:

- Instructions, system/developer/user/assistant rolleri, assistant kararları, ilgili tool calls/results, workspace/environment ve output schema normalize edilir; bilinmeyen gerekli native içerik sessizce atılmaz.
- Transport preamble yalnız köprüyü tarif eder. “İzin sorma”, her işte özel dosya oku gibi görevin anlamını veya izin politikasını değiştiren ek talimatlar kaldırılır.
- Retained suffix yalnız kanıtlanmış canonical geçmiş eşleşmesinden çıkarılır. Yeni developer/environment değişiklikleri korunur.
- Chat/epoch/account/lease veya canonical prefix uyuşmazsa eski chat'e kısmi bağlam basılmaz; önce sahiplik temizlenir, canonical full context ile yeni session hazırlanır.
- Görseller gerçek attachment veya desteklenen native multimodal sonuç olarak taşınır. Metin açıklaması görselin yerine geçirilmez; uzak görsel adresleri için yeni yetkisiz fetch yolu eklenmez.
- Model context token bütçesi, output rezervi, composer karakter/byte ölçüsü ve attachment limitleri ayrı doğrulanır. Referansın account-specific değerleri genel sabit yapılmaz.
- Sınır aşımında sessiz kırpma veya eski görsel eleme yok. Desteklenen compaction ya da açık kullanıcı tercihi gerekir; uygun yol yoksa gönderim öncesi hata.
- Usage tahmini açıkça estimated olarak taşınır; gerçek provider usage varmış gibi gösterilmez.

**Dosyalar:** `hub/web-contract.cjs`, `hub/web-session.cjs`, `hub/gateway.cjs`, model/catalog metadata'sı.

**Doğrulama:** Roller, developer değişikliği, assistant kararı ve tool evidence içeren kısa canonical fixture; birebir suffix; görsel blokları; Unicode karakter/byte farkı; context/attachment sınırı; schema; unsupported opaque payload.

**Kabul:** Gönderilecek bağlamın ne olduğu ve neden o suffix'in seçildiği kanıtlı; sessiz kayıp yok.

### Adım 6 — Browser'a doğru modeli, tam prompt'u ve attachment'ları gönder

**Amaç:** Referansın mevcut sorunumuzla doğrudan ilgili browser sözleşmesini uyarlamak. Durum: `IN PROGRESS` — exact prompt/model, optimistic identity ve normal/provisional URL promotion düzeltildi; gerçek kimlik değiştiren DOM remount ve hesap varyantları doğrulanmadı.

Yapılacaklar:

- Önce kurulu bundle'da anlamlı UI anchor/akış adayları bulunur, sonra canlı DOM'da varlığı ölçülür. Sıfır selector sonucu boş liste diye yorumlanmaz.
- Family, effort ve Browser-only/Full ayrı tutulur. Gerçek hesabın sunduğu seçenekler keşfedilir; picker/gateway/browser aynı doğrulanmış catalog'u kullanır.
- Pro veya slider/family kanıtlanamıyorsa send öncesi hata. Pro index'ini alt maksimuma clamp etmek, unknown slug'ı current model'e çevirmek yok. Retained turn'de de seçim yeniden doğrulanır.
- Mevcut browser penceresinde göreve ait lease/conversation sahipliği kaydedilir. Navigation, logout, close/crash bu bağı geçersiz kılar. İlk aşamada tek kapasite korunabilir; ikinci iş açık reddedilir, başkasının chat'i alınmaz.
- Temporary Chat/connector uyumluluğu gerçek hesapta ölçülür. Privacy/personalization ayarı veya normal history kullanımı gerekiyorsa kullanıcıya somut tercih sunulur; otomatik değiştirilmez.
- Referansın plain-text ekleme sözleşmesi uyarlanır. Connector pill'leri karşılaştırmadan çıkarılır; yalnız tanımlı eşdeğer boşluk farkları kabul edilir. Tam prompt doğrulanır, yalnız son parça/uzunluk değil.
- Kısmi insert sonrası bütün prompt tekrar eklenmez. Henüz gönderim yoksa yalnız bu işlemin sahibi olduğu draft temizlenir ve sınırlı güvenli toparlanma yapılır; kullanıcının ilgisiz draft'ı silinmez.
- Attachment dosya seçimi ile yükleme kabulü ayrılır; dosya sayısı, hazır attachment tile'ları ve upload failure kontrol edilir.
- Platform kısayolları doğrulanır. Gönderme kontrolünün aktif olması, send activation ve logical user-turn kabulü ayrı izlenir; Return tek başına başarı olmaz.
- DOM remount/virtualization durumunda yalnız kanıtlanmış aynı turn yeniden bağlanır; kabul edilmiş prompt tekrar gönderilmez.

**Dosyalar:** `hub/web-session.cjs`, `hub/web-contract.cjs`, `120-web-models.mjs`; mevcut preload/UI bağlantıları yalnız gerektiği ölçüde.

**Doğrulama:** Gerçek UI'de model seçimi ve kontrollü Markdown/Unicode prompt; kısa fixture ile partial insert, NBSP, remount, yanlış model, attachment failure ve kabul belirsizliği.

**Kabul:** Doğru model kanıtıyla tam prompt ve attachment kabulü tek gönderim olarak izlenebiliyor; kanıt eksikse send engelleniyor.

### Adım 7 — Connector, tunnel ve IPC readiness zincirini tamamla

**Amaç:** Pill veya çalışan process yerine gerçekten doğru köprünün hazır olduğunu kanıtlamak. Durum: `PASS-LOCAL` ve altı connector action ile gerçek native dönüş `PASS-LIVE`; spawn/restart/EOF negatifleri offline. Referans connector değiştirilmedi.

Yapılacaklar:

- Mevcut Codex++ tunnel/key/connector durumunu ölç; kullanıcı daha önce oluşturulmasına izin verdi diye yeniden key/tunnel yaratma. Key'in içeriğini gösterme.
- Codex++ connector kimliği, schema sürümü ve mevcut yayınlanan tool şeması eşleştirilir. Referans connector'a dokunulmaz.
- Readiness; executable erişimi, key okunabilirliği, socket erişimi, tunnel health, MCP initialize, tools/list, schema/version ve beklenen instance/turn'e bağlı zararsız nonce roundtrip olarak katman katman ölçülür.
- Yerel ayrı MCP process'inin başarılı olması, tunnel üzerinden yayınlanan connector'ın güncel olması sayılmaz. Eski ping action cache'i, stale schema ve yanlış instance özellikle ayrılır.
- Refresh gerekirse yalnız Codex++ connector için platformun mevcut yenileme yolu kullanılır; eski connector silinmez. Yeni kimlik ancak gerçek şema değişikliği gerektirirse önerilir ve migration açık gösterilir.
- `mcp-command` quoting boşluk/apostrof ve Windows executable/named-pipe ile POSIX path senaryolarında test edilir.
- POSIX socket sahipliği/uid/izinleri kontrol edilir; timeout veya permission error “stale socket” sayılmaz. Başka canlı instance'ın socket'i silinmez.
- Body/frame/argüman boyutları tutarlı sınırlandırılır. MCP'nin kabul ettiği payload daha küçük IPC limiti yüzünden belirsizce kaybolmaz; fazla boyut açık hata olur.
- Reply request-id eşleşmesi, EOF/mid-frame close, malformed frame, unsupported method ve protokol negotiation test edilir. `server/discover` için uygulanmayan boş başarı uydurulmaz.
- MCP timeout/abort ile broker pending çağrısı aynı iptal sözleşmesine bağlanır: dispatch öncesi kaldır, dispatch sonrası sonucu belirsiz iş olarak işaretle; kör tekrar yok.
- Spawn error/exit/close, geç readiness ve yeniden başlatma bütçesi ayrılır. Stop tüm restart timer'larını iptal eder; drain ve child exit bounded olarak izlenir.
- Yerel control endpoint'lerinin yalnız yetkili loopback sahibi tarafından kullanılması korunur.

**Dosyalar:** `hub/tunnel.cjs`, `hub/mcp-server.cjs`, `hub/broker-socket.cjs`, `hub/main.cjs`, ilgili kurulum bağlantıları.

**Kabul:** Doğru instance + doğru schema + gerçek yayın yolu kanıtlanır. Gerçek araç yetkisi Adım 8'de ayrıca sınanır. Refresh/login/izin engeli varsa bu adım `BLOCKED`, downstream canlı test `NOT RUN` olur.

### Adım 8 — İlk gerçek UI → Web → native araç → Web dönüşünü kanıtla

**Amaç:** İlk dikey canlı kabul. Durum: `PASS-LIVE` — native patch receipt, gerçek fixture etkisi ve aynı Web yanıtından native final kanıtlı.

Ön koşul: Adım 1–7'nin ilk canlı çağrı için gereken kabul koşulları sağlanmış olmalı. Yapılacaklar:

1. Aynı mevcut Codex++ kurulumu kullanılır. Değişiklik yüklemek için restart gerekiyorsa önce haber verilir; ilgisiz çalışan task kapatılmaz.
2. Kullanıcının günlük projesinden bağımsız, rastgele işaretli geçici workspace hazırlanır. Dosyaların önceki içeriği/hash'i kaydedilir.
3. Gerçek UI'de yeni görev açılır ve doğrulanmış ChatGPT Web Full modeli picker'dan seçilir. Ayrı app-server sürerek picker atlanmışsa test UI E2E diye adlandırılmaz.
4. ChatGPT'den native `codex_apply_patch` ile yalnız bu workspace'te bir dosya oluşturması istenir. İzin istenirse normal native approval akışı izlenir.
5. Native file-change/tool receipt, aynı callId'nin gateway/broker dönüşü ve aynı Web yanıtının devamı birlikte kontrol edilir.
6. Oluşan dosya bağımsız olarak okunur ve beklenen rastgele içerikle karşılaştırılır. Yalnız final metindeki “başardım” ifadesine bakılmaz.
7. Kullanıcıya hatanın hangi katmanda kaldığı veya tam zincirin hangi kanıtlarla geçtiği gösterilir.

**Kabul:** Bir gerçek Full mesajı native patch receipt + gerçek dosya etkisi + aynı Web yanıtına sonuç dönüşüyle `PASS-LIVE`. Bu, ikinci mesaj/retry/compaction geçti demek değildir.

### Adım 9 — Aynı thread'de ikinci mesajı ve native araç çeşitliliğini doğrula

**Amaç:** Tek başarılı ilk mesajın ötesine geçmek. Durum: `IN PROGRESS` — ikinci/üçüncü dosya etkisi, üç tool round, stdin, app ve native image canlı geçti; user-origin image, canlı error-exit ve old-token negatif senaryoları tamamlanmadı.

Yapılacak canlı senaryolar:

- Aynı Codex++ thread'inde ikinci user mesajıyla ilk dosyayı native patch üzerinden yeniden değiştir. Yeni token, eski token reddi, beklenen retained chat ve dosya hash'i doğrulanır.
- Bir user turn'ünde en az üç ardışık tool round tamamlat: inventory, native komut/okuma, native patch veya stdin devamı. Her callId'nin doğru sonuçla aynı browser turn'üne döndüğü gösterilir.
- Uzun native komutun session_id döndürmesini ve `codex_write_stdin` ile devam/poll edilmesini ölç. Session, exit_code, hata ve son çıktı korunur. Kontrollü komut yalnız geçici fixture kapsamında çalışır.
- Bir başarısız komutun exit/error bilgisinin Web'e hata olarak dönmesini kontrol et; izin reddi başarısızlık olarak korunur.
- Gerçek bir görsel input attachment'ı ve native `view_image` sonucu ayrı ayrı sınanır. Metin yer tutucu görsel başarısı sayılmaz.
- Inventory'den o turn'de gerçekten sunulan bir MCP/app aracı keşfedilir. Mevcut yetkiyle zararsız/read-only bir çağrı yapılır. Hiç uygun araç yoksa uydurulmaz; bu alt senaryo `BLOCKED` veya `NOT RUN` kalır.
- Native patch'in Codex UI diff/file-change görünümü korunmuş olmalı.

**Kabul:** Her alt senaryo ayrı receipt/sonuçla raporlanır. “Native araçların hepsi çalışıyor” genellemesi yapılmaz; test edilen isimler yazılır.

### Adım 10 — SSE, uzun bekleme, retry ve iptali aynı lifecycle'a bağla

**Amaç:** İlk çalışan zincirin yavaşlık, bağlantı kaybı veya iptal altında bozulmaması. Durum: `IN PROGRESS` — offline yarışlar ve gerçek engine heartbeat geçti; normal araçsız native UI cancel ve owned browser close canlı geçti. Takılan compaction'da Stop yanıt vermedi; fiziksel close ile toparlandı. Native komut sırasında iptal OpenAI güvenlik engeli nedeniyle `BLOCKED`; OS crash `NOT RUN`.

Yapılacaklar:

- Stream açılışında engine'in beklediği başlangıç olayları hemen gönderilir. Stateful writer response/item/call kimliklerini, sequence ve tek terminal olayı tutar; terminal sonrası write yok.
- Uzun hazırlık, düşünme, tool ve approval beklemesinde parser'ın işlediği data heartbeat kullanılır. SSE yorumunun yeterli olduğu varsayılmaz.
- Gerçek kurulu engine ile ölçülen idle eşiğinden uzun sessizlik sınanır. Eşik fixture/config/build üzerinden doğrulanır; sabit 65 saniye her sürüm için kanıt kabul edilmez.
- Liveness ile ilerleme ayrılır. Heartbeat yalnız bağlantının canlılığıdır; stage/progress deadline'ı ve kullanıcı iptali sonsuz takılmayı engeller. Her uzun model düşünmesi de otomatik başarısız sayılmaz; bekleme türleri ayrı izlenir.
- Görünür Markdown ve commentary delta'ları doğru turn kapsamında aktarılır. Gizli düşünce içeriği toplanmaz. Aynı uzunlukta değişen metin tamamlanmış sayılmaz.
- Doğrulanmış final yoksa partial metin başarılı completed olmaz. Deadline, abort ve failed durumları asıl hata nedenini korur.
- Request/round kimliğine bağlı, sınırlı olay kaydıyla aynı HTTP round'un yeniden gözlenmesi sağlanır. Sonuç kabulü veya browser submission tekrar edilmez; önceki stream'in olayları kaybolmaz.
- “Send hiç başlamadı”, “send başladı ama kabul belirsiz”, “kabul edildi” ve “tamamlandı” ayrılır. Belirsiz yan etkide otomatik yeniden gönderim/yürütme yok.
- Normal tool-boundary HTTP kapanışı, beklenmedik observer disconnect ve açık kullanıcı turn cancel birbirinden ayrılır. Kabul edilmiş Web işinde yalnız observer disconnect varsa referans gibi aynı round yeniden bağlanabilir; açık cancel/close/shutdown ise ilgili owned iş iptal edilir. Bu ayrım belgelenir.
- İptal kullanıcıya hızlı döner; eski browser'ın fiziksel temizliği bitmeden yerine yeni lease verilmez. Cleanup başarısızlığı gizlenmez.
- Tunnel/MCP/browser/engine iptali aynı sahipliğe bağlanır. Native yürütücünün desteklemediği fiziksel durdurma sonucu tamamlanmış gibi gösterilmez.

**Doğrulama:** Fake-clock kontrollü queue/retry/final yarışları; gerçek engine heartbeat/idle kontrolü; mevcut UI'de uzun komut iptali ve kontrollü browser close. Gerçek hesabı logout etmek kullanıcı isteği olmadan test amacıyla yapılmaz; logout failure yolu fixture ile sınanır.

**Kabul:** Yinelenen yan etki yok; aynı round verisi kaybolmuyor; iptal hızlı; partial completed değil; terminalde pending/queue/waiter/token kalmıyor, lease yalnız fiziksel cleanup sonunda bırakılıyor.

### Adım 11 — Renderer rotası, yeniden açılış ve model geçişlerini doğrula

**Amaç:** Çalışan köprünün gerçek Codex++ thread lifecycle'ında seçilip korunması. Durum: `IN PROGRESS` — gerçek engine start/resume/fork, offline local/remote/null→ready, canlı restart/yeni port/aynı thread devamı doğrulandı; in-flight crash ve tam model-geçiş UI matrisi tamamlanmadı.

Yapılacaklar:

- İlk null gateway route kalıcı cache'lenmez. Runtime readiness/generation ve port değiştiğinde route ile model catalog yenilenir.
- `thread/start`, resume, fork ve uygulama yeniden açılışında Web tercihi doğru okunur. `params.model` eksik resume'da eski thread modelinin kaybolmadığı gerçek engine sözleşmesiyle doğrulanır.
- `121-provider-client` yalnız `cxp/` davranışı üzerinden Web'i çözmüş varsayılmaz; iki patch'in sırası ve birbirine etkisi ölçülür.
- Native → Web geçişi için engine transport'u sonradan değiştirebiliyor mu ölçülür. Tüm local thread'lerin task-scoped passthrough'dan geçmesi gerekiyorsa bunun kapsamı ve native regression etkisi uygulamadan önce sunulur.
- Mevcut engine güvenli aynı-thread geçişini desteklemiyorsa browser-only/başka model fallback yok; açık unsupported hata ve kalan başarı hedefi olarak raporlanır. Bu hedef sessizce “yeni thread aç” ile tamamlanmış sayılmaz.
- Native thread'lere gereksiz code_mode/code_mode_only/capability metadata dayatılmaz.
- Remote host'a local loopback gönderilmez. Desteklenmeyen remote Web seçimi açık hata verir; remote native çalışma etkilenmez.
- Restart yalnız test-owned/izin verilen zamanda yapılır. Eski in-flight işin token'ı diriltilmez; durumu belirsiz kabul edilmiş iş otomatik yeniden gönderilmez. Yeni port ve yeni güvenli kullanıcı mesajı ayrı doğrulanır.

**Kabul:** Null→ready, port değişimi, start/resume/fork/reopen, local/remote ve native/Web/cxp ayrımı ölçülür. Aynı-thread model geçişinin destek durumu açık yazılır.

### Adım 12 — Compaction'ı gerçek native sözleşmeye uyarla

**Amaç:** Uzun görevin doğru replacement history ve yeni epoch ile devam etmesi. Durum: `IN PROGRESS` — v1/v2 gerçek engine fixture `PASS-LOCAL`; canlı v2 `FAIL/deadline_exceeded`, yeni epoch yok. Tekrar journal'ı düzeltildi ve fiziksel close sonrası canonical full-context devamı canlı geçti; bu compaction başarısı değil. Aktif-tool handoff uygulanmadı ve açık unsupported hatası verir.

Yapılacaklar:

- Aynı kurulu engine'in desteklediği `/responses/compact` v1 ve normal responses içindeki compaction-trigger/v2 biçimi ölçülür. Desteklenmeyen sürüm browser açmadan reddedilir.
- Exact path eşleşmesi korunur; `/responses/compact` normal browser turn'üne düşmez.
- V1 canonical user metadata'sını ve engine'in gerçek summary prefix/retained-history bütçesini korur; keyfi “son iki mesaj” kaldırılır.
- V2 gerekiyorsa tam bir native compaction output item üretir; summary normal assistant cevabı gibi stream edilmez. Kendi transparent envelope'umuz native encrypted içerikle karıştırılmaz.
- Aktif turn compaction'ında önce ilgili callId'lerin mevcut tool sonuçları teslim edilir. Sıradaki normal iş/yazma araçları compaction sırasında yürütülmez.
- Checkpoint için ordinary tool authority'den ayrı, exact handoff'a bağlı tek kullanımlık kontrol kullanılır. Sonuç yalnız beklenen transaction/source/summary bağıyla kabul edilir.
- Yeni epoch üretilir; eski token/lease temizlenir. Retained chat yoksa kanıtlı canonical context ile yeni read-only compaction session açılır; kısmi history ile devam edilmez.
- Compaction retry aynı kabul edilmiş checkpoint'i tekrar kullanır; ikinci özet mesajı/normal iş doğurmaz. Cancel/deadline bounded cleanup yapar.
- Compaction sonrası developer kuralları, assistant kararı ve tool evidence özette/continuation'da korunur; kullanım estimated ise öyle gösterilir.

**Dosyalar:** `hub/web-contract.cjs`, `hub/gateway.cjs`, broker/session ve gerekli küçük compaction yardımcıları; referans `compaction-handoff`, `compaction-transaction`, `compaction-continuation` sözleşmeleri.

**Doğrulama:** V1/v2 replacement fixture'ları, epoch, opaque unsupported, zero ordinary-tool dispatch, aktif tool-result handoff, tekrar/iptal. Sonra yalnız geçici görevde engine'in desteklediği gerçek compaction yolu canlı denenir.

**Kabul:** Doğru format + yeni epoch + aynı görevin doğru devamı kanıtlanır. Çalıştırılamayan sürüm ayrı `NOT RUN/BLOCKED` kalır.

### Adım 13 — Görev izolasyonu ve advertised subagent yolunu doğrula

**Amaç:** İki görevin karışmaması; destek varsa parent/child'ın kilitlenmemesi. Durum: `PASS-OFFLINE` tek-lease kapasite/izolasyon; parent-child multiplexing uygulanmadı ve advertised değil. Canlı iki görev testi çalıştırılmadı; kullanıcı isteğiyle aynı görevden devam ediliyor.

Yapılacaklar:

- İki bağımsız görev için farklı workspace/fixture/token/conversation sahipliği ölçülür. Önce tek kapasitede ikincinin açık reddi sınanır; sessiz global kuyruk veya pencere devralma yok.
- Paralellik gerekiyorsa referansın görev bazlı lease/tab sözleşmesi mevcut Codex++ browser sahipliğine uyarlanır. Referansın beş-tab sayısı gerekçesiz kopyalanmaz; sınırlı kapasite açık tanımlanır.
- Native registry gerçekten subagent araçlarını sunuyorsa parent → child → child native tool → parent sonucu zinciri sınanır.
- Parent uzun wait'i ortak MCP kanalını bloke etmez; kısa bounded native poll çağrıları/bağımsız request işleme kullanılır. Child için kapasite yoksa parent arkasında sonsuz bekletme yerine açık kapasite hatası verilir.
- Child'ın parent'ın tuttuğu tek browser kuyruğunda kilitlenmesi çözülmeden “multi-agent destekli” etiketi verilmez.
- Close/navigation/cancel yalnız doğru owner'ı etkiler; diğer thread devam eder. Encrypted cross-backend/native protokol okunamıyorsa browser açılmadan hata.
- Fiziksel cleanup, instance sahipliği ve shutdown sonunda lease/socket/token sızıntısı kontrol edilir.

**Kabul:** İki görev izolasyonu kanıtlı. Advertised parent-child yolu ya gerçek kanıtla geçer ya da açık destek sınırı olarak kalır; mock sonucu canlı subagent başarısı sayılmaz.

### Adım 14 — Regresyon, CI, dokümantasyon ve son kabul

**Amaç:** Web'i düzeltirken Codex++'ın mevcut davranışlarını bozmamak ve gerçek teslim durumunu netleştirmek. Durum: `IN PROGRESS` — hedefli CI testleri ve mimari/kanıt/rollback belgeleri güncellendi; yerel koruma testleri geçti, Windows'ta macOS canlı kontrolleri çalıştırılmadı. Push/uzak CI yok.

Yapılacaklar:

- Mevcut test dosyaları gözden geçirilir. Eski connector adı, sabit app yolu, UI'yi atlayıp “E2E” deme, sadece final kelimesi veya mock success'i canlı başarı sayma gibi kabul hataları düzeltilir.
- Aynı sorunu ölçen gereksiz testler çoğaltılmaz. Üretim modüllerine bağlı az sayıda hedefli contract/lifecycle testi CI'ya eklenir.
- Hesap/ağ/Electron/shell gerektirmeyen unit/contract katmanı ayrı CI işi olur. Loopback/IPC, gerçek engine/sandbox ve canlı ChatGPT katmanları bağımlılıklarına göre ayrılır.
- Native account/switch/refresh, thread-account header/routing, auth restore, usage/quota/resetlerin değişmemesi, native pipe peers, `cxp/` provider ve CLI passthrough regresyonları çalıştırılır.
- Bundle patch'leri kurulu doğru build üzerinde isolation/dry-run ve syntax kontrolünden geçirilir. Installer idempotency ve kaynak/kurulum hash eşleşmesi doğrulanır.
- macOS signing koruma testleri POSIX/uygun CI ortamında çalıştırılır. Windows'taki skip macOS pass sayılmaz. Gerçek codesign/Computer Use canlı kabulü macOS gerektirir; yoksa `NOT RUN` yazılır.
- Son canlı kabul: gerçek picker → route → gateway → browser → yayınlanan connector/tunnel → native tool → aynı browser yanıtı. Aynı thread'de iki dosya değişikliği, tool receipt ve bağımsız dosya etkisi yeniden doğrulanır.
- ARCHITECTURE, harness/Web davranışı, runtime preflight hataları, unsupported sınırlar, connector refresh/migration ve rollback güncel hale getirilir.
- Geçici dosyalar yalnız exact manifest kapsamından, kullanıcıya haber verilerek temizlenir; kullanıcının başka dosyaları, connector'ları veya aktif oturumları silinmez.
- Son rapor: bulgu → dosya/fonksiyon → değişiklik → test tablosu; gerçek komut/exit code/süre; offline/local/live ayrımı; blocked/not run; değişen dosyalar; kurulu build; kalan sınırlamalar.

**Kabul:** Aşağıdaki kabul matrisi doldurulmuş; her yeşil durumun gerçek kanıtı var. Zorunlu madde BLOCKED/NOT RUN ise bütün proje “tamamlandı” sayılmaz. Push/merge/release yapılmaz.

## 5. Test katmanları ve komut politikası

| Katman | Ne kanıtlar? | Bağımlılık / sınırlama |
|---|---|---|
| Offline unit/contract | Kimlik, schema, parser, queue/retry/final durum makinesi, prompt/limit dönüşümleri | Gerçek hesap, ağ, Electron veya shell yok. Production modülleri import edilir. |
| Yerel IPC/browser fixture | Socket/pipe, MCP framing, process lifecycle, sentetik DOM/clock senaryoları | Yerel OS izinleri/loopback veya ayrı test runner gerekebilir. Canlı hesap kanıtı değil. |
| Gerçek engine contract | Kurulu parser, advertised wire, native tool lifecycle, heartbeat, sandbox/approval | Aynı engine binary/build ve geçici workspace. Browser mock ise `PASS-LOCAL`. |
| Canlı E2E | Picker dahil gerçek uçtan uca zincir ve dosya etkisi | Giriş yapılmış hesap, gerçek connector/tunnel, native izinler. Mock yok. |
| Platform doğrulaması | Windows installer/sandbox ve macOS özgün imza koruması | İlgili OS gerekir; diğer platformda skip pass değildir. |

Seçilen Web worktree'sinde aşağıdaki dosyalar var; komutlar o dizinde çalıştırılır. Ana checkout'ta bulunmayan test varmış gibi davranılmaz. Plan ilk hazırlanırken çalıştırılmadılar; Adım 1'de contract 18/18, lifecycle 14/14 ve provider-client 9/9 başlangıç kontrolü olarak çalıştırıldı. Diğerleri bu adımda çalıştırılmadı. Bu başlangıç sonuçları yeni direct-tool sözleşmesinin veya canlı Full zincirinin kabulü değildir.

```powershell
# Seçilen uygulama worktree'sinde, dosyalar mevcut ve bağımlılıkları hazır olduğunda.
node tools/test-chatgpt-web-contracts.mjs
node tools/test-chatgpt-web-lifecycle.mjs
node tools/test-auth-refresh.mjs
node tools/test-app-server-restore.mjs
node tools/test-thread-account.mjs
node tools/test-thread-account-header.mjs
node tools/test-routing.cjs
node --test tools/test-providers.cjs
node tools/test-provider-client.mjs
node tools/test-windows-integrity.mjs
```

`test-chatgpt-web-contracts` ve `test-chatgpt-web-lifecycle` şu an farklı bağımlılık seviyelerinde vakalar içeriyor; CI ayrımı Adım 14'te yapılır. Kalan usage/quota/home/peer/signing testleri değişiklik alanına göre mevcut suite'ten seçilir ve son raporda tek tek listelenir.

`test-chatgpt-web-engine.mjs` mevcut haliyle ChatGPT browser'ını değiştiriyor ve auth state okuyor: offline veya canlı E2E diye çalıştırılmaz. Önce Adım 2–3 wire ve safety koşullarına uyarlanır. `test-harness-e2e.mjs` adında E2E geçmesi gerçek picker kullanıldığının kanıtı değildir; mevcut giriş akışı ayrı app-server başlatıyor ve eski connector metni içeriyor. Adım 14 bunu doğru etiketlemeyi veya gerçek UI akışına uyarlamayı kapsar.

`audit-repros.cjs` bulunur/verilirse yalnız tanı aracı olarak değerlendirilir. `defectReproduced=true` başarısız davranışın sürdüğünü söyler, yeşil kabul değildir.

Her çalıştırmada: kesin cwd, komut, app/engine build, exit code, süre, pass/fail/skip sayıları ve artifact kaydedilir. Canlı testlerde buna thread/turn/call ilişkisinin hassas olmayan kanıtı ve fixture etkisi eklenir.

## 6. İlk mesajdaki asgari kabul maddelerinin kapsaması

| Kabul maddesi | Adımlar | Gerekli kanıt |
|---|---|---|
| Aynı thread'de ilk/ikinci user mesajı fresh token; eski token reddi | 4, 8, 9 | Contract + iki gerçek tool receipt + dosya değişimleri |
| Bir user turn'ünde en az üç doğru callId round'u, aynı browser | 4, 9 | Round/call/browser bağı ve tüm sonuçlar |
| Expired queued tool yürütülmez; end/cancel tüm waiter'ları bitirir | 4, 7, 10 | Dispatch sayısı ve terminal state testi |
| Stale/duplicate/unknown output ayrımı; retry çift yan etki üretmez | 4, 10 | Call state + aynı round replay + yan etki sayacı |
| Uzun exec session_id, write_stdin, exit/error korunur | 3, 9, 10 | Gerçek native session receipt ve sonuç |
| Görsel input/view_image, native patch, inventory'den MCP/app aracı | 3, 5, 6, 9 | Gerçek attachment/multimodal block + diff + advertised araç receipt |
| Developer talimatı, assistant kararı, tool evidence korunur | 5, 9, 12 | Canonical fixture + takip/compaction continuation |
| Pro/family/slider yoksa send öncesi hata; unknown slug reddi | 2, 6, 11 | Gönderim sayısı sıfır + açık hata |
| Native idle eşiğini aşan sessizlik; partial completed olmaz | 4, 10 | Aynı engine parser testi + final fence testi |
| Partial insert, DOM remount, navigation, browser close | 6, 10, 13 | Fixture yarışları + kontrollü UI senaryosu |
| İki thread/lease karışmaz; advertised parent-child deadlock yok | 13 | Ayrı fixture etkileri + gerçek parent/child receipt |
| Null route→ready, restart port, resume/fork, local/remote | 2, 11 | Renderer contract ve gerçek yeniden açılış |
| Tunnel geç hazır/spawn error/stale schema/wrong instance/EOF | 7 | Katmanlı readiness ve bounded failure |
| Stop sonrası restart yok; token/queue/socket/lease sızıntısı yok | 4, 7, 10, 13 | Timer/owner/terminal state ve process kontrolü |
| Compaction doğru format/epoch; ordinary tool yürütmez | 12 | V1/v2 fixture + zero tool dispatch + desteklenen canlı continuation |
| Native account, cxp/provider, stock/CLI ve macOS imzası korunur | 1, 11, 14 | Önce/sonra domain testleri, hash ve platform kanıtı |

## 7. Runtime preflight ve hata davranışı

Hata adları uygulama sırasında mevcut error tiplerine uyarlanacak; yeni bir genel error framework kurulmayacak. Kullanıcıya gösterilecek anlam ve davranış sabittir:

| Durum | Kullanıcıya açıklanacak durum | Otomatik davranış |
|---|---|---|
| Eksik thread/turn kimliği | Aktif Codex görevi güvenli biçimde bağlanamıyor | Browser/token üretmeden reddet |
| Native araç veya destekli protokol yok | Bu turn gerekli aracı sunmuyor / bu native biçim okunamıyor | Araç/model/mod fallback yok |
| Model/Pro/effort kanıtlanamıyor | İstenen model düzeyi hesapta doğrulanamadı | Prompt gönderme |
| Context/composer/attachment sınırı | Hangi sınırın, hangi ölçüyle aşıldığı | Kırpma yok; destekli compact/tercih gereksinimi |
| Prompt/attachment kabulü doğrulanamadı | İçerik tam eklenmedi veya upload tamamlanmadı | Güvenli draft rollback; duplicate insert/send yok |
| Gönderim veya dispatch sonucu belirsiz | İş başlamış olabilir; otomatik tekrar güvenli değil | Aynı işi yeniden çalıştırma; mevcut turn'ün kontrol yolunu göster |
| Connector stale/wrong instance | Connector şeması/instance mevcut runtime ile eşleşmiyor | Sadece Codex++ connector refresh yönlendirmesi |
| Tunnel/socket/key/executable izni eksik | Hangi readiness katmanının geçmediği | Yeni key yaratma, izin genişletme veya canlı socket silme yok |
| Approval bekleniyor/reddedildi | Native izin kararı bekleniyor veya reddedildi | Native semantiği koru; reddi aşma |
| Kapasite dolu/cleanup sürüyor | Başka görev veya eski owner henüz kapasiteyi bırakmadı | Başkasının lease'ini alma; bounded bekleme veya açık reddetme |
| Timeout/cancel/browser close | Doğrulanmış final yok; partial yalnız kısmi çıktı | Completed üretme; sahipliğe uygun cleanup |
| Unsupported compaction/remote | Bu engine/host yolu henüz desteklenmiyor | Normal Web cevabı veya local loopback ile taklit etme |

## 8. Connector migration ve rollback

Migration sırası:

1. Mevcut Codex++ connector kimliği, serverInfo, published tools/schema sürümü ve beklenen instance ölçülür. Referans connector ayrı tutulur.
2. Native tool argüman sözleşmesi değişiyorsa version/refresh gereksinimi belgelenir. Mevcut tunnel/key yeterliyse yeniden oluşturulmaz.
3. Yalnız Codex++ connector için refresh/reconnect yapılır; yeni yetki kapsamı gerekiyorsa kullanıcıya somut neden sunulur.
4. Cache'teki eski ping/tool şeması senaryosu sınanır. Güncel published tools/list + beklenen instance/nonce + gerçek zararsız tool roundtrip birlikte doğrulanır.
5. Eski oturumlar/token'lar canlandırılmaz. Normal geçmiş konuşma seçeneği connector migration bahanesiyle otomatik açılmaz.

Rollback sırası:

1. Yalnız bu testin yeni gönderimleri durdurulur; owned turn/child/lease bounded olarak drain veya cancel edilir. Diğer kullanıcı görevleri korunur.
2. Adım 1 manifest'indeki uygulama/hub dosyaları kendi yedeğinden geri yüklenir. Yeni eklenen dosyalar yalnız exact manifest kapsamındaysa kaldırılır; genel klasör temizleme yapılmaz.
3. Testin değiştirdiği hesap/config durumu gerekiyorsa ilgili yedekten geri alınır; eşzamanlı kullanıcı değişikliği fark edilirse üzerine yazmadan durulur. Global Web rotası hiç eklenmemiş olmalı.
4. Uyumsuz connector sürümü varsa yalnız bizim connector için uygun eski sürüm/refresh durumu gösterilir. Referans connector veya hesap anahtarları silinmez.
5. Önceki engine/app hash'leri ve native/cxp temel davranışı doğrulanır. Kullanıcıya hangi dosyaların geri alındığı, test fixture'larının kaldırılıp kaldırılmadığı ve yedeğin nerede kaldığı bildirilir.

## 9. Kullanıcıdan ne zaman yardım gerekecek?

Şu anda yalnız plan hazırlanıyor; yeniden giriş veya ayar değişikliği gerekmiyor. Uygulama sırasında yalnız gerçekten gözlenen bir engel için yardım istenecek:

- ChatGPT oturumu bitmişse kullanıcı giriş yapar; hesap şifresi veya cookie istenmez.
- Native approval/UAC gerekiyorsa tam olarak hangi test ve izin olduğu gösterilir. Daha önce sandbox kuruldu diye yeniden kurulum başlatılmaz.
- Connector refresh UI'si kullanıcı işlemi gerektiriyorsa yalnız doğru Codex++ connector ve adımı gösterilir.
- Temporary Chat bu hesapta connector ile çalışmıyorsa normal history kullanımına ilişkin açık tercih alınır; mevcut test izni kalıcı ürün tercihi sayılmaz.
- Kurulu app'i yeniden başlatmak gerekecekse çalışan işler korunarak uygun an bildirilir.
- Uygun advertised MCP/app aracı veya macOS ortamı yoksa karşılık gelen test somut olarak `BLOCKED/NOT RUN` bırakılır.

## 10. İlerleme kaydı ve son teslim

Her adım kapanırken tek kısa kayıt verilecek:

1. Adım numarası ve kabul durumu.
2. Gözlenen hata/eksik sözleşme ve referans kaynağı.
3. Değişen dosya/fonksiyonlar; değişiklik yoksa açıkça yok.
4. Gerçekte çalıştırılan komut veya UI akışı; offline/local/live etiketi.
5. Beklenen ve gerçek sonuç; receipt/artifact/dosya etkisi.
6. Engeller, rollback durumu ve sıradaki tek adım.

Plan ilk hazırlanırken 1–14 uygulama adımlarının hiçbiri başlatılmamıştı. Bu tarihsel başlangıç durumu artık güncel değildir. Gerçekleşen işler üstteki durum özeti ve Web worktree'sindeki yürütme kaydındadır; bundan sonraki sıra Bölüm 12'dir. Önceki başarıları yeniden yapıp adım sayısını büyütmek yerine açık kabul maddeleri kapatılacaktır.

## 11. Referans kaynak dizini

Tüm referans bağlantıları incelenen sabit commit'e gider; launcher veya README tek başına doğruluk kaynağı değildir.

- [Native araç/MCP sözleşmesi](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/mcp-server.ts)
- [Environment ve gerçek tool yüzeyi](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/environment.ts)
- [Prompt normalizasyonu](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/prompt.ts)
- [Browser, model seçimi, insert, submission ve final](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/browser-worker.ts)
- [Turn execution ve replay](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/turn-execution.ts)
- [Broker, IPC ve tamamlanma sınırı](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/turn-broker.ts)
- [Responses parser](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/responses/parser.ts)
- [HTTP/SSE bridge](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/bridge.ts)
- [Model limitleri](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/chatgpt-web-models.ts)
- [Compaction handoff](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/compaction-handoff.ts)
- [Compaction native formatı](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/responses/compaction.ts)
- [Launcher browser sahipliği](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/launcher/electron/browser-host.cjs)
- [Tunnel lifecycle](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/tunnel.ts)
- [Harness contract testleri](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/tests/chatgpt-web-harness.test.ts)
- [Browser contract testleri](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/tests/browser-worker-contract.test.ts)
- [MIT lisansı ve copyright](https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/LICENSE)

## 12. Açık kalan senaryolar: referansa dayalı devam sırası

İnceleme tarihi: 11 Eylül 2026. Kapsam: kullanıcının isteğiyle yalnız kaynak/test okuma ve planlama. Bu incelemede ürün kodu, kurulu uygulama, hesap, connector ve izinler değiştirilmedi; canlı mesaj gönderilmedi, test çalıştırılmadı. Referanstaki testlerin gövdeleri okundu; var olmaları veya anlamlı assertion içermeleri, bu makinede ya da gerçek hesapta geçtikleri anlamına gelmez.

### 12.1. Sabit kaynaklar ve ölçüm

- Ana checkout yeniden ölçüldü: `main`, `f218a17a95281aeebc343893374b8ebbd90d32de`, kullanıcı değişiklikleri mevcut.
- Ürün worktree'si yeniden ölçüldü: `fix/chatgpt-web-full-harness-20260910`, `a80bb648f0cb9e27baaec09848d95c2d2005fb23` tabanı. Aşağıdaki hedef satırları commit edilmemiş mevcut dosyalara aittir; aynı SHA'nın temiz haline aitmiş gibi yorumlanmamalıdır.
- Yerel referans yeniden ölçüldü: temiz, detached `e85e3693fdb4e3e033348c08df0298c20fcdb612`, paket `5.0.6`. Uzak HEAD yeniden sorgulanmadı; “en güncel upstream” iddiası yok.
- Başlangıçta `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `rg --files -g AGENTS.md` kullanıldı. Devamında ilgili üretim dosyaları ve test gövdeleri `rg -n` ve `Get-Content ... | Select-Object -Skip ... -First ...` ile okundu. Son kontrol `git diff --check` ve plan bağlantı/çapa kontrolüdür; uygulama testi değildir.

Tekrar okunabilir başlıca kanıt komutları:

```powershell
# Yerel referans dizininde; hesap/browser gerektirmez.
rg -n 'requestRetainedCompactionHandoff|settleActiveCompactionSource|runStructuredCompactionOnce' src/adapters/chatgpt-web/compaction-handoff.ts
rg -n 'ChatGptCompletionTracker|ChatGptTurnDomHealthTracker|reconcileAssistantTurnBinding|attachFiles' src/adapters/chatgpt-web/browser-worker.ts
rg -n 'one-shot|ordinary assistant text|physical|deadline' tests/retained-compaction.test.ts
rg -n 'MAX_BROKER_LINE_CHARS|callTurnBroker' src/adapters/chatgpt-web/turn-broker.ts
```

```powershell
# Ürün worktree'sinde; ana checkout'ta Web dosyaları varmış gibi çalıştırma.
rg -n 'executeCompaction|runTurn|active_compaction_unsupported' hub/gateway.cjs
rg -n 'identity: request|cancelThread|readAnswer|readVisibleAnswer|attachmentFile' hub/web-session.cjs
rg -n 'MAX_FRAME_BYTES|CALL_TIMEOUT_MS' hub/mcp-server.cjs hub/broker-socket.cjs
```

### 12.2. Kaynak → bulgu → bizim karşılık

| ID / açık konu | Referansta gerçekten ne var? | Mevcut Codex++ farkı ve karar |
|---|---|---|
| R1 — Full compaction | [Handoff kaynağı][r-handoff], `requestRetainedCompactionHandoff` (277–378): aynı retained conversation'a tek checkpoint isteği; ayrı control token + handoff id; normal native araç ortamı yok. `codex_tool_call` içindeki ayrılmış control işlemi özeti teslim ediyor. Bu teslim terminal kanıtı; ardından owned browser'ın fiziksel kapanışı bekleniyor. [Testler][r-retained-tests] 148–192 ve 291–427: yanlış id, tekrar tüketim, normal tool claim reddi, sıradan metnin checkpoint sayılmaması, cleanup timeout. | `gateway.cjs:163–219` her defasında `key:null`, `harness:false` ile fresh özetleme açıyor. Son canlı FAIL bu farklı yolda oluştu. Referansın retained kontrol teslimi uygulanmamış. İlk tercih bu dar sözleşmeyi uyarlamak; tüm launcher'ı taşımamak. Checkpoint kabulü tek başına yetmez, fiziksel settlement da şart. |
| R2 — Compaction iptal kimliği | [Compaction owner][r-handoff] 384–489 native thread/turn kimliğini ve fiziksel settlement'ı ayrı tutuyor; önceden gelmiş interrupt'ı da kaydediyor. [Retained testler][r-retained-tests] 450–606 interrupt öncesi kayıt ve completed replay durumlarını kapsıyor. | `executeCompaction` kimliği parse ediyor ama iki `webSession.runTurn` çağrısına `request` vermiyor. `web-session.cjs:826` bu nedenle `lease.identity=null` yapıyor; `:920` `cancelThread` eşleşemiyor. Kaynakta doğrulanmış eksik bağlantı; canlı UI iptaline toplam etkisi bu turda sınanmadı. Önce küçük production-module regresyonu. HTTP kopmasıyla iptal çalışması bu eksik yolu kapatmış sayılmaz. |
| R3 — Uzun düşünme / final tespiti | [Browser worker][r-browser] 1373–1556 ve 4770–5007: görünür yanıt + Stop yok + Copy + kararlı text/HTML + tool fence; yeni tool batch öncesi metin baseline'ı; son araçtan sonra yeni final yoksa açık hata. Ayrı DOM health, scoped upstream/session hata ve bounded observation recovery var. [Browser testler][r-browser-tests] 3364–3396, 3776–3902 bu ayrımları ölçüyor. | `web-session.cjs:642–704` daha basit snapshot/prefix delta + 4 saniye stability kullanıyor; aynı kapsamda health/rebind/post-tool baseline yok. Ancak referansın “Copy gelmedi” health hatası da `running=false` ister: canlıda `Stop=true` kalan vakayı tek başına çözmez. Timeout'u artırmak veya partial'i final saymak yok; önce görünür durumları ayır. |
| R4 — DOM remount ve yarım insert | [Browser worker][r-browser] 2860–2891: eski assistant kaybolursa baseline dışındaki tek yeni kimliğe bağlanır; yeni user turn veya birden çok aday varsa reddeder. 3235–3298 prompt/pill eklemesini sahipli işlem olarak temizler. [Browser testler][r-browser-tests] 34–126 ve 2023–2054: virtualization, değişen id, competing id, iptalde cleanup. | Mevcut kod stabil kimliği ve ilk URL promotion'ını destekliyor; farklı assistant id'ye güvenli rebind yok. Kısmi insert duplicate gönderilmiyor ama taslak rollback yok. Kullanıcının önceden yazdığı taslağı silmeden, yalnız bize ait değişikliği geri alma koşulu gerekli. |
| R5 — Kullanıcı görseli ve büyük sonuç | [Browser worker][r-browser] 1988–2008 ve 3676–3705: gerçek image bytes, MIME/base64 kontrolü, 10 adet, 20 MB/adet ve 50 MB/toplam kaynak limitleri; exact filename tile + Send enabled. [Attachment testi][r-browser-tests] 2092–2155 bu sırayı fixture ile doğruluyor. [Broker][r-broker] 142 ve 831–874: 67,108,864 **karakter** sınırı; rich result taşıması [MCP][r-mcp] 215–225. | Küçük `view_image` canlı geçti; native composer'dan kullanıcı görseli NOT RUN. `attachmentFile` 20 **MiB** kontrolü yapıyor, aynı aggregate/MIME/base64 sıkılığı yok. MCP/broker sınırı 1 MiB; büyük görselde referanstan çok daha düşük. Sınırı körlemesine 64M yapma: wire/base64 toplamını, gateway sınırını ve bellek maliyetini beraber ölç; aşım açık hata, sessiz kırpma yok. |
| R6 — Uzun komut sırasında iptal / approval | [Turn session][r-turn] 745–775 tam thread/turn'ü hızlı iptal eder, fiziksel settlement'ı ayrı tutar. [Browser worker][r-browser] 784–823 yalnız tam eşleşen connector onayını yönetir; auto-approval açıkken yalnız `Allow`/`Allow once`, kalıcı Always allow değil. [Onay testleri][r-browser-tests] 2804–2837 bekleme/ret/tek sefer ayrımını içerir. | Önceki exec→session→stdin canlı PASS; **exec çalışırken cancel** denemesinde inventory engellendi ve exec hiç başlamadı. Bu bir sandbox arızası kanıtı değil. Referansın onay akışı provider'ın safety reddini çözmüş sayılmaz; reddi aşacak alternatif yol yok. Yeni test, gerçek native exec receipt'i görülürse başlar; tekrar ret gelirse BLOCKED. |
| R7 — Çökme, lease ve tekrar | [Launcher browser host][r-host] 824–850 renderer/load hatalarını, 1339–1395 lease heartbeat/bootstrap expiry'yi, 2206–2286 helper ownership'i ele alıyor. [Host testleri][r-host-tests] 1977–2070 cancellation acknowledgement olmadan DOM'u kaldırmamayı kapsıyor. [Turn session][r-turn] 497–501 ve [compaction cache][r-handoff] 393–489 bellekte Map kullanıyor. | `web-session` yalnız pencere `closed` olayını yakalıyor; renderer crash için ayrı yol yok. `web-http-rounds` journal'ı da bellekte. Referansta okunan turn/replay yollarında process restart boyunca durable exactly-once çözümü bulunmadı. Açık close PASS, OS crash değildir. Ölçmeden otomatik restore/resubmit eklenmez; yan etki belirsizse kullanıcıya açık durum. |
| R8 — Model, hesap, native→Web / remote | [Account probe][r-account] 179–249 canlı selector/slider readiness ve ARIA aralığını ölçüyor. [Model resolver][r-model] 25–76 bilinmeyen model/effort ve erişilemeyen Pro'yu reddediyor; [browser seçimi][r-browser] 2318–2460 yeniden doğruluyor. [Model testleri][r-model-tests] 4–83 bu sözleşmeyi sınar. | Referans ayrı launcher/bridge; Codex++ renderer patch 120, thread-account ve cxp davranışının hazır çözümü değil. Bizde exact family/slider testleri mevcut; bütün UI varyantları canlı değil. Hesabın model kapasitesini bilmek, retained chat'in doğru hesapta olduğunu kanıtlamaz. Startup catalog + generation-aware route + Web lease ayrı ölçülür; global config değişmez. |
| R9 — Parent/child | [Concurrency][r-concurrency] kapasite 5; [MCP][r-mcp] 29–47, 165–202, 369–404 native wait_agent için 30 saniye poll zorunluluğu uygular; direct ve exec içi çağrıyı ayırır. [Harness testleri][r-harness-tests] 2905–2961 uzun beklemeyi dispatch öncesi reddeder. [Canlı smoke kodu][r-subagent-smoke] 176–218 parent/child rollout, model, targeted wait ve terminal sonucu arar. Scriptin bu incelemede çalıştırıldığı iddia edilmez. | Tek lease ve catalog `multi_agent_version:disabled` mevcut. Sadece beş pencere açmak çözüm değil: child için kapasite, ortak MCP kanalının serbestliği ve exact owner şart. Önce tek kapasitede açık ret; destek eklenirse iki lease ile küçük parent/child kabulü. Advertised olmayan araç adı tahmin edilmez. |
| R10 — Aktif araç sırasında compaction | [Handoff][r-handoff] 162–216 önce mevcut callId'lerin canonical sonuçlarını aynen teslim eder, yalnız daha sonra istenen işi durdurur; normal final yarışını koruyarak ayrı retained checkpoint mesajına geçer. [Testler][r-retained-tests] 608–752 sonuç/final/intercept/deadline ayrımını yapar. | Şu an `active_compaction_unsupported`. R1'in **idle retained** desteği ile aynı iş değil. Son aşamaya ayrılacak; normal araç çalıştırarak compaction taklidi yapılmayacak. |
| R11 — Temporary / normal ve gizlilik | [Browser worker][r-browser] 2478–2511 Temporary surface'i kanıtlar; 579–639 gerektiğinde Personalized seçimini değiştiren akış da içerir. Bu hesap davranışı evrensel garanti değil. | Kullanıcı normal chat testine izin verdi; mevcut transient env tercihi yeterli başlangıç. Referansın personalization değişikliğini otomatik kopyalamayacağız. Kalıcı ürün tercihi istenirse explicit normal/temporary seçimi; sessiz history fallback veya yeni izin yok. |

Ek uyarlama sınırı: referans [prompt.ts][r-prompt] 175–210 en eski fazla görselleri açıklama notuna dönüştürüyor ve tüm 1×1 PNG'leri historical sentinel sayıyor. Bizim “kayıpsız / sessiz kırpma yok” koşulumuz için bu davranış aynen kopyalanmayacak. Gerçek kullanıcı 1×1 görseliyle engine placeholder'ı ayrıştırılamıyorsa kanıtlanmamış görseli yok saymak yerine açık sınırlama gerekir. Compaction replacement-history'nin kendi bütçesi normal user input'tan ayrı kalır.

### 12.3. Uygulama sırası ve adımın bitiş ölçütü

Bu sıra mevcut 14 adımın **açık kısımlarını** daraltır; yeni launcher veya yeni test framework'ü planlamaz. Her adımda önce referans/ölçüm, yalnız gerekli küçük test, düzeltme ve aynı canlı görevde doğrulama yapılır. UI'de üretilemeyen yarış ve yanlış kimlik durumları mevcut test dosyalarına eklenir. İlk kaynak incelemesinde bunlar çalıştırılmamıştı; sonraki K1/K2 uygulama ve canlı kabulü üstteki güncellemede ve execution log'da ayrıdır.

1. **K1 — Compaction sahipliği ve mevcut takılmanın gözlemi** (eski 10/12; R2–R3). Önce kimliksiz compaction lease'ine native interrupt'ın ulaşmadığını üretim modülüyle göster; ardından exact thread/turn bağını düzelt. Reader'a yalnız ölçüm için gereken scoped `response present / Stop / Copy / upstream error / last progress` bilgilerini ekle; prompt veya gizli düşünce kaydı yok. İptal kullanıcıya hızlı dönmeli, fiziksel cleanup bitene kadar yeni lease kabul edilmemeli. **Bitiş:** compaction iptal receipt'i + bounded cleanup veya açık drain hatası; partial hiç completed değil. `Stop=true` takılmasının nedeni doğrulanmadan “çözüldü” yok.

2. **K2 — Önce idle retained Full compaction** (eski 12; R1). Mevcut doğru sohbeti yeniden kullan, sadece özet teslimine yetkili tek kullanımlık control token/handoff ekle; normal native registry yetkisi verme. Mevcut `codex_tool_call` envelope'una uyarlamak mümkünse yeni MCP action ekleme. Token türü ayrımı, yanlış handoff, ikinci submit, normal tool claim, iptal/timeout ve aynı HTTP retry için küçük testler. Eski sohbet yoksa canonical full-context fresh compaction ayrı, açık ve doğrulanmış yol; model/mod değiştirme yok. **Bitiş:** canlı checkpoint receipt'i + fiziksel settlement + kurulu engine'in kabul ettiği v2 compaction item/yeni epoch + aynı görevin takip mesajında bağlam/fixture doğruluğu; normal tool dispatch sıfır. V1'in yerel sözleşme başarısı canlı v1 PASS sayılmaz. `Stop` cleanup başarısızsa K2 de tamamlanmaz.

3. **K3 — DOM ve gönderim toparlanması** (eski 6/10; R3–R4). Tek proven replacement identity için rebind; competing user/assistant varsa açık hata. Yalnız owned draft/pill/attachment değişikliklerini temizle; kullanıcının önceden var olan draft'ını koru. Native tool sonrası önceki commentary'nin final sayılmamasını ölç. **Bitiş:** partial insert'te send=0, kabul edilmiş submission'da resend=0; remount/virtualization fixture'ı doğru kimliğe bağlı; canlı history kaydırma/normal devam bozulmuyor. Gerçek ID değiştiren remount gözlenmezse live bölümü NOT RUN kalır.

4. **K4 — Görsel ve uzun komut kabulünü kapat** (eski 3/5/9/10; R5–R6). Aynı Codex++ görevinin gerçek composer'ından kontrollü görsel ekle; exact attachment kabulünü ve modelin görsele özgü bilgisini ölç. Küçük/limit aşımı/MIME/base64/aggregate için mevcut testleri genişlet; büyük rich result wire boyutunu ölçmeden sınır büyütme. Uzun exec için önce gerçek `session_id`, sonra `write_stdin`, kontrollü nonzero exit/hata ve ayrıca çalışırken native cancel. **Bitiş:** image transport + native receipts + exit/error korunması; cancellation sonrası eski session'ın durumu ayrıca doğrulanmış. Safety reddi testin önünde kalırsa ilgili satır BLOCKED, başka araçla dolanma yok.

5. **K5 — Crash/restart ve tek-lease izolasyonu** (eski 7/10/13; R7). Önce owned renderer-gone ve pending waiter kapanışını fixture ile ölç; sonra kullanıcıya haber vererek yalnız testin browser renderer'ında kontrollü crash. Bütün uygulama restartı, başka aktif iş yokken ve sahiplik kanıtlanınca yapılır. **Bitiş:** terminal hata, token/waiter/lease temizliği, otomatik çift gönderim yok, restart sonrası değişen porta route + canonical bağlamla aynı göreve dönüş. Process restart için receipt belirsizliği ayrı kalır; referansta yok diye büyük durable journal framework'ü eklenmez. Birden fazla native göreve geçmeden önce kapasite 1'in açık reddi fixture ile kanıtlanır.

6. **K6 — Model/hesap/geçiş ve connector matrisi** (eski 7/11/14; R8/R11). Gerçekte sunulan family/effort'u picker → gateway → browser zincirinde eşleştir. Aynı görevde native→Web ve Web→native; resume/reopen; kontrollü fork yalnız gerekli olduğunda ve ayrı olduğu belirtilerek. Remote host yoksa gerçek remote NOT RUN, loopback yasağı contract ile. Account değişikliği gerekiyorsa protected backup + kullanıcı login; mevcut account routing yeniden yazılmaz. Connector yalnız published schema/instance gerçekten eskiyse refresh edilir. **Bitiş:** model/effort kanıtlanamıyorsa send=0; değişen account/lease/epoch retained reuse yapmaz; native/cxp koruma testleri geçer. Normal history izni kalıcı personalization izni sayılmaz.

7. **K7 — Koşullu ileri yollar ve son teslim** (eski 12/13/14; R9–R10). Idle compaction ve tek görev yaşam döngüsü geçtikten sonra aktif-tool handoff ayrı uygulanır. Native registry destekliyorsa iki task-bound lease + bounded wait ile parent→child→native tool→parent zinciri ölçülür; kapasite değeri referanstan aynen alınmaz. Bu altyapı yapılmadıkça advertised subagent desteği açılmaz. **Bitiş:** canonical sonuçlar kayıpsız, compaction sırasında yeni ordinary tool yok, parent/child aynı kanalda deadlock yapmıyor; başarısız/uygulanmayan yollar açık unsupported. macOS imza/Computer Use canlı kabulü macOS'ta ayrıca yapılır; Windows'taki static test veya skip yerine geçmez. Son teslimde geçen/FAIL/BLOCKED/NOT RUN ayrımı korunur; bütün maddeler kapanmadan “hepsi tamam” denmez.

### 12.4. Ne taşınmayacak, hangi izin gerekebilir?

- Referansın tüm launcher'ı, beş-tab sayısı, varsayılan sınırsız normal-turn süresi, personalization değişikliği ve hatadan sonra otomatik yeniden submission politikası kopyalanmayacak. Referans failed compaction run'ını physical cleanup ardından cache'ten çıkarır; Codex++'ın kabul edilmiş/yan etkisi belirsiz isteği tekrar etmeme koşulu korunur.
- R1 control semantiği mevcut MCP tool schema'sıyla taşınabiliyorsa sırf bu iş için connector silme/yeniden yaratma gerekmez. Published schema değişirse yalnız **Codex++ Native v2** refresh + doğru instance/schema/nonce kontrolü; **Codex Native2** olduğu gibi kalır. Yeni anahtar veya geniş kalıcı yetki varsayılmaz.
- Bu kaynak incelemesi için kullanıcıdan giriş/ayar gerekmiyor. Sonraki canlı adımda yalnız gözlenen login, tek-sefer tool approval, kontrollü restart veya platform engeli için yardım istenir.
- Geri dönüş, Bölüm 8'deki exact dosya manifesti/yedeğiyle yapılır. Ortak config/auth, stock app ve özgün imzalı native bileşenlere dokunulmaz. Bu turda geri alınacak ürün değişikliği yok; yalnız bu plan güncellendi.

[r-handoff]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/compaction-handoff.ts
[r-retained-tests]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/tests/retained-compaction.test.ts
[r-browser]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/browser-worker.ts
[r-browser-tests]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/tests/browser-worker-contract.test.ts
[r-broker]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/turn-broker.ts
[r-mcp]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/mcp-server.ts
[r-turn]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/turn-execution.ts
[r-host]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/launcher/electron/browser-host.cjs
[r-host-tests]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/launcher/tests/browser-host.test.cjs
[r-account]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/chatgpt-session.ts
[r-model]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/model.ts
[r-model-tests]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/tests/model-contract.test.ts
[r-concurrency]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/concurrency.ts
[r-harness-tests]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/tests/chatgpt-web-harness.test.ts
[r-subagent-smoke]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/scripts/smoke-codex-web-subagents.ts
[r-prompt]: https://github.com/miuuyy/codex-chatgpt-web/blob/e85e3693fdb4e3e033348c08df0298c20fcdb612/src/adapters/chatgpt-web/prompt.ts
