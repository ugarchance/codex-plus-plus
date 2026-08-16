# Renderer Çapa Keşfi ve Belgelenmesi (WP1 Adım B)

Bu belge, Codex++ otomatik yönlendirme ve hesap failover altyapısı (WP1) için minified renderer bundle'ı üzerindeki kilit genişleme ve müdahale noktalarının (çapaların) anlamsal analizini, AST konumlarını, ham eşleşme ölçümlerini ve 2. tur UI/patch geliştirme planını içerir.

---

## 1. Keşif Metodolojisi ve Güvenlik Sınırları

[AGENTS.md](file:///Users/ahmet/gpt-binary-patch-wt-wp1-routing/AGENTS.md) kurallarına tam uyum sağlanmıştır:
1. **Orijinal Uygulamaya Dokunulmadı:** `/Applications/ChatGPT.app` salt okunur olarak muhafaza edilmiştir.
2. **Geçici Çalışma Alanı:** Paketleme ve ayrıştırma araçları (`acorn`, `acorn-walk`, `prettier`, `@electron/asar`), `patch/` dizini kirlenmeden `/tmp/codexpp-anchor-discovery` altında izole olarak kurulmuştur.
3. **Bundle Kaynağı:** `/Applications/ChatGPT.app/Contents/Resources/app.asar` içindeki `webview/assets/app-initial-BqZ9AFkF.js` (13.96 MB, tek satır) geçici dizine çıkarılmış ve AST ayrıştırması 12 saniyede tamamlanmıştır.
4. **Anlam Odaklı Çapalar:** Minified değişken veya fonksiyon adları (`X0s`, `Z0s`, `Q0s`, `Rsn`, `Afs`) asla arama girdisi yapılmamış; React i18n id'leri, protokol sabitleri, hata metinleri ve prop imza desenleri kullanılmıştır.

---

## 2. Yüzey I: Engine → View Mesaj Dağıtım Noktası

### Rol ve Amaç
Motor (`codex app-server`) süreçler arası JSON-RPC ile renderer'a yanıt (`result`), hata (`error`) ve bildirim (`notification`) iletir. `thread/start`, `thread/fork`, `thread/resume`, `thread/unarchive` çağrılarının yanıtlarının yakalanması; yeni oluşturulan veya devam ettirilen thread ID'sinin anlık aktif hesap ile eşleştirilmesini (`routing.json` içindeki `learnThreadOwner`) sağlar.

### Çapa Adayları ve Anlamsal Gerekçeleri

#### Çapa 1A (Önerilen - Temel RPC Yanıt Dağıtıcısı: `RequestClient.onResult`)
* **Anlam Gerekçesi:** RPC istek havuzunu yöneten `RequestClient` sınıfı; `mcp_request_enqueued` log sabiti ve `onResult` / `onError` metodları ile tüm sunucu yanıtlarını merkezi olarak çözümler (`resolve`/`reject`).
* **Anchor Deseni:**
  ```javascript
  Kp.debug(`Request completed`,{safe:{id:e,method:r.method
  ```
* **AST Aralığı:** `[2443803, 2455808]` (RequestClient sınıfı bütünü); `onResult`: `[2444983, 2446100]`
* **Ham Eşleşme Sayısı (`grep -c`):** `1`
* **Biçimlendirilmiş Parçacık Yolu:** `/tmp/codexpp-anchor-discovery/AppServerRequestClient.js`
* **Önerilen Enjeksiyon Noktası:** `onResult(e, t, n)` metodunda `r.resolve(t)` öncesi: `r.method` (`thread/start`, `thread/fork`, `thread/resume`, `thread/unarchive`) kontrol edilerek `t.thread?.id` varsa `globalThis.__codexpp?.learnThreadOwner(t.thread.id, activeAccountId)` çağrısı eklenir.

#### Çapa 1B (Alternatif - Server → Client Request Dağıtıcısı: Patch 010 Komşuluğu)
* **Anlam Gerekçesi:** Patch 010'un (`010-external-auth-refresh.mjs`) kullandığı `onRequest` hook'u.
* **Anchor Deseni:**
  ```javascript
  case`currentTime/read`:this.dispatchMessageFromView(`mcp-response`,{hostId:this.hostId,response:{id:
  ```
* **AST Aralığı:** `[3214623, 3218507]`
* **Ham Eşleşme Sayısı (`grep -c`):** `1` (tekil switch-case bloğu olarak)
* **Biçimlendirilmiş Parçacık Yolu:** `/tmp/codexpp-anchor-discovery/method-onRequest.js`

### Risk Notları
* `onResult` seviyesinde enjeksiyon en güvenli yoldur çünkü tüm taşıma katmanlarının (IPC, Worker, WebSocket) üzerindedir ve `r.method` doğrudan enum değerini korur.

---

## 3. Yüzey II: Turn Hata Yüzeyi (Rate Limit / Quota / Plan Upgrade Banner'ları)

### Rol ve Amaç
Model veya hesap kotası dolduğunda, rate limit aşıldığında veya plan yetersizliği nedeniyle turn reddedildiğinde renderer'ın çizdiği uyarı banner'ları yakalanarak kullanıcının anında otomatik rota veya failover hesaba geçirilmesi sağlanır.

### Hata Sabiti Keşif Taraması
Bundle üzerinde yapılan anahtar kelime taramasında tespit edilen sabitler:
* `codex.modelLimitBanner.headline.noReset`: `"You've hit your usage limit for {modelName}. Try again later, or start a new conversation with another model."`
* `codex.modelLimitBanner.headline.withReset`: `"You've hit your usage limit for {modelName}. Try again after {resetDate}, or start a new conversation with another model."`
* `codex.upsellBanner.plus.headline.noReset`: `"To continue using Codex, add credits or upgrade to Pro today."`
* `codex.upsellBanner.freeOrGo.headline`: `"Your rate limit resets on {resetDate}. To continue using Codex, upgrade to Plus today."`
* `codex.upsellBanner.workspaceUsage.ownerLimitReached.headline`: `"You've reached your usage limit. Increase your limits to continue using Codex"`

### Çapa Adayları ve Anlamsal Gerekçeleri

#### Çapa 2A (Model Spesifik Kullanım Limiti Banner'ı: `Q0s`)
* **Anlam Gerekçesi:** Seçilen model için kullanım limiti aşıldığında render edilen React bileşeni. i18n React key'leri ve string tanımları benzersizdir.
* **Anchor Deseni:**
  ```javascript
  id:`codex.modelLimitBanner.headline.noReset`
  ```
* **AST Aralığı:** `[10453689, 10455506]` (1,817 bayt)
* **Ham Eşleşme Sayısı (`grep -c`):** `1`
* **Biçimlendirilmiş Parçacık Yolu:** `/tmp/codexpp-anchor-discovery/component-error-10454637.js`
* **Önerilen Enjeksiyon Noktası:** Banner JSX render çıktısına alternatif olarak "Başka bir uygun hesaba yönlendir" aksiyon butonu eklenmesi.

#### Çapa 2B (Hesap/Workspace Rate Limit ve Upsell Banner'ı: `Z0s`)
* **Anlam Gerekçesi:** Hesabın genel rate limiti, kredi bitişi veya plan kısıtlamalarında (Free, Go, Plus, Pro, Enterprise CBP) gösterilen banner bileşeni.
* **Anchor Deseni:**
  ```javascript
  id:`codex.upsellBanner.plus.headline.noReset`
  ```
* **AST Aralığı:** `[10426435, 10453689]` (27,254 bayt)
* **Ham Eşleşme Sayısı (`grep -c`):** `1`
* **Biçimlendirilmiş Parçacık Yolu:** `/tmp/codexpp-anchor-discovery/component-error-10443234.js`
* **Önerilen Enjeksiyon Noktası:** Rate limit tetiklendiğinde `globalThis.__codexpp?.markIneligible(currentAccountId, 'rate_limited')` hook'unun çağrılması.

### Risk Notları
* React Compiler memo slotları (`t[N]`) nedeniyle JSX dönüşünden önce hook veya state eklerken React dispatcher kurallarına dikkat edilmelidir.

---

## 4. Yüzey III: Yeni Sohbet Oluşturma Çağrı Noktası (Thread/Start UI Yolu)

### Rol ve Amaç
Kullanıcı yeni bir konuşma başlattığında (`thread/start`), isteğin gönderilmesinden hemen önce otomatik yönlendirme politikasının devreye girip en uygun hesabı (`chooseAccount`) seçmesi ve aktif hesabı gerekiyorsa sessizce/hızla değiştirmesi gerekir.

### Çapa Adayları ve Anlamsal Gerekçeleri

#### Çapa 3A (Önerilen - UI Yeni Sohbet Aksiyon Yolu: `CKc`)
* **Anlam Gerekçesi:** Kullanıcı komut paletinden veya yeni sohbet butonundan proje içi/projesiz sohbet başlattığında çağrılan fonksiyon. `new_thread` telemetri sabiti ile eşleşir.
* **Anchor Deseni:**
  ```javascript
  Lh(e,Xg,{item:`new_thread`});
  ```
* **AST Aralığı:** `[12112423, 12113059]` (636 bayt)
* **Ham Eşleşme Sayısı (`grep -c`):** `1`
* **Biçimlendirilmiş Parçacık Yolu:** `/tmp/codexpp-anchor-discovery/function-CKc-newchat.js`
* **Önerilen Enjeksiyon Noktası:** `CKc` fonksiyonu başında `autoRoute` aktifse `globalThis.__cxpAutoRoute?.()` çağrısı yapılarak en yüksek urgency puanına sahip hesap aktif edilir.

#### Çapa 3B (Alternatif - Komut Paleti Başlatıcısı)
* **Anlam Gerekçesi:** `CmdOrCtrl+N` / `CmdOrCtrl+Shift+O` kısayollarının ve menü girişlerinin bağlandığı komut tanımı.
* **Anchor Deseni:**
  ```javascript
  id:`codex.command.newThread`
  ```
* **AST Aralığı:** `[3981577, 3982000]`
* **Ham Eşleşme Sayısı (`grep -c`):** `1`
* **Biçimlendirilmiş Parçacık Yolu:** `/tmp/codexpp-anchor-discovery/startConv-ref-1.js`

### Risk Notları
* Yeni sohbet oluşturma akışında enjeksiyon için `CKc` fonksiyonu hem UI butonlarından hem kısayollardan tetiklenen yeni konuşmaların ortak boğaz noktasıdır.

---

## 5. Ham Doğrulama Kanıtları (`grep -c` Çıktıları)

Aşağıdaki komutlar ayıklanan `app-initial-*.js` bundle dosyası üzerinde çalıştırılmış ve her bir çapanın tekil (tam olarak 1 eşleşme) olduğu doğrulanmıştır:

```bash
$ grep -c "case\`currentTime/read\`:this.dispatchMessageFromView(\`mcp-response\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "id:\`codex.upsellBanner.plus.headline.noReset\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "id:\`codex.modelLimitBanner.headline.noReset\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "{item:\`new_thread\`}" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "id:\`codex.command.newThread\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1
```

---

## 6. Çapa Keşif Özeti ve 2. Tur Enjeksiyon Planı

| Yüzey | Seçilen Çapa | Çapa Türü | Regex / String Eşleşme | AST Aralığı | 2. Tur Aksiyonu |
|---|---|---|---|---|---|
| **Yüzey I: Dağıtıcı** | `RequestClient.onResult` / `currentTime/read` | Protokol Log / Metod İmzası | `currentTime/read` (1) | `[2444983, 2446100]` & `[3214623, 3218507]` | `learnThreadOwner` otomatik kaydı |
| **Yüzey II: Hata** | `codex.modelLimitBanner.headline.noReset` & `codex.upsellBanner.plus...` | React i18n ID / Hata Metni | `codex.modelLimitBanner...` (1) | `[10453689, 10455506]` & `[10426435, 10453689]` | `markIneligible` ve UI failover önerisi |
| **Yüzey III: Yeni Sohbet** | `{item:`new_thread`}` / `CKc` | Telemetri & UI Eylem İmzası | `new_thread` (1) | `[12112423, 12113059]` | `chooseAccount` ile otomatik yönlendirme |

Tüm keşif parçacıkları `/tmp/codexpp-anchor-discovery/` altında doğrulanmış ve 2. tur patch yazımı için hazır hale getirilmiştir.
