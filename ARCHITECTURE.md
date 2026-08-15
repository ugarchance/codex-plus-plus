# Mimari

## Özet

Codex masaüstü uygulaması bir Electron **istemcisi**, motor ayrı bir Rust
süreci (`codex app-server`), araları JSON-RPC. Çoklu abonelik için motorda
zaten desteklenen bir yol var; üçüncü parti sağlayıcılar için ayrı bir yerel
geçit gerekiyor. İkisi tek bir yan süreçte (`codexpp-hub`) toplanır, arayüzde
tek liste olarak görünür.

| | Abonelikler | Sağlayıcılar |
|---|---|---|
| Mekanizma | external auth (`chatgptAuthTokens`) | `model_providers` + yerel geçit |
| Proxy | yok | var |
| Yapılandırma | çalışma anında, RPC | `~/.codex/config.toml` |
| Kimlik saklama | bellekte, motorda | dosyada, hub'da |

## Kanıtlanmış: external auth

`AuthMode` içinde motorun kendi tanımı:

> `chatgptAuthTokens` — ChatGPT auth tokens are supplied by an external host
> app and are only stored in memory. Token refresh must be handled by the
> external host app.

`ChatgptAuthTokensRefreshParams` açıklaması:

> Clients that manage multiple accounts/workspaces can use this as a hint to
> refresh the token for the correct workspace.

Boş bir `CODEX_HOME` ile canlı doğrulandı:

```
account/read      → account: null
account/login/start {type:"chatgptAuthTokens", accessToken, chatgptAccountId}
account/read      → {type:"chatgpt", planType:"pro", email:...}
account/rateLimits/read → {usedPercent, windowDurationMins, resetsAt, credits}
```

Sonrasında `CODEX_HOME` içinde `auth.json` **oluşmadı**. Kimlik yalnızca o
sürecin belleğinde. Sonuç: her app-server host'u farklı bir hesapla
çalıştırılabilir, hesaplar birbirini ezmez, `~/.codex/auth.json` hiç
değişmez.

Şema `[UNSTABLE] FOR OPENAI INTERNAL USE ONLY` diyor. Sürümler arası
değişebilir; kırıldığında belirti `account/login/start`'ın hata dönmesi olur.

## Bağlantı noktaları

`account/chatgptAuthTokens/refresh` bir **sunucu → istemci** isteği. Motor 401
aldığında token'ı istemciden ister. Masaüstü uygulamasında metot tanınıyor ama
gövdesi boş:

```js
case `currentTime/read`:
  this.dispatchMessageFromView(`mcp-response`, {hostId: this.hostId, response: {...}});
  break;
case `account/chatgptAuthTokens/refresh`:
case `attestation/generate`:
  break;
```

Yamanın gireceği yer burası. Yanındaki `currentTime/read` cevap kalıbını
gösteriyor. Çapa olarak metot adı kullanılır — protokol sabiti olduğu için
minified derlemeler arasında kaymaz.

`requestAttestation` initialize'da varsayılan `false`. Opt-in yapılmadığı
sürece `attestation/generate` gelmez.

## Yama yüzeyi

Ağırlık asar'ın dışında durur. Her Codex güncellemesinde yama yeniden
uygulanacağı için asar'a dokunan kısım küçük tutulur:

1. main process → hub'ı başlat, IPC köprüsü
2. renderer → `account/chatgptAuthTokens/refresh` cevabı
3. renderer → hesap menüsü paneli

Geri kalan her şey `hub/` altında normal kod.

## Sağlayıcı katmanı

Motorda `ModelProviderInfo` 18 alanla mevcut: `base_url`, `env_key`,
`env_key_instructions`, `experimental_bearer_token`, `auth`, `aws`, `wire_api`,
`query_params`, `http_headers`, `env_http_headers`, `request_max_retries`,
`stream_max_retries`, `stream_idle_timeout_ms`, `websocket_connect_timeout_ms`,
`requires_openai_auth`, `supports_websockets`, `supports_standalone_web_search`.

İki kısıt:

- `wire_api = "chat"` desteklenmiyor. Motorun hata mesajı: *"set
  `wire_api = "responses"` in your provider config"*. Geçit Responses API
  konuşmak zorunda; sağlayıcı konuşmuyorsa çeviri hub'ın işi.
- Yerleşik sağlayıcı id'leri korumalı: *"Built-in providers cannot be
  overridden."* Özel sağlayıcılar ayrı isimle tanımlanır.

Model listesi `model_catalog_json` ile besleniyor.

## Kimlik toplama

Hesap başına bir kez refresh token gerekiyor. OAuth'u sıfırdan yazmak yerine
yerleşik login akışı (`account/login/start {type:"chatgpt"}`) geçici bir
`CODEX_HOME` ile hesap başına bir kez çalıştırılır, oluşan `auth.json`
hub'ın deposuna alınır. Sonrasında token tazeleme hub'ın sorumluluğu.

## Şema üretimi

```bash
/Applications/ChatGPT.app/Contents/Resources/codex app-server generate-json-schema --out ./schema --experimental
```

132 istemci → sunucu metodu, 10 sunucu → istemci metodu.
