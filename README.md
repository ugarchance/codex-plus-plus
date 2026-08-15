# Codex++

`ChatGPT.app` (Codex masaüstü) yanına, orijinaline dokunmadan çalışan ikinci bir
uygulama kurar. Amaç: birden fazla aboneliği tek geçmiş üzerinden kullanabilmek.

Orijinal uygulama olduğu gibi kalır — imzası, otomatik güncellemesi, keychain
erişimi bozulmaz. İstediğin zaman ona dönebilirsin.

## Kurulum

```bash
./install.sh install
```

Gereksinimler: macOS, Xcode Command Line Tools (`clang`), kurulu `ChatGPT.app`.

Kaldırma:

```bash
./install.sh uninstall
```

## Ayarlar

Ortam değişkeniyle geçilir:

| Değişken | Varsayılan |
|---|---|
| `SRC_APP` | `/Applications/ChatGPT.app` |
| `DEST_APP` | `/Applications/Codex++.app` |
| `BUNDLE_ID` | `com.local.codexpp` |
| `USER_DATA_DIR` | `~/Library/Application Support/CodexPP` |
| `CODEX_HOME_SHARED` | `~/.codex` |

`CODEX_HOME` bilerek orijinalle **ortaktır** — thread geçmişi, projeler ve
skill'ler paylaşılsın diye. `USER_DATA_DIR` ise ayrıdır, yoksa iki uygulama
Electron'un tek-örnek kilidinde çakışır.

## Nasıl çalışıyor

Uygulama Electron tabanlı (`app.asar`), motoru ayrı bir `codex app-server`
süreci, aralarında JSON-RPC var.

Kurulum şunları yapar:

1. Bundle'ı `ditto` ile kopyalar
2. `CFBundleIdentifier`, `CFBundleName`, `CFBundleExecutable` değiştirir
3. `src/launcher.c`'yi derleyip ana çalıştırılabilir yapar
4. `embedded.provisionprofile` ve eski imzayı kaldırır
5. İçten dışa ad-hoc imzalar

### Launcher neden gerekli

`userData` dizini yalnızca Chromium'un `--user-data-dir` anahtarıyla
değiştirilebiliyor. Kodda duran `CODEX_ELECTRON_USER_DATA_PATH` değişkeni
okunuyor ama etkisiz:

```
ERROR:owl/browser/api/electron_api_app.cc:792
Ignoring late userData path change after native startup.
```

`app.setPath('userData')` native başlangıçtan sonra çağrıldığı için OpenAI'ın
özel Electron fork'u reddediyor. `Info.plist`'e argüman koyulamadığı ve
hardened runtime shell script'i ana çalıştırılabilir olarak kabul etmediği için
(`Launchd job spawn failed`, POSIX 162) küçük bir Mach-O launcher gerekiyor.

### İmzalama

Ad-hoc imza. Kısıtlı entitlement'lar (`keychain-access-groups`,
`application-groups`, `aps-environment`, `application-identifier`) düşürülür —
bunlar OpenAI'ın team id'sine bağlı ve devredilemez. Kaybedilenler: push
bildirimleri ve app-group'a bağlı iki servis.

`Codex++-bin` entitlement'larla imzalanmalı, aksi halde kütüphane doğrulaması
`Codex Framework`'ü yüklemeyi reddediyor (*different Team IDs*).

### Otomatik güncelleme

`CODEX_SPARKLE_ENABLED=false` ile kapatılır, yoksa fork kendini günceller ve
yamalar silinir. Orijinal uygulama güncellendiğinde `install.sh install` tekrar
çalıştırılmalı.

## Durum

Kurulum ve izolasyon çalışıyor. Çoklu hesap özelliği henüz yok.

Sonraki adım için tespit edilen bağlantı noktaları:

- `appServerConnectionRegistry.getConnection(hostId)` — birden fazla app-server
  bağlantısı zaten destekleniyor
- `$e({codexCliPath, codexHome, ...})` — her app-server ayrı `CODEX_HOME` ile
  spawn edilebiliyor
- `app_server_history_snapshots` tablosu `PRIMARY KEY (principal_key, host_id,
  thread_id)` — yerel önbellek hesap bazında bölünmüş
- Protokolde `Account/read`, `Account/rateLimits/read`, `Account/usage/read`,
  `Account/login/start`, `Account/logout`
- Motorda çalışma anı auth yeniden yüklemesi var (`Reloading auth`), hesap
  değişimini fark ediyor
- `is(e)` → `persist:codex-browser-<e>` — partition fabrikası parametrik

Protokol şemasını üretmek için:

```bash
/Applications/ChatGPT.app/Contents/Resources/codex app-server generate-json-schema --out ./schema --experimental
```

## Uyarılar

- Fork ile orijinali **aynı anda çalıştırma**. Ortak `CODEX_HOME` üzerinde iki
  app-server eşzamanlı SQLite erişimi demek.
- Ad-hoc imza notarization bilgisini geçersiz kılar. Yalnızca yerel kullanım
  için; dağıtım için uygun değil.
